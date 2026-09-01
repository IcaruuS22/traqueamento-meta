import 'server-only';
import { execute, LacunasDeEsquema, query, queryOne } from '@/lib/db/pool';
import { sanitizaNomeBanco, type BancoCliente } from '@/lib/db/cliente';
import { avaliaOrcamento, ultimoDiaConsiderado, type Orcamento } from '@/lib/orcamento';
import { epochSecParaData } from '@/lib/periodo';

/**
 * Leitura do fee mensal e do gasto do mês analisado.
 *
 * O fee vive no catálogo central (`trakeamento_controle.ad_accounts`,
 * coluna `monthly_fee`) porque é um dado comercial do cliente, não do seu
 * banco de leads — mesmo lugar de `content_category` e `status`.
 *
 * O gasto vem de `meta_insights_daily` no nível `campaign`, exatamente
 * como `totaisAnuncios` em `lib/db/metricas.ts`: somar os três níveis
 * multiplicaria o mesmo real por três. A regra do gasto está repetida
 * aqui e não reaproveitada de lá porque a janela é outra — o card compara
 * um mês inteiro, enquanto o período da tela pode ser sete dias ou um
 * intervalo qualquer dentro desse mês.
 *
 * As duas leituras toleram esquema defasado: banco que ainda não rodou
 * `Banco de Dados/migracao_fee_mensal.sql` devolve fee nulo, e o card
 * aparece pedindo o cadastro em vez de derrubar a página.
 */

/** Fee combinado com o cliente, ou `null` quando não há. */
export async function leFeeMensal(
  clientDb: string,
  lacunas?: LacunasDeEsquema,
): Promise<number | null> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return null;

  const coletor = lacunas ?? new LacunasDeEsquema();
  const linha = await coletor.ou(
    queryOne<{ monthly_fee: string | number | null }>(
      `SELECT monthly_fee FROM trakeamento_controle.ad_accounts
        WHERE client_db_name = ? LIMIT 1`,
      [nome],
    ),
    null,
  );

  const valor = Number(linha?.monthly_fee);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

/**
 * Fee de todos os clientes de uma vez, para a lista da administração.
 *
 * Uma consulta só em vez de uma por cartão. Banco sem a migração devolve
 * mapa vazio, e cada cartão mostra o campo em branco.
 */
export async function leFeesMensais(): Promise<Map<string, number | null>> {
  const lacunas = new LacunasDeEsquema();
  const linhas = await lacunas.ou(
    query<{ client_db_name: string; monthly_fee: string | number | null }>(
      `SELECT client_db_name, monthly_fee FROM trakeamento_controle.ad_accounts
        WHERE client_db_name IS NOT NULL AND client_db_name <> ''`,
    ),
    [],
  );

  const mapa = new Map<string, number | null>();
  for (const l of linhas) {
    const valor = Number(l.monthly_fee);
    mapa.set(l.client_db_name, Number.isFinite(valor) && valor > 0 ? valor : null);
  }
  return mapa;
}

/**
 * Gasto das campanhas entre o primeiro dia do mês e `ultimoDia`, ambos
 * inclusive e no formato "YYYY-MM-DD".
 *
 * `meta_insights_daily.date` é DATE, então a janela é fechada por
 * comparação de data e não por timestamp — o mesmo recorte que o
 * Gerenciador de Anúncios mostra por mês.
 */
export async function gastoDoMes(
  db: BancoCliente,
  mes: string,
  ultimoDia: string,
  lacunas?: LacunasDeEsquema,
): Promise<number> {
  const coletor = lacunas ?? new LacunasDeEsquema();
  const linha = await coletor.ou(
    db.queryOne<{ total: string | number | null }>(
      `SELECT COALESCE(SUM(spend), 0) AS total
         FROM ${db.tabela('meta_insights_daily')}
        WHERE entity_level = 'campaign'
          AND \`date\` >= ? AND \`date\` <= ?`,
      [`${mes}-01`, ultimoDia],
    ),
    null,
  );

  const total = Number(linha?.total);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/**
 * Fee e gasto já comparados, prontos para o card.
 *
 * `fimSec` é o fim (exclusivo) do período escolhido na tela: o mês
 * analisado é o do último dia desse período, para que filtrar agosto
 * mostre o fechamento de agosto. Sem período — o range "máximo" — o mês
 * é o corrente.
 */
export async function buscaOrcamentoDoMes(
  clientDb: string,
  db: BancoCliente,
  fimSec: number | null,
): Promise<Orcamento> {
  const hoje = epochSecParaData(Math.floor(Date.now() / 1000));
  // -1s porque `fimSec` é exclusivo: às 00:00 do dia 1 de setembro o
  // período que termina em 31 de agosto não pode virar setembro.
  const ultimoDoPeriodo = fimSec === null ? hoje : epochSecParaData(fimSec - 1);
  const mes = ultimoDoPeriodo.slice(0, 7);
  const ultimoDia = ultimoDiaConsiderado(mes, hoje);

  const lacunas = new LacunasDeEsquema();
  const [fee, gasto] = await Promise.all([
    leFeeMensal(clientDb, lacunas),
    gastoDoMes(db, mes, ultimoDia, lacunas),
  ]);
  return avaliaOrcamento({ fee, gasto, mes, hoje });
}

/**
 * Grava o fee combinado. `null` limpa o valor — cliente que deixou de ter
 * teto combinado volta ao card neutro, e não a um teto de zero.
 */
export async function salvaFeeMensal(clientDb: string, fee: number | null): Promise<void> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  await execute(
    `UPDATE trakeamento_controle.ad_accounts SET monthly_fee = ? WHERE client_db_name = ?`,
    [fee, nome],
  );
}
