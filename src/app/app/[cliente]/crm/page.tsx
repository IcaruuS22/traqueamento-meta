import { redirect } from 'next/navigation';
import { ehOrigem } from '@/lib/crm';

export const dynamic = 'force-dynamic';

/**
 * Rota antiga do quadro único.
 *
 * O CRM virou duas telas, uma por funil: `/formularios/crm` e
 * `/whatsapp/crm`. A rota fica de pé porque link antigo, favorito e
 * histórico do navegador continuam apontando para cá.
 *
 * O `?origem=` que era o filtro da tela vira o destino. Sem ele, vai
 * para Formulários: é de onde o quadro veio (`/formularios/kanban`), e é
 * para onde os links antigos foram feitos.
 */
export default async function PaginaCrmRedirecionada({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;

  const um = (chave: string) => {
    const v = busca[chave];
    return Array.isArray(v) ? v[0] : v;
  };

  const origem = um('origem');
  const secao = ehOrigem(origem) && origem === 'whatsapp' ? 'whatsapp' : 'formularios';

  const qs = new URLSearchParams();
  for (const chave of ['range', 'date_from', 'date_to', 'search', 'lead'] as const) {
    const valor = um(chave);
    if (valor) qs.set(chave, valor);
  }

  const destino = `/app/${encodeURIComponent(cliente)}/${secao}/crm`;
  redirect(qs.toString() ? `${destino}?${qs.toString()}` : destino);
}
