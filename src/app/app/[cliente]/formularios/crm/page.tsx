import type { Metadata } from 'next';
import { TelaCrm } from '@/components/tela-crm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'CRM (Formulários) — Trakeamento' };

/** Quadro dos leads de Formulário Instantâneo. Corpo em `tela-crm.tsx`. */
export default async function PaginaCrmFormularios({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;
  return <TelaCrm cliente={cliente} origem="form" searchParams={busca} />;
}
