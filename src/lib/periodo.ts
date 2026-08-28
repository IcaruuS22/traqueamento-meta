/**
 * Cálculo das faixas de data do seletor de período.
 *
 * Portado literalmente do Code node "Monta Filtro Data Metricas" de
 * `build_admin_panel_workflow.js`. É a lógica mais copiada do sistema
 * (aparece em 6 endpoints diferentes) e a mais fácil de errar, então
 * aqui ela existe UMA vez, com teste.
 *
 * Por que não usar CURDATE()/NOW() do MySQL: essas funções usam o fuso da
 * SESSÃO da conexão, que nos hosts gerenciados costuma ser UTC. Isso
 * deslocava a fronteira do dia em 3h e fazia leads de ~21h–23h59 (horário
 * local) caírem no dia errado, divergindo das contagens do CRM e da Meta.
 *
 * A solução: calcular os limites em epoch UTC a partir do horário de São
 * Paulo (fixo em UTC-3, sem horário de verão desde 2019) e comparar via
 * `UNIX_TIMESTAMP(coluna)`, que devolve o epoch UTC verdadeiro
 * independente do fuso da sessão — sem depender de CONVERT_TZ nem de
 * tabelas de fuso carregadas no MySQL.
 *
 * Este módulo não importa nada do servidor de propósito: é lógica pura,
 * testável e utilizável também no cliente.
 */

export const RANGES = ['hoje', 'ontem', '7d', '30d', 'ano', 'max', 'custom'] as const;
export type Range = (typeof RANGES)[number];

export const CANAIS = ['form', 'whatsapp', 'geral'] as const;
export type Canal = (typeof CANAIS)[number];

const SP_OFFSET_MS = 3 * 60 * 60 * 1000; // São Paulo = UTC-3
const DAY_MS = 86_400_000;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export type EntradaPeriodo = {
  range?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  channel?: string | null;
};

export type Periodo = {
  range: Range;
  canal: Canal;
  customFrom: string | null;
  customTo: string | null;
  /** Início da janela atual em epoch (segundos). `null` em `max`. */
  inicioSec: number | null;
  /** Fim exclusivo da janela atual em epoch (segundos). `null` em `max`. */
  fimSec: number | null;
  /** Início da janela anterior. `null` quando não há período comparável. */
  anteriorInicioSec: number | null;
  /** Fim exclusivo da janela anterior. */
  anteriorFimSec: number | null;
};

/**
 * Normaliza e valida a entrada do seletor de período.
 *
 * `range` fora da lista cai no padrão. `custom` sem as duas datas válidas
 * também cai no padrão — em vez de gerar uma query sem filtro nenhum,
 * que é o modo silencioso de retornar dados errados. Datas invertidas
 * são trocadas de lugar.
 */
export function resolvePeriodo(
  entrada: EntradaPeriodo,
  rangePadrao: Range = '7d',
): Periodo {
  let range = String(entrada.range ?? rangePadrao).toLowerCase() as Range;
  if (!RANGES.includes(range)) range = rangePadrao;

  let customFrom = RE_DATA.test(String(entrada.date_from ?? ''))
    ? String(entrada.date_from)
    : null;
  let customTo = RE_DATA.test(String(entrada.date_to ?? '')) ? String(entrada.date_to) : null;

  if (range === 'custom' && customFrom && customTo && customFrom > customTo) {
    [customFrom, customTo] = [customTo, customFrom];
  }
  if (range === 'custom' && (!customFrom || !customTo)) range = rangePadrao;

  let canal = String(entrada.channel ?? 'geral').toLowerCase() as Canal;
  if (!CANAIS.includes(canal)) canal = 'geral';

  const agoraUtcMs = Date.now();
  const spWallMs = agoraUtcMs - SP_OFFSET_MS;
  const spInicioHojeWallMs = Math.floor(spWallMs / DAY_MS) * DAY_MS;

  const limitesDia = (diasAtras: number) => {
    const inicioUtcMs = spInicioHojeWallMs + SP_OFFSET_MS - diasAtras * DAY_MS;
    return {
      start: Math.floor(inicioUtcMs / 1000),
      end: Math.floor((inicioUtcMs + DAY_MS) / 1000),
    };
  };

  let inicioSec: number | null = null;
  let fimSec: number | null = null;

  switch (range) {
    case 'hoje': {
      const b = limitesDia(0);
      inicioSec = b.start;
      fimSec = b.end;
      break;
    }
    case 'ontem': {
      const b = limitesDia(1);
      inicioSec = b.start;
      fimSec = b.end;
      break;
    }
    case '7d':
      inicioSec = limitesDia(6).start;
      fimSec = Math.floor(agoraUtcMs / 1000);
      break;
    case '30d':
      inicioSec = limitesDia(29).start;
      fimSec = Math.floor(agoraUtcMs / 1000);
      break;
    case 'ano': {
      const ano = new Date(spWallMs).getUTCFullYear();
      inicioSec = Math.floor((Date.UTC(ano, 0, 1) + SP_OFFSET_MS) / 1000);
      fimSec = Math.floor(agoraUtcMs / 1000);
      break;
    }
    case 'custom':
      inicioSec = dataParaEpochSec(customFrom!);
      fimSec = dataParaEpochSec(customTo!) + 86_400;
      break;
    case 'max':
      // Sem limite inferior: não há período anterior computável.
      break;
  }

  // O período anterior é a MESMA janela deslocada para trás pela sua
  // própria duração. Isso funciona igual para todos os ranges, sem caso
  // especial por nome.
  let anteriorInicioSec: number | null = null;
  let anteriorFimSec: number | null = null;
  if (inicioSec !== null && fimSec !== null) {
    anteriorFimSec = inicioSec;
    anteriorInicioSec = inicioSec - (fimSec - inicioSec);
  }

  return {
    range,
    canal,
    customFrom,
    customTo,
    inicioSec,
    fimSec,
    anteriorInicioSec,
    anteriorFimSec,
  };
}

/** Meia-noite de São Paulo de uma data civil "YYYY-MM-DD", em epoch (s). */
export function dataParaEpochSec(dataStr: string): number {
  const [ano, mes, dia] = dataStr.split('-').map(Number);
  return Math.floor((Date.UTC(ano, mes - 1, dia) + SP_OFFSET_MS) / 1000);
}

/** Converte epoch (s) de volta para a data civil "YYYY-MM-DD" em São Paulo. */
export function epochSecParaData(sec: number): string {
  return new Date(sec * 1000 - SP_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Condição de data para colunas TIMESTAMP.
 *
 * Devolve o fragmento e os parâmetros separados — os limites vão por `?`,
 * não interpolados. (Nos workflows eles eram interpolados; como são
 * números calculados no servidor não havia risco de injeção, mas
 * parametrizar é gratuito aqui e aproveita o cache de plano do MySQL.)
 */
export function condicaoTimestamp(
  coluna: string,
  inicioSec: number | null,
  fimSec: number | null,
): { sql: string; params: number[] } {
  if (inicioSec === null) return { sql: '', params: [] };
  const u = `UNIX_TIMESTAMP(${coluna})`;
  if (fimSec === null) return { sql: `${u} >= ?`, params: [inicioSec] };
  return { sql: `${u} >= ? AND ${u} < ?`, params: [inicioSec, fimSec] };
}

/**
 * Condição de data para colunas DATE (`meta_insights_daily.date`).
 *
 * DATE não carrega fuso. Usar `UNIX_TIMESTAMP(date)` aqui reproduziria o
 * mesmo deslocamento de ~3h que este módulo existe para evitar, porque o
 * MySQL converteria o valor usando o fuso da sessão. Por isso a
 * comparação é feita direto entre strings de data já calculadas em
 * São Paulo.
 */
export function condicaoData(
  coluna: string,
  inicioSec: number | null,
  fimSec: number | null,
): { sql: string; params: string[] } {
  if (inicioSec === null) return { sql: '', params: [] };
  const de = epochSecParaData(inicioSec);
  if (fimSec === null) return { sql: `${coluna} >= ?`, params: [de] };
  // fim é exclusivo em epoch; em data civil o último dia incluído é
  // o dia anterior ao fim.
  const ate = epochSecParaData(fimSec - 1);
  return { sql: `${coluna} >= ? AND ${coluna} <= ?`, params: [de, ate] };
}

/**
 * Filtro de canal.
 *
 * `customers` é compartilhada entre leads de Formulário Instantâneo e
 * conversas de WhatsApp — o que os distingue é apenas a existência de uma
 * linha em `whatsapp_conversations`. Sem este filtro, a aba "Métricas" de
 * Formulários conta leads de WhatsApp junto (e vice-versa), diluindo CPL
 * e taxa de conversão de cada canal.
 *
 * `tabelaConversas` já vem qualificada e escapada por `BancoCliente.tabela`.
 */
export function condicaoCanal(
  canal: Canal,
  aliasCustomers: string,
  tabelaConversas: string,
): string {
  return condicaoCanalPorId(canal, aliasCustomers ? `${aliasCustomers}.id` : 'id', tabelaConversas);
}

/**
 * Mesmo recorte, quando o id do lead não vem de `customers` e sim de uma
 * coluna de outra tabela (`meta_capi_events.customer_id`, por exemplo).
 */
export function condicaoCanalPorId(
  canal: Canal,
  idExpr: string,
  tabelaConversas: string,
): string {
  if (canal === 'geral') return '';
  const existe = `EXISTS (SELECT 1 FROM ${tabelaConversas} wcx WHERE wcx.customer_id = ${idExpr})`;
  return canal === 'whatsapp' ? existe : `NOT ${existe}`;
}

/** Junta condições não vazias num `WHERE`, ou devolve string vazia. */
export function montaWhere(condicoes: (string | null | undefined)[]): string {
  const partes = condicoes.filter((c): c is string => Boolean(c && c.trim()));
  return partes.length ? `WHERE ${partes.join(' AND ')}` : '';
}

/** Junta condições não vazias como continuação de um `WHERE` já existente. */
export function montaAnd(condicoes: (string | null | undefined)[]): string {
  const partes = condicoes.filter((c): c is string => Boolean(c && c.trim()));
  return partes.length ? `AND ${partes.join(' AND ')}` : '';
}

/**
 * Preenche com zero os dias sem nenhum registro dentro do período.
 *
 * O banco só devolve os dias que tiveram leads. Plotar essa série crua
 * comprime o eixo e faz três dias esparsos parecerem três dias seguidos
 * de volume constante. Em `max` (sem limite inferior) o intervalo é o da
 * própria série.
 */
export function preencheDias(
  serie: { dia: string; total: number }[],
  inicioSec: number | null,
  fimSec: number | null,
): { dia: string; total: number }[] {
  const porDia = new Map(serie.map((p) => [p.dia, p.total]));

  const primeiro = inicioSec !== null ? epochSecParaData(inicioSec) : serie[0]?.dia;
  // `fimSec` é exclusivo: o último dia exibido é o anterior a ele.
  const ultimo =
    fimSec !== null ? epochSecParaData(fimSec - 1) : serie[serie.length - 1]?.dia;
  if (!primeiro || !ultimo || primeiro > ultimo) return serie;

  const resultado: { dia: string; total: number }[] = [];
  let atual = dataParaEpochSec(primeiro);
  const limite = dataParaEpochSec(ultimo);
  // Guarda contra um período absurdo (ex.: 'custom' com data de 1970)
  // gerando dezenas de milhares de colunas: acima de ~2 anos a série
  // crua já não é legível como gráfico de dias.
  const MAX_DIAS = 800;
  while (atual <= limite && resultado.length < MAX_DIAS) {
    const dia = epochSecParaData(atual);
    resultado.push({ dia, total: porDia.get(dia) ?? 0 });
    atual += 86_400;
  }
  return resultado;
}

/** Rótulo do período para exibição. */
export function rotuloPeriodo(p: Periodo): string {
  switch (p.range) {
    case 'hoje':
      return 'Hoje';
    case 'ontem':
      return 'Ontem';
    case '7d':
      return 'Últimos 7 dias';
    case '30d':
      return 'Últimos 30 dias';
    case 'ano':
      return 'Este ano';
    case 'max':
      return 'Todo o período';
    case 'custom':
      return `${p.customFrom} a ${p.customTo}`;
  }
}

const MESES_ABREV = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Agrupa a série diária para caber no gráfico.
 *
 * Até 31 dias cada barra é um dia. Acima disso, uma barra por dia vira
 * um borrão de 200 colunas de 2px, então a série é somada em semanas,
 * meses, trimestres ou anos conforme o tamanho do período — mesma regra
 * do painel antigo.
 */
export function agrupaSerie(
  serie: { dia: string; total: number }[],
): { label: string; count: number }[] {
  if (!serie.length) return [];

  const primeiro = dataParaEpochSec(serie[0].dia);
  const ultimo = dataParaEpochSec(serie[serie.length - 1].dia);
  const dias = Math.round((ultimo - primeiro) / 86_400) + 1;

  if (dias <= 31) {
    return serie.map((p) => {
      const [, m, d] = p.dia.split('-');
      return { label: `${d}/${m}`, count: p.total };
    });
  }

  const granularidade =
    dias <= 180 ? 'semana' : dias <= 730 ? 'mes' : dias <= 2920 ? 'trimestre' : 'ano';

  const baldes = new Map<string, { label: string; count: number }>();
  for (const p of serie) {
    const d = new Date(`${p.dia}T00:00:00Z`);
    let chave: string;
    let label: string;

    if (granularidade === 'semana') {
      // Segunda-feira da semana: getUTCDay() devolve 0 para domingo.
      const inicio = new Date(d);
      const diaDaSemana = (d.getUTCDay() + 6) % 7;
      inicio.setUTCDate(d.getUTCDate() - diaDaSemana);
      chave = inicio.toISOString().slice(0, 10);
      label = `${pad2(inicio.getUTCDate())}/${pad2(inicio.getUTCMonth() + 1)}`;
    } else if (granularidade === 'mes') {
      chave = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
      label = `${MESES_ABREV[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`;
    } else if (granularidade === 'trimestre') {
      const t = Math.floor(d.getUTCMonth() / 3) + 1;
      chave = `${d.getUTCFullYear()}-T${t}`;
      label = `T${t}/${String(d.getUTCFullYear()).slice(2)}`;
    } else {
      chave = String(d.getUTCFullYear());
      label = chave;
    }

    const balde = baldes.get(chave);
    if (balde) balde.count += p.total;
    else baldes.set(chave, { label, count: p.total });
  }
  return [...baldes.values()];
}
