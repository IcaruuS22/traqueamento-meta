/**
 * Ranking dos motivos de perda.
 *
 * Puro e fora de `lib/db/*` pelo mesmo motivo de `lib/crm.ts`: o que
 * erra em silêncio aqui é a junção dos motivos — "Preço", "preço" e
 * "Preço " são o mesmo motivo escrito por três pessoas diferentes, e o
 * campo é texto livre justamente para não virar mais uma tela de
 * cadastro (ver `MOTIVOS_PERDA_SUGERIDOS`). Sem essa junção, o cliente
 * que mais perde por preço enxerga três barras pequenas em vez de uma
 * grande, que é o contrário de "visualizar melhor".
 */

/** Uma linha crua do banco: o motivo como foi digitado e quantos leads. */
export type LinhaMotivoPerda = { motivo: string | null; total: number };

export type ItemMotivoPerda = {
  rotulo: string;
  valor: number;
  /** Fatia do total de perdas, já arredondada para uma casa. */
  percentual: number;
  /** Linha dos leads perdidos sem motivo registrado. */
  sem_motivo: boolean;
};

export type RankingPerdas = {
  itens: ItemMotivoPerda[];
  /** Perdas do período, com motivo ou sem. */
  total: number;
  /** Quantas delas ninguém registrou o motivo. */
  sem_motivo: number;
  /** Quantos motivos distintos existem, mesmo os que não viraram barra. */
  motivos_distintos: number;
};

/** Barras antes de o resto virar "Outros". */
export const LIMITE_MOTIVOS = 8;

const ROTULO_SEM_MOTIVO = 'Sem motivo registrado';

/**
 * Junta, ordena e recorta as linhas do banco.
 *
 * Os dois funis chegam na mesma lista: motivo igual no formulário e no
 * WhatsApp é o mesmo motivo do mesmo cliente, e separá-los em duas
 * barras esconderia o tamanho real dele.
 *
 * A grafia que sobrevive é a do motivo mais frequente, não a primeira
 * que apareceu: entre "preço" (40 leads) e "Preço" (2), a barra deve
 * levar a que o time reconhece.
 */
export function montaRankingPerdas(
  linhas: LinhaMotivoPerda[],
  limite = LIMITE_MOTIVOS,
): RankingPerdas {
  const porChave = new Map<string, { rotulo: string; total: number; maiorGrafia: number }>();
  let semMotivo = 0;
  let total = 0;

  for (const linha of linhas) {
    const quantidade = Number(linha.total) || 0;
    if (quantidade <= 0) continue;
    total += quantidade;

    const texto = (linha.motivo ?? '').replace(/\s+/g, ' ').trim();
    if (!texto) {
      semMotivo += quantidade;
      continue;
    }

    const chave = texto.toLowerCase();
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, { rotulo: texto, total: quantidade, maiorGrafia: quantidade });
      continue;
    }
    atual.total += quantidade;
    if (quantidade > atual.maiorGrafia) {
      atual.maiorGrafia = quantidade;
      atual.rotulo = texto;
    }
  }

  const fatia = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  // Empate desempatado pelo rótulo para a ordem não mudar sozinha entre
  // dois carregamentos iguais — a mesma tela duas vezes tem de desenhar
  // as mesmas barras na mesma ordem.
  const ordenados = [...porChave.values()].sort(
    (a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo, 'pt-BR'),
  );

  const itens: ItemMotivoPerda[] = ordenados.slice(0, limite).map((m) => ({
    rotulo: m.rotulo,
    valor: m.total,
    percentual: fatia(m.total),
    sem_motivo: false,
  }));

  const resto = ordenados.slice(limite);
  if (resto.length) {
    const soma = resto.reduce((acc, m) => acc + m.total, 0);
    itens.push({
      rotulo: `Outros (${resto.length} ${resto.length === 1 ? 'motivo' : 'motivos'})`,
      valor: soma,
      percentual: fatia(soma),
      sem_motivo: false,
    });
  }

  // Sempre por último, e fora do recorte acima: não é um motivo que
  // competiu com os outros, é o buraco no preenchimento. Ficaria errado
  // ele empurrar um motivo de verdade para dentro de "Outros".
  if (semMotivo > 0) {
    itens.push({
      rotulo: ROTULO_SEM_MOTIVO,
      valor: semMotivo,
      percentual: fatia(semMotivo),
      sem_motivo: true,
    });
  }

  return { itens, total, sem_motivo: semMotivo, motivos_distintos: ordenados.length };
}
