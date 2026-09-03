import { ehEtapaDeGanho } from '@/lib/funil';

/**
 * Selo "Ganho" das etapas que fecham o negócio.
 *
 * O nome da etapa é escrito pelo cliente (no Kommo, ou na configuração
 * de eventos), então quem decide se ela é de ganho é `ehEtapaDeGanho` —
 * o componente só desenha. Quando a etapa não é de ganho ele não
 * renderiza nada, para caber direto na célula ou no card sem condição
 * repetida em cada tela.
 */
export function BadgeGanho({ etapa }: { etapa: string | null | undefined }) {
  if (!ehEtapaDeGanho(etapa)) return null;
  return (
    <span
      className="origem-tag inline-flex items-center gap-1 bg-[var(--green-50)] text-[var(--green-700)]"
      title="Etapa de fechamento: o lead virou cliente."
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3" fill="currentColor">
        <path d="M6.4 11.6 3.2 8.4l1.1-1.1 2.1 2.1 5-5 1.1 1.1z" />
      </svg>
      Ganho
    </span>
  );
}
