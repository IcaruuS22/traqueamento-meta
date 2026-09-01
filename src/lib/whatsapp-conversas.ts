/**
 * Tipos e constantes da tela "Conversas" usados dos dois lados.
 *
 * Fica fora de `lib/db/conversas.ts` porque aquele módulo é `server-only`
 * e a tela de conversas é um componente de cliente — mesmo motivo de
 * `lib/meta-eventos.ts` e `lib/metricas-catalogo.ts`.
 */

/** Janela da Meta para responder livremente, em segundos. */
export const JANELA_24H_SEGUNDOS = 24 * 60 * 60;

/**
 * Mensagens que não são texto.
 *
 * Com a Evolution o arquivo é baixado no webhook e guardado em
 * `whatsapp_media`, então a bolha desenha a imagem, o áudio ou o vídeo.
 * O rótulo daqui continua servindo para a prévia da lista e para quando
 * os bytes não estão disponíveis (`media_status` diferente de `'ok'`:
 * conversa vinda da Cloud API, mensagem anterior à captura, arquivo
 * grande demais ou download que falhou).
 */
export const TIPO_MIDIA_LABEL: Record<string, string> = {
  image: 'Imagem recebida',
  audio: 'Áudio recebido',
  video: 'Vídeo recebido',
  document: 'Documento recebido',
  sticker: 'Figurinha recebida',
  location: 'Localização recebida',
};

/**
 * Estágios que fecham o funil.
 *
 * A lista de estágios é do cliente (`whatsapp_event_map`), então a tela
 * não pode ter os sete nomes iniciais escritos no código. Só estes dois
 * são fixos: são eles que definem em qual das três faixas da lista a
 * conversa cai. Estágio renomeado no cadastro deixa de contar como
 * fechamento e volta para "Em aberto" — é o comportamento certo, porque
 * quem decide o que é ganho é o cadastro do cliente.
 */
export const ESTAGIO_GANHO = 'ganho';
export const ESTAGIO_PERDIDO = 'perdido';

/**
 * Estágio pronto para comparar com as constantes acima.
 *
 * O nome do estágio é digitado pelo cliente em "Configuração de Eventos"
 * e também é escrito pela classificação por IA, que capitaliza ("Ganho",
 * "Perdido"). O MySQL compara sem diferenciar maiúscula, então o filtro
 * da listagem sempre acertou; o JavaScript não, e a conversa fechada
 * caía em "Em aberto" e nunca pedia motivo de perda. Comparar
 * normalizado é o que faz os dois lados concordarem.
 */
export function normalizaEstagio(estagio: string | null | undefined): string {
  return (estagio ?? '').trim().toLowerCase();
}

/** Faixa da lista de conversas. Substitui o filtro por estágio solto. */
export type FaixaConversa = 'aberto' | 'ganho' | 'perdido';

export const FAIXAS: { valor: FaixaConversa; rotulo: string }[] = [
  { valor: 'aberto', rotulo: 'Em aberto' },
  { valor: 'ganho', rotulo: 'Ganho' },
  { valor: 'perdido', rotulo: 'Perdido' },
];

export const FAIXA_PADRAO: FaixaConversa = 'aberto';

export function ehFaixa(valor: unknown): valor is FaixaConversa {
  return valor === 'aberto' || valor === 'ganho' || valor === 'perdido';
}

/** Em qual faixa um estágio cai. Tudo que não fecha está em aberto. */
export function faixaDoEstagio(estagio: string | null | undefined): FaixaConversa {
  const valor = normalizaEstagio(estagio);
  if (valor === ESTAGIO_GANHO) return 'ganho';
  if (valor === ESTAGIO_PERDIDO) return 'perdido';
  return 'aberto';
}

/**
 * Estágio como texto de tela: `em_atendimento` vira "Em atendimento".
 *
 * Os valores são gravados em minúsculas com underscore porque é assim que
 * o n8n e a classificação por IA os comparam; trocar o valor no banco
 * quebraria os dois. O que muda é só a apresentação.
 */
export function rotuloEstagio(estagio: string | null | undefined): string {
  const bruto = (estagio ?? '').trim();
  if (!bruto) return '—';
  const texto = bruto.replace(/_/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export type Conversa = {
  customer_id: number;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string;
  unread_count: number;
  last_message_at: string | null;
  ultima_mensagem: string | null;
  ultima_mensagem_tipo: string | null;
  ultima_mensagem_direcao: string | null;
};

export type MensagemWhatsapp = {
  id: number;
  created_at: string;
  direction: string;
  message_type: string | null;
  message_text: string | null;
  /**
   * Descrição do arquivo, quando a mensagem tem um. Vem `undefined` em
   * banco de cliente que ainda não passou por
   * `WhatsApp/migracao_whatsapp_midia.sql` — a leitura cai na consulta
   * antiga e a bolha volta a ser só o rótulo do tipo.
   */
  media_mime?: string | null;
  media_filename?: string | null;
  media_size?: number | null;
  media_seconds?: number | null;
  /** 'ok' | 'pendente' | 'grande' | 'falha' | null — ver a migração. */
  media_status?: string | null;
};

/** Se os bytes desta mensagem podem ser pedidos à rota de mídia. */
export function temMidia(msg: MensagemWhatsapp): boolean {
  return msg.media_status === 'ok';
}

/**
 * Como a bolha deve desenhar o arquivo.
 *
 * Decide pelo MIME, não pelo `message_type`: um áudio gravado no
 * WhatsApp chega como `audio/ogg; codecs=opus`, e um documento pode ser
 * um PDF ou uma imagem enviada como arquivo. O tipo da mensagem só
 * entra como desempate quando o MIME não veio.
 */
export function formatoMidia(msg: MensagemWhatsapp): 'imagem' | 'audio' | 'video' | 'arquivo' {
  const mime = (msg.media_mime ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'imagem';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime) return 'arquivo';
  if (msg.message_type === 'image' || msg.message_type === 'sticker') return 'imagem';
  if (msg.message_type === 'audio') return 'audio';
  if (msg.message_type === 'video') return 'video';
  return 'arquivo';
}

/** Nome que aparece no link de download. */
export function nomeArquivo(msg: MensagemWhatsapp): string {
  const nome = (msg.media_filename ?? '').trim();
  if (nome) return nome;
  return TIPO_MIDIA_LABEL[msg.message_type ?? ''] ?? 'Arquivo';
}

/** Tamanho em texto curto para o link de download. */
export function tamanhoLegivel(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Por que o arquivo não está na tela, quando não está.
 *
 * `pendente` só aparece na janela entre gravar a mensagem e terminar o
 * download; a atualização automática da thread resolve sozinha.
 */
export function avisoMidia(status: string | null | undefined): string | null {
  if (status === 'pendente') return 'Baixando arquivo…';
  if (status === 'grande') return 'Arquivo grande demais para guardar';
  if (status === 'falha') return 'Arquivo indisponível';
  return null;
}

export type LeadConversa = {
  customer_id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  notes: string | null;
  tags: string | null;
  /** Só existe em banco que já rodou a migração de motivo de perda. */
  motivo_perda: string | null;
  /**
   * Segundos decorridos desde a última mensagem recebida do lead,
   * calculados pelo MySQL (`TIMESTAMPDIFF(... , NOW())`). `null` quando
   * o lead nunca escreveu.
   *
   * A janela de 24h é derivada daqui, e não de comparar `last_inbound_at`
   * com o relógio do navegador: o banco devolve TIMESTAMP sem fuso, e
   * interpretá-lo no fuso de quem estiver olhando erra a conta em horas.
   * Com a diferença já calculada no servidor, não há fuso envolvido.
   */
  segundos_desde_inbound: number | null;
  referral_ctwa_clid: string | null;
  referral_ad_id: string | null;
  ai_last_analyzed_at: string | null;
  ai_last_classification: string | null;
  ai_last_reason: string | null;
  /**
   * Valor que a IA achou nas mensagens ("paguei 19,90"), quando achou.
   * Só existe em banco que já rodou `migracao_whatsapp_ia_valor.sql`.
   */
  ai_last_value: string | number | null;
};

export type Thread = {
  lead: LeadConversa | null;
  mensagens: MensagemWhatsapp[];
};

/** Nome do lead como aparece na lista e no cabeçalho da conversa. */
export function nomeExibicao(
  primeiro: string | null | undefined,
  ultimo: string | null | undefined,
  telefone: string | null | undefined,
): string {
  const nome = `${primeiro ?? ''} ${ultimo ?? ''}`.trim();
  return nome || telefone || 'Sem nome';
}

/** Até duas iniciais para o círculo do avatar. */
export function iniciais(nome: string): string {
  const letras = nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('');
  return (letras || '?').toUpperCase();
}

/** Texto de uma mensagem na bolha e na prévia da lista. */
export function textoDaMensagem(
  tipo: string | null | undefined,
  texto: string | null | undefined,
): string {
  if (tipo && tipo !== 'text') return `📎 ${TIPO_MIDIA_LABEL[tipo] ?? tipo}`;
  return texto ?? '';
}

/**
 * Texto da bolha quando o arquivo já está desenhado acima dela.
 *
 * Aí o rótulo "📎 Imagem recebida" viraria repetição do que está na
 * tela; o que sobra é a legenda, quando o lead mandou uma. A prévia da
 * lista continua usando `textoDaMensagem`, porque lá não há arquivo
 * nenhum para olhar.
 */
export function textoDaBolha(msg: MensagemWhatsapp): string {
  if (temMidia(msg) || avisoMidia(msg.media_status)) return msg.message_text ?? '';
  return textoDaMensagem(msg.message_type, msg.message_text);
}

/**
 * Momento (em milissegundos do relógio local) em que a janela de 24h
 * fecha, a partir da diferença medida pelo servidor no instante da
 * resposta. Devolve `null` quando o lead nunca escreveu.
 */
export function fimDaJanela(
  segundosDesdeInbound: number | null | undefined,
  recebidoEm: number,
): number | null {
  if (segundosDesdeInbound === null || segundosDesdeInbound === undefined) return null;
  return recebidoEm + (JANELA_24H_SEGUNDOS - segundosDesdeInbound) * 1000;
}
