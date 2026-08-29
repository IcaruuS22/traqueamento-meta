import { z } from 'zod';
import { rota, queryParams, entradaInvalida } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { paginaRastreamento } from '@/lib/db/rastreamento';
import { FONTES } from '@/lib/rastreamento';
import { resolvePeriodo } from '@/lib/periodo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Paginação da tabela de Rastreamento.
 *
 * Só a tabela: os cards de fonte cobrem o período inteiro e não mudam ao
 * carregar mais linhas — mesma divisão de "Últimos eventos".
 */

const Entrada = z.object({
  client_db: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
  range: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  fonte: z.enum(FONTES).optional(),
  search: z.string().max(120).optional(),
});

export const GET = rota(async (req) => {
  const analise = Entrada.safeParse(queryParams(req));
  if (!analise.success) throw entradaInvalida('Parâmetros inválidos', analise.error.flatten());
  const entrada = analise.data;

  const { db } = await requireClientAccess(entrada.client_db);
  const periodo = resolvePeriodo({
    range: entrada.range,
    date_from: entrada.date_from,
    date_to: entrada.date_to,
    channel: 'geral',
  });

  const leads = await paginaRastreamento(db, periodo, {
    fonte: entrada.fonte ?? null,
    search: entrada.search ?? null,
    limite: entrada.limit,
    offset: entrada.offset,
  });
  return { leads };
});
