/**
 * Vocabulário de eventos da Meta, compartilhado entre servidor e
 * navegador.
 *
 * Fica fora de `lib/db/mapeamentos.ts` porque aquele módulo é
 * `server-only` e estas listas são renderizadas no `<datalist>` e no
 * `<select>` das telas de configuração, que rodam no cliente.
 */

/**
 * Eventos padrão da Meta, iguais aos do `<datalist>` do painel antigo.
 * É sugestão, não validação: a Meta aceita eventos personalizados, e o
 * painel antigo também deixava digitar qualquer nome.
 */
export const EVENTOS_META = [
  'Lead',
  'Contact',
  'Schedule',
  'CompleteRegistration',
  'SubmitApplication',
  'ViewContent',
  'AddToCart',
  'AddToWishlist',
  'InitiateCheckout',
  'AddPaymentInfo',
  'Purchase',
  'StartTrial',
  'Subscribe',
  'Search',
] as const;

/**
 * Ordem dos estágios no funil de vendas.
 *
 * O funil precisa sair na ordem da jornada, não na ordem de volume: o
 * `ORDER BY total DESC` da consulta serve para escolher os eventos mais
 * relevantes, mas desenhá-los nessa ordem inverte o significado do
 * gráfico — um evento raro no meio da jornada aparecia depois de um
 * evento comum que vem antes dele.
 *
 * `LeadQualified` não é evento padrão da Meta, mas é o estágio que o
 * fluxo do Kommo cria entre `Lead` e o resto, então entra aqui.
 *
 * Evento que não estiver nesta lista (personalizado) vai para o fim,
 * ordenado por volume — o desconhecido não tem lugar na jornada.
 */
export const ORDEM_FUNIL = [
  'ViewContent',
  'Search',
  'Lead',
  'LeadQualified',
  'Contact',
  'Schedule',
  'CompleteRegistration',
  'SubmitApplication',
  'StartTrial',
  'AddToWishlist',
  'AddToCart',
  'InitiateCheckout',
  'AddPaymentInfo',
  'Subscribe',
  'Purchase',
] as const;

const POSICAO_NO_FUNIL = new Map<string, number>(ORDEM_FUNIL.map((nome, i) => [nome, i]));

/**
 * Posição do evento na jornada; eventos fora do catálogo vão para o fim.
 * É o que permite ordenar etapas do cliente (que têm nome livre) pela
 * ordem real do funil, já que cada etapa carrega o evento Meta que
 * dispara.
 */
export function posicaoNoFunil(eventName: string): number {
  return POSICAO_NO_FUNIL.get(eventName) ?? ORDEM_FUNIL.length;
}

/** Reordena eventos pela jornada; empate e desconhecidos, por volume. */
export function ordenaFunil<T extends { event_name: string; total: number }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    const pa = POSICAO_NO_FUNIL.get(a.event_name) ?? ORDEM_FUNIL.length;
    const pb = POSICAO_NO_FUNIL.get(b.event_name) ?? ORDEM_FUNIL.length;
    return pa !== pb ? pa - pb : b.total - a.total;
  });
}

/**
 * De onde sai o `value` do evento no funil do Kommo:
 *  - `price`: o valor do negócio no CRM;
 *  - `fixed`: um valor fixo configurado no fluxo;
 *  - `none`: evento sem valor.
 */
export const TIPOS_DE_VALOR = ['price', 'fixed', 'none'] as const;
export type TipoDeValor = (typeof TIPOS_DE_VALOR)[number];

export const ROTULO_TIPO_DE_VALOR: Record<TipoDeValor, string> = {
  price: 'Valor do negócio (price)',
  fixed: 'Valor fixo (fixed)',
  none: 'Sem valor (none)',
};
