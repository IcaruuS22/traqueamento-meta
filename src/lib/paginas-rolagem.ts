/**
 * ViewContent automático por rolagem — as opções que o painel oferece.
 *
 * Fica num arquivo próprio, sem dependência, porque o formulário do
 * painel (componente de cliente) e a camada de banco (só servidor) leem a
 * mesma lista.
 */

/** Porcentagem da página vista que dispara o ViewContent; 0 = desligado. */
export const OPCOES_ROLAGEM = [0, 25, 50, 75, 90] as const;

export type OpcaoRolagem = (typeof OPCOES_ROLAGEM)[number];

/** Padrão dos sites novos: metade da página indica leitura de verdade. */
export const ROLAGEM_PADRAO: OpcaoRolagem = 50;

export function ehOpcaoRolagem(v: unknown): v is OpcaoRolagem {
  return typeof v === 'number' && (OPCOES_ROLAGEM as readonly number[]).includes(v);
}

export function rotuloRolagem(v: number): string {
  return v > 0 ? `ao rolar ${v}% da página` : 'desligado';
}
