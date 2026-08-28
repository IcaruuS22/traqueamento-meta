import 'server-only';
import { execute, query } from '@/lib/db/pool';
import { sanitizaNomeBanco } from '@/lib/db/cliente';
import { CATALOGO_METRICAS, metricaPorChave } from '@/lib/metricas-catalogo';

/**
 * Preferências de visibilidade das métricas.
 *
 * Porte de `GET /painel-api/metricas-prefs` (nodes "Consulta Metricas
 * Prefs" / "Monta Resposta Metricas Prefs") e de
 * `POST /painel-api/metricas-prefs-salvar`, somados à resolução que o
 * front-end antigo fazia em `isMetricVisible()`. As três metades ficam
 * juntas aqui porque separá-las nunca serviu a ninguém: o endpoint
 * devolvia as duas camadas cruas e cada tela reimplementava a decisão.
 *
 * Duas camadas, nesta ordem de precedência:
 *  1. linha com `client_db_name` = cliente atual — só vale para métricas
 *     marcadas como `porCliente` (Receita e ROAS: nem todo cliente
 *     consegue calcular receita de forma confiável);
 *  2. linha global (`client_db_name = ''`);
 *  3. o padrão do catálogo.
 *
 * O catálogo em si mora em `lib/metricas-catalogo.ts` — o seletor da tela
 * é componente de cliente e não pode importar um módulo `server-only`.
 */

export type { Metrica } from '@/lib/metricas-catalogo';
export { CATALOGO_METRICAS, rotuloMetrica } from '@/lib/metricas-catalogo';

type LinhaPref = { metric_key: string; client_db_name: string; visible: number | boolean | string };

/**
 * Resolve a visibilidade de cada métrica do catálogo para um cliente.
 * Devolve um mapa chave → visível.
 */
export async function visibilidadeMetricas(clientDb: string): Promise<Map<string, boolean>> {
  const nome = sanitizaNomeBanco(clientDb);

  let linhas: LinhaPref[] = [];
  try {
    linhas = await query<LinhaPref>(
      `SELECT metric_key, client_db_name, visible
         FROM trakeamento_controle.painel_metric_prefs
        WHERE client_db_name = '' OR client_db_name = ?`,
      [nome],
    );
  } catch {
    // A tabela é opcional: um ambiente que ainda não rodou a migração do
    // painel deve mostrar o padrão do catálogo, não uma tela de erro.
    linhas = [];
  }

  const global = new Map<string, boolean>();
  const doCliente = new Map<string, boolean>();
  for (const l of linhas) {
    const visivel = !(l.visible === false || l.visible === 0 || l.visible === '0');
    if (l.client_db_name && l.client_db_name === nome) doCliente.set(l.metric_key, visivel);
    else global.set(l.metric_key, visivel);
  }

  const resultado = new Map<string, boolean>();
  for (const m of CATALOGO_METRICAS) {
    if (m.porCliente && doCliente.has(m.key)) resultado.set(m.key, doCliente.get(m.key)!);
    else if (global.has(m.key)) resultado.set(m.key, global.get(m.key)!);
    else resultado.set(m.key, m.padrao !== false);
  }
  return resultado;
}

/**
 * Liga/desliga uma métrica. Uma linha por vez, igual ao endpoint antigo.
 *
 * O destino da escrita é decidido pelo catálogo, nunca pelo que chega do
 * navegador: métrica `porCliente` grava na linha do cliente, o resto
 * grava na linha global (`client_db_name = ''`). No endpoint antigo isso
 * dependia de o front-end mandar (ou não) `client_db` no corpo — quem
 * chamasse a API na mão conseguia criar uma linha por cliente para uma
 * métrica global, que a leitura então ignorava para sempre.
 */
export async function salvaPreferenciaMetrica(
  clientDb: string,
  metricKey: string,
  visivel: boolean,
): Promise<{ escopo: 'cliente' | 'global' }> {
  const metrica = metricaPorChave(metricKey);
  if (!metrica) throw new Error(`Métrica desconhecida: ${metricKey}`);

  const alvo = metrica.porCliente ? sanitizaNomeBanco(clientDb) : '';
  const valor = visivel ? 1 : 0;

  // A unicidade é por (client_db_name, metric_key), então salvar a mesma
  // combinação atualiza em vez de duplicar.
  await execute(
    `INSERT INTO trakeamento_controle.painel_metric_prefs (client_db_name, metric_key, visible)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE visible = ?`,
    [alvo, metricKey, valor, valor],
  );

  return { escopo: metrica.porCliente ? 'cliente' : 'global' };
}
