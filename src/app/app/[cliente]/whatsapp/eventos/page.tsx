import type { Metadata } from 'next';
import { TelaEventos } from '@/components/tela-eventos';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Últimos eventos (WhatsApp) | Trakeamento' };

/**
 * Mesma tela de eventos, recortada para os leads que têm conversa de
 * WhatsApp. Hoje nenhum cliente em produção tem conversas gravadas, então
 * esta tela aparece vazia — o que é o resultado correto, não uma falha.
 */
export default async function PaginaEventosWhatsapp({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;
  return <TelaEventos cliente={cliente} canal="whatsapp" busca={busca} />;
}
