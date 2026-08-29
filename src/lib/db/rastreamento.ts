import 'server-only';
import type { BancoCliente } from '@/lib/db/cliente';
import { LacunasDeEsquema } from '@/lib/db/pool';
import { condicaoTimestamp, montaWhere, type Periodo } from '@/lib/periodo';
import type { Confianca, Fonte } from '@/lib/rastreamento';

/**
 * Rastreamento de origem — de onde cada lead veio, e com que garantia.
 *
 * Nada aqui exige coluna nova: os identificadores já são gravados na
 * captura (`customers.utm_*`, `fbclid`, `meta_*`) e na conversa
 * (`whatsapp_messages.referral_*`). O que faltava era ler isso junto.
 *
 * A classificação mora no SQL porque a tela precisa contar por fonte e
 * paginar por fonte — fazer isso em TypeScript exigiria trazer o período
 * inteiro para a memória a cada página. Para não haver duas verdades, a
 * expressão é montada uma única vez (`sqlFonte`/`sqlConfianca`) e a mesma
 * string é usada na contagem, na listagem e no detalhe.
 *
 * Ordem da classificação (a primeira que casa vence): CTWA vem antes de
 * Lead Ads porque um lead pode ter as duas marcas — foi criado por
 * formulário e depois puxou conversa por anúncio — e o que interessa
 * quando isso acontece é o clique que abriu a conversa, que é o mais
 * recente e o mais forte.
 */

export const LIMITE_PADRAO = 30;

export type LinhaRastreio = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  fonte: Fonte;
  confianca: Confianca;
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  ctwa_clid: string | null;
  campanha: string | null;
  conjunto: string | null;
  anuncio: string | null;
};

export type ContagemFonte = { fonte: Fonte; total: number };

export type PainelRastreamento = {
  leads: LinhaRastreio[];
  por_fonte: ContagemFonte[];
  total: number;
  lacunas_de_esquema: string[];
};

export type FiltrosRastreamento = {
  /** Já validada contra a whitelist pela rota/página. */
  fonte?: Fonte | null;
  search?: string | null;
  limite?: number;
  offset?: number;
};

/** `TRUE` quando existe mensagem daquele lead com o campo de referral preenchido. */
function existeReferral(db: BancoCliente, campo: 'referral_ctwa_clid' | 'referral_ad_id'): string {
  return `EXISTS (SELECT 1 FROM ${db.tabela('whatsapp_messages')} m
                   WHERE m.customer_id = c.id AND COALESCE(m.${campo}, '') <> '')`;
}

function preenchido(coluna: string): string {
  return `COALESCE(${coluna}, '') <> ''`;
}

/**
 * `comWhatsapp = false` monta a mesma expressão sem tocar em
 * `whatsapp_messages`, para bancos de cliente que ainda não rodaram a
 * migração de mensagens: sem isso a tela inteira viraria erro 500 por
 * causa de uma tabela que só decide uma das quatro fontes.
 */
function sqlFonte(db: BancoCliente, comWhatsapp: boolean): string {
  const ctwa = comWhatsapp
    ? `WHEN ${existeReferral(db, 'referral_ctwa_clid')} OR ${existeReferral(db, 'referral_ad_id')} THEN 'ctwa'`
    : '';
  return `CASE
      ${ctwa}
      WHEN ${preenchido('c.meta_lead_id')} OR ${preenchido('c.meta_form_id')} THEN 'meta_lead_ads'
      WHEN ${preenchido('c.utm_source')} OR ${preenchido('c.utm_medium')}
        OR ${preenchido('c.utm_campaign')} OR ${preenchido('c.fbclid')} THEN 'lp_utm'
      ELSE 'outros'
    END`;
}

/**
 * Confiança = quão direta é a ligação com o anúncio.
 *
 * Alta exige identificador de clique (ctwa_clid, fbclid) ou o par
 * lead_id + ad_id. Média é saber a campanha sem saber o clique. Baixa é
 * não ter nada — e aí a tela precisa dizer isso, em vez de mostrar a
 * última campanha conhecida como se fosse a origem daquele lead.
 */
function sqlConfianca(db: BancoCliente, comWhatsapp: boolean): string {
  const clid = comWhatsapp ? `${existeReferral(db, 'referral_ctwa_clid')} OR ` : '';
  const adReferral = comWhatsapp ? ` OR ${existeReferral(db, 'referral_ad_id')}` : '';
  return `CASE
      WHEN ${clid}${preenchido('c.fbclid')}
        OR (${preenchido('c.meta_lead_id')} AND ${preenchido('c.meta_ad_id')}) THEN 'alta'
      WHEN ${preenchido('c.meta_lead_id')} OR ${preenchido('c.meta_campaign_id')}
        OR ${preenchido('c.meta_ad_id')} OR ${preenchido('c.utm_campaign')}
        OR ${preenchido('c.utm_source')}${adReferral} THEN 'media'
      ELSE 'baixa'
    END`;
}

/** `ad_id` efetivo: o do lead, ou o que veio na referência da conversa. */
function sqlAdId(db: BancoCliente, comWhatsapp: boolean): string {
  if (!comWhatsapp) return `NULLIF(c.meta_ad_id, '')`;
  return `COALESCE(NULLIF(c.meta_ad_id, ''),
            (SELECT MAX(m.referral_ad_id) FROM ${db.tabela('whatsapp_messages')} m
              WHERE m.customer_id = c.id AND COALESCE(m.referral_ad_id, '') <> ''))`;
}

function sqlCtwaClid(db: BancoCliente, comWhatsapp: boolean): string {
  if (!comWhatsapp) return 'NULL';
  return `(SELECT MAX(m.referral_ctwa_clid) FROM ${db.tabela('whatsapp_messages')} m
            WHERE m.customer_id = c.id AND COALESCE(m.referral_ctwa_clid, '') <> '')`;
}

function filtroBusca(filtros: FiltrosRastreamento): { sql: string | null; params: unknown[] } {
  const termo = String(filtros.search ?? '').trim();
  if (!termo) return { sql: null, params: [] };
  const like = `%${termo}%`;
  return {
    sql: `(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?
           OR CONCAT_WS(' ', c.first_name, c.last_name) LIKE ?
           OR c.utm_campaign LIKE ? OR c.meta_campaign_name LIKE ? OR c.meta_ad_name LIKE ?)`,
    params: [like, like, like, like, like, like, like, like],
  };
}

/**
 * Bloco `FROM customers c` com as expressões calculadas, usado como
 * tabela derivada. O período e a busca entram aqui dentro para o JOIN dos
 * nomes de campanha rodar só sobre o que já passou pelo filtro.
 */
function derivada(
  db: BancoCliente,
  periodo: Periodo,
  filtros: FiltrosRastreamento,
  comWhatsapp: boolean,
): { sql: string; params: unknown[] } {
  const data = condicaoTimestamp('c.created_at', periodo.inicioSec, periodo.fimSec);
  const busca = filtroBusca(filtros);
  return {
    sql: `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.created_at,
                 ${sqlFonte(db, comWhatsapp)} AS fonte,
                 ${sqlConfianca(db, comWhatsapp)} AS confianca,
                 ${sqlAdId(db, comWhatsapp)} AS ad_id,
                 NULLIF(c.meta_adset_id, '') AS adset_id,
                 NULLIF(c.meta_campaign_id, '') AS campaign_id,
                 ${sqlCtwaClid(db, comWhatsapp)} AS ctwa_clid,
                 NULLIF(c.meta_campaign_name, '') AS campanha_lead,
                 NULLIF(c.meta_adset_name, '') AS conjunto_lead,
                 NULLIF(c.meta_ad_name, '') AS anuncio_lead,
                 NULLIF(c.utm_campaign, '') AS utm_campaign
            FROM ${db.tabela('customers')} c
            ${montaWhere([data.sql, busca.sql])}`,
    params: [...data.params, ...busca.params],
  };
}

async function listaLeads(
  db: BancoCliente,
  periodo: Periodo,
  filtros: FiltrosRastreamento,
  comWhatsapp: boolean,
): Promise<LinhaRastreio[]> {
  const base = derivada(db, periodo, filtros, comWhatsapp);
  const limite = filtros.limite ?? LIMITE_PADRAO;
  const offset = filtros.offset ?? 0;
  const fonte = filtros.fonte ?? null;

  // O nome gravado no lead vem primeiro: é o que valia no momento da
  // captura. O espelho da Graph API (`meta_campaigns`) entra como segunda
  // opção, e o id cru como última — melhor um id do que uma célula vazia
  // quando o anúncio foi apagado da conta.
  return db.query<LinhaRastreio>(
    `SELECT b.id, b.first_name, b.last_name, b.email, b.phone, b.created_at,
            b.fonte, b.confianca, b.ad_id, b.adset_id, b.campaign_id, b.ctwa_clid,
            COALESCE(b.campanha_lead, cam.campaign_name, b.utm_campaign, b.campaign_id) AS campanha,
            COALESCE(b.conjunto_lead, cj.adset_name, b.adset_id) AS conjunto,
            COALESCE(b.anuncio_lead, an.ad_name, b.ad_id) AS anuncio
       FROM (${base.sql}) b
       LEFT JOIN ${db.tabela('meta_ads')} an ON an.ad_id = b.ad_id
       LEFT JOIN ${db.tabela('meta_adsets')} cj ON cj.adset_id = COALESCE(b.adset_id, an.adset_id)
       LEFT JOIN ${db.tabela('meta_campaigns')} cam
              ON cam.campaign_id = COALESCE(b.campaign_id, an.campaign_id)
      WHERE (? IS NULL OR b.fonte = ?)
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?`,
    [...base.params, fonte, fonte, limite, offset],
  );
}

async function contaPorFonte(
  db: BancoCliente,
  periodo: Periodo,
  filtros: FiltrosRastreamento,
  comWhatsapp: boolean,
): Promise<ContagemFonte[]> {
  // A contagem ignora o filtro de fonte de propósito: os cards são a
  // régua para escolher o filtro, e cairiam a um só card assim que um
  // fosse escolhido. A busca, essa sim, vale para os dois.
  const base = derivada(db, periodo, { search: filtros.search }, comWhatsapp);
  const linhas = await db.query<{ fonte: Fonte; total: unknown }>(
    `SELECT b.fonte, COUNT(*) AS total FROM (${base.sql}) b GROUP BY b.fonte`,
    base.params,
  );
  return linhas.map((l) => ({ fonte: l.fonte, total: Number(l.total) || 0 }));
}

/**
 * Executa a consulta contando com `whatsapp_messages` e, se aquele banco
 * ainda não a tem, repete sem ela. A lacuna fica registrada e a tela
 * avisa que CTWA não pôde ser apurado — em vez de exibir zero conversas
 * vindas de anúncio como se fosse resultado.
 */
async function comOuSemWhatsapp<T>(
  lacunas: LacunasDeEsquema,
  consulta: (comWhatsapp: boolean) => Promise<T>,
): Promise<T> {
  const resultado = await lacunas.ou<T | null>(consulta(true), null);
  return resultado === null ? consulta(false) : resultado;
}

/** Tabela + contagem por fonte, na mesma ida ao banco que a tela precisa. */
export async function buscaPainelRastreamento(
  db: BancoCliente,
  periodo: Periodo,
  filtros: FiltrosRastreamento = {},
): Promise<PainelRastreamento> {
  const lacunas = new LacunasDeEsquema();
  const [leads, porFonte] = await Promise.all([
    comOuSemWhatsapp(lacunas, (wa) => listaLeads(db, periodo, filtros, wa)),
    comOuSemWhatsapp(lacunas, (wa) => contaPorFonte(db, periodo, filtros, wa)),
  ]);
  return {
    leads,
    por_fonte: porFonte,
    total: porFonte.reduce((s, f) => s + f.total, 0),
    lacunas_de_esquema: lacunas.lista(),
  };
}

/** Só a página seguinte da tabela — os cards não dependem de paginação. */
export async function paginaRastreamento(
  db: BancoCliente,
  periodo: Periodo,
  filtros: FiltrosRastreamento,
): Promise<LinhaRastreio[]> {
  const lacunas = new LacunasDeEsquema();
  return comOuSemWhatsapp(lacunas, (wa) => listaLeads(db, periodo, filtros, wa));
}

export type ConversaoCapi = {
  id: number;
  created_at: string;
  event_name: string | null;
  content_name: string | null;
  status: string;
  value: string | number | null;
  currency: string | null;
  event_source_url: string | null;
  action_source: string | null;
  error_message: string | null;
};

export type RastreioContato = LinhaRastreio & {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  fbclid: string | null;
  meta_lead_id: string | null;
  meta_form_id: string | null;
  meta_page_id: string | null;
  ad_account_id: string | null;
  current_stage: string | null;
  ip_address: string | null;
  user_agent: string | null;
  /** Momento em que a conversa de WhatsApp começou, quando houve. */
  primeira_mensagem_em: string | null;
  /** URL do anúncio guardada no payload cru da mensagem, quando veio. */
  url_origem: string | null;
  /** Título do anúncio no card de referência da mensagem, quando veio. */
  titulo_anuncio: string | null;
  conversoes: ConversaoCapi[];
  lacunas_de_esquema: string[];
};

type ReferenciaConversa = {
  primeira_mensagem_em: string | null;
  url_origem: string | null;
  titulo_anuncio: string | null;
};

/**
 * Referência do anúncio guardada no payload cru da mensagem.
 *
 * Os dois caminhos são os dois provedores suportados: `$.referral.*` é o
 * formato da Cloud API da Meta, `$.message.contextInfo.externalAdReply.*`
 * é o da Evolution (Baileys). Ler os dois aqui evita normalizar na
 * ingestão só por causa desta tela.
 */
async function referenciaDaConversa(
  db: BancoCliente,
  customerId: number,
): Promise<ReferenciaConversa | null> {
  return db.queryOne<ReferenciaConversa>(
    `SELECT MIN(m.created_at) AS primeira_mensagem_em,
            MAX(COALESCE(
              JSON_UNQUOTE(JSON_EXTRACT(m.raw_payload, '$.referral.source_url')),
              JSON_UNQUOTE(JSON_EXTRACT(m.raw_payload, '$.message.contextInfo.externalAdReply.sourceUrl'))
            )) AS url_origem,
            MAX(COALESCE(
              JSON_UNQUOTE(JSON_EXTRACT(m.raw_payload, '$.referral.headline')),
              JSON_UNQUOTE(JSON_EXTRACT(m.raw_payload, '$.message.contextInfo.externalAdReply.title'))
            )) AS titulo_anuncio
       FROM ${db.tabela('whatsapp_messages')} m
      WHERE m.customer_id = ?`,
    [customerId],
  );
}

/** Tudo o que o modal "Rastreio do contato" mostra, de uma vez. */
export async function buscaRastreioContato(
  db: BancoCliente,
  customerId: number,
): Promise<RastreioContato | null> {
  const lacunas = new LacunasDeEsquema();

  const linha = await comOuSemWhatsapp(lacunas, (comWhatsapp) =>
    db.queryOne<RastreioContato>(
      `SELECT b.*,
              -- current_stage guarda o status_id bruto do CRM; o nome
              -- amigável vem do mesmo mapa usado nas outras telas.
              COALESCE(em.content_name, b.stage_id) AS current_stage,
              COALESCE(b.campanha_lead, cam.campaign_name, b.utm_campaign, b.campaign_id) AS campanha,
              COALESCE(b.conjunto_lead, cj.adset_name, b.adset_id) AS conjunto,
              COALESCE(b.anuncio_lead, an.ad_name, b.ad_id) AS anuncio
         FROM (SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.created_at,
                      c.utm_source, c.utm_medium, c.utm_campaign, c.utm_content, c.utm_term,
                      c.fbclid, c.meta_lead_id, c.meta_form_id, c.meta_page_id,
                      c.ad_account_id, c.current_stage AS stage_id, c.ip_address, c.user_agent,
                      ${sqlFonte(db, comWhatsapp)} AS fonte,
                      ${sqlConfianca(db, comWhatsapp)} AS confianca,
                      ${sqlAdId(db, comWhatsapp)} AS ad_id,
                      NULLIF(c.meta_adset_id, '') AS adset_id,
                      NULLIF(c.meta_campaign_id, '') AS campaign_id,
                      ${sqlCtwaClid(db, comWhatsapp)} AS ctwa_clid,
                      NULLIF(c.meta_campaign_name, '') AS campanha_lead,
                      NULLIF(c.meta_adset_name, '') AS conjunto_lead,
                      NULLIF(c.meta_ad_name, '') AS anuncio_lead
                 FROM ${db.tabela('customers')} c
                WHERE c.id = ?) b
         LEFT JOIN ${db.tabela('meta_ads')} an ON an.ad_id = b.ad_id
         LEFT JOIN ${db.tabela('meta_adsets')} cj ON cj.adset_id = COALESCE(b.adset_id, an.adset_id)
         LEFT JOIN ${db.tabela('meta_campaigns')} cam
                ON cam.campaign_id = COALESCE(b.campaign_id, an.campaign_id)
         LEFT JOIN ${db.tabela('crm_meta_event_map')} em ON em.status_id = b.stage_id
        LIMIT 1`,
      [customerId],
    ),
  );
  if (!linha) return null;

  const [referencia, conversoes] = await Promise.all([
    lacunas.ou<ReferenciaConversa | null>(referenciaDaConversa(db, customerId), null),
    lacunas.ou(
      db.query<ConversaoCapi>(
        `SELECT e.id, e.created_at, e.event_name, e.content_name, e.status, e.value,
                e.currency, e.event_source_url, e.action_source, e.error_message
           FROM ${db.tabela('meta_capi_events')} e
          WHERE e.customer_id = ?
          ORDER BY e.created_at DESC
          LIMIT 30`,
        [customerId],
      ),
      [] as ConversaoCapi[],
    ),
  ]);

  return {
    ...linha,
    primeira_mensagem_em: referencia?.primeira_mensagem_em ?? null,
    url_origem: referencia?.url_origem ?? null,
    titulo_anuncio: referencia?.titulo_anuncio ?? null,
    conversoes,
    lacunas_de_esquema: lacunas.lista(),
  };
}
