/**
 * Formatação de números e datas.
 *
 * Portado de `painel-admin.html` (fmtBRL/fmtInt/fmtPct/fmtDec/fmtDate/
 * fmtElapsed) para que os mesmos números apareçam com a mesma cara no app.
 *
 * Todas as funções são puras e determinísticas para um mesmo valor —
 * importante porque rodam tanto no servidor (render inicial) quanto no
 * cliente, e uma divergência entre os dois vira erro de hidratação. Por
 * isso o fuso é fixado em São Paulo em vez de usar o do navegador.
 */

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INTEIRO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function fmtBRL(valor: number | null | undefined): string {
  return BRL.format(Number(valor) || 0);
}

export function fmtInt(valor: number | null | undefined): string {
  return INTEIRO.format(Math.round(Number(valor) || 0));
}

export function fmtDec(valor: number | null | undefined, casas = 2): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(Number(valor) || 0);
}

export function fmtPct(valor: number | null | undefined, casas = 2): string {
  return `${fmtDec(valor, casas)}%`;
}

/** Valor ausente vira travessão, e não "0" — zero e "sem dado" são coisas diferentes. */
export function ouTraco(valor: string | null | undefined): string {
  const v = String(valor ?? '').trim();
  return v || '—';
}

/**
 * Converte o que o MySQL devolve (Date, string ou epoch) em ms UTC.
 * `null` quando não dá para interpretar.
 */
function paraMs(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor === 'number') return valor > 1e12 ? valor : valor * 1000;
  const ms = new Date(String(valor).replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** "10/05/2026 14:32" no horário de São Paulo. */
export function fmtDataHora(valor: unknown): string {
  const ms = paraMs(valor);
  if (ms === null) return '—';
  const d = new Date(ms - SP_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Hora curta de lista de conversas: "agora", "12 min", "14:32", "ontem",
 * "3 d", "10/05".
 *
 * A lista mostra dezenas de linhas e o que importa nelas é "quão recente",
 * não a data exata — esta fica no título e na bolha da mensagem. Abaixo
 * de uma hora vale sempre o contador em minutos; da hora em diante o
 * corte é o dia em São Paulo, não "24h atrás": às 08:00, uma mensagem das
 * 23:50 é "ontem", não "8 h" solto sem dia.
 *
 * `agora` entra por parâmetro para o teste não depender do relógio.
 */
export function fmtHoraRelativa(valor: unknown, agora: number = Date.now()): string {
  const ms = paraMs(valor);
  if (ms === null) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  const local = (t: number) => new Date(t - SP_OFFSET_MS);
  const diaDe = (t: number) => Math.floor((t - SP_OFFSET_MS) / 86_400_000);
  const hora = () => {
    const d = local(ms);
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  };

  const diff = agora - ms;
  // Relógio do servidor adiantado em relação ao do navegador acontece; o
  // futuro vira a hora do dia em vez de "-2 min".
  if (diff < 0) return hora();

  const minutos = Math.floor(diff / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `${minutos} min`;

  const dias = diaDe(agora) - diaDe(ms);
  if (dias <= 0) return hora();
  if (dias === 1) return 'ontem';
  if (dias < 7) return `${dias} d`;

  const d = local(ms);
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

/** "10/05/2026" no horário de São Paulo. */
export function fmtData(valor: unknown): string {
  const ms = paraMs(valor);
  if (ms === null) return '—';
  const d = new Date(ms - SP_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** "10/05" — usado nos rótulos do gráfico diário. */
export function fmtDiaMes(dataIso: string): string {
  const partes = String(dataIso).split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}` : dataIso;
}

/** Duração legível: "3 dias", "5 h", "12 min". Mesma escala do painel. */
export function fmtDuracao(ms: number | null | undefined): string {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 0) return '—';
  const min = Math.round(Math.max(0, v) / 60_000);
  if (min < 60) return `${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `${horas} h`;
  const dias = Math.round(horas / 24);
  return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

/** Tempo decorrido entre dois instantes, já formatado. */
export function fmtDecorrido(de: unknown, ate: unknown): string {
  const a = paraMs(de);
  const b = paraMs(ate);
  if (a === null || b === null) return '—';
  return fmtDuracao(b - a);
}

/**
 * ROAS e ROI da tabela de Campanhas.
 *
 * Nenhum dos dois é coluna do banco: são derivados de gasto e receita, e
 * calculá-los aqui evita repetir a mesma conta em SQL nos três níveis da
 * hierarquia. Sem gasto não há retorno sobre gasto — travessão, não zero.
 */
export function fmtRoas(gasto: unknown, receita: unknown): string {
  const g = Number(gasto);
  if (!Number.isFinite(g) || g === 0) return '—';
  return `${fmtDec((Number(receita) || 0) / g, 2)}x`;
}

export function fmtRoi(gasto: unknown, receita: unknown): string {
  const g = Number(gasto);
  if (!Number.isFinite(g) || g === 0) return '—';
  const roi = ((Number(receita) || 0) - g) / g;
  return `${roi >= 0 ? '+' : ''}${fmtDec(roi * 100, 1)}%`;
}

/**
 * Variação percentual contra o período anterior.
 *
 * `null` quando não há comparação possível: sem período anterior, ou base
 * zero (variação infinita não é informação, é ruído).
 */
export function variacao(atual: unknown, anterior: unknown): number | null {
  const a = Number(atual);
  const b = Number(anterior);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
}
