import { avaliaOrcamento, type Orcamento } from '@/lib/orcamento';

/**
 * Quebra do orçamento mensal por categoria de campanha.
 *
 * O card de orçamento responde "o mês vai estourar?". Este responde "por
 * causa de quê?": a verba combinada é uma só, mas ela é gasta em frentes
 * diferentes — captação, remarketing, institucional — e quem gerencia
 * precisa saber qual delas está comendo a verba da outra. Sem isso, um
 * mês no alvo esconde uma captação parada e um remarketing dobrado.
 *
 * As categorias são inventadas pelo cliente e ficam em
 * `trakeamento_controle.campaign_categories`; a atribuição campanha →
 * categoria em `campaign_category_map`. Nada disso vem da Meta: o
 * objetivo da campanha (`objective`) é atalho para classificar em lote,
 * não a classificação em si.
 *
 * Cada categoria passa pelo mesmo `avaliaOrcamento` do card geral, então
 * herda de graça o ritmo em dias inteiros, a projeção e a recomendação —
 * e, principalmente, herda as mesmas regras: uma categoria não pode dizer
 * "reduzir" pelo mesmo gasto que o total chama de "no alvo".
 *
 * Módulo puro, sem `server-only`: só distribuição de números já lidos. A
 * leitura está em `lib/db/orcamento.ts`.
 */

/** Categoria como está cadastrada, antes de encontrar o gasto. */
export type CategoriaVerba = {
  id: number;
  nome: string;
  /** Verba mensal própria. `null` = categoria só separa gasto, sem teto. */
  verba: number | null;
  ordem: number;
};

/** Gasto do mês de uma categoria, no formato que `gastoDoMes` já devolve. */
export type GastoCategoria = { total: number; ateOntem: number };

export type LinhaOrcamentoCategoria = {
  /** `null` na linha das campanhas ainda não classificadas. */
  id: number | null;
  nome: string;
  /** A categoria não tem verba própria cadastrada. */
  semVerba: boolean;
  /** Fatia do gasto do mês que saiu desta categoria (0,42 = 42%). */
  fatiaDoGasto: number;
  orcamento: Orcamento;
};

export type OrcamentoPorCategoria = {
  linhas: LinhaOrcamentoCategoria[];
  /** Soma das verbas cadastradas nas categorias. */
  verbaDistribuida: number;
  /** Investimento total do cliente, para conferir contra a soma acima. */
  investimento: number;
  /**
   * Diferença entre o investimento e a soma das verbas. Positivo = sobra
   * verba não distribuída; negativo = as categorias somam mais do que o
   * combinado. Zero quando bate, ou quando não há o que comparar.
   */
  diferenca: number;
  /** Gasto do mês inteiro, classificado ou não. */
  gasto: number;
  /** Gasto que caiu em campanhas sem categoria. */
  gastoSemCategoria: number;
  /** Há pelo menos uma categoria cadastrada. */
  temCategorias: boolean;
};

/** Nome da linha que junta o que ninguém classificou. */
export const NOME_SEM_CATEGORIA = 'Sem categoria';

/**
 * Junta categorias, verbas e gastos numa lista pronta para a tela.
 *
 * `gastos` é indexado pelo id da categoria; a chave `null` guarda o que
 * saiu de campanha sem categoria. Categoria cadastrada que não gastou
 * nada no mês continua na lista — verba parada é justamente o que
 * interessa ver.
 *
 * A linha "Sem categoria" só aparece quando há gasto nela, e nunca ganha
 * verba: não é uma frente de investimento, é trabalho de classificação
 * pendente. Ela também fica sempre por último, pelo mesmo motivo.
 */
export function montaOrcamentoPorCategoria(entrada: {
  categorias: CategoriaVerba[];
  gastos: Map<number | null, GastoCategoria>;
  /** Investimento mensal total do cliente, o mesmo do card geral. */
  investimento: number | null;
  /** Mês analisado, "YYYY-MM". */
  mes: string;
  /** Hoje em São Paulo, "YYYY-MM-DD". */
  hoje: string;
}): OrcamentoPorCategoria {
  const { categorias, gastos, mes, hoje } = entrada;
  const investimento = Number(entrada.investimento) > 0 ? Number(entrada.investimento) : 0;

  const vazio: GastoCategoria = { total: 0, ateOntem: 0 };
  let gastoTotal = 0;
  for (const g of gastos.values()) gastoTotal += Number(g.total) > 0 ? Number(g.total) : 0;

  const ordenadas = [...categorias].sort(
    (a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'),
  );

  const linha = (
    id: number | null,
    nome: string,
    verba: number | null,
    gasto: GastoCategoria,
  ): LinhaOrcamentoCategoria => ({
    id,
    nome,
    semVerba: !(Number(verba) > 0),
    fatiaDoGasto: gastoTotal > 0 ? gasto.total / gastoTotal : 0,
    orcamento: avaliaOrcamento({
      investimento: verba,
      gasto: gasto.total,
      gastoAteOntem: gasto.ateOntem,
      mes,
      hoje,
    }),
  });

  const linhas = ordenadas.map((c) => linha(c.id, c.nome, c.verba, gastos.get(c.id) ?? vazio));

  const semCategoria = gastos.get(null) ?? vazio;
  if (semCategoria.total > 0) {
    linhas.push(linha(null, NOME_SEM_CATEGORIA, null, semCategoria));
  }

  let verbaDistribuida = 0;
  for (const c of categorias) if (Number(c.verba) > 0) verbaDistribuida += Number(c.verba);

  return {
    linhas,
    verbaDistribuida,
    investimento,
    // Sem investimento total cadastrado não existe diferença a apontar:
    // a soma das categorias passa a ser o próprio combinado.
    diferenca: investimento > 0 ? Math.round((investimento - verbaDistribuida) * 100) / 100 : 0,
    gasto: gastoTotal,
    gastoSemCategoria: semCategoria.total,
    temCategorias: categorias.length > 0,
  };
}

/**
 * Aviso sobre a distribuição da verba, ou `null` quando ela fecha.
 *
 * Vale a pena avisar porque o erro é silencioso: quem cadastra R$ 1.000
 * em três categorias de um investimento de R$ 4.000 vê três barras verdes e
 * um mês estourando, sem nada ligando uma coisa à outra.
 *
 * A folga de um real absorve o arredondamento de quem digita "1.333,33"
 * três vezes — apontar um centavo de diferença seria ruído.
 */
export function avisoDistribuicao(o: OrcamentoPorCategoria): string | null {
  if (o.investimento <= 0 || o.verbaDistribuida <= 0) return null;
  if (Math.abs(o.diferenca) < 1) return null;

  const brl = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  return o.diferenca > 0
    ? `${brl(o.diferenca)} do investimento mensal ainda não estão em nenhuma categoria.`
    : `As categorias somam ${brl(-o.diferenca)} a mais do que o investimento mensal.`;
}
