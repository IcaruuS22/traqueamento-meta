import 'server-only';
import type { BancoCliente } from '@/lib/db/cliente';
import { queryOne } from '@/lib/db/pool';
import { condicaoTimestamp, type Periodo } from '@/lib/periodo';
import { dddDoTelefone } from '@/lib/paginas-web';

/**
 * Rastreio de páginas de vendas no banco do cliente: visitantes,
 * eventos e o lead que um formulário da página cria em `customers`.
 *
 * Quem escreve aqui são as rotas públicas de `/api/rastreio`. Nada
 * nelas vem de sessão, então toda entrada chega a este módulo já
 * validada e normalizada por `paginas-web.ts` — aqui é só SQL.
 */

export type Utm = Partial<Record<'source' | 'medium' | 'campaign' | 'content' | 'term', string | null>>;

/** De onde a visita veio. Tudo opcional: visita direta não traz nada. */
export type OrigemVisita = {
  landing_url: string | null;
  referrer: string | null;
  utm: Utm;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  meta_ad_id: string | null;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  ip: string | null;
  user_agent: string | null;
};

/** O visitante como ficou gravado, com a origem que vale para atribuir. */
export type Visitante = {
  customer_id: number | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  meta_ad_id: string | null;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  /**
   * Primeira página vista. É o `event_source_url` da compra que chega
   * pelo webhook, que não sabe de página nenhuma — e a Meta exige essa
   * URL em todo evento `website`.
   */
  landing_url: string | null;
};

/** Visita com alguma origem identificada — o que pode sobrescrever a anterior. */
function temOrigem(o: OrigemVisita): boolean {
  return Boolean(o.utm.source || o.utm.campaign || o.fbclid || o.meta_campaign_id || o.meta_ad_id);
}

/**
 * Cria ou atualiza o visitante e devolve como ele ficou.
 *
 * A atribuição é de último toque com origem conhecida: quem clicou no
 * anúncio, saiu e voltou digitando o endereço continua atribuído à
 * campanha. Uma visita nova COM origem troca a campanha inteira — UTMs
 * e ids do anúncio juntos, para nunca misturar o `utm_campaign` de um
 * clique com o `meta_ad_id` de outro. `landing_url`, `referrer` e
 * `first_seen_at` são da primeira visita e não mudam.
 */
export async function registraVisitante(
  db: BancoCliente,
  siteId: number,
  visitorId: string,
  o: OrigemVisita,
): Promise<Visitante | null> {
  const troca = temOrigem(o) ? 1 : 0;
  const colunasOrigem = [
    ['utm_source', o.utm.source ?? null],
    ['utm_medium', o.utm.medium ?? null],
    ['utm_campaign', o.utm.campaign ?? null],
    ['utm_content', o.utm.content ?? null],
    ['utm_term', o.utm.term ?? null],
    ['fbclid', o.fbclid],
    ['meta_ad_id', o.meta_ad_id],
    ['meta_adset_id', o.meta_adset_id],
    ['meta_campaign_id', o.meta_campaign_id],
  ] as const;

  const t = db.tabela('paginas_visitantes');
  await db.execute(
    `INSERT INTO ${t}
       (visitor_id, site_id, landing_url, referrer, fbc, fbp, ip_address, user_agent,
        ${colunasOrigem.map(([c]) => c).join(', ')})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${colunasOrigem.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE
       last_seen_at = CURRENT_TIMESTAMP,
       site_id = ?,
       fbc = COALESCE(?, fbc),
       fbp = COALESCE(?, fbp),
       ip_address = COALESCE(?, ip_address),
       user_agent = COALESCE(?, user_agent),
       ${colunasOrigem.map(([c]) => `${c} = IF(?, ?, ${c})`).join(',\n       ')}`,
    [
      visitorId, siteId, o.landing_url, o.referrer, o.fbc, o.fbp, o.ip, o.user_agent,
      ...colunasOrigem.map(([, v]) => v),
      siteId, o.fbc, o.fbp, o.ip, o.user_agent,
      ...colunasOrigem.flatMap(([, v]) => [troca, v]),
    ],
  );
  return buscaVisitante(db, visitorId);
}

export async function buscaVisitante(db: BancoCliente, visitorId: string): Promise<Visitante | null> {
  return db.queryOne<Visitante>(
    `SELECT customer_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            fbclid, fbc, fbp, meta_ad_id, meta_adset_id, meta_campaign_id,
            ip_address, user_agent, landing_url
       FROM ${db.tabela('paginas_visitantes')}
      WHERE visitor_id = ?
      LIMIT 1`,
    [visitorId],
  );
}

/**
 * Liga o visitante ao lead. Os eventos que ele já tinha feito anônimo
 * passam a apontar para o lead também: é assim que a tela mostra o
 * caminho inteiro de quem converteu, e não só o último passo.
 */
export async function vinculaVisitante(
  db: BancoCliente,
  visitorId: string,
  customerId: number,
): Promise<void> {
  await db.execute(
    `UPDATE ${db.tabela('paginas_visitantes')} SET customer_id = ? WHERE visitor_id = ?`,
    [customerId, visitorId],
  );
  await db.execute(
    `UPDATE ${db.tabela('paginas_eventos')}
        SET customer_id = ?
      WHERE visitor_id = ? AND customer_id IS NULL`,
    [customerId, visitorId],
  );
}

export type NovoEvento = {
  siteId: number;
  visitorId: string | null;
  customerId: number | null;
  eventName: string;
  eventId: string;
  pageUrl: string | null;
  pagePath: string | null;
  value: number | null;
  currency: string | null;
  orderId: string | null;
  plataforma: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  metaCampaignId: string | null;
};

/**
 * Grava o evento. Devolve `false` quando o `event_id` já existia — a
 * plataforma reenviou a compra, ou o navegador mandou o mesmo evento
 * duas vezes. Quem chama usa isso para não mandar de novo à Meta.
 */
export async function gravaEvento(db: BancoCliente, e: NovoEvento): Promise<boolean> {
  const { affectedRows } = await db.execute(
    `INSERT IGNORE INTO ${db.tabela('paginas_eventos')}
       (site_id, visitor_id, customer_id, event_name, event_id, page_url, page_path,
        value, currency, order_id, plataforma, utm_source, utm_campaign, meta_campaign_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.siteId, e.visitorId, e.customerId, e.eventName, e.eventId, e.pageUrl, e.pagePath,
      e.value, e.currency, e.orderId, e.plataforma, e.utmSource, e.utmCampaign, e.metaCampaignId,
    ],
  );
  return affectedRows > 0;
}

/**
 * Situação do envio à Conversions API. `SKIPPED` é o cliente sem pixel
 * ou sem token: o evento fica registrado no painel mesmo assim.
 */
export async function marcaCapiEvento(
  db: BancoCliente,
  eventId: string,
  status: 'SENT' | 'ERROR' | 'SKIPPED',
  erro: string | null,
): Promise<void> {
  await db.execute(
    `UPDATE ${db.tabela('paginas_eventos')} SET capi_status = ?, capi_error = ? WHERE event_id = ?`,
    [status, erro ? erro.slice(0, 500) : null, eventId],
  );
}

/** Contato de um lead, como veio do formulário da página. */
export type ContatoLead = {
  /** Normalizado: só dígitos, com 55. */
  telefone: string | null;
  email: string | null;
  primeiro_nome: string | null;
  sobrenome: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
};

export type LeadEncontrado = {
  id: number;
  criado: boolean;
  crm_lead_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
};

const COLUNAS_LEAD = 'id, crm_lead_id, first_name, last_name, email, phone, city, state, zipcode';

/**
 * O lead já existente com esse telefone (pelos 10 últimos dígitos, a
 * mesma regra do WhatsApp) ou, sem telefone, com esse e-mail.
 */
export async function buscaLeadPorContato(
  db: BancoCliente,
  telefone: string | null,
  email: string | null,
): Promise<Omit<LeadEncontrado, 'criado'> | null> {
  const t = db.tabela('customers');
  if (telefone) {
    const porTelefone = await db.queryOne<Omit<LeadEncontrado, 'criado'>>(
      `SELECT ${COLUNAS_LEAD} FROM ${t}
        WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = RIGHT(?, 10)
        ORDER BY id DESC LIMIT 1`,
      [telefone],
    );
    if (porTelefone) return porTelefone;
  }
  if (email) {
    return db.queryOne<Omit<LeadEncontrado, 'criado'>>(
      `SELECT ${COLUNAS_LEAD} FROM ${t} WHERE LOWER(email) = ? ORDER BY id DESC LIMIT 1`,
      [email],
    );
  }
  return null;
}

/** UF pelo DDD, pela tabela de referência do banco central. */
async function ufDoTelefone(telefone: string | null): Promise<string | null> {
  const ddd = dddDoTelefone(telefone);
  if (!ddd) return null;
  try {
    const linha = await queryOne<{ state: string }>(
      'SELECT state FROM trakeamento_controle.ddd_state_map WHERE ddd = ? LIMIT 1',
      [ddd],
    );
    return linha?.state?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * Acha o lead pelo contato ou cria um novo.
 *
 * Lead existente só tem os campos VAZIOS preenchidos: o que o CRM ou o
 * formulário instantâneo já gravaram é mais confiável que um campo de
 * site, e a origem de um lead antigo não é trocada pela de uma visita
 * nova. `current_stage` fica nulo: lead de página de vendas não nasce
 * em funil de CRM nenhum.
 */
export async function encontraOuCriaLeadPagina(
  db: BancoCliente,
  adAccountId: string,
  contato: ContatoLead,
  origem: Visitante | null,
  navegador: { ip: string | null; user_agent: string | null },
): Promise<LeadEncontrado> {
  const t = db.tabela('customers');
  const estado = contato.estado ?? (await ufDoTelefone(contato.telefone));
  const o = origem;
  const campos = [
    ['first_name', contato.primeiro_nome],
    ['last_name', contato.sobrenome],
    ['email', contato.email],
    ['phone', contato.telefone],
    ['city', contato.cidade],
    ['state', estado],
    ['zipcode', contato.cep],
    ['ip_address', navegador.ip],
    ['user_agent', navegador.user_agent],
    ['utm_source', o?.utm_source ?? null],
    ['utm_medium', o?.utm_medium ?? null],
    ['utm_campaign', o?.utm_campaign ?? null],
    ['utm_content', o?.utm_content ?? null],
    ['utm_term', o?.utm_term ?? null],
    ['fbclid', o?.fbclid ?? null],
    ['meta_ad_id', o?.meta_ad_id ?? null],
    ['meta_adset_id', o?.meta_adset_id ?? null],
    ['meta_campaign_id', o?.meta_campaign_id ?? null],
  ] as const;

  const existente = await buscaLeadPorContato(db, contato.telefone, contato.email);
  if (existente) {
    await db.execute(
      `UPDATE ${t}
          SET ${campos.map(([c]) => `${c} = COALESCE(NULLIF(${c}, ''), ?)`).join(', ')},
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [...campos.map(([, v]) => v), existente.id],
    );
    const atual = await db.queryOne<Omit<LeadEncontrado, 'criado'>>(
      `SELECT ${COLUNAS_LEAD} FROM ${t} WHERE id = ?`,
      [existente.id],
    );
    return { ...(atual ?? existente), criado: false };
  }

  const { insertId } = await db.execute(
    `INSERT INTO ${t} (ad_account_id, country, ${campos.map(([c]) => c).join(', ')})
     VALUES (?, 'br', ${campos.map(() => '?').join(', ')})`,
    [adAccountId, ...campos.map(([, v]) => v)],
  );
  return {
    id: insertId,
    criado: true,
    crm_lead_id: null,
    first_name: contato.primeiro_nome,
    last_name: contato.sobrenome,
    email: contato.email,
    phone: contato.telefone,
    city: contato.cidade,
    state: estado,
    zipcode: contato.cep,
  };
}

export type ContatoDoCliente = {
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  country: string | null;
};

/**
 * O contato de um lead conhecido. Vai no `user_data` de todo evento que
 * o visitante faz depois de virar lead — um InitiateCheckout com e-mail
 * e telefone casa com a pessoa na Meta muito melhor que só com cookie.
 */
export async function contatoDoCliente(db: BancoCliente, customerId: number): Promise<ContatoDoCliente | null> {
  return db.queryOne<ContatoDoCliente>(
    `SELECT email, phone, first_name, last_name, city, state, zipcode, country
       FROM ${db.tabela('customers')} WHERE id = ? LIMIT 1`,
    [customerId],
  );
}

// ---------------------------------------------------------------------
// Leitura para a tela
// ---------------------------------------------------------------------

export type Totais = {
  visitantes: number;
  visualizacoes: number;
  leads: number;
  checkouts: number;
  compras: number;
  receita: number;
};

export type LinhaAgrupada = Totais & { chave: string };

export type EventoRecente = {
  created_at: string;
  event_name: string;
  page_path: string | null;
  value: number | null;
  currency: string | null;
  plataforma: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  capi_status: string;
  capi_error: string | null;
  customer_id: number | null;
  nome: string | null;
};

export type PainelPaginas = {
  totais: Totais;
  errosCapi: number;
  porCampanha: LinhaAgrupada[];
  porPagina: LinhaAgrupada[];
  recentes: EventoRecente[];
};

/**
 * Pessoas distintas em cada etapa. Compra sem visitante (webhook que
 * não trouxe o id) conta pelo próprio evento, para não sumir do total.
 */
const SOMAS = `
  COUNT(DISTINCT CASE WHEN event_name = 'PageView' THEN visitor_id END) AS visitantes,
  SUM(event_name = 'PageView') AS visualizacoes,
  COUNT(DISTINCT CASE WHEN event_name = 'Lead' THEN COALESCE(visitor_id, event_id) END) AS leads,
  COUNT(DISTINCT CASE WHEN event_name = 'InitiateCheckout' THEN COALESCE(visitor_id, event_id) END) AS checkouts,
  SUM(event_name = 'Purchase') AS compras,
  COALESCE(SUM(CASE WHEN event_name = 'Purchase' THEN value END), 0) AS receita
`;

type LinhaSomas = Record<keyof Totais, string | number | null>;

function numeros(l: LinhaSomas | null | undefined): Totais {
  const n = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
  return {
    visitantes: n(l?.visitantes),
    visualizacoes: n(l?.visualizacoes),
    leads: n(l?.leads),
    checkouts: n(l?.checkouts),
    compras: n(l?.compras),
    receita: n(l?.receita),
  };
}

export async function buscaPainelPaginas(
  db: BancoCliente,
  periodo: Periodo,
  siteId: number | null,
): Promise<PainelPaginas> {
  const t = db.tabela('paginas_eventos');
  const tempo = condicaoTimestamp('e.created_at', periodo.inicioSec, periodo.fimSec);
  const condicoes = [tempo.sql, siteId ? 'e.site_id = ?' : ''].filter(Boolean);
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const params: (string | number)[] = [...tempo.params, ...(siteId ? [siteId] : [])];

  const [totais, erros, porCampanha, porPagina, recentes] = await Promise.all([
    db.queryOne<LinhaSomas>(`SELECT ${SOMAS} FROM ${t} e ${where}`, params),
    db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${t} e ${where ? `${where} AND` : 'WHERE'} e.capi_status = 'ERROR'`,
      params,
    ),
    db.query<LinhaSomas & { chave: string }>(
      `SELECT COALESCE(NULLIF(e.utm_campaign, ''), '(sem campanha)') AS chave, ${SOMAS}
         FROM ${t} e ${where}
        GROUP BY chave
        ORDER BY receita DESC, compras DESC, leads DESC, visitantes DESC
        LIMIT 50`,
      params,
    ),
    db.query<LinhaSomas & { chave: string }>(
      `SELECT COALESCE(e.page_path, '(webhook de compra)') AS chave, ${SOMAS}
         FROM ${t} e ${where}
        GROUP BY chave
        ORDER BY visitantes DESC, leads DESC, compras DESC
        LIMIT 50`,
      params,
    ),
    db.query<EventoRecente>(
      `SELECT e.created_at, e.event_name, e.page_path, e.value, e.currency, e.plataforma,
              e.utm_source, e.utm_campaign, e.capi_status, e.capi_error, e.customer_id,
              NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '') AS nome
         FROM ${t} e
         LEFT JOIN ${db.tabela('customers')} c ON c.id = e.customer_id
         ${where ? `${where} AND` : 'WHERE'} e.event_name <> 'PageView'
        ORDER BY e.id DESC
        LIMIT 50`,
      params,
    ),
  ]);

  return {
    totais: numeros(totais),
    errosCapi: Number(erros?.n ?? 0),
    porCampanha: porCampanha.map((l) => ({ chave: l.chave, ...numeros(l) })),
    porPagina: porPagina.map((l) => ({ chave: l.chave, ...numeros(l) })),
    recentes: recentes.map((r) => ({ ...r, value: r.value === null ? null : Number(r.value) })),
  };
}
