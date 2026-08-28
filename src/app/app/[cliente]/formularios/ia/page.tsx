import type { Metadata } from 'next';
import { TelaIa } from '@/components/tela-ia';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Análise por IA (Formulários) — Trakeamento' };

export default async function PaginaIaFormularios({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;
  return <TelaIa cliente={cliente} canal="form" busca={busca} />;
}
