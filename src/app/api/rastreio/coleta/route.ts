import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bateu } from '@/lib/auth/limite';
import { BancoCliente } from '@/lib/db/cliente';
import {
  contatoDoCliente,
  encontraOuCriaLeadPagina,
  gravaEvento,
  marcaCapiEvento,
  registraVisitante,
  salvaNegocioDoLead,
  vinculaVisitante,
} from '@/lib/db/paginas';
import { buscaSitePorChave, type SiteDaColeta } from '@/lib/db/paginas-sites';
import { buscaNegocioNoKommo, criaLeadNoKommo } from '@/lib/kommo';
import { enviaEventoSite } from '@/lib/meta-capi';
import {
  EVENTOS_PAGINA,
  caminhoDe,
  contatoDoFormulario,
  dadosPersonalizados,
  dominioPermitido,
  ehEventIdPagina,
  ehFbc,
  ehFbp,
  eventIdDaCompra,
  hostDe,
  ipDaRequisicao,
  limpaUrl,
  montaFbc,
  montaUserData,
  origemDaUrl,
  texto,
  type ContatoFormulario,
} from '@/lib/paginas-web';

/**
 * `POST /api/rastreio/coleta` — cada evento que o script `/t.js` manda.
 *
 * Rota pública, sem sessão: quem chama é o navegador de um visitante
 * qualquer, num site que não é este. Por isso ela não usa `rota()` e
 * confere tudo o que a sessão conferiria em outro lugar:
 *
 *  - a chave precisa ser de um site ativo;
 *  - a página (e a origem da requisição) precisa ser de um dos domínios
 *    cadastrados para aquele site;
 *  - há teto por IP, e um teto bem menor para Lead, que cria negócio no
 *    Kommo do cliente.
 *
 * O corpo chega como `text/plain` (é o que o `sendBeacon` manda sem
 * preflight de CORS) e é lido à mão, com limite de tamanho.
 *
 * A resposta não importa para o script, que não espera por ela. Os
 * códigos existem para quem depura com `data-debug` e para os logs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BYTES = 8 * 1024;

/** Motivos de `enviaEventoSite` que são configuração ausente, não falha. */
const MOTIVOS_PULADOS = new Set(['cliente sem pixel cadastrado', 'sem token de acesso para a CAPI']);

const schema = z.object({
  k: z.string().min(16).max(32),
  ev: z.enum(EVENTOS_PAGINA),
  id: z.string().max(120),
  vid: z.string().regex(/^[a-f0-9]{32}$/),
  url: z.string().max(2000),
  ref: z.string().max(2000).nullish(),
  fbc: z.string().max(500).nullish(),
  fbp: z.string().max(120).nullish(),
  dados: z.record(z.unknown()).nullish(),
  cd: z.record(z.unknown()).nullish(),
});

/**
 * CORS. A origem é ecoada sem conferir contra a lista do site: a
 * requisição não leva cookie (`credentials: 'omit'`) e a resposta não
 * tem nada a esconder. Quem barra evento de domínio alheio é a checagem
 * de domínio dentro do POST, não o CORS — CORS só decide se o navegador
 * deixa o script LER a resposta.
 */
function cors(origem: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: 'Origin' };
  if (origem && /^https?:\/\/[^/]+$/.test(origem)) {
    h['Access-Control-Allow-Origin'] = origem;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function resposta(status: number, h: Record<string, string>, erro?: string) {
  if (!erro) return new Response(null, { status, headers: h });
  return NextResponse.json({ ok: false, erro }, { status, headers: h });
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin')) });
}

export async function POST(req: Request) {
  const h = cors(req.headers.get('origin'));
  try {
    return await processa(req, h);
  } catch (e) {
    console.error('[rastreio/coleta] falha inesperada', e);
    return resposta(500, h, 'erro interno');
  }
}

async function processa(req: Request, h: Record<string, string>): Promise<Response> {
  const bruto = await req.text();
  if (bruto.length > MAX_BYTES) return resposta(413, h, 'corpo grande demais');

  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    return resposta(400, h, 'JSON inválido');
  }
  const lido = schema.safeParse(json);
  if (!lido.success) return resposta(400, h, 'evento inválido');
  const p = lido.data;

  const site = await buscaSitePorChave(p.k);
  if (!site || !site.ativo) return resposta(404, h, 'site desconhecido ou desativado');

  // A página do evento E a origem da requisição precisam ser do site.
  // Só a URL do corpo não bastaria: é texto livre, qualquer um escreve.
  // Origin (ou Referer, que o sendBeacon às vezes manda no lugar) é o
  // navegador quem preenche.
  const hostPagina = hostDe(p.url);
  const hostOrigem = hostDe(req.headers.get('origin')) ?? hostDe(req.headers.get('referer')) ?? hostPagina;
  if (!dominioPermitido(hostPagina, site.dominios) || !dominioPermitido(hostOrigem, site.dominios)) {
    return resposta(403, h, 'domínio não cadastrado para este site');
  }

  const ip = ipDaRequisicao(req.headers);
  const userAgent = texto(req.headers.get('user-agent'), 500);
  if (bateu('coletaPorIp', ip ?? 'desconhecido').bloqueado) return resposta(429, h, 'muitas requisições');

  // Lead é conferido antes de gravar qualquer coisa: sem contato válido
  // o evento não vale, e o teto de lead conta mesmo na tentativa recusada.
  let contato: ContatoFormulario | null = null;
  if (p.ev === 'Lead') {
    if (bateu('leadPorIp', ip ?? 'desconhecido').bloqueado) return resposta(429, h, 'muitos leads');
    contato = contatoDoFormulario(p.dados);
    if (!contato) return resposta(400, h, 'lead sem e-mail nem telefone válido');
  }

  const cd = dadosPersonalizados(p.cd);
  // Compra com número de pedido usa o mesmo id do webhook da plataforma:
  // a que chegar depois é descartada como repetida.
  const eventId = p.ev === 'Purchase' && cd.order_id ? eventIdDaCompra(cd.order_id) : p.id;
  if (!ehEventIdPagina(eventId)) return resposta(400, h, 'event_id inválido');

  const db = new BancoCliente(site.client_db_name);
  const origem = origemDaUrl(p.url);
  const fbc = ehFbc(p.fbc) ? p.fbc : origem.fbclid ? montaFbc(origem.fbclid, Date.now()) : null;
  const fbp = ehFbp(p.fbp) ? p.fbp : null;
  const urlLimpa = limpaUrl(p.url);

  const visitante = await registraVisitante(db, site.id, p.vid, {
    landing_url: urlLimpa,
    referrer: limpaUrl(p.ref),
    utm: origem.utm,
    fbclid: origem.fbclid,
    fbc,
    fbp,
    meta_ad_id: origem.meta_ad_id,
    meta_adset_id: origem.meta_adset_id,
    meta_campaign_id: origem.meta_campaign_id,
    ip,
    user_agent: userAgent,
  });

  const novo = await gravaEvento(db, {
    siteId: site.id,
    visitorId: p.vid,
    customerId: visitante?.customer_id ?? null,
    eventName: p.ev,
    eventId,
    pageUrl: urlLimpa,
    pagePath: caminhoDe(p.url),
    value: typeof cd.value === 'number' ? cd.value : null,
    currency: typeof cd.currency === 'string' ? cd.currency : null,
    orderId: typeof cd.order_id === 'string' ? cd.order_id : null,
    plataforma: null,
    utmSource: visitante?.utm_source ?? null,
    utmCampaign: visitante?.utm_campaign ?? null,
    metaCampaignId: visitante?.meta_campaign_id ?? null,
  });
  // Repetido: o navegador mandou de novo, ou a compra já veio pelo
  // webhook. Nada de lead novo, nada de segundo envio à Meta.
  if (!novo) return resposta(204, h);

  let customerId = visitante?.customer_id ?? null;
  if (contato) {
    customerId = await registraLead(db, site, p.vid, contato, visitante, { ip, user_agent: userAgent });
  }

  const cliente = customerId ? await contatoDoCliente(db, customerId) : null;
  const resultado = await enviaEventoSite(site.client_db_name, db, {
    eventName: p.ev,
    eventId,
    eventTime: Math.floor(Date.now() / 1000),
    actionSource: 'website',
    eventSourceUrl: urlLimpa,
    userData: montaUserData({
      email: cliente?.email ?? null,
      telefone: cliente?.phone ?? null,
      primeiro_nome: cliente?.first_name ?? null,
      sobrenome: cliente?.last_name ?? null,
      cidade: cliente?.city ?? null,
      estado: cliente?.state ?? null,
      cep: cliente?.zipcode ?? null,
      pais: cliente ? (cliente.country ?? 'br') : null,
      external_id: p.vid,
      fbc: fbc ?? visitante?.fbc ?? null,
      fbp: fbp ?? visitante?.fbp ?? null,
      ip,
      user_agent: userAgent,
    }),
    customData: cd,
    log: p.ev !== 'PageView' && customerId ? { customerId, leadEventSource: 'Página de vendas' } : undefined,
  });

  const status = resultado.enviado ? 'SENT' : MOTIVOS_PULADOS.has(resultado.motivo) ? 'SKIPPED' : 'ERROR';
  await marcaCapiEvento(db, eventId, status, resultado.enviado ? null : resultado.motivo);

  return resposta(204, h);
}

/**
 * Cria (ou acha) o lead no banco e, se o site manda para o CRM, o
 * negócio no Kommo. Devolve o id do lead.
 *
 * Falha do Kommo não derruba o evento: o lead já está no banco e o
 * evento vai para a Meta do mesmo jeito. O erro fica no log do servidor
 * — sem o contato, que é dado pessoal.
 */
async function registraLead(
  db: BancoCliente,
  site: SiteDaColeta,
  visitorId: string,
  contato: ContatoFormulario,
  visitante: Awaited<ReturnType<typeof registraVisitante>>,
  navegador: { ip: string | null; user_agent: string | null },
): Promise<number> {
  const lead = await encontraOuCriaLeadPagina(db, site.ad_account_id, contato, visitante, navegador);
  await vinculaVisitante(db, visitorId, lead.id);

  if (!site.envia_kommo || lead.crm_lead_id) return lead.id;

  const criado = await criaLeadNoKommo(site.client_db_name, {
    nome:
      contato.nome ??
      contato.email ??
      (contato.telefone ? `+${contato.telefone}` : `Lead do site ${site.nome}`),
    telefone: contato.telefone,
    email: contato.email,
    primeiroNome: contato.primeiro_nome,
    sobrenome: contato.sobrenome,
    pipelineId: site.kommo_pipeline_id,
    statusId: site.kommo_status_id,
    tags: ['Site', site.nome.slice(0, 50)],
    utm: {
      source: visitante?.utm_source ?? null,
      medium: visitante?.utm_medium ?? null,
      campaign: visitante?.utm_campaign ?? null,
      content: visitante?.utm_content ?? null,
      term: visitante?.utm_term ?? null,
    },
    fbclid: visitante?.fbclid ?? null,
  });

  if (!criado.ok) {
    if (!criado.semConfiguracao) {
      console.error('[rastreio/coleta] Kommo recusou o lead', site.client_db_name, lead.id, criado.erro);
    }
    return lead.id;
  }

  // A etapa: a configurada no site ou, sem ela, a que o Kommo escolheu.
  let etapa = site.kommo_status_id;
  if (!etapa) {
    const negocio = await buscaNegocioNoKommo(site.client_db_name, criado.lead_id);
    etapa = negocio.ok ? negocio.negocio.status_id : null;
  }
  await salvaNegocioDoLead(db, lead.id, {
    crm_lead_id: criado.lead_id,
    crm_contact_id: criado.contact_id,
    current_stage: etapa,
  });
  return lead.id;
}
