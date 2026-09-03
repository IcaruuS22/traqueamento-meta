import type { Metadata } from 'next';
import { TelaEventos } from '@/components/tela-eventos';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Últimos eventos (Formulários) | Trakeamento' };

/**
 * Envios à Meta CAPI dos leads de Formulário Instantâneo.
 *
 * O canal vem da rota, como no resto do app: `meta_capi_events` não tem
 * coluna de canal, e o que separa os dois é a existência (ou não) de
 * conversa de WhatsApp para aquele lead.
 */
export default async function PaginaEventosFormularios({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;
  return <TelaEventos cliente={cliente} canal="form" busca={busca} />;
}
