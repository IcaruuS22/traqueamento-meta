import type { Metadata } from 'next';
import { TelaPaginas } from '@/components/tela-paginas';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Últimos eventos (Página de vendas) | Trakeamento' };

/**
 * Leads, checkouts e compras mais recentes das páginas de vendas, com o
 * status do envio à Meta pela Conversions API.
 */
export default async function PaginaEventosPaginas({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;
  return <TelaPaginas cliente={cliente} busca={busca} secao="eventos" />;
}
