import { z } from 'zod';
import { rota, queryParams, entradaInvalida, naoEncontrado } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { buscaThread } from '@/lib/db/conversas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Conversa aberta — porte de `GET /painel-api/whatsapp-thread`.
 *
 * Como no painel antigo, abrir a conversa zera o contador de não lidas.
 * Por isso a rota é chamada também na atualização de 5 em 5 segundos:
 * enquanto a conversa está aberta, ela permanece lida.
 */

const Entrada = z.object({
  client_db: z.string().min(1),
  customer_id: z.coerce.number().int().positive(),
});

export const GET = rota(async (req) => {
  const analise = Entrada.safeParse(queryParams(req));
  if (!analise.success) throw entradaInvalida('Parâmetros inválidos', analise.error.flatten());
  const entrada = analise.data;

  const { db } = await requireClientAccess(entrada.client_db);
  const thread = await buscaThread(db, entrada.customer_id);
  if (!thread.lead) throw naoEncontrado('Lead não encontrado.');
  return thread;
});
