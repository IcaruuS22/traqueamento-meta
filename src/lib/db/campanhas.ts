import 'server-only';
import type { BancoCliente } from '@/lib/db/cliente';
import { LacunasDeEsquema } from '@/lib/db/pool';
import { condicaoTimestamp, condicaoData, montaWhere, type Periodo } from '@/lib/periodo';
import type { Fragmento } from '@/lib/db/metricas';

/**
 * Hierarquia Campanha → Conjunto → Anúncio.
 *
 * Porte de `GET /painel-api/campanhas`, `/campanhas/adsets` e
 * `/campanhas/ads` (função `buildHierarquiaQuery` de
 * `Painel Administrativo/build_admin_panel_workflow.js`). Os três
 * endpoints do n8n eram a MESMA query com quatro identificadores
 * trocados; aqui viram um nível só, parametrizado por `NIVEIS`.
 *
 * O SQL foi copiado literalmente. O que mudou:
 *  - os limites de data e o id do pai entram por `?`;
 *  - identificadores de banco/tabela passam por `BancoCliente.tabela`;
 *  - as colunas de id e nome saem com alias fixo (`id`, `nome`) para que
 *    uma única linha de tabela sirva aos três níveis — no painel antigo
 *    o front-end carregava `idKey`/`nameKey` por nível só por causa disso.
 */

export type NivelHierarquia = 'campaign' | 'adset' | 'ad';

type ConfigNivel = {
  tabela: string;
  colunaId: string;
  colunaNome: string;
  /** `meta_ads` não tem orçamento próprio — ele vive no conjunto. */
  temOrcamento: boolean;
  /** Coluna que liga a entidade ao pai. `null` no nível raiz. */
  colunaPai: string | null;
  /** Nível filho carregado ao expandir a linha. `null` na folha. */
  filho: NivelHierarquia | null;
};

export const NIVEIS: Record<NivelHierarquia, ConfigNivel> = {
  campaign: {
    tabela: 'meta_campaigns',
    colunaId: 'campaign_id',
    colunaNome: 'campaign_name',
    temOrcamento: true,
    colunaPai: null,
    filho: 'adset',
  },
  adset: {
    tabela: 'meta_adsets',
    colunaId: 'adset_id',
    colunaNome: 'adset_name',
    temOrcamento: true,
    colunaPai: 'campaign_id',
    filho: 'ad',
  },
  ad: {
    tabela: 'meta_ads',
    colunaId: 'ad_id',
    colunaNome: 'ad_name',
    temOrcamento: false,
    colunaPai: 'adset_id',
    filho: null,
  },
};

export type EventoFunil = { event_name: string; total: number };

export type LinhaHierarquia = {
  id: string;
  nome: string | null;
  status: string | null;
  /** Diário quando existe; senão o vitalício. `null` no nível de anúncio. */
  orcamento: number | null;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  unique_clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  total_leads: number;
  total_conversoes: number;
  cpl: number | null;
  cac: number | null;
  receita: number;
  funil_eventos: EventoFunil[];
};

export type Hierarquia = {
  nivel: NivelHierarquia;
  linhas: LinhaHierarquia[];
  /**
   * Gasto de nível campanha registrado no período, incluindo campanhas que
   * não estão mais na conta. Só é calculado no nível raiz; `null` nos
   * demais. Ver `gastoTotalCampanhas`.
   */
  gasto_total_periodo: number | null;
  /** Mesma semântica de `Metricas.lacunas_de_esquema`. */
  lacunas_de_esquema: string[];
};

type LinhaBruta = {
  id: string | number | null;
  nome: string | null;
  status: string | null;
  daily_budget?: string | number | null;
  lifetime_budget?: string | number | null;
  spend: unknown;
  impressions: unknown;
  reach: unknown;
  frequency: unknown;
  clicks: unknown;
  unique_clicks: unknown;
  ctr: unknown;
  cpc: unknown;
  cpm: unknown;
  total_leads: unknown;
  total_conversoes: unknown;
  cpl: unknown;
  cac: unknown;
  receita: unknown;
  funil_eventos: string | null;
};

const num = (v: unknown): number => Number(v) || 0;
const numOuNulo = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * `"Lead:5|LeadQualified:3"` → lista ordenada (o banco já devolve do mais
 * para o menos frequente). O corte é no ÚLTIMO `:` porque nome de evento
 * personalizado pode conter dois-pontos.
 */
export function parseFunil(bruto: string | null | undefined): EventoFunil[] {
  if (!bruto) return [];
  const eventos: EventoFunil[] = [];
  for (const par of String(bruto).split('|')) {
    if (!par) continue;
    const corte = par.lastIndexOf(':');
    if (corte === -1) continue;
    eventos.push({ event_name: par.slice(0, corte), total: Number(par.slice(corte + 1)) || 0 });
  }
  return eventos;
}

/**
 * Filtros de período desta tela.
 *
 * Campanhas não filtra por canal: a aba fica na seção "Geral" e um
 * anúncio do Meta gera lead pelos dois caminhos (Formulário Instantâneo e
 * clique-para-WhatsApp). Separar por canal aqui faria o gasto — que é
 * sempre do anúncio inteiro — ser comparado com uma fração dos leads.
 */
function filtrosDaJanela(periodo: Periodo) {
  const leads = condicaoTimestamp('c.created_at', periodo.inicioSec, periodo.fimSec);
  const insights = condicaoData('date', periodo.inicioSec, periodo.fimSec);
  return {
    whereLeads: {
      sql: montaWhere([leads.sql]),
      params: leads.params as unknown[],
    } satisfies Fragmento,
    andInsights: {
      sql: insights.sql ? `AND ${insights.sql}` : '',
      params: insights.params as unknown[],
    } satisfies Fragmento,
  };
}

/**
 * Gasto total de nível campanha no período, direto de `meta_insights_daily`.
 *
 * A hierarquia parte de `meta_campaigns` e só enxerga o que ainda existe na
 * conta: uma campanha excluída no Meta some da ressincronização, mas o gasto
 * que ela já teve continua em `meta_insights_daily` — e continua entrando no
 * "Gasto (Meta Ads)" da Visão geral, que soma a tabela de insights inteira.
 * Sem este número a tabela simplesmente não fecharia com o cabeçalho, sem
 * explicação. É a mesma soma de `totaisAnuncios` (metricas.ts).
 */
async function gastoTotalCampanhas(db: BancoCliente, f: Fragmento): Promise<number> {
  const linha = await db.queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(spend),0) AS total
       FROM ${db.tabela('meta_insights_daily')}
      WHERE entity_level = 'campaign' ${f.sql}`,
    f.params,
  );
  return Number(linha?.total) || 0;
}

/**
 * Busca um nível da hierarquia.
 *
 * Atribuição de leads (`grupo`/`juncaoAds`) — a parte mais fácil de errar
 * e a que já causou bug em produção: no nível "ad" o agrupamento é direto
 * por `customers.meta_ad_id`, que é a origem primária, gravada no momento
 * da captura do lead. Nos níveis "adset"/"campaign" NÃO se agrupa pelas
 * colunas `customers.meta_adset_id`/`meta_campaign_id` (também gravadas na
 * captura, mas congeladas: se o anúncio for movido de conjunto depois, elas
 * continuam apontando para o conjunto antigo). O agrupamento é derivado do
 * `meta_ad_id` via JOIN em `meta_ads`, que é ressincronizada com a
 * estrutura ATUAL da conta a cada atualização — assim a soma dos filhos
 * sempre bate com o total do pai, em vez de o conjunto mostrar menos leads
 * do que a soma dos próprios anúncios.
 */
export async function buscaHierarquia(
  db: BancoCliente,
  nivel: NivelHierarquia,
  periodo: Periodo,
  paiId?: string | null,
): Promise<Hierarquia> {
  const cfg = NIVEIS[nivel];
  const { whereLeads, andInsights } = filtrosDaJanela(periodo);

  const grupo =
    nivel === 'ad' ? 'c.meta_ad_id' : `ma.${nivel === 'adset' ? 'adset_id' : 'campaign_id'}`;
  const juncaoAds =
    nivel === 'ad' ? '' : ` JOIN ${db.tabela('meta_ads')} ma ON ma.ad_id = c.meta_ad_id`;

  const entidade = db.tabela(cfg.tabela);
  const customers = db.tabela('customers');
  const capi = db.tabela('meta_capi_events');
  const mapa = db.tabela('crm_meta_event_map');

  const orcamento = cfg.temOrcamento ? ', mc.daily_budget, mc.lifetime_budget' : '';
  // Sem filtro de status: campanha pausada sem gasto no período também
  // aparece. Ela ficava de fora, e desde que o status virou chave
  // liga/desliga isso escondia justamente a linha que se quer religar.
  const escopo = cfg.colunaPai && paiId ? `
      WHERE mc.${cfg.colunaPai} = ?` : '';

  const sql =
    `SELECT mc.${cfg.colunaId} AS id, mc.${cfg.colunaNome} AS nome, mc.status AS status${orcamento},
            COALESCE(ins.spend, 0) AS spend, COALESCE(ins.impressions, 0) AS impressions,
            COALESCE(ins.reach, 0) AS reach, COALESCE(ins.frequency, 0) AS frequency,
            COALESCE(ins.clicks, 0) AS clicks, COALESCE(ins.unique_clicks, 0) AS unique_clicks,
            COALESCE(ins.ctr, 0) AS ctr, COALESCE(ins.cpc, 0) AS cpc, COALESCE(ins.cpm, 0) AS cpm,
            COALESCE(leads.total_leads, 0) AS total_leads,
            COALESCE(conv.total_conversoes, 0) AS total_conversoes,
            CASE WHEN COALESCE(leads.total_leads,0) = 0 THEN NULL
                 ELSE ROUND(COALESCE(ins.spend,0) / leads.total_leads, 2) END AS cpl,
            CASE WHEN COALESCE(conv.total_conversoes,0) = 0 THEN NULL
                 ELSE ROUND(COALESCE(ins.spend,0) / conv.total_conversoes, 2) END AS cac,
            COALESCE(funil.funil, '') AS funil_eventos,
            COALESCE(receita.total_receita, 0) AS receita
       FROM ${entidade} mc
       LEFT JOIN ( SELECT entity_id, SUM(spend) spend, SUM(impressions) impressions,
                          SUM(reach) reach, AVG(frequency) frequency, SUM(clicks) clicks,
                          SUM(unique_clicks) unique_clicks, AVG(ctr) ctr, AVG(cpc) cpc, AVG(cpm) cpm
                     FROM ${db.tabela('meta_insights_daily')}
                    WHERE entity_level = ? ${andInsights.sql}
                    GROUP BY entity_id ) ins ON ins.entity_id = mc.${cfg.colunaId}
       LEFT JOIN ( SELECT ${grupo} AS entity_id, COUNT(DISTINCT c.id) AS total_leads
                     FROM ${customers} c${juncaoAds} ${whereLeads.sql}
                    GROUP BY ${grupo} ) leads ON leads.entity_id = mc.${cfg.colunaId}
       LEFT JOIN ( SELECT ${grupo} AS entity_id, COUNT(DISTINCT c.id) AS total_conversoes
                     FROM ${customers} c${juncaoAds}
                     JOIN ${mapa} em ON em.status_id = c.current_stage AND em.is_conversion = 1
                     ${whereLeads.sql}
                    GROUP BY ${grupo} ) conv ON conv.entity_id = mc.${cfg.colunaId}
       LEFT JOIN ( SELECT entity_id,
                          GROUP_CONCAT(CONCAT(event_name, ':', total) ORDER BY total DESC SEPARATOR '|') AS funil
                     FROM ( SELECT ${grupo} AS entity_id, e.event_name AS event_name, COUNT(*) AS total
                              FROM ${capi} e
                              JOIN ${customers} c ON c.id = e.customer_id${juncaoAds}
                              ${whereLeads.sql} AND e.status = 'SENT'
                             GROUP BY ${grupo}, e.event_name ) x
                    GROUP BY entity_id ) funil ON funil.entity_id = mc.${cfg.colunaId}
       LEFT JOIN ( SELECT ${grupo} AS entity_id, COALESCE(SUM(e.value),0) AS total_receita
                     FROM ${capi} e
                     JOIN ${customers} c ON c.id = e.customer_id${juncaoAds}
                     JOIN ${mapa} em ON em.status_id = c.current_stage AND em.is_conversion = 1
                     ${whereLeads.sql} AND e.status = 'SENT'
                    GROUP BY ${grupo} ) receita ON receita.entity_id = mc.${cfg.colunaId}
${escopo}
      ORDER BY (mc.status = 'ACTIVE') DESC, spend DESC, mc.${cfg.colunaNome} ASC`;

  // A ordem dos `?` segue a ordem de aparição no SQL acima: nível e datas
  // dos insights, depois as quatro repetições do filtro de leads, e por
  // fim o id do pai no WHERE final.
  const params: unknown[] = [
    nivel,
    ...andInsights.params,
    ...whereLeads.params,
    ...whereLeads.params,
    ...whereLeads.params,
    ...whereLeads.params,
    ...(escopo ? [paiId] : []),
  ];

  // A hierarquia é uma consulta só: ou ela roda inteira, ou não há
  // resultado parcial a exibir. Sem uma das cinco tabelas, a tela mostra a
  // tabela vazia com o aviso de banco defasado — em vez de erro 500.
  const lacunas = new LacunasDeEsquema();
  const [brutas, gastoTotal] = await Promise.all([
    lacunas.ou(db.query<LinhaBruta>(sql, params), [] as LinhaBruta[]),
    nivel === 'campaign'
      ? lacunas.ou(gastoTotalCampanhas(db, andInsights), 0)
      : Promise.resolve(null),
  ]);

  return {
    nivel,
    gasto_total_periodo: gastoTotal,
    linhas: brutas.map((l) => ({
      id: String(l.id ?? ''),
      nome: l.nome,
      status: l.status,
      orcamento: cfg.temOrcamento
        ? (numOuNulo(l.daily_budget) ?? numOuNulo(l.lifetime_budget))
        : null,
      spend: num(l.spend),
      impressions: num(l.impressions),
      reach: num(l.reach),
      frequency: num(l.frequency),
      clicks: num(l.clicks),
      unique_clicks: num(l.unique_clicks),
      ctr: num(l.ctr),
      cpc: num(l.cpc),
      cpm: num(l.cpm),
      total_leads: num(l.total_leads),
      total_conversoes: num(l.total_conversoes),
      cpl: numOuNulo(l.cpl),
      cac: numOuNulo(l.cac),
      receita: num(l.receita),
      funil_eventos: parseFunil(l.funil_eventos),
    })),
    lacunas_de_esquema: lacunas.lista(),
  };
}

/**
 * Espelha na tabela local o status que a Meta acabou de aceitar.
 *
 * Sem isto a linha voltaria ao status antigo no primeiro `router.refresh()`:
 * a tela lê `meta_campaigns`/`meta_adsets`/`meta_ads`, e essas tabelas só
 * são reescritas quando a sincronização com a Meta roda. Aqui a fonte da
 * verdade continua sendo a Meta — o que se grava é a resposta dela, e a
 * próxima sincronização sobrescreve de qualquer jeito.
 *
 * Devolve quantas linhas mudaram. Zero é possível e não é erro: a
 * campanha pode existir na conta da Meta e ainda não ter sido importada
 * para o banco do cliente.
 */
export async function atualizaStatusLocal(
  db: BancoCliente,
  nivel: NivelHierarquia,
  id: string,
  status: string,
): Promise<number> {
  const cfg = NIVEIS[nivel];
  const { affectedRows } = await db.execute(
    `UPDATE ${db.tabela(cfg.tabela)} SET status = ? WHERE ${cfg.colunaId} = ?`,
    [status, id],
  );
  return affectedRows;
}
