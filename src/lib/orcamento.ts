/**
 * Orçamento mensal de mídia: comparação entre o que o cliente contratou
 * e o que as campanhas gastaram no mês.
 *
 * A pergunta que isto responde é uma só: no ritmo atual, o mês fecha
 * acima ou abaixo do valor combinado? A resposta vira uma recomendação
 * de subir ou baixar o orçamento das campanhas — nunca uma ação
 * automática. Quem mexe em verba de anúncio é gente.
 *
 * O mês analisado é o do período escolhido na tela, e não sempre o mês
 * corrente: quem filtra agosto quer o fechamento de agosto. Mês já
 * encerrado não recebe recomendação — não há o que ajustar no passado.
 *
 * Tudo aqui trabalha com data civil ("YYYY-MM-DD") em vez de `Date`. O
 * servidor da Vercel roda em UTC e o painel raciocina em São Paulo; usar
 * `getDate()` faria o card virar o mês três horas antes da meia-noite de
 * quem olha. As strings vêm de `lib/periodo.ts`, que já resolve o fuso.
 *
 * Módulo puro, sem `server-only`: só aritmética de datas e dinheiro, para
 * poder ser testado sem banco. A leitura do fee e a soma do gasto ficam
 * em `lib/db/orcamento.ts`.
 */

/**
 * Margem em que o ritmo é considerado "no alvo".
 *
 * Sem uma faixa assim o indicador oscilaria entre "aumentar" e "reduzir"
 * todo dia, porque gasto diário nunca bate exatamente no ideal. 10% é
 * folga suficiente para o ruído do dia a dia e apertada o bastante para
 * um mês inteiro não sair do lugar sem ninguém perceber.
 */
export const MARGEM_NO_ALVO = 0.1;

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export type Recomendacao =
  /** Ritmo abaixo do necessário: sobra verba para o mês. */
  | 'aumentar'
  /** Ritmo acima: mantido assim, estoura o limite antes do fim do mês. */
  | 'reduzir'
  /** Dentro da margem. */
  | 'manter'
  /** O limite do mês já foi gasto — não é questão de ritmo. */
  | 'estourado'
  /** Mês encerrado: o número é histórico, não há ajuste a fazer. */
  | 'fechado'
  /** Sem fee cadastrado, ou mês ainda sem gasto: não dá para opinar. */
  | 'indefinido';

export type Orcamento = {
  /** Mês analisado, "YYYY-MM". */
  mes: string;
  /** O mesmo mês por extenso, para o título do card. */
  mesRotulo: string;
  /** O mês já terminou. */
  fechado: boolean;
  /** Limite mensal combinado com o cliente. */
  fee: number;
  /** Gasto acumulado no mês, até o dia de referência. */
  gasto: number;
  /** Quanto ainda cabe no mês; nunca negativo. */
  restante: number;
  /** Fração do fee já consumida (0,42 = 42%). */
  consumo: number;
  /** Quanto o mês fecharia mantido o ritmo atual. Mês fechado: o gasto. */
  projecao: number;
  /** Média diária praticada no mês. */
  diarioAtual: number;
  /** Média diária que faz o mês fechar exatamente no fee. */
  diarioIdeal: number;
  /**
   * Ajuste sugerido no orçamento diário, em fração (0,25 = subir 25%).
   * Negativo pede redução. Zero quando não há recomendação.
   */
  ajuste: number;
  diasNoMes: number;
  /** Dias já decorridos, contando o dia de referência. */
  diasDecorridos: number;
  /** Dias que faltam, contando o dia de referência. */
  diasRestantes: number;
  recomendacao: Recomendacao;
};

/** Quantos dias tem o mês "YYYY-MM". */
export function diasDoMes(mes: string): number {
  const [ano, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(ano, m, 0)).getUTCDate();
}

/** "2026-08" vira "agosto de 2026". */
export function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  return `${MESES[m - 1] ?? mes} de ${ano}`;
}

/**
 * Último dia do mês que deve entrar na soma do gasto, "YYYY-MM-DD".
 *
 * Mês corrente para no dia de hoje: incluir os dias que ainda não
 * aconteceram diluiria a média diária e faria todo mês parecer folgado.
 * Mês encerrado vai até o fim.
 */
export function ultimoDiaConsiderado(mes: string, hoje: string): string {
  const mesDeHoje = hoje.slice(0, 7);
  if (mes === mesDeHoje) return hoje;
  if (mes > mesDeHoje) return `${mes}-01`;
  return `${mes}-${String(diasDoMes(mes)).padStart(2, '0')}`;
}

/**
 * Compara gasto e fee e devolve tudo o que o card precisa mostrar.
 *
 * `fee` nulo ou zero significa cliente sem valor combinado — o card
 * aparece convidando a cadastrar, e não como se o cliente tivesse
 * estourado um limite de zero.
 */
export function avaliaOrcamento(entrada: {
  fee: number | null;
  gasto: number;
  /** Mês analisado, "YYYY-MM". */
  mes: string;
  /** Hoje em São Paulo, "YYYY-MM-DD". */
  hoje: string;
}): Orcamento {
  const fee = Number(entrada.fee) > 0 ? Number(entrada.fee) : 0;
  const gasto = Number(entrada.gasto) > 0 ? Number(entrada.gasto) : 0;
  const mes = entrada.mes;
  const mesDeHoje = entrada.hoje.slice(0, 7);

  const diasNoMes = diasDoMes(mes);
  const fechado = mes < mesDeHoje;
  const futuro = mes > mesDeHoje;
  const diasDecorridos = fechado
    ? diasNoMes
    : futuro
      ? 0
      : Math.min(Number(entrada.hoje.slice(8, 10)), diasNoMes);
  const diasRestantes = fechado ? 0 : diasNoMes - diasDecorridos + 1;

  const restante = Math.max(fee - gasto, 0);
  const diarioAtual = diasDecorridos > 0 ? gasto / diasDecorridos : 0;
  const diarioIdeal = diasRestantes > 0 ? restante / diasRestantes : 0;

  const base: Omit<Orcamento, 'ajuste' | 'recomendacao'> = {
    mes,
    mesRotulo: rotuloDoMes(mes),
    fechado,
    fee,
    gasto,
    restante,
    consumo: fee > 0 ? gasto / fee : 0,
    projecao: fechado ? gasto : diarioAtual * diasNoMes,
    diarioAtual,
    diarioIdeal,
    diasNoMes,
    diasDecorridos,
    diasRestantes,
  };

  if (fee <= 0) return { ...base, ajuste: 0, recomendacao: 'indefinido' };
  // Mês encerrado é histórico: recomendar ajuste de ritmo no passado não
  // significa nada, mesmo quando o gasto ficou longe do combinado.
  if (fechado) return { ...base, ajuste: 0, recomendacao: 'fechado' };
  if (futuro) return { ...base, ajuste: 0, recomendacao: 'indefinido' };
  if (restante <= 0) return { ...base, ajuste: -1, recomendacao: 'estourado' };
  // Sem gasto nenhum não existe ritmo para comparar: qualquer percentual
  // sairia de uma divisão por zero e viraria "aumentar 1000%".
  if (gasto <= 0) return { ...base, ajuste: 0, recomendacao: 'indefinido' };

  const ajuste = diarioIdeal / diarioAtual - 1;
  if (Math.abs(ajuste) <= MARGEM_NO_ALVO) return { ...base, ajuste, recomendacao: 'manter' };
  return { ...base, ajuste, recomendacao: ajuste > 0 ? 'aumentar' : 'reduzir' };
}

/**
 * Texto curto do indicador, em uma frase.
 *
 * A recomendação é dita em reais por dia, e não em percentual: no começo
 * do mês o percentual explode — gastar R$ 8 no dia 1 de um fee de
 * R$ 4.000 vira "aumente 1486%" — e some com a informação que interessa,
 * que é quanto por dia.
 */
export function fraseOrcamento(o: Orcamento): string {
  const brl = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  switch (o.recomendacao) {
    case 'aumentar':
      return `Suba a diária de ${brl(o.diarioAtual)} para cerca de ${brl(o.diarioIdeal)} e use o fee do mês.`;
    case 'reduzir':
      return `Desça a diária de ${brl(o.diarioAtual)} para cerca de ${brl(o.diarioIdeal)} e não passe do fee.`;
    case 'manter':
      return `Ritmo no alvo: ${brl(o.diarioAtual)} por dia fecha o mês no combinado.`;
    case 'estourado':
      return `Fee consumido — ${brl(o.gasto - o.fee)} acima do combinado.`;
    case 'fechado':
      return o.gasto > o.fee
        ? `Mês encerrado ${brl(o.gasto - o.fee)} acima do fee.`
        : `Mês encerrado com ${brl(o.fee - o.gasto)} do fee não usados.`;
    default:
      return o.fee > 0
        ? 'Ainda não há gasto neste mês para comparar com o fee.'
        : 'Cadastre o fee mensal deste cliente para acompanhar o gasto.';
  }
}
