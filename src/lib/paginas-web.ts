import { createHash } from 'node:crypto';

/**
 * Rastreio de páginas de vendas — a parte pura.
 *
 * Tudo aqui é transformação de texto, sem banco e sem rede: o que chega
 * do navegador (evento, campos de formulário, parâmetros de URL) e o que
 * chega das plataformas de checkout (Hotmart, Kiwify, genérico) vira um
 * formato só, e o formato só vira o `user_data` que a Meta espera.
 *
 * Fica separado do resto porque é aqui que o rastreio erra calado. Um
 * e-mail com maiúscula gera outro hash, um valor em centavos vira uma
 * venda cem vezes maior, um `sck` de outra ferramenta vira um visitante
 * que não existe — e em nenhum desses casos a Meta devolve erro. Por
 * isso cada regra tem teste em `tests/paginas-web.test.ts`.
 */

/* ------------------------------------------------------------------ */
/* Vocabulário                                                         */
/* ------------------------------------------------------------------ */

/** Eventos que o script da página pode mandar. */
export const EVENTOS_PAGINA = [
  'PageView',
  'ViewContent',
  'Lead',
  'InitiateCheckout',
  'Purchase',
] as const;
export type EventoPagina = (typeof EVENTOS_PAGINA)[number];

export function ehEventoPagina(v: unknown): v is EventoPagina {
  return typeof v === 'string' && (EVENTOS_PAGINA as readonly string[]).includes(v);
}

/** Plataformas com adaptador de webhook de compra. */
export const PLATAFORMAS = ['generico', 'hotmart', 'kiwify'] as const;
export type Plataforma = (typeof PLATAFORMAS)[number];

export function ehPlataforma(v: unknown): v is Plataforma {
  return typeof v === 'string' && (PLATAFORMAS as readonly string[]).includes(v);
}

export const ROTULO_PLATAFORMA: Record<Plataforma, string> = {
  generico: 'Genérico (qualquer checkout)',
  hotmart: 'Hotmart',
  kiwify: 'Kiwify',
};

/**
 * Domínios de checkout reconhecidos sem configuração.
 *
 * Link para um destes ganha o id do visitante na URL e dispara
 * `InitiateCheckout` no clique. Qualquer outro checkout pode ser marcado
 * com `data-trk-checkout` no próprio link; o script também reconhece
 * hosts que começam com `checkout.`, `pay.` ou `pagamento.`.
 */
export const DOMINIOS_CHECKOUT = [
  'pay.hotmart.com',
  'hotmart.com',
  'pay.kiwify.com.br',
  'kiwify.com.br',
  'kiwify.app',
  'sun.eduzz.com',
  'chk.eduzz.com',
  'eduzz.com',
  'checkout.perfectpay.com.br',
  'go.perfectpay.com.br',
  'pay.monetizze.com.br',
  'checkout.ticto.app',
  'payment.ticto.app',
  'pay.cakto.com.br',
  'checkout.yampi.com.br',
  'seguro.pagar.me',
] as const;

/**
 * Formato do id de visitante gerado pelo script: 32 caracteres
 * hexadecimais (um UUID sem os traços).
 *
 * O formato fechado é o que permite achar o visitante no meio dos
 * parâmetros de rastreio de uma plataforma: `sck`, `src` e `xcod` são
 * campos livres, e o dono da página pode já usá-los para outra coisa
 * ("instagram", "bio"). Só o que tem exatamente esta forma é tratado
 * como visitante.
 */
const RX_VISITANTE = /^[a-f0-9]{32}$/;

export function ehIdVisitante(v: unknown): v is string {
  return typeof v === 'string' && RX_VISITANTE.test(v);
}

/**
 * `event_id` que vai para a Meta e para `paginas_eventos`.
 *
 * Todo evento de página começa com `site_`. O fluxo do Kommo no n8n grava
 * em `meta_capi_events` com `event_id` no formato `<evento>_<id do lead>`
 * — `purchase_12345` — e um pedido de número 12345 colidiria com ele na
 * mesma coluna UNIQUE. O prefixo separa os dois espaços de nomes.
 */
const RX_EVENT_ID = /^site_[A-Za-z0-9_.:-]{1,100}$/;

export function ehEventIdPagina(v: unknown): v is string {
  return typeof v === 'string' && RX_EVENT_ID.test(v);
}

/** Parte do número do pedido que pode entrar num `event_id`. */
export function limpaPedido(pedido: unknown): string {
  return String(pedido ?? '')
    .replace(/[^A-Za-z0-9_.:-]/g, '')
    .slice(0, 80);
}

/**
 * `event_id` da compra. O mesmo para o webhook da plataforma e para o
 * `trk('purchase')` da página de obrigado: é o que faz a Meta contar uma
 * venda só quando os dois chegam.
 */
export function eventIdDaCompra(pedido: unknown): string | null {
  const limpo = limpaPedido(pedido);
  return limpo ? `site_purchase_${limpo}` : null;
}

/* ------------------------------------------------------------------ */
/* Domínios                                                            */
/* ------------------------------------------------------------------ */

const RX_HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/;

/**
 * Lê a lista de domínios digitada no cadastro do site.
 *
 * Aceita vírgula, espaço ou quebra de linha entre eles, e aceita a URL
 * colada inteira — guarda só o host. O `www.` sai porque a regra de
 * `dominioPermitido` já cobre subdomínios: guardar `exemplo.com` libera
 * `www.exemplo.com`, o contrário não.
 */
export function normalizaDominios(texto: unknown): { dominios: string[]; invalidos: string[] } {
  const dominios: string[] = [];
  const invalidos: string[] = [];
  for (const bruto of String(texto ?? '').split(/[\s,;]+/)) {
    const t = bruto.trim().toLowerCase();
    if (!t) continue;
    const host = t
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/[/?#].*$/, '')
      .replace(/:\d+$/, '')
      .replace(/^www\./, '')
      .replace(/\.$/, '');
    if (RX_HOST.test(host)) {
      if (!dominios.includes(host)) dominios.push(host);
    } else {
      invalidos.push(bruto.trim());
    }
  }
  return { dominios, invalidos };
}

/** O host de uma URL, ou `null` se não for URL. */
export function hostDe(url: unknown): string | null {
  try {
    return new URL(String(url ?? '')).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Diz se o host pertence a um dos domínios cadastrados — ele mesmo ou
 * qualquer subdomínio. Lista vazia não libera nada: site sem domínio
 * cadastrado aceitaria evento de qualquer página da internet.
 */
export function dominioPermitido(host: string | null, dominios: readonly string[]): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/\.$/, '');
  return dominios.some((d) => h === d || h.endsWith(`.${d}`));
}

/* ------------------------------------------------------------------ */
/* Campos de formulário                                                */
/* ------------------------------------------------------------------ */

export type TipoCampo =
  | 'ignorar'
  | 'email'
  | 'telefone'
  | 'sobrenome'
  | 'primeiro_nome'
  | 'nome'
  | 'cidade'
  | 'estado'
  | 'cep';

/**
 * Regras para reconhecer um campo pelo nome, id, `autocomplete`,
 * `placeholder` ou rótulo — nesta ordem de prioridade entre as regras.
 *
 * Ficam como texto (fonte de regex) e não como `RegExp` porque são as
 * mesmas regras que o script da página usa: `paginas-script.ts` injeta
 * esta lista no JavaScript entregue ao navegador. Uma cópia só, testada
 * aqui, em vez de duas que divergem.
 *
 * `ignorar` vem primeiro: "nome da empresa" contém "nome", e CPF tem os
 * mesmos 11 dígitos de um celular com DDD.
 */
export const REGRAS_CAMPO: readonly (readonly [TipoCampo, string])[] = [
  [
    'ignorar',
    'empresa|company|organiza|cnpj|cpf|documento|senha|password|cupom|coupon|mensagem|message|assunto|subject|coment|observa|captcha|honeypot',
  ],
  ['email', 'e-?mail'],
  [
    'telefone',
    'phone|fone|telefone|whats|wpp|zap|celular|mobile|(^|[^a-z])(tel|cel|ddd)([^a-z]|$)',
  ],
  ['sobrenome', 'sobrenome|last.?name|surname|family.?name'],
  ['primeiro_nome', 'first.?name|primeiro.?nome|given.?name'],
  ['nome', 'nome|name'],
  ['cidade', 'cidade|city|municipio|address-level2'],
  ['estado', '(^|[^a-z])(uf|estado|state)([^a-z]|$)|address-level1'],
  ['cep', '(^|[^a-z])(cep|zip|postal)'],
];

const REGRAS_COMPILADAS = REGRAS_CAMPO.map(([tipo, fonte]) => [tipo, new RegExp(fonte, 'i')] as const);

const TIPOS_SEM_DADO = new Set(['hidden', 'password', 'checkbox', 'radio', 'submit', 'button', 'file', 'reset', 'image', 'range', 'color']);

/**
 * Classifica um campo de formulário. Espelho exato da função `classifica`
 * do script da página.
 */
export function classificaCampo(campo: {
  type?: string | null;
  name?: string | null;
  id?: string | null;
  autocomplete?: string | null;
  placeholder?: string | null;
  rotulo?: string | null;
}): TipoCampo | null {
  const tipo = String(campo.type ?? '').toLowerCase();
  if (tipo === 'email') return 'email';
  if (tipo === 'tel') return 'telefone';
  if (TIPOS_SEM_DADO.has(tipo)) return null;
  const texto = [campo.name, campo.id, campo.autocomplete, campo.placeholder, campo.rotulo]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!texto) return null;
  for (const [t, rx] of REGRAS_COMPILADAS) if (rx.test(texto)) return t;
  return null;
}

/* ------------------------------------------------------------------ */
/* Dados do visitante e do lead                                        */
/* ------------------------------------------------------------------ */

/** Corta e limpa um texto livre vindo de fora. Vazio vira `null`. */
export function texto(v: unknown, max = 255): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/** E-mail minimamente plausível, em minúsculas. */
export function normalizaEmail(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254 ? s : null;
}

/**
 * Parte "Maria da Silva" em primeiro nome e sobrenome. O resto do nome
 * inteiro vira sobrenome, que é o que a Meta compara em `ln`.
 */
export function separaNome(nome: unknown): { primeiro: string | null; resto: string | null } {
  const partes = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return { primeiro: null, resto: null };
  return { primeiro: partes[0], resto: partes.slice(1).join(' ') || null };
}

/**
 * Nome no formato de hash da Meta: minúsculo, sem pontuação, sem espaço
 * nas pontas. Acento fica — a Meta pede UTF-8, não ASCII.
 */
export function normalizaNomeParaHash(v: unknown): string | null {
  const s = String(v ?? '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\d]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s || null;
}

/** Cidade no formato da Meta: minúscula, sem espaço e sem pontuação. */
export function normalizaCidadeParaHash(v: unknown): string | null {
  const s = String(v ?? '')
    .toLowerCase()
    .replace(/[^\p{L}]/gu, '');
  return s || null;
}

/**
 * UF em duas letras minúsculas. Aceita a sigla ou o nome do estado, que
 * é o que muita página pede num `<select>`.
 */
const UF_POR_NOME: Record<string, string> = {
  acre: 'ac', alagoas: 'al', amapa: 'ap', amazonas: 'am', bahia: 'ba', ceara: 'ce',
  'distrito federal': 'df', 'espirito santo': 'es', goias: 'go', maranhao: 'ma',
  'mato grosso': 'mt', 'mato grosso do sul': 'ms', 'minas gerais': 'mg', para: 'pa',
  paraiba: 'pb', parana: 'pr', pernambuco: 'pe', piaui: 'pi', 'rio de janeiro': 'rj',
  'rio grande do norte': 'rn', 'rio grande do sul': 'rs', rondonia: 'ro', roraima: 'rr',
  'santa catarina': 'sc', 'sao paulo': 'sp', sergipe: 'se', tocantins: 'to',
};
const UFS = new Set(Object.values(UF_POR_NOME));

export function normalizaUf(v: unknown): string | null {
  const s = String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  if (UFS.has(s)) return s;
  return UF_POR_NOME[s] ?? null;
}

export function normalizaCep(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 5 && d.length <= 9 ? d : null;
}

/** DDD de um telefone já normalizado com 55 na frente. */
export function dddDoTelefone(telefone: string | null): number | null {
  if (!telefone) return null;
  const d = telefone.replace(/\D/g, '');
  const semPais = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (semPais.length < 10) return null;
  const ddd = Number(semPais.slice(0, 2));
  return ddd >= 11 && ddd <= 99 ? ddd : null;
}

/** `_fbc` montado a partir do `fbclid`, no formato do pixel. */
export function montaFbc(fbclid: string, agoraMs: number): string {
  return `fb.1.${agoraMs}.${fbclid}`;
}

export function ehFbc(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 500 && /^fb\.\d\.\d{10,}\..+$/.test(v);
}

export function ehFbp(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 120 && /^fb\.\d\.\d{10,}\.\d+$/.test(v);
}

/** Primeiro IP de `x-forwarded-for`, ou o `x-real-ip`. */
export function ipDaRequisicao(h: Headers): string | null {
  const encaminhado = h.get('x-forwarded-for');
  const ip = (encaminhado ? encaminhado.split(',')[0] : h.get('x-real-ip'))?.trim() ?? '';
  return ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}

/* ------------------------------------------------------------------ */
/* user_data da Meta                                                   */
/* ------------------------------------------------------------------ */

export type DadosUsuario = {
  email?: string | null;
  /** Já normalizado (só dígitos, com 55). */
  telefone?: string | null;
  primeiro_nome?: string | null;
  sobrenome?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  pais?: string | null;
  /** Id do visitante. Vai em hash, como a Meta recomenda. */
  external_id?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  ip?: string | null;
  user_agent?: string | null;
};

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

/**
 * Monta o `user_data`: dados pessoais em SHA-256 depois de normalizados,
 * identificadores de navegador (`fbc`, `fbp`, IP, user agent) em claro —
 * é assim que a Meta pede cada um. Campo vazio não vai, nem como hash de
 * texto vazio: um hash de "" casa com todo mundo que também não
 * informou, e a Meta trata isso como sinal ruim.
 */
export function montaUserData(d: DadosUsuario): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const h = (chave: string, valor: string | null | undefined) => {
    if (valor) out[chave] = [sha256(valor)];
  };
  h('em', normalizaEmail(d.email));
  h('ph', d.telefone ? d.telefone.replace(/\D/g, '') || null : null);
  h('fn', normalizaNomeParaHash(d.primeiro_nome));
  h('ln', normalizaNomeParaHash(d.sobrenome));
  h('ct', normalizaCidadeParaHash(d.cidade));
  h('st', normalizaUf(d.estado));
  h('zp', normalizaCep(d.cep));
  h('country', (d.pais ?? '').trim().toLowerCase().slice(0, 2) || null);
  h('external_id', d.external_id ?? null);
  if (d.fbc && ehFbc(d.fbc)) out.fbc = d.fbc;
  if (d.fbp && ehFbp(d.fbp)) out.fbp = d.fbp;
  if (d.ip) out.client_ip_address = d.ip;
  if (d.user_agent) out.client_user_agent = d.user_agent;
  return out;
}

/* ------------------------------------------------------------------ */
/* Webhooks de compra                                                  */
/* ------------------------------------------------------------------ */

export type SituacaoCompra = 'aprovada' | 'reembolsada' | 'outra';

export type CompraNormalizada = {
  situacao: SituacaoCompra;
  /** Nome do evento como a plataforma mandou, para o log. */
  evento: string | null;
  pedido: string;
  valor: number | null;
  moeda: string;
  email: string | null;
  telefone: string | null;
  nome: string | null;
  produto: string | null;
  /** Id do visitante achado nos parâmetros de rastreio, se houver. */
  visitante: string | null;
  utm: Partial<Record<'source' | 'medium' | 'campaign' | 'content' | 'term', string>>;
  ip: string | null;
};

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}

/**
 * Valor monetário vindo como número ou texto ("97,00", "1.297,90",
 * "97.00"). Texto com vírgula é lido no formato brasileiro.
 */
export function numeroMonetario(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function moeda(v: unknown): string {
  const s = String(v ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : 'BRL';
}

/** O primeiro candidato que tem forma de id de visitante. */
function achaVisitante(...candidatos: unknown[]): string | null {
  for (const c of candidatos) {
    const s = String(c ?? '').trim().toLowerCase();
    if (ehIdVisitante(s)) return s;
  }
  return null;
}

function utmDe(o: Obj): CompraNormalizada['utm'] {
  const utm: CompraNormalizada['utm'] = {};
  for (const k of ['source', 'medium', 'campaign', 'content', 'term'] as const) {
    const v = texto(o[`utm_${k}`]);
    if (v) utm[k] = v;
  }
  return utm;
}

function telefoneDe(...partes: unknown[]): string | null {
  const d = partes.map((p) => String(p ?? '').replace(/\D/g, '')).join('');
  if (d.length < 10) return null;
  return d.startsWith('55') ? d : `55${d}`;
}

/**
 * Hotmart, webhook versão 2.0.0.
 *
 * `PURCHASE_COMPLETE` chega depois do prazo de garantia, para a mesma
 * transação já aprovada; como o `event_id` é o da transação, a segunda
 * chegada é descartada como repetida em vez de contar a venda duas vezes.
 */
function leHotmart(corpo: Obj): CompraNormalizada | null {
  const d = obj(corpo.data);
  const compra = obj(d.purchase);
  const comprador = obj(d.buyer);
  const origem = obj(compra.origin);
  const preco = obj(compra.price);
  const pedido = texto(compra.transaction, 120);
  if (!pedido) return null;

  const evento = texto(corpo.event, 60);
  const status = String(compra.status ?? '').toUpperCase();
  let situacao: SituacaoCompra = 'outra';
  if (evento === 'PURCHASE_APPROVED' || evento === 'PURCHASE_COMPLETE' || (!evento && (status === 'APPROVED' || status === 'COMPLETE' || status === 'COMPLETED'))) {
    situacao = 'aprovada';
  } else if (
    evento === 'PURCHASE_REFUNDED' ||
    evento === 'PURCHASE_CHARGEBACK' ||
    evento === 'PURCHASE_PROTEST' ||
    status === 'REFUNDED' ||
    status === 'CHARGEBACK'
  ) {
    situacao = 'reembolsada';
  }

  return {
    situacao,
    evento,
    pedido,
    valor: numeroMonetario(preco.value ?? obj(compra.full_price).value),
    moeda: moeda(preco.currency_value ?? obj(compra.full_price).currency_value),
    email: normalizaEmail(comprador.email),
    telefone: telefoneDe(comprador.checkout_phone_code, comprador.checkout_phone) ?? telefoneDe(comprador.phone),
    nome: texto(comprador.name),
    produto: texto(obj(d.product).name),
    visitante: achaVisitante(origem.sck, origem.xcod, origem.src),
    utm: {},
    ip: null,
  };
}

/**
 * Kiwify. O valor vem em centavos (`charge_amount: "9700"` = R$ 97,00),
 * e o corpo às vezes chega embrulhado em `order`.
 */
function leKiwify(corpoBruto: Obj): CompraNormalizada | null {
  const corpo = corpoBruto.order_id ? corpoBruto : obj(corpoBruto.order);
  const pedido = texto(corpo.order_id, 120) ?? texto(corpo.order_ref, 120);
  if (!pedido) return null;

  const cliente = obj(corpo.Customer);
  const comissoes = obj(corpo.Commissions);
  const rastreio = obj(corpo.TrackingParameters);
  const status = String(corpo.order_status ?? '').toLowerCase();
  const evento = texto(corpo.webhook_event_type, 60);

  let situacao: SituacaoCompra = 'outra';
  if (status === 'paid' || status === 'approved' || evento === 'order_approved') situacao = 'aprovada';
  if (status === 'refunded' || status === 'chargedback' || evento === 'order_refunded' || evento === 'chargeback') {
    situacao = 'reembolsada';
  }

  const centavos = numeroMonetario(comissoes.charge_amount ?? comissoes.product_base_price);

  return {
    situacao,
    evento: evento ?? (status || null),
    pedido,
    valor: centavos === null ? null : Math.round(centavos) / 100,
    moeda: moeda(comissoes.currency ?? comissoes.product_base_price_currency),
    email: normalizaEmail(cliente.email),
    telefone: telefoneDe(cliente.mobile),
    nome: texto(cliente.full_name ?? cliente.first_name),
    produto: texto(obj(corpo.Product).product_name),
    visitante: achaVisitante(rastreio.sck, rastreio.src, rastreio.s1, rastreio.s2, rastreio.s3),
    utm: utmDe(rastreio),
    ip: texto(cliente.ip, 45),
  };
}

/**
 * Formato genérico, para checkout próprio ou plataforma sem adaptador
 * (via Zapier, Make, n8n). Aceita nomes em português e em inglês. Sem
 * `status`, a compra é tratada como aprovada: quem manda para cá é quem
 * decidiu que aquilo é uma venda.
 */
function leGenerico(corpo: Obj): CompraNormalizada | null {
  const pedido = texto(corpo.order_id ?? corpo.pedido ?? corpo.transaction ?? corpo.id, 120);
  if (!pedido) return null;

  const status = String(corpo.status ?? '').trim().toLowerCase();
  let situacao: SituacaoCompra = 'outra';
  if (!status || ['approved', 'paid', 'aprovado', 'aprovada', 'pago', 'paga', 'complete', 'completed'].includes(status)) {
    situacao = 'aprovada';
  } else if (['refunded', 'reembolsado', 'reembolsada', 'chargeback', 'estornado', 'estornada'].includes(status)) {
    situacao = 'reembolsada';
  }

  return {
    situacao,
    evento: status || null,
    pedido,
    valor: numeroMonetario(corpo.value ?? corpo.valor ?? corpo.amount),
    moeda: moeda(corpo.currency ?? corpo.moeda),
    email: normalizaEmail(corpo.email),
    telefone: telefoneDe(corpo.phone ?? corpo.telefone),
    nome: texto(corpo.name ?? corpo.nome),
    produto: texto(corpo.product ?? corpo.produto),
    visitante: achaVisitante(corpo.visitor_id, corpo.trk, corpo.sck, corpo.src),
    utm: utmDe(corpo),
    ip: texto(corpo.ip, 45),
  };
}

/** Traduz o corpo do webhook de compra da plataforma. `null` = formato desconhecido. */
export function leCompra(plataforma: Plataforma, corpo: unknown): CompraNormalizada | null {
  const o = obj(corpo);
  switch (plataforma) {
    case 'hotmart':
      return leHotmart(o);
    case 'kiwify':
      return leKiwify(o);
    case 'generico':
      return leGenerico(o);
  }
}

/* ------------------------------------------------------------------ */
/* Origem da visita e formulário da página                             */
/* ------------------------------------------------------------------ */

export type OrigemDaUrl = {
  utm: Partial<Record<'source' | 'medium' | 'campaign' | 'content' | 'term', string>>;
  fbclid: string | null;
  meta_ad_id: string | null;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
};

/** Id numérico da Meta. `{{ad.id}}` não substituído (pré-visualização) não passa. */
function idMeta(v: string | null): string | null {
  return v && /^\d{5,30}$/.test(v) ? v : null;
}

/**
 * A origem que a URL da página traz.
 *
 * O servidor lê isto da URL que o script manda, em vez de o script ler e
 * mandar pronto: a regra fica num lugar só, testada, e o script continua
 * pequeno. Os ids do anúncio vêm dos nomes que costumam receber os
 * parâmetros dinâmicos da Meta (`ad_id={{ad.id}}`, `adset_id=...`,
 * `campaign_id=...`); `utm_id` numérico vale como campanha, que é o que
 * o construtor de parâmetros do Gerenciador sugere.
 */
export function origemDaUrl(url: unknown): OrigemDaUrl {
  const vazia: OrigemDaUrl = { utm: {}, fbclid: null, meta_ad_id: null, meta_adset_id: null, meta_campaign_id: null };
  let p: URLSearchParams;
  try {
    p = new URL(String(url ?? '')).searchParams;
  } catch {
    return vazia;
  }
  const utm: OrigemDaUrl['utm'] = {};
  for (const k of ['source', 'medium', 'campaign', 'content', 'term'] as const) {
    const v = texto(p.get(`utm_${k}`));
    if (v) utm[k] = v;
  }
  const fbclid = p.get('fbclid');
  return {
    utm,
    fbclid: fbclid && /^[A-Za-z0-9_-]{10,500}$/.test(fbclid) ? fbclid : null,
    meta_ad_id: idMeta(p.get('ad_id') || p.get('fb_ad_id')),
    meta_adset_id: idMeta(p.get('adset_id') || p.get('fb_adset_id')),
    meta_campaign_id: idMeta(p.get('campaign_id') || p.get('fb_campaign_id')) ?? idMeta(p.get('utm_id')),
  };
}

/**
 * Parâmetros que não saem daqui: a página de obrigado de muita
 * plataforma devolve o comprador na URL (`?email=...&name=...`), e a
 * Meta restringe a conta de anúncio que manda dado pessoal em claro no
 * `event_source_url`.
 */
const RX_PARAM_PESSOAL = /mail|phone|fone|tel|whats|celular|nome|name|cpf|cnpj|document|doc|address|endereco|cep|zip|birth|nascimento/i;

/** URL sem fragmento e sem parâmetros com cara de dado pessoal. */
export function limpaUrl(url: unknown, max = 1000): string | null {
  let u: URL;
  try {
    u = new URL(String(url ?? ''));
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.username = '';
  u.password = '';
  for (const chave of [...u.searchParams.keys()]) {
    if (RX_PARAM_PESSOAL.test(chave)) u.searchParams.delete(chave);
  }
  return u.toString().slice(0, max);
}

/** Caminho da página (`/obrigado`), para agrupar na tela. */
export function caminhoDe(url: unknown): string | null {
  try {
    return new URL(String(url ?? '')).pathname.slice(0, 255) || '/';
  } catch {
    return null;
  }
}

export type ContatoFormulario = {
  /** Só dígitos, com 55. */
  telefone: string | null;
  email: string | null;
  nome: string | null;
  primeiro_nome: string | null;
  sobrenome: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
};

/**
 * O contato que o script tirou do formulário, já normalizado. `null`
 * quando não há nem e-mail nem telefone válido: sem um dos dois o lead
 * não tem como ser achado de novo, nem no CRM nem pela Meta.
 *
 * Telefone vale com 10 a 13 dígitos — DDD + número, com ou sem o 55.
 * Menos que isso é número sem DDD; mais é outra coisa (CPF com DDI,
 * dois números colados).
 */
export function contatoDoFormulario(dados: unknown): ContatoFormulario | null {
  const o = obj(dados);
  const email = normalizaEmail(o.email);
  const digitos = String(o.telefone ?? '').replace(/\D/g, '');
  const telefone =
    digitos.length >= 10 && digitos.length <= 13 ? (digitos.startsWith('55') && digitos.length >= 12 ? digitos : `55${digitos}`) : null;
  if (!email && !telefone) return null;

  const nome = texto(o.nome, 120);
  const partes = separaNome(nome);
  const primeiroInformado = texto(o.primeiro_nome, 80);
  const primeiro = primeiroInformado ?? partes.primeiro;
  const sobrenome = texto(o.sobrenome, 120) ?? (primeiroInformado ? null : partes.resto);

  return {
    telefone,
    email,
    nome: nome ?? ([primeiro, sobrenome].filter(Boolean).join(' ') || null),
    primeiro_nome: primeiro,
    sobrenome,
    cidade: texto(o.cidade, 100),
    estado: normalizaUf(o.estado),
    cep: normalizaCep(o.cep),
  };
}

/** `custom_data` de um evento de página, a partir do que o script mandou. */
export function dadosPersonalizados(cd: unknown): Record<string, unknown> {
  const o = obj(cd);
  const out: Record<string, unknown> = {};
  const valor = numeroMonetario(o.value ?? o.valor);
  if (valor !== null && valor >= 0) {
    out.value = Math.round(valor * 100) / 100;
    out.currency = moeda(o.currency ?? o.moeda);
  }
  const produto = texto(o.content_name ?? o.produto, 200);
  if (produto) out.content_name = produto;
  const pedido = limpaPedido(o.order_id ?? o.pedido);
  if (pedido) out.order_id = pedido;
  return out;
}
