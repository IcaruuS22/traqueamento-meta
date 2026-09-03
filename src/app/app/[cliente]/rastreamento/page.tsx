import type { Metadata } from 'next';
import { TelaRastreamento } from '@/components/tela-rastreamento';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Rastreamento | Trakeamento' };

/**
 * Origem dos leads do cliente, com o detalhe por contato.
 *
 * Fica na seção "Geral" da navegação, e não dentro de Formulários ou
 * WhatsApp: a tela existe justamente para comparar as duas entradas — e
 * mostrar o que entrou sem nenhuma delas.
 */
export default async function PaginaRastreamento({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;
  return <TelaRastreamento cliente={cliente} busca={busca} />;
}
