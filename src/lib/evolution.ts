import 'server-only';

/**
 * Cliente HTTP da Evolution API.
 *
 * A Evolution roda no servidor do próprio cliente, então a URL base e a
 * api key são configuração por conta (`whatsapp_accounts`), não variável
 * de ambiente: dois clientes podem estar em servidores diferentes.
 *
 * Este módulo é a única porta para a Evolution. Ele não lê banco nem
 * grava nada — quem chama já traz as credenciais e decide o que fazer
 * com o resultado. Isso mantém a api key confinada a um caminho curto:
 * `lib/db/whatsapp.ts` lê, a ação passa direto para cá, e daqui ela vai
 * só para o header `apikey`.
 *
 * Versão alvo: Evolution API v2. Onde o formato de v1 e v2 divergem em
 * algo que não dá para detectar antes (o corpo do sendText, o formato do
 * `hash` do /instance/create), o código aceita as duas formas em vez de
 * exigir uma versão específica do servidor de quem usa.
 */

const TIMEOUT_MS = 20_000;

export type CredenciaisEvolution = {
  base_url: string;
  api_key: string;
  instancia: string;
};

export class ErroEvolution extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ErroEvolution';
  }
}

/**
 * Normaliza a URL base digitada no formulário.
 *
 * Recusa qualquer coisa que não seja http/https: sem isso, um `file://`
 * ou um esquema exótico salvo por engano viraria uma requisição estranha
 * partindo do servidor do app.
 */
export function normalizaBaseUrl(bruta: string): string {
  const texto = bruta.trim().replace(/\/+$/, '');
  if (!texto) throw new ErroEvolution('URL da Evolution API não informada.');
  const comEsquema = /^https?:\/\//i.test(texto) ? texto : `https://${texto}`;
  let url: URL;
  try {
    url = new URL(comEsquema);
  } catch {
    throw new ErroEvolution('URL da Evolution API inválida.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ErroEvolution('A URL da Evolution API precisa começar com http:// ou https://.');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Nome da instância a partir do nome do banco do cliente.
 *
 * A Evolution usa o nome como identificador na URL e no payload do
 * webhook, então ele fica restrito ao mesmo alfabeto já garantido por
 * `sanitizaNomeBanco`. Derivar em vez de deixar digitar evita dois
 * clientes escolherem o mesmo nome no mesmo servidor.
 */
export function nomeInstancia(clientDb: string): string {
  return clientDb.replace(/[^A-Za-z0-9_]/g, '').slice(0, 100);
}

type Metodo = 'GET' | 'POST' | 'DELETE';

async function chama<T>(
  cred: Pick<CredenciaisEvolution, 'base_url' | 'api_key'>,
  metodo: Metodo,
  caminho: string,
  corpo?: unknown,
): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${cred.base_url}${caminho}`, {
      method: metodo,
      headers: {
        apikey: cred.api_key,
        'content-type': 'application/json',
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (erro) {
    // O motivo real fica no log do servidor; para a tela vai um texto
    // que não expõe o endereço interno do servidor do cliente.
    console.error('[evolution] falha de rede:', metodo, caminho, erro);
    const detalhe = erro instanceof Error ? erro.message : 'falha de rede';
    throw new ErroEvolution(`Não foi possível falar com a Evolution API: ${detalhe}`);
  }

  const bruto = await resposta.text();
  let dados: unknown = null;
  if (bruto) {
    try {
      dados = JSON.parse(bruto);
    } catch {
      dados = null;
    }
  }

  if (!resposta.ok) {
    const d = dados as {
      message?: unknown;
      error?: unknown;
      response?: { message?: unknown };
    } | null;
    const mensagem =
      textoDeErro(d?.response?.message) ??
      textoDeErro(d?.message) ??
      textoDeErro(d?.error) ??
      `HTTP ${resposta.status}`;
    throw new ErroEvolution(mensagem, resposta.status);
  }

  return dados as T;
}

/** A Evolution devolve `message` ora como texto, ora como lista de textos. */
function textoDeErro(valor: unknown): string | null {
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (Array.isArray(valor)) {
    const partes = valor.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
    if (partes.length) return partes.join('; ');
  }
  return null;
}

/**
 * Eventos que o painel precisa receber.
 *
 * Pedir só estes evita que o webhook seja acordado por presença,
 * contatos e chamadas — volume alto e sem uso nenhum aqui.
 */
export const EVENTOS_WEBHOOK = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'];

export type QrCode = {
  /** Imagem `data:image/png;base64,...` pronta para o `<img src>`. */
  base64: string | null;
  /** Texto do QR, para quem preferir gerar a imagem por fora. */
  code: string | null;
  /** Código de pareamento por número, alternativa ao QR em alguns aparelhos. */
  pairingCode: string | null;
};

function extraiQr(dados: unknown): QrCode {
  const d = dados as {
    base64?: string;
    code?: string;
    pairingCode?: string;
    qrcode?: { base64?: string; code?: string; pairingCode?: string };
  } | null;
  const q = d?.qrcode ?? d ?? {};
  const base64 = typeof q.base64 === 'string' && q.base64 ? q.base64 : null;
  return {
    // A v2 já devolve com o prefixo `data:`; a v1 devolve o base64 cru.
    base64: base64 && !base64.startsWith('data:') ? `data:image/png;base64,${base64}` : base64,
    code: typeof q.code === 'string' && q.code ? q.code : null,
    pairingCode: typeof q.pairingCode === 'string' && q.pairingCode ? q.pairingCode : null,
  };
}

/**
 * Cria a instância e já deixa o webhook apontado para o painel.
 *
 * Devolve o QR Code que veio junto com a criação (a Evolution monta o
 * primeiro QR na hora) e o `hash` — a chave própria da instância, que na
 * v2 é o que autentica as chamadas seguintes. Quando o servidor não
 * devolve `hash`, a chave global continua valendo e é ela que fica
 * gravada.
 */
export async function criaInstancia(
  cred: CredenciaisEvolution,
  webhookUrl: string,
): Promise<{ qr: QrCode; hash: string | null }> {
  const dados = await chama<{
    hash?: string | { apikey?: string };
    qrcode?: unknown;
  }>(cred, 'POST', '/instance/create', {
    instanceName: cred.instancia,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    webhook: {
      enabled: true,
      url: webhookUrl,
      // `byEvents: false` mantém tudo numa URL só. Com `true`, a
      // Evolution acrescenta o nome do evento ao caminho e cada evento
      // vira uma rota diferente no app.
      byEvents: false,
      base64: true,
      events: EVENTOS_WEBHOOK,
    },
  });

  const hash =
    typeof dados?.hash === 'string'
      ? dados.hash
      : typeof dados?.hash === 'object' && typeof dados.hash?.apikey === 'string'
        ? dados.hash.apikey
        : null;

  return { qr: extraiQr(dados?.qrcode), hash };
}

/**
 * (Re)aponta o webhook de uma instância que já existe.
 *
 * Necessário porque a instância pode ter sido criada antes, direto no
 * servidor, ou o endereço do painel pode ter mudado.
 */
export async function defineWebhook(cred: CredenciaisEvolution, webhookUrl: string): Promise<void> {
  await chama(cred, 'POST', `/webhook/set/${encodeURIComponent(cred.instancia)}`, {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: false,
      base64: true,
      events: EVENTOS_WEBHOOK,
    },
  });
}

/**
 * Pede um QR novo.
 *
 * Usado quando o anterior expirou (a Evolution troca o QR a cada ~40
 * segundos) ou quando a instância caiu e precisa ser pareada de novo.
 */
export async function conectaInstancia(cred: CredenciaisEvolution): Promise<QrCode> {
  const dados = await chama<unknown>(
    cred,
    'GET',
    `/instance/connect/${encodeURIComponent(cred.instancia)}`,
  );
  return extraiQr(dados);
}

export type EstadoInstancia = 'open' | 'close' | 'connecting' | 'desconhecido';

/** Estado da conexão com o aparelho. `open` = pareado e funcionando. */
export async function estadoInstancia(cred: CredenciaisEvolution): Promise<EstadoInstancia> {
  const dados = await chama<{ instance?: { state?: string }; state?: string }>(
    cred,
    'GET',
    `/instance/connectionState/${encodeURIComponent(cred.instancia)}`,
  );
  const estado = dados?.instance?.state ?? dados?.state;
  if (estado === 'open' || estado === 'close' || estado === 'connecting') return estado;
  return 'desconhecido';
}

/** Descobre o número que atendeu o QR, só para exibir na tela. */
export async function numeroConectado(cred: CredenciaisEvolution): Promise<string | null> {
  try {
    const dados = await chama<unknown>(
      cred,
      'GET',
      `/instance/fetchInstances?instanceName=${encodeURIComponent(cred.instancia)}`,
    );
    const lista = Array.isArray(dados) ? dados : [dados];
    for (const item of lista) {
      const i = item as { instance?: { owner?: string }; ownerJid?: string; owner?: string } | null;
      const jid = i?.instance?.owner ?? i?.ownerJid ?? i?.owner;
      if (typeof jid === 'string' && jid) return jid.split('@')[0] ?? null;
    }
  } catch (erro) {
    // Informação decorativa: se não vier, a tela mostra a conexão sem o
    // número em vez de falhar a operação inteira.
    console.error('[evolution] não foi possível ler o número conectado:', erro);
  }
  return null;
}

/**
 * Desconecta o aparelho sem apagar a instância — a configuração e o
 * histórico continuam lá, e reconectar é só ler um QR novo.
 */
export async function desconectaInstancia(cred: CredenciaisEvolution): Promise<void> {
  await chama(cred, 'DELETE', `/instance/logout/${encodeURIComponent(cred.instancia)}`);
}

/** Apaga a instância no servidor da Evolution. */
export async function apagaInstancia(cred: CredenciaisEvolution): Promise<void> {
  await chama(cred, 'DELETE', `/instance/delete/${encodeURIComponent(cred.instancia)}`);
}

/**
 * Envia texto e devolve o id da mensagem na Evolution.
 *
 * O corpo muda entre as versões: a v2 aceita `{number, text}` na raiz, a
 * v1 exige `{number, textMessage: {text}}`. Mandar os dois campos atende
 * as duas — cada versão lê o que conhece e ignora o resto.
 */
export async function enviaTexto(
  cred: CredenciaisEvolution,
  destino: string,
  texto: string,
): Promise<string> {
  const dados = await chama<{ key?: { id?: string }; id?: string }>(
    cred,
    'POST',
    `/message/sendText/${encodeURIComponent(cred.instancia)}`,
    {
      number: destino,
      text: texto,
      textMessage: { text: texto },
    },
  );
  return dados?.key?.id ?? dados?.id ?? `evo-${Date.now()}`;
}

export type MidiaEvolution = {
  bytes: Buffer;
  mime: string | null;
  nome: string | null;
};

/**
 * Baixa o arquivo de uma mensagem de mídia.
 *
 * O webhook não traz o arquivo: traz a chave da mensagem e os metadados
 * (mimetype, nome, duração). Quem guarda o binário é o servidor da
 * Evolution, que o descriptografa sob demanda neste endpoint — por isso
 * a busca acontece logo depois de gravar a mensagem, e não quando
 * alguém abre a conversa: a mídia expira no WhatsApp depois de alguns
 * dias, e uma conversa aberta semanas depois já não conseguiria baixar.
 *
 * `convertToMp4: false` mantém o áudio como veio (ogg/opus, que todo
 * navegador atual toca). Converter exigiria ffmpeg no servidor do
 * cliente e é onde a chamada costuma falhar em instalações enxutas.
 */
export async function baixaMidia(
  cred: CredenciaisEvolution,
  waMessageId: string,
): Promise<MidiaEvolution | null> {
  const dados = await chama<{
    base64?: unknown;
    mimetype?: unknown;
    fileName?: unknown;
  }>(cred, 'POST', `/chat/getBase64FromMediaMessage/${encodeURIComponent(cred.instancia)}`, {
    message: { key: { id: waMessageId } },
    convertToMp4: false,
  });

  const base64 = typeof dados?.base64 === 'string' ? dados.base64 : '';
  if (!base64) return null;

  return {
    bytes: Buffer.from(base64, 'base64'),
    mime: typeof dados?.mimetype === 'string' ? dados.mimetype : null,
    nome: typeof dados?.fileName === 'string' ? dados.fileName : null,
  };
}
