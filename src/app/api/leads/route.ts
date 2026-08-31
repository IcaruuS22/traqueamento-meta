import { z } from 'zod';
import { rota, queryParams, entradaInvalida } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { filtroLeads, ultimosLeads } from '@/lib/db/metricas';
import { resolvePeriodo } from '@/lib/periodo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Paginação de "Últimos leads" — porte de `GET /painel-api/leads`.
 *
 * A primeira página já vem renderizada com a Visão geral; esta rota
 * existe só para o "Carregar mais", que o navegador chama sozinho.
 *
 * `limit` é limitado a 50 e `offset` a um inteiro não negativo, como no
 * endpoint original — sem teto, uma URL forjada pediria a tabela inteira
 * numa consulta só.
 */

const Entrada = z.object({
  client_db: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).default(0),
  range: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  channel: z.string().optional(),
  /** Etapa escolhida no filtro da tabela. */
  stage: z.string().max(255).optional(),
  /** Busca por nome. O teto evita um LIKE gigante vindo de URL forjada. */
  nome: z.string().max(120).optional(),
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
    channel: entrada.channel,
  });

  const leads = await ultimosLeads(
    db,
    filtroLeads(db, periodo),
    entrada.limit,
    entrada.offset,
    { etapa: entrada.stage, nome: entrada.nome },
  );
  return { leads };
});
