/**
 * Orçamento mensal de mídia: comparação entre o que o cliente contratou
 * e o que as campanhas já gastaram no mês.
 *
 * A pergunta que isto responde é uma só: no ritmo de hoje, o mês fecha
 * acima ou abaixo do valor combinado? A resposta vira uma recomendação
 * de subir ou baixar o orçamento das campanhas — nunca uma ação
 * automática. Quem mexe em verba de anúncio é gente.
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

export type Recomendacao =
  /** Ritmo abaixo do necessário: sobra verba para o mês. */
  | 'aumentar'
  /** Ritmo acima: mantido assim, estoura o limite antes do fim do mês. */
  | 'reduzir'
  /** Dentro da margem. */
  | 'manter'
  /** O limite do mês já foi gasto — não é questão de ritmo. */
  | 'estourado'
  /** Sem fee cadastrado, ou mês ainda sem gasto: não dá para opinar. */
  | 'indefinido';

export type Orcamento = {
  /** Limite mensal combinado com o cliente. */
  fee: number;
  /** Gasto acumulado no mês, até o dia de referência. */
  gasto: number;
  /** Quanto ainda cabe no mês; nunca negativo. */
  restante: number;
  /** Fração do fee já consumida (0,42 = 42%). */
  consumo: number;
  /** Quanto o mês fecharia mantido o ritmo atual. */
  projecao: number;
  /** Média diária já praticada no mês. */
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

/** Quantos dias tem o mês da data informada. */
export function diasDoMes(referencia: Date): number {
  return new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0).getDate();
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
  referencia: Date;
}): Orcamento {
  const fee = Number(entrada.fee) > 0 ? Number(entrada.fee) : 0;
  const gasto = Number(entrada.gasto) > 0 ? Number(entrada.gasto) : 0;

  const diasNoMes = diasDoMes(entrada.referencia);
  const diasDecorridos = Math.min(entrada.referencia.getDate(), diasNoMes);
  const diasRestantes = diasNoMes - diasDecorridos + 1;

  const restante = Math.max(fee - gasto, 0);
  const diarioAtual = gasto / diasDecorridos;
  const diarioIdeal = restante / diasRestantes;
  const projecao = diarioAtual * diasNoMes;

  const base: Omit<Orcamento, 'ajuste' | 'recomendacao'> = {
    fee,
    gasto,
    restante,
    consumo: fee > 0 ? gasto / fee : 0,
    projecao,
    diarioAtual,
    diarioIdeal,
    diasNoMes,
    diasDecorridos,
    diasRestantes,
  };

  if (fee <= 0) return { ...base, ajuste: 0, recomendacao: 'indefinido' };
  if (restante <= 0) return { ...base, ajuste: -1, recomendacao: 'estourado' };
  // Sem gasto nenhum não existe ritmo para comparar: qualquer percentual
  // sairia de uma divisão por zero e viraria "aumentar 1000%".
  if (gasto <= 0) return { ...base, ajuste: 0, recomendacao: 'indefinido' };

  const ajuste = diarioIdeal / diarioAtual - 1;
  if (Math.abs(ajuste) <= MARGEM_NO_ALVO) return { ...base, ajuste, recomendacao: 'manter' };
  return { ...base, ajuste, recomendacao: ajuste > 0 ? 'aumentar' : 'reduzir' };
}

/** Texto curto do indicador, em uma frase. */
export function fraseOrcamento(o: Orcamento): string {
  const pct = Math.round(Math.abs(o.ajuste) * 100);
  switch (o.recomendacao) {
    case 'aumentar':
      return `Aumente o orçamento diário em cerca de ${pct}% para usar o fee do mês.`;
    case 'reduzir':
      return `Reduza o orçamento diário em cerca de ${pct}% para não passar do fee do mês.`;
    case 'manter':
      return 'O ritmo de gasto está no alvo. Mantenha o orçamento diário.';
    case 'estourado':
      return 'O fee do mês já foi consumido. Qualquer gasto a mais passa do combinado.';
    default:
      return o.fee > 0
        ? 'Ainda não há gasto neste mês para comparar com o fee.'
        : 'Cadastre o fee mensal deste cliente para acompanhar o ritmo de gasto.';
  }
}
