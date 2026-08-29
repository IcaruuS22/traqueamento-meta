import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Rota antiga do Kanban de Formulários.
 *
 * O quadro virou uma tela só em `/crm`, com os leads de formulário e os
 * contatos de WhatsApp juntos. A rota fica de pé porque link antigo,
 * favorito e histórico do navegador continuam apontando para cá.
 */
export default async function PaginaKanbanRedirecionada({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;

  // Período escolhido acompanha o redirecionamento; o filtro de canal
  // não, porque o quadro novo é dos dois canais.
  const qs = new URLSearchParams();
  for (const chave of ['range', 'date_from', 'date_to'] as const) {
    const v = busca[chave];
    const valor = Array.isArray(v) ? v[0] : v;
    if (valor) qs.set(chave, valor);
  }

  const destino = `/app/${encodeURIComponent(cliente)}/crm`;
  redirect(qs.toString() ? `${destino}?${qs.toString()}` : destino);
}
