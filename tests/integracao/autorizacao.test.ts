import test from 'node:test';
import assert from 'node:assert/strict';
import type mysql from 'mysql2/promise';
import {
  BASE,
  Cookies,
  conecta,
  criaUsuarioTeste,
  emDesenvolvimento,
  listaClientes,
  login,
  removeUsuarioTeste,
  servidorNoAr,
} from './apoio';

/**
 * Teste de autorização entre clientes — item 2 da Fase 4 do
 * PLANO_IMPLEMENTACAO.md.
 *
 * Cria um usuário `cliente` de verdade, vinculado a UM cliente apenas,
 * faz login pelo fluxo real do Auth.js e tenta alcançar por URL direta
 * todas as rotas do OUTRO cliente. Nada aqui usa mock: a barreira que
 * este teste exercita é a mesma que roda em produção.
 *
 * Roda com `npm run test:integracao`, fora do `npm test`, porque precisa
 * do servidor no ar e escreve no banco. Sem servidor ou sem MySQL, os
 * casos são pulados em vez de falharem.
 *
 * O usuário de teste é removido no fim, mesmo quando um caso falha.
 */

const EMAIL_TESTE = 'qa-autorizacao@teste.local';

type Cenario = {
  cookies: Cookies;
  meu: string;
  alheio: string;
  /** Nome comercial do cliente alheio — nenhuma resposta de erro pode contê-lo. */
  nomeAlheio: string;
  /** Lead existente no cliente próprio, para as rotas que exigem um id real. */
  customerId: number;
  conexao: mysql.Connection;
};

async function preparaCenario(): Promise<Cenario | null> {
  if (!(await servidorNoAr())) return null;

  const conexao = await conecta();
  if (!conexao) return null;

  const clientes = await listaClientes(conexao);
  if (clientes.length < 2) {
    await conexao.end();
    return null;
  }
  const meu = clientes[0].client_db_name;
  const alheio = clientes[1].client_db_name;
  const nomeAlheio = clientes[1].account_name;

  // `customer_id` fixo não serve: a rota da thread valida o lead antes de
  // devolver 200, e um id inventado responderia 404 no caminho feliz.
  const [leads] = await conexao.query<mysql.RowDataPacket[]>(
    `SELECT id FROM \`${meu}\`.customers ORDER BY id LIMIT 1`,
  );
  const customerId = Number(leads[0]?.id ?? 0);

  const usuario = await criaUsuarioTeste(conexao, {
    email: EMAIL_TESTE,
    papel: 'cliente',
    clientes: [meu],
  });

  const cookies = await login(usuario.email, usuario.senha);
  return { cookies, meu, alheio, nomeAlheio, customerId, conexao };
}

/** Rotas de API, com os parâmetros mínimos que passam pela validação. */
function rotasApi(
  clientDb: string,
  customerId: number,
): { rotulo: string; url: string; metodo: string }[] {
  const q = (extra: Record<string, string>) =>
    new URLSearchParams({ client_db: clientDb, ...extra }).toString();
  const c = encodeURIComponent(clientDb);
  return [
    { rotulo: 'GET /api/leads', url: `${BASE}/api/leads?${q({})}`, metodo: 'GET' },
    { rotulo: 'GET /api/eventos', url: `${BASE}/api/eventos?${q({})}`, metodo: 'GET' },
    { rotulo: 'GET /api/conversas', url: `${BASE}/api/conversas?${q({})}`, metodo: 'GET' },
    {
      rotulo: 'GET /api/conversas/thread',
      url: `${BASE}/api/conversas/thread?${q({ customer_id: String(customerId) })}`,
      metodo: 'GET',
    },
    {
      rotulo: 'GET /api/campanhas',
      url: `${BASE}/api/campanhas?${q({ nivel: 'adset', pai: '1' })}`,
      metodo: 'GET',
    },
    { rotulo: 'POST /api/clientes/{c}/sync', url: `${BASE}/api/clientes/${c}/sync`, metodo: 'POST' },
    {
      rotulo: 'POST /api/clientes/{c}/importar-historico',
      url: `${BASE}/api/clientes/${c}/importar-historico`,
      metodo: 'POST',
    },
  ];
}

/** Páginas de cliente — todas abaixo do layout que chama o guard. */
function paginasCliente(clientDb: string): string[] {
  const base = `${BASE}/app/${encodeURIComponent(clientDb)}`;
  return [
    base,
    `${base}/campanhas`,
    `${base}/formularios/kanban`,
    `${base}/formularios/eventos`,
    `${base}/formularios/config`,
    `${base}/formularios/ia`,
    `${base}/whatsapp`,
    `${base}/whatsapp/conversas`,
    `${base}/whatsapp/eventos`,
    `${base}/whatsapp/estagios`,
    `${base}/whatsapp/ia`,
  ];
}

test('autorização entre clientes', async (t) => {
  const cenario = await preparaCenario();
  if (!cenario) {
    t.skip('servidor ou MySQL indisponível, ou menos de 2 clientes cadastrados');
    return;
  }

  try {
    const { cookies, meu, alheio, nomeAlheio, customerId } = cenario;
    const comSessao = { cookie: cookies.cabecalho() };
    if (!customerId) t.diagnostic('cliente próprio sem leads: a rota da thread devolve 404');

    await t.test('API do próprio cliente responde 200', async () => {
      for (const rota of rotasApi(meu, customerId).filter((r) => r.metodo === 'GET')) {
        const r = await fetch(rota.url, { headers: comSessao });
        assert.equal(r.status, 200, `${rota.rotulo} do próprio cliente devia responder 200`);
      }
    });

    await t.test('API de cliente alheio responde 403', async () => {
      for (const rota of rotasApi(alheio, customerId)) {
        const r = await fetch(rota.url, { method: rota.metodo, headers: comSessao });
        assert.equal(r.status, 403, `${rota.rotulo} de cliente alheio devia responder 403`);
      }
    });

    await t.test('cliente inexistente responde 403, não 404', async () => {
      // 404 aqui entregaria quais nomes de banco existem no sistema.
      for (const rota of rotasApi('cliente_que_nao_existe_999', customerId)) {
        const r = await fetch(rota.url, { method: rota.metodo, headers: comSessao });
        assert.equal(r.status, 403, `${rota.rotulo} inexistente devia responder 403`);
      }
    });

    await t.test('API sem sessão responde 401', async () => {
      for (const rota of rotasApi(meu, customerId)) {
        const r = await fetch(rota.url, { method: rota.metodo });
        assert.equal(r.status, 401, `${rota.rotulo} sem sessão devia responder 401`);
      }
    });

    await t.test('páginas do próprio cliente abrem', async () => {
      for (const url of paginasCliente(meu)) {
        const r = await fetch(url, { headers: comSessao, redirect: 'manual' });
        assert.equal(r.status, 200, `${url} devia abrir para quem tem vínculo`);
      }
    });

    await t.test('páginas de cliente alheio respondem 404 sem vazar nada', async () => {
      const dev = await emDesenvolvimento();
      if (dev) {
        t.diagnostic(
          'servidor em modo dev: o payload de depuração do Next anexa o resultado das ' +
            'funções de servidor, então a checagem de vazamento roda só contra `next start`',
        );
      }
      for (const url of paginasCliente(alheio)) {
        const r = await fetch(url, { headers: comSessao, redirect: 'manual' });
        // 404, não 500: erro de servidor já é sinal de que existe algo ali,
        // além de virar tela de erro genérica para quem só errou a URL.
        assert.equal(r.status, 404, `${url} devia responder 404 para outro cliente`);
        if (dev) continue;
        const corpo = await r.text();
        assert.ok(
          !corpo.includes(nomeAlheio),
          `${url} vazou o nome comercial do outro cliente na resposta`,
        );
      }
    });

    await t.test('área de administração barra usuário comum', async () => {
      for (const url of [`${BASE}/admin/usuarios`, `${BASE}/admin/clientes/novo`]) {
        const r = await fetch(url, { headers: comSessao, redirect: 'manual' });
        assert.notEqual(r.status, 200, `${url} não podia abrir para papel 'cliente'`);
      }
    });
  } finally {
    await removeUsuarioTeste(cenario.conexao, EMAIL_TESTE);
    await cenario.conexao.end();
  }
});
