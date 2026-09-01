import { ESTAGIO_PERDIDO, normalizaEstagio } from '@/lib/whatsapp-conversas';

/**
 * Motivo de perda — as regras que os dois lados usam.
 *
 * Fica fora de `lib/db/*` porque aqueles módulos são `server-only` e o
 * modal do CRM, o quadro e a tela de Conversas precisam das mesmas
 * regras no navegador. Mesmo motivo de `lib/crm.ts`.
 */

/**
 * Motivos oferecidos de saída, para o time não escrever cinco variações
 * do mesmo motivo.
 *
 * Não são uma tabela de cadastro de propósito: seria mais uma tela de
 * configuração para o cliente manter e mais uma migração. O campo aceita
 * texto livre, e a tela também oferece os motivos que o próprio cliente
 * já usou — na prática o cadastro se forma sozinho, sem tela.
 */
export const MOTIVOS_PERDA_SUGERIDOS = [
  'Preço',
  'Sem resposta',
  'Fora da região',
  'Comprou do concorrente',
  'Não é o público',
  'Sem interesse',
  'Contato inválido',
] as const;

/** Limite da coluna `whatsapp_conversations.lost_reason`. */
export const TAMANHO_MOTIVO = 120;

/**
 * Texto do motivo pronto para gravar: sem espaços sobrando, no limite da
 * coluna, e `null` quando não há nada — motivo em branco é ausência de
 * motivo, não a string vazia.
 */
export function normalizaMotivo(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const texto = valor.replace(/\s+/g, ' ').trim();
  return texto ? texto.slice(0, TAMANHO_MOTIVO) : null;
}

/** A etapa de destino é a que fecha a conversa como perdida? */
export function ehEtapaDePerda(etapa: string | null | undefined): boolean {
  return normalizaEstagio(etapa) === ESTAGIO_PERDIDO;
}
