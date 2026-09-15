import type { Metadata } from 'next';
import { TelaPaginas } from '@/components/tela-paginas';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Métricas (Página de vendas) | Trakeamento' };

/**
 * Funil das páginas de vendas do cliente: visita, lead de formulário,
 * checkout e compra, com a origem de cada um.
 *
 * O cadastro dos sites (tag e webhooks) fica em Página de vendas ›
 * Configuração, só para o administrador; aqui é só leitura.
 */
export default async function PaginaPaginasDeVendas({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;
  return <TelaPaginas cliente={cliente} busca={busca} secao="metricas" />;
}
