import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { bateu } from '@/lib/auth/limite';
import { BancoCliente } from '@/lib/db/cliente';
import {
  buscaLeadPorContato,
  buscaVisitante,
  contatoDoCliente,
  gravaEvento,
  marcaCapiEvento,
  vinculaVisitante,
} from '@/lib/db/paginas';
import { buscaSitePorChave } from '@/lib/db/paginas-sites';
import { enviaEventoSite } from '@/lib/meta-capi';
import {
  ehPlataforma,
  eventIdDaCompra,
  ipDaRequisicao,
  leCompra,
  limpaPedido,
  montaUserData,
  separaNome,
} from '@/lib/paginas-web';

/**
 * `POST /api/rastreio/compra/{generico|hotmart|kiwify}?k=CHAVE&token=TOKEN`
 * — o webhook de venda aprovada da plataforma de checkout.
 *
 * É a fonte confiável do Purchase: quem manda é o servidor da
 * plataforma, com o token secreto do site na URL, e não o navegador.
 * O `trk('purchase')` da página de obrigado usa o mesmo `event_id`
 * (`site_purchase_<pedido>`), então a venda conta uma vez só na Meta e
 * uma vez só no painel, venha por onde vier primeiro.
 *
 * A compra é ligada à visita pelo id do visitante que o script põe no
 * `sck`/`src` do link de checkout. Sem ele, pelo telefone ou e-mail do
 * comprador contra os leads já existentes. Comprador que nunca foi lead
 * NÃO vira lead: o CRM é do cliente, e quem comprou direto sem passar
 * por formulário não entra no funil por aqui.
 *
 * Status de resposta pensado para a plataforma, que reenvia em qualquer
 * coisa diferente de 2xx: evento que não é venda aprovada, site
 * desativado e compra repetida respondem 200 com o motivo, para não
 * virar fila de reenvio. Token errado e formato desconhecido respondem
 * erro, porque aí reenviar também não resolve — e aparece no painel da
 * plataforma para quem configurou.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BYTES = 64 * 1024;

const MOTIVOS_PULADOS = new Set(['cliente sem pixel cadastrado', 'sem token de acesso para a CAPI']);

function json(status: number, corpo: Record<string, unknown>) {
  return NextResponse.json(corpo, { status });
}

function mesmoToken(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request, ctx: { params: Promise<{ plataforma: string }> }) {
  try {
    return await processa(req, (await ctx.params).plataforma);
  } catch (e) {
    // 500 de propósito: a plataforma reenvia, e o banco fora do ar por
    // um minuto não pode custar a venda.
    console.error('[rastreio/compra] falha inesperada', e);
    return json(500, { ok: false, erro: 'erro interno' });
  }
}

async function processa(req: Request, plataforma: string): Promise<Response> {
  if (!ehPlataforma(plataforma)) return json(404, { ok: false, erro: 'plataforma desconhecida' });

  const ip = ipDaRequisicao(req.headers);
  if (bateu('compraPorIp', ip ?? 'desconhecido').bloqueado) {
    return json(429, { ok: false, erro: 'muitas requisições' });
  }

  const params = new URL(req.url).searchParams;
  const token = params.get('token') ?? req.headers.get('x-trk-token') ?? '';
  const site = await buscaSitePorChave(params.get('k') ?? '');
  if (!site || !mesmoToken(token, site.webhook_token)) {
    return json(401, { ok: false, erro: 'chave ou token inválido' });
  }
  if (!site.ativo) return json(200, { ok: true, ignorado: 'site desativado' });

  const bruto = await req.text();
  if (bruto.length > MAX_BYTES) return json(413, { ok: false, erro: 'corpo grande demais' });

  let corpo: unknown;
  try {
    corpo = (req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')
      ? Object.fromEntries(new URLSearchParams(bruto))
      : JSON.parse(bruto);
  } catch {
    return json(400, { ok: false, erro: 'corpo ilegível' });
  }

  const compra = leCompra(plataforma, corpo);
  const eventId = compra ? eventIdDaCompra(compra.pedido) : null;
  if (!compra || !eventId) return json(422, { ok: false, erro: 'formato de compra não reconhecido' });
  if (compra.situacao !== 'aprovada') {
    return json(200, { ok: true, ignorado: `evento ${compra.evento ?? compra.situacao}` });
  }

  const db = new BancoCliente(site.client_db_name);
  const visitante = compra.visitante ? await buscaVisitante(db, compra.visitante) : null;
  let customerId = visitante?.customer_id ?? null;
  if (!customerId) {
    customerId = (await buscaLeadPorContato(db, compra.telefone, compra.email))?.id ?? null;
    if (customerId && visitante && compra.visitante) await vinculaVisitante(db, compra.visitante, customerId);
  }

  const novo = await gravaEvento(db, {
    siteId: site.id,
    visitorId: visitante ? compra.visitante : null,
    customerId,
    eventName: 'Purchase',
    eventId,
    pageUrl: null,
    pagePath: null,
    value: compra.valor,
    currency: compra.moeda,
    orderId: limpaPedido(compra.pedido),
    plataforma,
    utmSource: visitante?.utm_source ?? compra.utm.source ?? null,
    utmCampaign: visitante?.utm_campaign ?? compra.utm.campaign ?? null,
    metaCampaignId: visitante?.meta_campaign_id ?? null,
  });
  if (!novo) return json(200, { ok: true, repetido: true });

  const cliente = customerId ? await contatoDoCliente(db, customerId) : null;
  const nome = separaNome(compra.nome);
  const userAgent = visitante?.user_agent ?? null;
  // `website` exige navegador por trás: user agent e URL da página. Sem
  // a visita, a venda vai como `system_generated` — conta do mesmo jeito,
  // só casa com o usuário pelo e-mail e telefone.
  const comNavegador = Boolean(userAgent && visitante?.landing_url);

  const customData: Record<string, unknown> = { currency: compra.moeda, order_id: limpaPedido(compra.pedido) };
  if (compra.valor !== null) customData.value = Math.round(compra.valor * 100) / 100;
  if (compra.produto) customData.content_name = compra.produto;

  const resultado = await enviaEventoSite(site.client_db_name, db, {
    eventName: 'Purchase',
    eventId,
    eventTime: Math.floor(Date.now() / 1000),
    actionSource: comNavegador ? 'website' : 'system_generated',
    eventSourceUrl: comNavegador ? visitante!.landing_url : null,
    userData: montaUserData({
      email: compra.email ?? cliente?.email ?? null,
      telefone: compra.telefone ?? cliente?.phone ?? null,
      primeiro_nome: nome.primeiro ?? cliente?.first_name ?? null,
      sobrenome: nome.resto ?? cliente?.last_name ?? null,
      cidade: cliente?.city ?? null,
      estado: cliente?.state ?? null,
      cep: cliente?.zipcode ?? null,
      pais: cliente?.country ?? null,
      external_id: visitante ? compra.visitante : null,
      fbc: visitante?.fbc ?? null,
      fbp: visitante?.fbp ?? null,
      ip: compra.ip ?? visitante?.ip_address ?? null,
      user_agent: comNavegador ? userAgent : null,
    }),
    customData,
    log: customerId ? { customerId, leadEventSource: 'Página de vendas' } : undefined,
  });

  const status = resultado.enviado ? 'SENT' : MOTIVOS_PULADOS.has(resultado.motivo) ? 'SKIPPED' : 'ERROR';
  await marcaCapiEvento(db, eventId, status, resultado.enviado ? null : resultado.motivo);

  return json(200, { ok: true, evento: eventId, capi: status, visitante: Boolean(visitante), lead: Boolean(customerId) });
}
