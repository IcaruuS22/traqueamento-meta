import 'server-only';
import { execute, LacunasDeEsquema, query, queryOne } from '@/lib/db/pool';
import { sanitizaNomeBanco, type BancoCliente } from '@/lib/db/cliente';
import { avaliaOrcamento, ultimoDiaConsiderado, type Orcamento } from '@/lib/orcamento';
import {
  montaOrcamentoPorCategoria,
  type CategoriaVerba,
  type GastoCategoria,
  type OrcamentoPorCategoria,
} from '@/lib/orcamento-categorias';
import { epochSecParaData } from '@/lib/periodo';

/**
 * Leitura do investimento mensal e do gasto do mês analisado.
 *
 * O investimento vive no catálogo central (`trakeamento_controle.ad_accounts`,
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
 * `Banco de Dados/migracao_fee_mensal.sql` devolve investimento nulo, e o card
 * aparece pedindo o cadastro em vez de derrubar a página.
 */

/** Investimento combinado com o cliente, ou `null` quando não há. */
export async function leInvestimentoMensal(
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
 * Investimento de todos os clientes de uma vez, para a lista da administração.
 *
 * Uma consulta só em vez de uma por cartão. Banco sem a migração devolve
 * mapa vazio, e cada cartão mostra o campo em branco.
 */
export async function leInvestimentosMensais(): Promise<Map<string, number | null>> {
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
 *
 * Volta também o subtotal até o dia anterior a `hoje`, na mesma consulta.
 * O card mede o ritmo em dias inteiros, e o dia de hoje está pela metade
 * na hora em que alguém olha o painel — uma segunda consulta só para
 * descontá-lo seria uma varredura a mais na mesma tabela.
 */
export async function gastoDoMes(
  db: BancoCliente,
  mes: string,
  ultimoDia: string,
  hoje: string,
  lacunas?: LacunasDeEsquema,
): Promise<{ total: number; ateOntem: number }> {
  const coletor = lacunas ?? new LacunasDeEsquema();
  const linha = await coletor.ou(
    db.queryOne<{ total: string | number | null; ate_ontem: string | number | null }>(
      `SELECT COALESCE(SUM(spend), 0) AS total,
              COALESCE(SUM(CASE WHEN \`date\` < ? THEN spend ELSE 0 END), 0) AS ate_ontem
         FROM ${db.tabela('meta_insights_daily')}
        WHERE entity_level = 'campaign'
          AND \`date\` >= ? AND \`date\` <= ?`,
      [hoje, `${mes}-01`, ultimoDia],
    ),
    null,
  );

  const positivo = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return { total: positivo(linha?.total), ateOntem: positivo(linha?.ate_ontem) };
}

/**
 * Investimento e gasto já comparados, prontos para o card.
 *
 * `fimSec` é o fim (exclusivo) do período escolhido na tela: o mês
 * analisado é o do último dia desse período, para que filtrar agosto
 * mostre o fechamento de agosto. Sem período — o range "máximo" — o mês
 * é o corrente.
 */
/**
 * Categorias de verba do cliente, com a verba de cada uma.
 *
 * Vivem no banco central junto de `monthly_fee`, pelo mesmo motivo: é
 * dado comercial, e assim a migração roda uma vez em vez de uma por
 * cliente. Banco sem `Banco de Dados/migracao_verba_por_categoria.sql`
 * devolve lista vazia, e a tela mostra só o total do mês.
 */
export async function leCategoriasVerba(
  clientDb: string,
  lacunas?: LacunasDeEsquema,
): Promise<CategoriaVerba[]> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return [];

  const coletor = lacunas ?? new LacunasDeEsquema();
  const linhas = await coletor.ou(
    query<{ id: number; nome: string; monthly_budget: string | number | null; ordem: number }>(
      `SELECT id, nome, monthly_budget, ordem
         FROM trakeamento_controle.campaign_categories
        WHERE client_db_name = ?
        ORDER BY ordem, nome`,
      [nome],
    ),
    [],
  );

  return linhas.map((l) => {
    const verba = Number(l.monthly_budget);
    return {
      id: Number(l.id),
      nome: l.nome,
      verba: Number.isFinite(verba) && verba > 0 ? verba : null,
      ordem: Number(l.ordem) || 0,
    };
  });
}

/**
 * Gasto do mês quebrado por categoria, na mesma janela de `gastoDoMes`.
 *
 * O `LEFT JOIN` é entre bancos: os insights estão no banco do cliente e o
 * mapa no central. Isso funciona porque a conexão é uma só e o usuário
 * enxerga os dois — é o mesmo arranjo que `leInvestimentoMensal` já usa
 * ao ler `trakeamento_controle.ad_accounts` de dentro do painel.
 *
 * O `client_db_name` entra na condição do join, e não no `WHERE`: no
 * `WHERE` ele viraria um `INNER JOIN` disfarçado e apagaria justamente a
 * linha que mais importa, a das campanhas sem categoria.
 *
 * Chave `null` no mapa = campanha ainda não classificada. Cliente que não
 * rodou a migração cai no mesmo lugar: tudo sem categoria, nenhum erro.
 */
export async function gastoDoMesPorCategoria(
  db: BancoCliente,
  clientDb: string,
  mes: string,
  ultimoDia: string,
  hoje: string,
  lacunas?: LacunasDeEsquema,
): Promise<Map<number | null, GastoCategoria>> {
  const mapa = new Map<number | null, GastoCategoria>();
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return mapa;

  const coletor = lacunas ?? new LacunasDeEsquema();
  const linhas = await coletor.ou(
    db.query<{
      category_id: number | null;
      total: string | number | null;
      ate_ontem: string | number | null;
    }>(
      `SELECT m.category_id AS category_id,
              COALESCE(SUM(i.spend), 0) AS total,
              COALESCE(SUM(CASE WHEN i.\`date\` < ? THEN i.spend ELSE 0 END), 0) AS ate_ontem
         FROM ${db.tabela('meta_insights_daily')} i
         LEFT JOIN trakeamento_controle.campaign_category_map m
           ON m.campaign_id = i.campaign_id AND m.client_db_name = ?
        WHERE i.entity_level = 'campaign'
          AND i.\`date\` >= ? AND i.\`date\` <= ?
        GROUP BY m.category_id`,
      [hoje, nome, `${mes}-01`, ultimoDia],
    ),
    [],
  );

  const positivo = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  for (const l of linhas) {
    const id = l.category_id === null ? null : Number(l.category_id);
    mapa.set(id, { total: positivo(l.total), ateOntem: positivo(l.ate_ontem) });
  }
  return mapa;
}

/** O card geral e a quebra por categoria, do mesmo mês. */
export type OrcamentoDoMes = {
  orcamento: Orcamento;
  categorias: OrcamentoPorCategoria;
};

export async function buscaOrcamentoDoMes(
  clientDb: string,
  db: BancoCliente,
  fimSec: number | null,
): Promise<OrcamentoDoMes> {
  const hoje = epochSecParaData(Math.floor(Date.now() / 1000));
  // -1s porque `fimSec` é exclusivo: às 00:00 do dia 1 de setembro o
  // período que termina em 31 de agosto não pode virar setembro.
  const ultimoDoPeriodo = fimSec === null ? hoje : epochSecParaData(fimSec - 1);
  const mes = ultimoDoPeriodo.slice(0, 7);
  const ultimoDia = ultimoDiaConsiderado(mes, hoje);

  const lacunas = new LacunasDeEsquema();
  const [investimento, gasto, categorias, gastoPorCategoria] = await Promise.all([
    leInvestimentoMensal(clientDb, lacunas),
    gastoDoMes(db, mes, ultimoDia, hoje, lacunas),
    leCategoriasVerba(clientDb, lacunas),
    gastoDoMesPorCategoria(db, clientDb, mes, ultimoDia, hoje, lacunas),
  ]);

  return {
    orcamento: avaliaOrcamento({
      investimento,
      gasto: gasto.total,
      gastoAteOntem: gasto.ateOntem,
      mes,
      hoje,
    }),
    categorias: montaOrcamentoPorCategoria({
      categorias,
      gastos: gastoPorCategoria,
      investimento,
      mes,
      hoje,
    }),
  };
}

/**
 * Grava o investimento combinado. `null` limpa o valor — cliente que deixou de ter
 * teto combinado volta ao card neutro, e não a um teto de zero.
 */
export async function salvaInvestimentoMensal(
  clientDb: string,
  investimento: number | null,
): Promise<void> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  await execute(
    `UPDATE trakeamento_controle.ad_accounts SET monthly_fee = ? WHERE client_db_name = ?`,
    [investimento, nome],
  );
}

/**
 * Campanha do cliente com o objetivo da Meta e a categoria atual.
 *
 * O objetivo vem junto porque é o que torna a classificação viável: uma
 * conta madura tem dezenas de campanhas, e marcar uma a uma é trabalho
 * que ninguém faz. Com o objetivo à vista dá para atribuir todas as de
 * "Cadastros" a "Captação" de uma vez e depois corrigir as exceções.
 */
export type CampanhaClassificavel = {
  campaign_id: string;
  nome: string | null;
  status: string | null;
  /** Cru, como veio da Meta ("OUTCOME_LEADS"). Rótulo em `lib/objetivos-meta.ts`. */
  objetivo: string | null;
  /** Categoria atual, ou `null` quando ainda não foi classificada. */
  categoria_id: number | null;
};

/** Todas as campanhas do cliente, com objetivo e categoria. */
export async function leCampanhasClassificaveis(
  db: BancoCliente,
  clientDb: string,
  lacunas?: LacunasDeEsquema,
): Promise<CampanhaClassificavel[]> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return [];

  const coletor = lacunas ?? new LacunasDeEsquema();
  const linhas = await coletor.ou(
    db.query<{
      campaign_id: string;
      campaign_name: string | null;
      status: string | null;
      objective: string | null;
      category_id: number | null;
    }>(
      `SELECT c.campaign_id, c.campaign_name, c.status, c.objective, m.category_id
         FROM ${db.tabela('meta_campaigns')} c
         LEFT JOIN trakeamento_controle.campaign_category_map m
           ON m.campaign_id = c.campaign_id AND m.client_db_name = ?
        ORDER BY c.campaign_name`,
      [nome],
    ),
    [],
  );

  return linhas.map((l) => ({
    campaign_id: String(l.campaign_id),
    nome: l.campaign_name,
    status: l.status,
    objetivo: l.objective,
    categoria_id: l.category_id === null ? null : Number(l.category_id),
  }));
}

/** Cria uma categoria e devolve o id. */
export async function criaCategoriaVerba(
  clientDb: string,
  nome: string,
  verba: number | null,
  ordem: number,
): Promise<number> {
  const banco = sanitizaNomeBanco(clientDb);
  if (!banco) throw new Error('Nome de banco de cliente inválido');

  const r = await execute(
    `INSERT INTO trakeamento_controle.campaign_categories
       (client_db_name, nome, monthly_budget, ordem) VALUES (?, ?, ?, ?)`,
    [banco, nome, verba, ordem],
  );
  return r.insertId;
}

/**
 * Renomeia a categoria e/ou muda a verba.
 *
 * O `client_db_name` entra no `WHERE` junto do id: sem ele, um id
 * adivinhado editaria a categoria de outro cliente.
 */
export async function atualizaCategoriaVerba(
  clientDb: string,
  id: number,
  nome: string,
  verba: number | null,
): Promise<number> {
  const banco = sanitizaNomeBanco(clientDb);
  if (!banco) throw new Error('Nome de banco de cliente inválido');

  const r = await execute(
    `UPDATE trakeamento_controle.campaign_categories
        SET nome = ?, monthly_budget = ?
      WHERE id = ? AND client_db_name = ?`,
    [nome, verba, id, banco],
  );
  return r.affectedRows;
}

/**
 * Apaga a categoria. As campanhas dela voltam a ficar sem categoria pelo
 * `ON DELETE CASCADE` do mapa — nenhum gasto some, ele só deixa de estar
 * classificado.
 */
export async function removeCategoriaVerba(clientDb: string, id: number): Promise<number> {
  const banco = sanitizaNomeBanco(clientDb);
  if (!banco) throw new Error('Nome de banco de cliente inválido');

  const r = await execute(
    `DELETE FROM trakeamento_controle.campaign_categories
      WHERE id = ? AND client_db_name = ?`,
    [id, banco],
  );
  return r.affectedRows;
}

/** Maior `ordem` já usada pelo cliente, para a próxima categoria entrar no fim. */
export async function proximaOrdemCategoria(clientDb: string): Promise<number> {
  const banco = sanitizaNomeBanco(clientDb);
  if (!banco) return 0;

  const linha = await queryOne<{ maior: number | null }>(
    `SELECT MAX(ordem) AS maior FROM trakeamento_controle.campaign_categories
      WHERE client_db_name = ?`,
    [banco],
  );
  const maior = Number(linha?.maior);
  return Number.isFinite(maior) ? maior + 1 : 0;
}

/**
 * Põe (ou tira) um conjunto de campanhas numa categoria.
 *
 * `categoriaId` nulo desclassifica. O `INSERT ... ON DUPLICATE KEY` faz o
 * mover valer tanto para campanha nova quanto para campanha que já estava
 * em outra categoria — a chave primária é (cliente, campanha), então
 * mudar de categoria é sobrescrever, e não acumular duas linhas.
 *
 * Escreve em lote porque o caso normal é atribuir dezenas de campanhas de
 * uma vez, vindas do filtro por objetivo da Meta.
 */
export async function defineCategoriaDeCampanhas(
  clientDb: string,
  campanhas: string[],
  categoriaId: number | null,
): Promise<number> {
  const banco = sanitizaNomeBanco(clientDb);
  if (!banco) throw new Error('Nome de banco de cliente inválido');
  if (campanhas.length === 0) return 0;

  const marcadores = campanhas.map(() => '?').join(', ');

  if (categoriaId === null) {
    const r = await execute(
      `DELETE FROM trakeamento_controle.campaign_category_map
        WHERE client_db_name = ? AND campaign_id IN (${marcadores})`,
      [banco, ...campanhas],
    );
    return r.affectedRows;
  }

  const valores = campanhas.map(() => '(?, ?, ?)').join(', ');
  const params: unknown[] = [];
  for (const c of campanhas) params.push(banco, c, categoriaId);

  const r = await execute(
    `INSERT INTO trakeamento_controle.campaign_category_map
       (client_db_name, campaign_id, category_id) VALUES ${valores}
     ON DUPLICATE KEY UPDATE category_id = VALUES(category_id)`,
    params,
  );
  return r.affectedRows;
}
