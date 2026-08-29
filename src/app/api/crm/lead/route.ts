import { z } from 'zod';
import { rota, queryParams, entradaInvalida, naoEncontrado } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { buscaLeadCrm } from '@/lib/db/crm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Detalhe do lead aberto no quadro do CRM.
 *
 * Carregado sob demanda, ao abrir o card: o quadro traz o funil inteiro,
 * e são seis consultas por lead (conversa, etapa do Kommo, prévia das
 * mensagens, etapas ativas, motivos de perda já usados e o click-id). Trazer isso junto com o quadro
 * multiplicaria por milhares de leads o custo de abrir, no máximo, um.
 */

const Entrada = z.object({
  client_db: z.string().min(1),
  customer_id: z.coerce.number().int().positive(),
});

export const GET = rota(async (req) => {
  const analise = Entrada.safeParse(queryParams(req));
  if (!analise.success) throw entradaInvalida('Parâmetros inválidos', analise.error.flatten());
  const { client_db, customer_id } = analise.data;

  const { db } = await requireClientAccess(client_db);
  const lead = await buscaLeadCrm(db, customer_id);
  if (!lead) throw naoEncontrado('Lead não encontrado neste cliente.');

  return { lead };
});
