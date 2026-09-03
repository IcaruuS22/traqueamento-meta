import type { Metadata } from 'next';
import { TelaCrm } from '@/components/tela-crm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'CRM (WhatsApp) | Trakeamento' };

/** Quadro dos contatos de WhatsApp. Corpo em `tela-crm.tsx`. */
export default async function PaginaCrmWhatsapp({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;
  return <TelaCrm cliente={cliente} origem="whatsapp" searchParams={busca} />;
}
