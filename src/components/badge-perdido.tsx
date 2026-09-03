/**
 * Selo "Perdido" do negócio que caiu.
 *
 * Diferente do `BadgeGanho`, aqui quem decide não é o nome da etapa: no
 * funil de formulário a etapa de perda é a marcada na aba Eventos, e no
 * de WhatsApp é `ehEtapaDePerda`. Quem chama já sabe disso e passa
 * `perdido`; o componente só desenha, e mostra o motivo no title quando
 * o CRM informou algum.
 */
export function BadgePerdido({
  perdido,
  motivo,
}: {
  perdido: boolean;
  motivo?: string | null;
}) {
  if (!perdido) return null;
  const texto = (motivo ?? '').trim();
  return (
    <span
      className="origem-tag tag-perdido"
      title={texto ? `Negócio perdido. Motivo: ${texto}` : 'Negócio perdido.'}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
        <path d="M4.7 3.6 8 6.9l3.3-3.3 1.1 1.1L9.1 8l3.3 3.3-1.1 1.1L8 9.1l-3.3 3.3-1.1-1.1L6.9 8 3.6 4.7z" />
      </svg>
      Perdido
    </span>
  );
}
