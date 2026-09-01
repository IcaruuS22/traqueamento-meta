/**
 * Leitura do payload de webhook da Evolution API.
 *
 * Fica separado de `lib/db/evolution-ingestao.ts` (que é `server-only` e
 * fala com o banco) porque isto aqui é só transformação de dados: dá
 * para ler e conferir sem subir banco nenhum, e é a parte que mais muda
 * quando a Evolution troca de versão.
 *
 * O que chega é JSON de terceiro. Nada aqui confia em tipo: cada campo é
 * lido com checagem, e o que não bater vira `null` em vez de derrubar a
 * rota — um formato inesperado não pode fazer o webhook responder erro,
 * senão a Evolution reenvia a mesma notificação em laço.
 */

import { normalizaTelefone } from '@/lib/telefone';

/** Tipos que a tela de conversas já sabe rotular (`TIPO_MIDIA_LABEL`). */
const TIPOS_POR_CHAVE: Record<string, string> = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  audioMessage: 'audio',
  videoMessage: 'video',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
  locationMessage: 'location',
  contactMessage: 'contact',
  reactionMessage: 'reaction',
};

export type MensagemEvolution = {
  wa_message_id: string;
  /** Só dígitos, como já é gravado por `whatsapp_messages.phone`. */
  telefone: string;
  direcao: 'inbound' | 'outbound';
  tipo: string;
  texto: string | null;
  /** Nome do perfil no WhatsApp, usado quando o lead ainda não existe. */
  nome_perfil: string | null;
  timestamp_unix: number;
  /** Anúncio que originou a conversa, quando veio de "Clique p/ WhatsApp". */
  referral_ad_id: string | null;
  referral_ctwa_clid: string | null;
  /** Metadados do arquivo, quando a mensagem não é texto. */
  midia: MidiaMensagem | null;
};

export type MidiaMensagem = {
  mime: string | null;
  nome: string | null;
  /** Duração de áudio e vídeo, em segundos. */
  segundos: number | null;
  /** Tamanho anunciado pelo WhatsApp, em bytes. */
  tamanho: number | null;
  /**
   * Arquivo já embutido no webhook, quando a instância foi criada com
   * `webhookBase64: true` e a versão da Evolution manda o conteúdo. Nas
   * versões que não mandam, fica nulo e o arquivo é buscado depois em
   * `/chat/getBase64FromMediaMessage`.
   */
  base64: string | null;
};

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor : null;
}

/**
 * Extrai o texto legível de qualquer um dos formatos de mensagem.
 *
 * Mídia entra com a legenda quando tem uma; sem legenda o texto fica
 * nulo e a bolha mostra o rótulo do tipo, igual ao que já acontece com
 * as mensagens da Cloud API.
 */
function extraiTexto(message: Record<string, unknown> | null): string | null {
  if (!message) return null;

  const direto = texto(message.conversation);
  if (direto) return direto;

  const candidatos = [
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'documentMessage',
    'documentWithCaptionMessage',
    'buttonsResponseMessage',
    'listResponseMessage',
  ];
  for (const chave of candidatos) {
    const bloco = message[chave] as Record<string, unknown> | undefined;
    if (!bloco) continue;
    const valor =
      texto(bloco.text) ??
      texto(bloco.caption) ??
      texto(bloco.selectedDisplayText) ??
      texto((bloco.title as string | undefined) ?? undefined);
    if (valor) return valor;
  }
  return null;
}

function extraiTipo(message: Record<string, unknown> | null, messageType: unknown): string {
  if (message) {
    for (const chave of Object.keys(message)) {
      const tipo = TIPOS_POR_CHAVE[chave];
      if (tipo) return tipo;
    }
  }
  if (typeof messageType === 'string') return TIPOS_POR_CHAVE[messageType] ?? messageType;
  return 'text';
}

/**
 * Origem de anúncio "Clique para WhatsApp".
 *
 * É o equivalente, no Baileys, ao bloco `referral` que a Cloud API manda
 * no webhook — e é o que sustenta o evento `Contact` na CAPI. Sem estes
 * dois campos a Meta recebe uma conversa sem saber de qual anúncio ela
 * veio, e o anúncio fica sem a conversão que gerou.
 *
 * O bloco chega dentro do `contextInfo` da mensagem, e o `contextInfo`
 * mora em qualquer um dos tipos (texto, imagem, vídeo…), dependendo do
 * que a pessoa mandou primeiro. Por isso a busca varre os blocos em vez
 * de olhar só o `extendedTextMessage`.
 *
 * `ctwaClid` é campo próprio nas versões novas; nas antigas ele só existe
 * como parâmetro da `sourceUrl`. Ler os dois evita perder o clique em
 * servidores que ainda não atualizaram o Baileys.
 */
function extraiOrigemAnuncio(
  message: Record<string, unknown> | null,
  contextoSolto: unknown,
): { ad_id: string | null; ctwa_clid: string | null } {
  const contextos: unknown[] = [contextoSolto];
  if (message) {
    for (const bloco of Object.values(message)) {
      const c = (bloco as Record<string, unknown> | null)?.contextInfo;
      if (c) contextos.push(c);
    }
  }

  for (const contexto of contextos) {
    const externo = (contexto as { externalAdReply?: Record<string, unknown> } | null)
      ?.externalAdReply;
    if (!externo) continue;

    const adId = texto(externo.sourceId);
    let clid = texto(externo.ctwaClid) ?? texto(externo.ctwa_clid);

    if (!clid) {
      const url = texto(externo.sourceUrl);
      if (url) {
        try {
          clid = new URL(url).searchParams.get('ctwa_clid') || null;
        } catch {
          // URL malformada não é motivo para descartar o `ad_id`.
        }
      }
    }

    if (adId || clid) return { ad_id: adId, ctwa_clid: clid };
  }

  return { ad_id: null, ctwa_clid: null };
}

/** Blocos de mensagem que carregam arquivo. */
const BLOCOS_MIDIA = [
  'imageMessage',
  'audioMessage',
  'videoMessage',
  'documentMessage',
  'stickerMessage',
];

function numero(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * Metadados do arquivo de uma mensagem de mídia.
 *
 * `documentWithCaptionMessage` embrulha um `documentMessage` dentro de
 * outra mensagem — é o formato de documento com legenda. Sem desembrulhar,
 * o documento apareceria sem nome e sem mimetype.
 *
 * O base64 é lido de vários lugares porque cada versão da Evolution o
 * põe em um: na raiz do evento, ao lado da mensagem, ou dentro do bloco
 * do próprio tipo. Quando não vem em nenhum, quem chama busca o arquivo
 * pela API.
 */
function extraiMidia(
  message: Record<string, unknown> | null,
  base64Solto: unknown,
): MidiaMensagem | null {
  if (!message) return null;

  const embrulho = message.documentWithCaptionMessage as
    | { message?: Record<string, unknown> }
    | undefined;
  const alvo = embrulho?.message ?? message;

  for (const chave of BLOCOS_MIDIA) {
    const bloco = alvo[chave] as Record<string, unknown> | undefined;
    if (!bloco) continue;
    return {
      mime: texto(bloco.mimetype),
      nome: texto(bloco.fileName) ?? texto(bloco.title),
      segundos: numero(bloco.seconds),
      tamanho: numero(bloco.fileLength),
      base64: texto(bloco.base64) ?? texto(alvo.base64) ?? texto(message.base64) ?? texto(base64Solto),
    };
  }
  return null;
}

/**
 * Telefone como `whatsapp_messages.phone` já guarda: só dígitos, com o
 * 55 na frente — o mesmo tratamento que o fluxo do n8n aplica, via
 * `normalizaTelefone`.
 */
export function telefoneDoJid(jid: unknown): string | null {
  if (typeof jid !== 'string' || !jid) return null;
  // A Evolution manda `5511999999999@s.whatsapp.net`. Grupos vêm com
  // `@g.us` e status com `status@broadcast` — nenhum dos dois é conversa
  // de lead, e quem chama descarta pelo `null`.
  if (!jid.includes('@s.whatsapp.net')) return null;
  const digitos = normalizaTelefone(jid.split('@')[0]?.split(':')[0]);
  return digitos || null;
}

/**
 * Converte um evento `messages.upsert` em uma mensagem, ou `null` quando
 * o evento não é uma conversa individual (grupo, status, protocolo).
 *
 * `fromMe` é o que separa as duas direções — e é por ele que a mensagem
 * respondida pelo celular, fora do painel, também entra no histórico.
 */
export function leMensagemUpsert(data: unknown): MensagemEvolution | null {
  const d = data as {
    key?: { id?: unknown; remoteJid?: unknown; fromMe?: unknown };
    message?: Record<string, unknown> | null;
    messageType?: unknown;
    pushName?: unknown;
    messageTimestamp?: unknown;
    contextInfo?: unknown;
    base64?: unknown;
  } | null;
  if (!d?.key) return null;

  const id = texto(d.key.id);
  const telefone = telefoneDoJid(d.key.remoteJid);
  if (!id || !telefone) return null;

  const message = (d.message ?? null) as Record<string, unknown> | null;
  const tipo = extraiTipo(message, d.messageType);
  // Confirmação de leitura, edição e apagamento chegam como mensagem
  // mas não são conversa: entrariam na thread como bolhas vazias.
  if (tipo === 'protocolMessage' || tipo === 'reaction') return null;

  const carimbo = Number(d.messageTimestamp);
  const origem = extraiOrigemAnuncio(message, d.contextInfo);
  const midia = tipo === 'text' ? null : extraiMidia(message, d.base64);

  return {
    wa_message_id: id,
    telefone,
    direcao: d.key.fromMe === true ? 'outbound' : 'inbound',
    tipo,
    texto: extraiTexto(message),
    nome_perfil: texto(d.pushName),
    referral_ad_id: origem.ad_id,
    referral_ctwa_clid: origem.ctwa_clid,
    midia,
    timestamp_unix: Number.isFinite(carimbo) && carimbo > 0 ? Math.floor(carimbo) : Math.floor(Date.now() / 1000),
  };
}

/** Estado da conexão em um evento `connection.update`. */
export function leEstadoConexao(data: unknown): string | null {
  const d = data as { state?: unknown; connection?: unknown } | null;
  const estado = texto(d?.state) ?? texto(d?.connection);
  return estado;
}

/**
 * Número do aparelho conectado, quando o evento de conexão o traz.
 *
 * Nem toda versão da Evolution manda — por isso a tela de conexão também
 * o busca em `fetchInstances`. Aproveitar o que vem no webhook faz o
 * número chegar ao catálogo sem depender de alguém abrir a tela, e é
 * dele que sai o filtro que impede o próprio número de virar lead.
 */
export function leNumeroConexao(data: unknown): string | null {
  const d = data as { wuid?: unknown; ownerJid?: unknown; owner?: unknown } | null;
  const jid = texto(d?.wuid) ?? texto(d?.ownerJid) ?? texto(d?.owner);
  if (!jid) return null;
  const digitos = normalizaTelefone(jid.split('@')[0]?.split(':')[0]);
  return digitos || null;
}
