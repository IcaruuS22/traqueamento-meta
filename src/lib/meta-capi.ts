import 'server-only';
import { createHash } from 'node:crypto';
import type { BancoCliente } from '@/lib/db/cliente';
import { buscaCredenciaisCliente } from '@/lib/db/cliente';
import { leadVeioDeAnuncio } from '@/lib/db/conversas';
import { buscaCredenciaisCapiWhatsapp } from '@/lib/db/whatsapp';
import { decideEnvioCapiWhatsapp } from '@/lib/capi-politica';
import { env } from '@/lib/env';

/**
 * Envio de evento para a Conversions API da Meta — porte do bloco P.1 do
 * painel antigo (disparo por mudança de estágio na tela de Conversas).
 *
 * O disparo é acessório ao salvamento: no n8n ele corria em paralelo e
 * nunca derrubava a resposta de sucesso do formulário. Aqui vale a mesma
 * regra — esta função não lança, devolve o que aconteceu, e quem salva o
 * lead segue em frente de qualquer jeito.
 *
 * `meta_access_token` só existe dentro desta função e vai na query da
 * Graph API; nada do que ela devolve contém o token, e o log em
 * `meta_capi_events` guarda o corpo enviado, onde o token não está.
 */

/**
 * A Cloud API (envio de mensagem) continua em v20.0, como no workflow
 * antigo; a CAPI, em v25.0. As duas versões vieram do fluxo original e
 * estão registradas separadas de propósito: alinhá-las é uma mudança de
 * comportamento com a Meta, não uma limpeza de código.
 */
export const VERSAO_GRAPH_CAPI = 'v25.0';
export const VERSAO_GRAPH_CLOUD = 'v20.0';

const TIMEOUT_MS = 15_000;

/**
 * Para onde o evento de WhatsApp vai, e se vai.
 *
 * Todo evento que sai daqui é de WhatsApp — os leads de formulário são
 * enviados pelo n8n, não por este app —, então o destino é sempre o
 * dataset de mensagens em `whatsapp_accounts`, nunca
 * `ad_accounts.meta_pixel_dataset_id`. Antes ele caia nesse último por
 * não haver outro, e conversa de WhatsApp virava conversão no pixel do
 * site, misturada com os leads de formulário.
 *
 * O token é a única coisa que ainda cai para `ad_accounts`: um mesmo
 * token de System User atende os dois datasets quando eles estão na
 * mesma conta de negócios, e obrigar a recadastrá-lo não protegeria
 * nada. O dataset nunca cai.
 */
type Destino =
  | { ok: true; dataset_id: string; access_token: string; test_event_code: string | null }
  | { ok: false; motivo: string };

async function destinoWhatsapp(clientDb: string): Promise<Destino> {
  const capi = await buscaCredenciaisCapiWhatsapp(clientDb);
  if (!capi) {
    return {
      ok: false,
      motivo:
        'catálogo sem as colunas do pixel de mensagens — rode ' +
        'migracao_whatsapp_pixel_mensagens.sql',
    };
  }

  const decisao = decideEnvioCapiWhatsapp(capi);
  if (!decisao.envia) return { ok: false, motivo: decisao.motivo };

  const token = capi.access_token || (await buscaCredenciaisCliente(clientDb))?.meta_access_token;
  if (!token) return { ok: false, motivo: 'sem token de acesso para a CAPI' };

  return {
    ok: true,
    dataset_id: capi.dataset_id as string,
    access_token: token,
    test_event_code: decisao.test_event_code,
  };
}

export type EventoEstagio = {
  customerId: number;
  phone: string | null;
  estagio: string;
  meta_event: string;
  content_name: string | null;
  currency: string | null;
  value: number;
};

export type ResultadoCapi =
  | { enviado: true; event_id: string }
  | { enviado: false; motivo: string };

/**
 * SHA-256 do telefone no formato que a Meta espera: só dígitos, sem
 * espaço, parêntese, traço nem `+`.
 *
 * O fluxo antigo hasheava o valor cru de `customers.phone`. Quando o
 * telefone estava formatado, o hash não batia com o que a Meta calcula e
 * o evento chegava sem casamento de usuário — silenciosamente, porque a
 * API responde 200 do mesmo jeito.
 */
function hashTelefone(phone: string): string {
  const digitos = phone.replace(/\D/g, '');
  return createHash('sha256').update(digitos).digest('hex');
}

/**
 * Evento de mudança de etapa do lead de WhatsApp.
 *
 * A trava de origem fica AQUI, e não em cada tela que move o lead, pelo
 * mesmo motivo de `requireClientAccess` ficar no guard: são duas telas
 * hoje (Conversas e quadro do CRM) e uma terceira amanhã, e uma barreira
 * que depende de alguém lembrar de chamá-la não é barreira. Ver
 * `env.meta.exigeAnuncioWhatsapp` para quando ela vale.
 *
 * O evento barrado não vai para `meta_capi_events`: nada foi enviado, e
 * registrar um envio que não houve confundiria o log. Quem chamou recebe
 * o motivo e mostra na tela.
 */
export async function enviaEventoEstagio(
  clientDb: string,
  db: BancoCliente,
  evento: EventoEstagio,
): Promise<ResultadoCapi> {
  if (!evento.phone) return { enviado: false, motivo: 'lead sem telefone' };

  if (env.meta.exigeAnuncioWhatsapp && !(await leadVeioDeAnuncio(db, evento.customerId))) {
    return { enviado: false, motivo: 'lead não veio de anúncio' };
  }

  const destino = await destinoWhatsapp(clientDb);
  if (!destino.ok) return { enviado: false, motivo: destino.motivo };

  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = `whatsapp_estagio_${evento.customerId}_${evento.estagio}_${Date.now()}`;
  const userData = { ph: [hashTelefone(evento.phone)] };
  const customData = {
    content_name: evento.content_name || undefined,
    currency: evento.currency || 'BRL',
    value: Number(evento.value) || 0,
  };

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: evento.meta_event,
        event_time: eventTime,
        action_source: 'system_generated',
        event_id: eventId,
        user_data: userData,
        custom_data: customData,
      },
    ],
  };
  if (destino.test_event_code) {
    payload.test_event_code = destino.test_event_code;
  }

  const url = new URL(
    `https://graph.facebook.com/${VERSAO_GRAPH_CAPI}/${destino.dataset_id}/events`,
  );
  url.searchParams.set('access_token', destino.access_token);

  let resposta: unknown;
  let erro: string | null = null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    resposta = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detalhe = (resposta as { error?: { message?: string } })?.error?.message;
      erro = detalhe || `HTTP ${r.status}`;
    }
  } catch (e) {
    resposta = {};
    erro = e instanceof Error ? e.message : 'falha de rede';
  }

  await gravaLog(db, {
    customerId: evento.customerId,
    eventName: evento.meta_event,
    eventId,
    eventTime,
    userData: JSON.stringify(userData),
    customData: JSON.stringify(customData),
    payload: JSON.stringify(payload),
    resposta: JSON.stringify(resposta ?? {}),
    erro,
  });

  return erro ? { enviado: false, motivo: erro } : { enviado: true, event_id: eventId };
}

export type EventoContatoWhatsapp = {
  customerId: number;
  phone: string;
  /** Click-id do anúncio "Clique p/ WhatsApp". Sem ele não há evento. */
  ctwa_clid: string;
  ad_id: string | null;
  /** Entra no `event_id`, o que torna o disparo idempotente por mensagem. */
  wa_message_id: string;
};

/**
 * Evento `Contact` da primeira mensagem de uma conversa vinda de anúncio.
 *
 * É o mesmo evento que o workflow n8n da Cloud API dispara — mesmo
 * `event_name`, mesmo `action_source`, mesmo formato de `event_id` — só
 * que a partir da conexão por Evolution API, onde quem recebe a mensagem
 * é a rota de webhook deste app e não o n8n. Manter o formato igual é o
 * que permite um cliente trocar de conexão sem que a Meta veja dois
 * padrões de evento para o mesmo funil.
 *
 * `attribution_data` só vai quando o anúncio veio identificado: mandar
 * `attribution_share` sem `ad_id` faria a Meta atribuir a conversão a
 * nada.
 */
export async function enviaEventoContatoWhatsapp(
  clientDb: string,
  db: BancoCliente,
  evento: EventoContatoWhatsapp,
): Promise<ResultadoCapi> {
  const destino = await destinoWhatsapp(clientDb);
  if (!destino.ok) return { enviado: false, motivo: destino.motivo };

  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = `whatsapp_contact_${evento.wa_message_id}`;
  const userData = { ph: [hashTelefone(evento.phone)], ctwa_clid: evento.ctwa_clid };

  const dado: Record<string, unknown> = {
    event_name: 'Contact',
    event_time: eventTime,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    event_id: eventId,
    user_data: userData,
  };
  if (evento.ad_id) {
    dado.attribution_data = { ad_id: evento.ad_id, attribution_share: 1 };
  }

  const payload: Record<string, unknown> = { data: [dado] };
  if (destino.test_event_code) {
    payload.test_event_code = destino.test_event_code;
  }

  const url = new URL(
    `https://graph.facebook.com/${VERSAO_GRAPH_CAPI}/${destino.dataset_id}/events`,
  );
  url.searchParams.set('access_token', destino.access_token);

  let resposta: unknown;
  let erro: string | null = null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    resposta = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detalhe = (resposta as { error?: { message?: string } })?.error?.message;
      erro = detalhe || `HTTP ${r.status}`;
    }
  } catch (e) {
    resposta = {};
    erro = e instanceof Error ? e.message : 'falha de rede';
  }

  await gravaLog(db, {
    customerId: evento.customerId,
    eventName: 'Contact',
    eventId,
    eventTime,
    userData: JSON.stringify(userData),
    customData: JSON.stringify({}),
    payload: JSON.stringify(payload),
    resposta: JSON.stringify(resposta ?? {}),
    erro,
    actionSource: 'business_messaging',
    leadEventSource: 'WhatsApp Evolution',
  });

  return erro ? { enviado: false, motivo: erro } : { enviado: true, event_id: eventId };
}

/**
 * Registra a tentativa em `meta_capi_events`.
 *
 * Falha de log não vira falha do evento: o evento já foi entregue (ou
 * já falhou) na Meta, e derrubar a ação por causa da escrita do histórico
 * só faria o usuário reenviar algo que já saiu.
 */
async function gravaLog(
  db: BancoCliente,
  dados: {
    customerId: number;
    eventName: string;
    eventId: string;
    eventTime: number;
    userData: string;
    customData: string;
    payload: string;
    resposta: string;
    erro: string | null;
    /** Padrão: o disparo por mudança de estágio, que veio primeiro. */
    actionSource?: string;
    leadEventSource?: string;
  },
): Promise<void> {
  const status = dados.erro ? 'ERROR' : 'SENT';
  try {
    await db.execute(
      `INSERT INTO ${db.tabela('meta_capi_events')}
         (customer_id, event_name, event_id, event_time_unix, action_source,
          lead_event_source, user_data_hashed, custom_data, meta_payload_sent,
          meta_response, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE meta_response = ?, status = ?, error_message = ?`,
      [
        dados.customerId, dados.eventName, dados.eventId, dados.eventTime,
        dados.actionSource ?? 'system_generated',
        dados.leadEventSource ?? 'WhatsApp Conversas',
        dados.userData, dados.customData, dados.payload, dados.resposta, status, dados.erro,
        dados.resposta, status, dados.erro,
      ],
    );
  } catch (e) {
    console.error('[meta-capi] falha ao gravar log do evento:', e);
  }
}
