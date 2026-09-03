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
 * O ritmo é medido só em dias inteiros. O dia de hoje está pela metade
 * quando alguém olha o painel, e dividir o gasto do mês pelos dias
 * decorridos jogava essa metade na média: no dia 2, com R$ 130 ontem e
 * R$ 18 até agora, a média caía para R$ 74 e o card mandava dobrar a
 * diária de quem estava exatamente no ritmo certo. O gasto de hoje
 * continua contando no total e no que resta do investimento — ele só não entra na
 * conta da média.
 *
 * Tudo aqui trabalha com data civil ("YYYY-MM-DD") em vez de `Date`. O
 * servidor da Vercel roda em UTC e o painel raciocina em São Paulo; usar
 * `getDate()` faria o card virar o mês três horas antes da meia-noite de
 * quem olha. As strings vêm de `lib/periodo.ts`, que já resolve o fuso.
 *
 * Módulo puro, sem `server-only`: só aritmética de datas e dinheiro, para
 * poder ser testado sem banco. A leitura do investimento e a soma do gasto ficam
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
  /** Sem investimento cadastrado, ou mês ainda sem gasto: não dá para opinar. */
  | 'indefinido';

export type Orcamento = {
  /** Mês analisado, "YYYY-MM". */
  mes: string;
  /** O mesmo mês por extenso, para o título do card. */
  mesRotulo: string;
  /** O mês já terminou. */
  fechado: boolean;
  /** Limite mensal combinado com o cliente. */
  investimento: number;
  /** Gasto acumulado no mês, até o dia de referência. */
  gasto: number;
  /** Quanto ainda cabe no mês; nunca negativo. */
  restante: number;
  /** Fração do investimento já consumida (0,42 = 42%). */
  consumo: number;
  /** Quanto o mês fecharia mantido o ritmo atual. Mês fechado: o gasto. */
  projecao: number;
  /** Média diária praticada nos dias inteiros do mês, hoje de fora. */
  diarioAtual: number;
  /** Média diária que faz o mês fechar exatamente no investimento. */
  diarioIdeal: number;
  /**
   * Ajuste sugerido no orçamento diário, em fração (0,25 = subir 25%).
   * Negativo pede redução. Zero quando não há recomendação.
   */
  ajuste: number;
  diasNoMes: number;
  /** Dias já decorridos, contando o dia de referência. */
  diasDecorridos: number;
  /** Dias que já terminaram — os decorridos menos hoje. Base do ritmo. */
  diasCompletos: number;
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
 * Compara gasto e investimento e devolve tudo o que o card precisa mostrar.
 *
 * `investimento` nulo ou zero significa cliente sem valor combinado — o card
 * aparece convidando a cadastrar, e não como se o cliente tivesse
 * estourado um limite de zero.
 */
export function avaliaOrcamento(entrada: {
  investimento: number | null;
  /** Gasto do mês até hoje, hoje incluso. */
  gasto: number;
  /**
   * Gasto do mês até ontem. É o que sustenta o ritmo: o dia de hoje está
   * pela metade e diluiria a média. Mês encerrado não tem "hoje", então
   * pode vir igual ao gasto ou ser omitido.
   */
  gastoAteOntem?: number;
  /** Mês analisado, "YYYY-MM". */
  mes: string;
  /** Hoje em São Paulo, "YYYY-MM-DD". */
  hoje: string;
}): Orcamento {
  const investimento = Number(entrada.investimento) > 0 ? Number(entrada.investimento) : 0;
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
  // Hoje sai da conta do ritmo, mas continua no que resta do mês: ainda
  // dá para gastar nele.
  const diasCompletos = fechado ? diasNoMes : Math.max(diasDecorridos - 1, 0);
  const diasRestantes = fechado ? 0 : diasNoMes - diasDecorridos + 1;

  const ateOntemBruto = Number(entrada.gastoAteOntem);
  const gastoAteOntem = fechado
    ? gasto
    : Math.min(Number.isFinite(ateOntemBruto) && ateOntemBruto > 0 ? ateOntemBruto : 0, gasto);

  const restante = Math.max(investimento - gasto, 0);
  const diarioAtual = diasCompletos > 0 ? gastoAteOntem / diasCompletos : 0;
  const diarioIdeal = diasRestantes > 0 ? restante / diasRestantes : 0;

  const base: Omit<Orcamento, 'ajuste' | 'recomendacao'> = {
    mes,
    mesRotulo: rotuloDoMes(mes),
    fechado,
    investimento,
    gasto,
    restante,
    consumo: investimento > 0 ? gasto / investimento : 0,
    // O que já se gastou, mais o ritmo dos dias inteiros que ainda vêm.
    // Hoje entra pelo valor real, e não pela média: parte dele já foi.
    projecao: fechado ? gasto : gasto + diarioAtual * (diasNoMes - diasDecorridos),
    diarioAtual,
    diarioIdeal,
    diasNoMes,
    diasDecorridos,
    diasCompletos,
    diasRestantes,
  };

  if (investimento <= 0) return { ...base, ajuste: 0, recomendacao: 'indefinido' };
  // Mês encerrado é histórico: recomendar ajuste de ritmo no passado não
  // significa nada, mesmo quando o gasto ficou longe do combinado.
  if (fechado) return { ...base, ajuste: 0, recomendacao: 'fechado' };
  if (futuro) return { ...base, ajuste: 0, recomendacao: 'indefinido' };
  if (restante <= 0) return { ...base, ajuste: -1, recomendacao: 'estourado' };
  // Sem um dia inteiro com gasto não existe ritmo para comparar: qualquer
  // percentual sairia de uma divisão por zero e viraria "aumentar 1000%".
  if (diasCompletos <= 0 || gastoAteOntem <= 0) {
    return { ...base, ajuste: 0, recomendacao: 'indefinido' };
  }

  const ajuste = diarioIdeal / diarioAtual - 1;
  if (Math.abs(ajuste) <= MARGEM_NO_ALVO) return { ...base, ajuste, recomendacao: 'manter' };
  return { ...base, ajuste, recomendacao: ajuste > 0 ? 'aumentar' : 'reduzir' };
}

/**
 * Texto curto do indicador, em uma frase.
 *
 * A recomendação é dita em reais por dia, e não em percentual: no começo
 * do mês o percentual explode — gastar R$ 8 no dia 1 de um investimento de
 * R$ 4.000 vira "aumente 1486%" — e some com a informação que interessa,
 * que é quanto por dia.
 */
export function fraseOrcamento(o: Orcamento): string {
  const brl = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  switch (o.recomendacao) {
    case 'aumentar':
      return `Suba a diária de ${brl(o.diarioAtual)} para cerca de ${brl(o.diarioIdeal)} e use o investimento do mês.`;
    case 'reduzir':
      return `Desça a diária de ${brl(o.diarioAtual)} para cerca de ${brl(o.diarioIdeal)} e não passe do investimento.`;
    case 'manter':
      return `Ritmo no alvo: ${brl(o.diarioAtual)} por dia fecha o mês no combinado.`;
    case 'estourado':
      return `Investimento consumido: ${brl(o.gasto - o.investimento)} acima do combinado.`;
    case 'fechado':
      return o.gasto > o.investimento
        ? `Mês encerrado ${brl(o.gasto - o.investimento)} acima do investimento.`
        : `Mês encerrado com ${brl(o.investimento - o.gasto)} do investimento não usados.`;
    default:
      if (o.investimento <= 0)
        return 'Cadastre o investimento mensal deste cliente para acompanhar o gasto.';
      if (o.gasto <= 0 && o.diasCompletos > 0)
        return 'Ainda não há gasto neste mês para comparar com o investimento.';
      // Gasto só de hoje, ou dia 1 do mês: existe gasto, mas nenhum dia
      // inteiro para medir ritmo. A diária de referência ainda ajuda.
      if (o.diarioIdeal > 0)
        return `Sem dia inteiro fechado para medir o ritmo. Para usar o investimento, cerca de ${brl(o.diarioIdeal)} por dia.`;
      return 'Ainda não há gasto neste mês para comparar com o investimento.';
  }
}
