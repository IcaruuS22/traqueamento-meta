import 'server-only';
import type { BancoCliente } from '@/lib/db/cliente';
import { LacunasDeEsquema, lacunaDeEsquema } from '@/lib/db/pool';
import { ordenaFunil } from '@/lib/meta-eventos';
import {
  condicaoTimestamp,
  condicaoData,
  condicaoCanal,
  montaWhere,
  type Canal,
  type Periodo,
} from '@/lib/periodo';

/**
 * Métricas gerais de um cliente.
 *
 * Porte de `GET /painel-api/metricas` e `GET /painel-api/cliente-info`
 * (nodes "Monta Filtro Data Metricas" ... "Monta Resposta Metricas" de
 * `Painel Administrativo/build_admin_panel_workflow.js`).
 *
 * O SQL foi copiado literalmente; o que mudou:
 *  - os limites de data entram por `?` em vez de interpolados;
 *  - identificadores de banco/tabela passam por `BancoCliente.tabela`;
 *  - as 10 consultas rodam em paralelo (o n8n as encadeava em série só
 *    por limitação do editor visual — elas são independentes entre si).
 *
 * Nenhuma métrica vem pronta da Meta: leads, conversões e receita saem
 * sempre das nossas tabelas (`customers`, `crm_meta_event_map`,
 * `whatsapp_event_map`, `meta_capi_events`). Só gasto/impressões/cliques
 * vêm de `meta_insights_daily`, que é o espelho local da Graph API.
 */

const DIA_SEG = 86_400;
const SP_OFFSET_SEG = 3 * 60 * 60;

export type Fragmento = { sql: string; params: unknown[] };

export type LeadDia = { dia: string; total: number };
export type EventoPorNome = { event_name: string; total: number };
export type Transicao = { from_stage: string; to_stage: string; avg_ms: number; count: number };
export type Lead = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  current_stage: string | null;
  created_at: string;
  last_moved_at: string | null;
};

export type Totais = {
  total_leads: number;
  total_spend: number;
  cpl: number | null;
  total_conversoes: number;
  taxa_conversao: number | null;
  receita: number;
  roas: number | null;
};

export type Metricas = Totais & {
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  comparativo_anterior: Totais | null;
  leads_por_dia: LeadDia[];
  eventos_por_nome: EventoPorNome[];
  tempo_medio_entre_etapas: Transicao[];
  ultimos_leads: Lead[];
  /**
   * Tabelas e colunas que faltam neste banco de cliente. Vazio no caso
   * normal. A tela avisa em vez de exibir os zeros como se fossem dado
   * real — zero por falta de migração não é zero por falta de resultado.
   */
  lacunas_de_esquema: string[];
};

const ANUNCIOS_ZERADOS: LinhaAnuncios = {
  total_spend: 0,
  total_impressions: 0,
  total_reach: 0,
  avg_frequency: 0,
  total_clicks: 0,
  avg_ctr: 0,
  avg_cpc: 0,
  avg_cpm: 0,
};

/**
 * Monta os fragmentos de WHERE de uma janela de tempo.
 *
 * Repete a estrutura de "Monta Filtro Data Metricas": um filtro por tipo
 * de coluna (TIMESTAMP em `customers`, DATE em `meta_insights_daily`) e
 * um recorte de canal, porque `customers` é compartilhada entre leads de
 * Formulário Instantâneo e conversas de WhatsApp.
 */
function filtrosDaJanela(
  db: BancoCliente,
  canal: Canal,
  inicioSec: number | null,
  fimSec: number | null,
) {
  const tabelaConversas = db.tabela('whatsapp_conversations');

  const semAlias = condicaoTimestamp('created_at', inicioSec, fimSec);
  const comAlias = condicaoTimestamp('c.created_at', inicioSec, fimSec);
  const canalSemAlias = condicaoCanal(canal, '', tabelaConversas);
  const canalComAlias = condicaoCanal(canal, 'c', tabelaConversas);

  // Conversão e receita precisam de um JOIN diferente por canal: o funil
  // do Kommo liga `crm_meta_event_map.status_id` a `customers.current_stage`;
  // o do WhatsApp liga `whatsapp_event_map.estagio` a
  // `whatsapp_conversations.status`. Em 'geral' os dois entram por LEFT
  // JOIN e a condição extra abaixo garante que ao menos um bateu — senão
  // COUNT(DISTINCT c.id) contaria todo lead, já que LEFT JOIN não filtra.
  let convJoin: string;
  if (canal === 'whatsapp') {
    convJoin =
      `JOIN ${tabelaConversas} wc ON wc.customer_id = c.id ` +
      `JOIN ${db.tabela('whatsapp_event_map')} em ON em.estagio = wc.status AND em.is_conversion = 1`;
  } else if (canal === 'form') {
    convJoin = `JOIN ${db.tabela('crm_meta_event_map')} em ON em.status_id = c.current_stage AND em.is_conversion = 1`;
  } else {
    convJoin =
      `LEFT JOIN ${db.tabela('crm_meta_event_map')} em ON em.status_id = c.current_stage AND em.is_conversion = 1 ` +
      `LEFT JOIN ${tabelaConversas} wc ON wc.customer_id = c.id ` +
      `LEFT JOIN ${db.tabela('whatsapp_event_map')} emw ON emw.estagio = wc.status AND emw.is_conversion = 1`;
  }
  const condConv = canal === 'geral' ? '(em.status_id IS NOT NULL OR emw.estagio IS NOT NULL)' : '';

  const insights = condicaoData('date', inicioSec, fimSec);

  return {
    convJoin,
    /** WHERE em `customers` sem alias. */
    whereCustomers: {
      sql: montaWhere([semAlias.sql, canalSemAlias]),
      params: semAlias.params as unknown[],
    } satisfies Fragmento,
    /** WHERE em `customers c`. */
    whereC: {
      sql: montaWhere([comAlias.sql, canalComAlias]),
      params: comAlias.params as unknown[],
    } satisfies Fragmento,
    /** WHERE em `customers c` já com o filtro de conversão. */
    whereConv: {
      sql: montaWhere([comAlias.sql, canalComAlias, condConv]),
      params: comAlias.params as unknown[],
    } satisfies Fragmento,
    /** Continuação de um WHERE já aberto, em `customers c` com conversão. */
    andConv: {
      sql: montaWhere([comAlias.sql, canalComAlias, condConv]).replace(/^WHERE/, 'AND'),
      params: comAlias.params as unknown[],
    } satisfies Fragmento,
    /** Continuação de um WHERE já aberto, em `customers c`. */
    andC: {
      sql: montaWhere([comAlias.sql, canalComAlias]).replace(/^WHERE/, 'AND'),
      params: comAlias.params as unknown[],
    } satisfies Fragmento,
    /** Continuação do WHERE de `meta_insights_daily`. */
    andInsights: {
      sql: insights.sql ? `AND ${insights.sql}` : '',
      params: insights.params as unknown[],
    } satisfies Fragmento,
  };
}

type LinhaAnuncios = {
  total_spend: number;
  total_impressions: number;
  total_reach: number;
  avg_frequency: number;
  total_clicks: number;
  avg_ctr: number;
  avg_cpc: number;
  avg_cpm: number;
};

/**
 * Soma de gasto/impressões/alcance/cliques só no nível 'campaign' —
 * somar os três níveis juntos multiplicaria o gasto, porque o mesmo real
 * é refletido em campaign, adset e ad.
 *
 * Alcance e frequência não são somáveis entre dias (a mesma pessoa
 * alcançada em dois dias não conta duas vezes): reach usa SUM e
 * frequency/ctr/cpc/cpm usam AVG dos valores diários. É a mesma
 * aproximação já documentada nos tooltips do painel atual.
 */
async function totaisAnuncios(db: BancoCliente, f: Fragmento): Promise<LinhaAnuncios> {
  const linha = await db.queryOne<LinhaAnuncios>(
    `SELECT COALESCE(SUM(spend),0)       AS total_spend,
            COALESCE(SUM(impressions),0) AS total_impressions,
            COALESCE(SUM(reach),0)       AS total_reach,
            COALESCE(AVG(frequency),0)   AS avg_frequency,
            COALESCE(SUM(clicks),0)      AS total_clicks,
            COALESCE(AVG(ctr),0)         AS avg_ctr,
            COALESCE(AVG(cpc),0)         AS avg_cpc,
            COALESCE(AVG(cpm),0)         AS avg_cpm
       FROM ${db.tabela('meta_insights_daily')}
      WHERE entity_level = 'campaign' ${f.sql}`,
    f.params,
  );
  return linha ?? ANUNCIOS_ZERADOS;
}

async function contaLeads(db: BancoCliente, f: Fragmento): Promise<number> {
  const linha = await db.queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ${db.tabela('customers')} ${f.sql}`,
    f.params,
  );
  return Number(linha?.total) || 0;
}

/**
 * Leads que chegaram a um estágio marcado como conversão
 * (`is_conversion = 1`) — o mesmo flag que alimenta o CAC da aba
 * Campanhas.
 */
async function contaConversoes(db: BancoCliente, convJoin: string, f: Fragmento): Promise<number> {
  const linha = await db.queryOne<{ total: number }>(
    `SELECT COUNT(DISTINCT c.id) AS total
       FROM ${db.tabela('customers')} c ${convJoin} ${f.sql}`,
    f.params,
  );
  return Number(linha?.total) || 0;
}

/**
 * Receita: soma o `value` dos eventos SENT dos leads que converteram no
 * período — não de todo evento SENT. Receita só existe quando o lead
 * virou conversão de fato.
 */
async function somaReceita(db: BancoCliente, convJoin: string, f: Fragmento): Promise<number> {
  const linha = await db.queryOne<{ total_receita: number }>(
    `SELECT COALESCE(SUM(e.value),0) AS total_receita
       FROM ${db.tabela('meta_capi_events')} e
       JOIN ${db.tabela('customers')} c ON c.id = e.customer_id
       ${convJoin}
      WHERE e.status = 'SENT' ${f.sql}`,
    f.params,
  );
  return Number(linha?.total_receita) || 0;
}

/**
 * Leads por dia civil de São Paulo.
 *
 * `GROUP BY DATE(created_at)` dependeria do fuso da SESSÃO do MySQL — o
 * mesmo bug de deslocamento de 3h que `lib/periodo.ts` existe para
 * evitar. O workflow contornava trazendo todos os timestamps crus e
 * agrupando em JS; aqui o agrupamento volta para o banco, mas por
 * aritmética pura sobre o epoch (`UNIX_TIMESTAMP`), que é imune ao fuso
 * da sessão. O resultado é idêntico e o retorno cai de uma linha por
 * lead para uma linha por dia.
 */
async function leadsPorDia(db: BancoCliente, f: Fragmento): Promise<LeadDia[]> {
  const linhas = await db.query<{ dia_num: number; total: number }>(
    `SELECT FLOOR((UNIX_TIMESTAMP(created_at) - ${SP_OFFSET_SEG}) / ${DIA_SEG}) AS dia_num,
            COUNT(*) AS total
       FROM ${db.tabela('customers')} ${f.sql}
      GROUP BY dia_num
      ORDER BY dia_num ASC`,
    f.params,
  );
  return linhas.map((l) => ({
    dia: new Date(Number(l.dia_num) * DIA_SEG * 1000).toISOString().slice(0, 10),
    total: Number(l.total) || 0,
  }));
}

async function eventosPorNome(db: BancoCliente, f: Fragmento): Promise<EventoPorNome[]> {
  const linhas = await db.query<EventoPorNome>(
    `SELECT e.event_name, COUNT(*) AS total
       FROM ${db.tabela('meta_capi_events')} e
       JOIN ${db.tabela('customers')} c ON c.id = e.customer_id
       ${f.sql}
      GROUP BY e.event_name
      ORDER BY total DESC
      LIMIT 10`,
    f.params,
  );
  // O DESC acima é só para o LIMIT escolher os 10 eventos mais relevantes.
  // Quem sai daqui é o funil, e funil se lê na ordem da jornada.
  return ordenaFunil(
    linhas.map((l) => ({ event_name: l.event_name, total: Number(l.total) || 0 })),
  );
}

/**
 * Últimos leads do período.
 *
 * `current_stage` guarda o status_id bruto do CRM (ex.: "75275031"),
 * traduzido aqui para o nome amigável via `crm_meta_event_map`; sem
 * correspondência cadastrada, cai de volta no valor bruto em vez de
 * sumir da tela.
 *
 * `last_moved_at` não sai de `customers.updated_at`: essa coluna não tem
 * ON UPDATE CURRENT_TIMESTAMP e o UPDATE que muda o estágio não a toca.
 * A movimentação real é o evento SENT mais recente do lead — e só conta
 * como movimentação quando há mais de um evento (o primeiro é a própria
 * geração do lead).
 */
export async function ultimosLeads(
  db: BancoCliente,
  f: Fragmento,
  limite = 10,
  offset = 0,
): Promise<Lead[]> {
  return db.query<Lead>(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
            COALESCE(em.content_name, c.current_stage) AS current_stage,
            c.created_at,
            (SELECT CASE WHEN COUNT(*) > 1 THEN MAX(e.created_at) END
               FROM ${db.tabela('meta_capi_events')} e
              WHERE e.customer_id = c.id AND e.status = 'SENT') AS last_moved_at
       FROM ${db.tabela('customers')} c
       LEFT JOIN ${db.tabela('crm_meta_event_map')} em ON em.status_id = c.current_stage
       ${f.sql}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?`,
    [...f.params, limite, offset],
  );
}

/**
 * Tempo médio entre etapas da jornada.
 *
 * Percorre a timeline de eventos SENT de cada lead em ordem cronológica
 * e mede o intervalo entre cada par de etapas realmente percorridas —
 * não um funil fixo, porque o caminho de cada lead pode pular ou repetir
 * etapas. Agrupa por par (de → para) e tira a média, revelando onde a
 * jornada é mais lenta.
 */
async function tempoEntreEtapas(db: BancoCliente, f: Fragmento): Promise<Transicao[]> {
  const linhas = await db.query<{ customer_id: number; created_at: unknown; stage_name: string }>(
    `SELECT e.customer_id, e.created_at, COALESCE(e.content_name, e.event_name) AS stage_name
       FROM ${db.tabela('meta_capi_events')} e
       JOIN ${db.tabela('customers')} c ON c.id = e.customer_id
      WHERE e.status = 'SENT' ${f.sql}
      ORDER BY e.customer_id ASC, e.created_at ASC`,
    f.params,
  );

  const porLead = new Map<number, { ms: number; etapa: string }[]>();
  for (const l of linhas) {
    if (!l.stage_name || !l.created_at) continue;
    const ms = new Date(l.created_at as string).getTime();
    if (!Number.isFinite(ms)) continue;
    const lista = porLead.get(l.customer_id) ?? [];
    lista.push({ ms, etapa: l.stage_name });
    porLead.set(l.customer_id, lista);
  }

  const transicoes = new Map<string, Transicao & { totalMs: number }>();
  for (const eventos of porLead.values()) {
    for (let i = 1; i < eventos.length; i++) {
      const de = eventos[i - 1];
      const para = eventos[i];
      if (de.etapa === para.etapa) continue;
      const delta = para.ms - de.ms;
      if (!(delta >= 0)) continue;
      const chave = `${de.etapa}||${para.etapa}`;
      const atual = transicoes.get(chave) ?? {
        from_stage: de.etapa,
        to_stage: para.etapa,
        avg_ms: 0,
        count: 0,
        totalMs: 0,
      };
      atual.totalMs += delta;
      atual.count += 1;
      transicoes.set(chave, atual);
    }
  }

  return [...transicoes.values()]
    .map((t) => ({
      from_stage: t.from_stage,
      to_stage: t.to_stage,
      avg_ms: Math.round(t.totalMs / t.count),
      count: t.count,
    }))
    .sort((a, b) => b.count - a.count);
}

function montaTotais(
  leads: number,
  anuncios: Pick<LinhaAnuncios, 'total_spend'>,
  conversoes: number,
  receita: number,
): Totais {
  const gasto = Number(anuncios.total_spend) || 0;
  return {
    total_leads: leads,
    total_spend: gasto,
    cpl: leads > 0 ? Math.round((gasto / leads) * 100) / 100 : null,
    total_conversoes: conversoes,
    taxa_conversao: leads > 0 ? Math.round((conversoes / leads) * 1000) / 10 : null,
    receita,
    roas: gasto > 0 ? Math.round((receita / gasto) * 100) / 100 : null,
  };
}

/** Data do primeiro lead — limita o período mínimo selecionável na tela. */
export async function primeiroLeadEm(db: BancoCliente): Promise<string | null> {
  let linha: { primeiro_lead_em: unknown } | null;
  try {
    linha = await db.queryOne<{ primeiro_lead_em: unknown }>(
      `SELECT DATE(MIN(created_at)) AS primeiro_lead_em FROM ${db.tabela('customers')}`,
    );
  } catch (erro) {
    // O cabeçalho não é lugar de derrubar a página: sem a tabela, o
    // seletor de período só fica sem data mínima.
    if (!lacunaDeEsquema(erro)) throw erro;
    return null;
  }
  const valor = linha?.primeiro_lead_em;
  if (!valor) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

/** Métricas completas do período, com o comparativo do período anterior. */
export async function buscaMetricas(db: BancoCliente, periodo: Periodo): Promise<Metricas> {
  const atual = filtrosDaJanela(db, periodo.canal, periodo.inicioSec, periodo.fimSec);
  const lacunas = new LacunasDeEsquema();

  // 'max' não tem limite inferior, logo não existe janela anterior
  // computável — a tela simplesmente não mostra badge de comparação.
  // As 4 consultas do comparativo não dependem das 8 da janela atual, então
  // vão no MESMO Promise.all em vez de esperar num segundo lote em série:
  // uma ida a menos ao banco remoto no caminho da página inicial do cliente.
  const temComparativo = periodo.anteriorInicioSec !== null;
  const ant = temComparativo
    ? filtrosDaJanela(db, periodo.canal, periodo.anteriorInicioSec, periodo.anteriorFimSec)
    : null;

  const [
    anuncios,
    leads,
    conversoes,
    receita,
    porDia,
    eventos,
    transicoes,
    leadsRecentes,
    anunciosAnt,
    leadsAnt,
    conversoesAnt,
    receitaAnt,
  ] = await Promise.all([
    lacunas.ou(totaisAnuncios(db, atual.andInsights), ANUNCIOS_ZERADOS),
    lacunas.ou(contaLeads(db, atual.whereCustomers), 0),
    lacunas.ou(contaConversoes(db, atual.convJoin, atual.whereConv), 0),
    lacunas.ou(somaReceita(db, atual.convJoin, atual.andConv), 0),
    lacunas.ou(leadsPorDia(db, atual.whereCustomers), [] as LeadDia[]),
    lacunas.ou(eventosPorNome(db, atual.whereC), [] as EventoPorNome[]),
    lacunas.ou(tempoEntreEtapas(db, atual.andC), [] as Transicao[]),
    lacunas.ou(ultimosLeads(db, atual.whereC), [] as Lead[]),
    ant ? lacunas.ou(totaisAnuncios(db, ant.andInsights), ANUNCIOS_ZERADOS) : ANUNCIOS_ZERADOS,
    ant ? lacunas.ou(contaLeads(db, ant.whereCustomers), 0) : 0,
    ant ? lacunas.ou(contaConversoes(db, ant.convJoin, ant.whereConv), 0) : 0,
    ant ? lacunas.ou(somaReceita(db, ant.convJoin, ant.andConv), 0) : 0,
  ]);

  const comparativo: Totais | null = temComparativo
    ? montaTotais(leadsAnt, anunciosAnt, conversoesAnt, receitaAnt)
    : null;

  return {
    ...montaTotais(leads, anuncios, conversoes, receita),
    impressions: Number(anuncios.total_impressions) || 0,
    reach: Number(anuncios.total_reach) || 0,
    frequency: Number(anuncios.avg_frequency) || 0,
    clicks: Number(anuncios.total_clicks) || 0,
    ctr: Number(anuncios.avg_ctr) || 0,
    cpc: Number(anuncios.avg_cpc) || 0,
    cpm: Number(anuncios.avg_cpm) || 0,
    comparativo_anterior: comparativo,
    leads_por_dia: porDia,
    eventos_por_nome: eventos,
    tempo_medio_entre_etapas: transicoes,
    ultimos_leads: leadsRecentes,
    lacunas_de_esquema: lacunas.lista(),
  };
}

/** Fragmento de WHERE de `customers c` — reutilizado pela paginação de leads. */
export function filtroLeads(db: BancoCliente, periodo: Periodo): Fragmento {
  return filtrosDaJanela(db, periodo.canal, periodo.inicioSec, periodo.fimSec).whereC;
}
