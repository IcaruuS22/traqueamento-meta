import { z } from 'zod';
import { rota, queryParams, entradaInvalida } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { paginaEventos } from '@/lib/db/eventos';
import { resolvePeriodo } from '@/lib/periodo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Paginação de "Últimos eventos" — porte de `GET /painel-api/eventos-recentes`.
 *
 * Só a tabela: os cards e o gráfico da tela cobrem o período inteiro e não
 * mudam ao carregar mais linhas, então não há por que recalculá-los aqui.
 *
 * `status` é validado contra a mesma whitelist do endpoint original — um
 * valor livre viraria filtro que nunca casa e uma tabela vazia sem
 * explicação.
 */

const STATUS = ['PENDING', 'SENT', 'ERROR', 'DUPLICATE'] as const;

const Entrada = z.object({
  client_db: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
  range: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  channel: z.string().optional(),
  status: z.enum(STATUS).optional(),
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
    channel: entrada.channel,
  });

  const eventos = await paginaEventos(db, periodo, {
    status: entrada.status ?? null,
    search: entrada.search ?? null,
    limite: entrada.limit,
    offset: entrada.offset,
  });
  return { eventos };
});
