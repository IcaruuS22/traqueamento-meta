import { z } from 'zod';
import { rota, queryParams, entradaInvalida } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { listaConversas } from '@/lib/db/conversas';
import { FAIXA_PADRAO, ehFaixa } from '@/lib/whatsapp-conversas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Lista de conversas — porte de `GET /painel-api/whatsapp-conversas`.
 *
 * A primeira carga vem renderizada com a página; esta rota serve a
 * atualização periódica da coluna da esquerda e as trocas de filtro.
 *
 * O filtro é por faixa do funil (`aberto`, `ganho`, `perdido`), não por
 * estágio: os estágios são cadastrados pelo cliente em
 * `whatsapp_event_map` e mudam sem aviso (ver `lib/db/conversas.ts`).
 */

const Entrada = z.object({
  client_db: z.string().min(1),
  faixa: z.string().trim().max(20).optional(),
  busca: z.string().trim().max(120).optional(),
});

export const GET = rota(async (req) => {
  const analise = Entrada.safeParse(queryParams(req));
  if (!analise.success) throw entradaInvalida('Parâmetros inválidos', analise.error.flatten());
  const entrada = analise.data;

  const { db } = await requireClientAccess(entrada.client_db);
  return listaConversas(db, {
    faixa: ehFaixa(entrada.faixa) ? entrada.faixa : FAIXA_PADRAO,
    busca: entrada.busca,
  });
});
