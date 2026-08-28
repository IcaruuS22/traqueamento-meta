import test from 'node:test';
import assert from 'node:assert/strict';
import type mysql from 'mysql2/promise';
import {
  BASE,
  conecta,
  criaUsuarioTeste,
  listaClientes,
  login,
  removeUsuarioTeste,
  servidorNoAr,
  threadsConectadas,
} from './apoio';

/**
 * Teste de carga leve — item 3 da Fase 4 do PLANO_IMPLEMENTACAO.md.
 *
 * Não mede desempenho: mede se o pool segura a mão. `connectionLimit` é 3
 * (ver `lib/db/pool.ts`), justamente porque o `max_connections` do MySQL
 * do VPS é o recurso mais escasso da arquitetura. 20 requisições
 * simultâneas precisam então (a) responder todas, enfileirando em vez de
 * abrir conexão nova, e (b) não fazer `Threads_connected` subir junto com
 * o número de requisições.
 *
 * O número que interessa é o SALTO de `Threads_connected` durante a
 * rajada, não o valor absoluto: o servidor é compartilhado com o n8n e
 * com o painel antigo, que abrem conexões o tempo todo.
 */

const EMAIL_TESTE = 'qa-carga@teste.local';
const SIMULTANEAS = 20;

/**
 * Folga sobre o `connectionLimit` do pool. Uma instância pode manter até
 * 3; o resto da margem cobre a conexão deste próprio teste e o vaivém
 * normal do n8n durante a medição.
 */
const SALTO_ACEITAVEL = 6;

type Cenario = {
  cabecalho: Record<string, string>;
  cliente: string;
  conexao: mysql.Connection;
};

async function preparaCenario(): Promise<Cenario | null> {
  if (!(await servidorNoAr())) return null;

  const conexao = await conecta();
  if (!conexao) return null;

  const clientes = await listaClientes(conexao);
  if (clientes.length === 0) {
    await conexao.end();
    return null;
  }
  const cliente = clientes[0].client_db_name;

  const usuario = await criaUsuarioTeste(conexao, {
    email: EMAIL_TESTE,
    papel: 'cliente',
    clientes: [cliente],
  });
  const cookies = await login(usuario.email, usuario.senha);

  return { cabecalho: { cookie: cookies.cabecalho() }, cliente, conexao };
}

type Resultado = { status: number; ms: number };

async function rajada(url: string, cabecalho: Record<string, string>): Promise<Resultado[]> {
  const inicio = Date.now();
  const disparos = Array.from({ length: SIMULTANEAS }, async () => {
    const t0 = Date.now();
    const r = await fetch(url, { headers: cabecalho, signal: AbortSignal.timeout(60_000) });
    // O corpo precisa ser consumido, senão a conexão fica presa e o
    // tempo medido não corresponde ao da requisição completa.
    await r.text();
    return { status: r.status, ms: Date.now() - t0 };
  });
  const resultados = await Promise.all(disparos);
  resultados.sort((a, b) => a.ms - b.ms);
  console.log(
    `  ${url.replace(BASE, '')} — ${SIMULTANEAS} simultâneas em ${Date.now() - inicio}ms ` +
      `(mais rápida ${resultados[0].ms}ms, mediana ${resultados[Math.floor(SIMULTANEAS / 2)].ms}ms, ` +
      `mais lenta ${resultados[SIMULTANEAS - 1].ms}ms)`,
  );
  return resultados;
}

test('carga leve com 20 requisições simultâneas', async (t) => {
  const cenario = await preparaCenario();
  if (!cenario) {
    t.skip('servidor ou MySQL indisponível, ou nenhum cliente cadastrado');
    return;
  }

  const { cabecalho, cliente, conexao } = cenario;
  const q = new URLSearchParams({ client_db: cliente }).toString();

  try {
    const antes = await threadsConectadas(conexao);
    t.diagnostic(`Threads_connected antes: ${antes}`);

    let pico = antes;
    const observador = setInterval(() => {
      threadsConectadas(conexao)
        .then((n) => {
          if (n > pico) pico = n;
        })
        .catch(() => {});
    }, 200);

    try {
      for (const url of [
        `${BASE}/api/health`,
        `${BASE}/api/leads?${q}`,
        `${BASE}/api/eventos?${q}`,
      ]) {
        const resultados = await rajada(url, cabecalho);
        const falhas = resultados.filter((r) => r.status !== 200);
        assert.equal(
          falhas.length,
          0,
          `${url} devolveu ${falhas.length} respostas fora de 200 (${[
            ...new Set(falhas.map((f) => f.status)),
          ].join(', ')}) — pool estourado ou fila recusada`,
        );
      }
    } finally {
      clearInterval(observador);
    }

    const depois = await threadsConectadas(conexao);
    t.diagnostic(`Threads_connected pico: ${pico} · depois: ${depois}`);

    assert.ok(
      pico - antes <= SALTO_ACEITAVEL,
      `Threads_connected saltou de ${antes} para ${pico} durante ${SIMULTANEAS} requisições ` +
        'simultâneas: o pool não está segurando a concorrência',
    );
  } finally {
    await removeUsuarioTeste(conexao, EMAIL_TESTE);
    await conexao.end();
  }
});
