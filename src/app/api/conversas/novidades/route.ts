import { z } from 'zod';
import { rota, queryParams, entradaInvalida } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { cursorConversas } from '@/lib/db/conversas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Espera longa ("long polling") das Conversas.
 *
 * A tela manda o cursor que já tem e a resposta só volta quando o cursor
 * do banco fica diferente — ou quando a espera estoura. É o que troca os
 * antigos 5 a 10 segundos de atraso por algo próximo de tempo real sem
 * infraestrutura nova: quem escreve as mensagens é o n8n, em outro
 * processo, então não há evento em memória para empurrar daqui, e um
 * canal de push na Vercel exigiria pub/sub externo mais uma conexão viva.
 *
 * A checagem é a consulta agregada de `cursorConversas`, não a lista
 * inteira; a lista só é buscada pela tela depois que o cursor muda.
 *
 * `maxDuration` é 30s e a espera é menor de propósito: a resposta precisa
 * sair antes de a plataforma cortar a função, senão a tela veria erro de
 * rede a cada ciclo.
 */

const ESPERA_MAXIMA_MS = 20_000;
const INTERVALO_CHECAGEM_MS = 1_000;

const Entrada = z.object({
  client_db: z.string().min(1),
  cursor: z.string().max(200).optional(),
  customer_id: z.coerce.number().int().positive().optional(),
});

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const GET = rota(async (req) => {
  const analise = Entrada.safeParse(queryParams(req));
  if (!analise.success) throw entradaInvalida('Parâmetros inválidos', analise.error.flatten());
  const entrada = analise.data;

  const { db } = await requireClientAccess(entrada.client_db);
  const limite = Date.now() + ESPERA_MAXIMA_MS;

  let cursor = await cursorConversas(db, entrada.customer_id);
  // Sem cursor anterior (primeira chamada da tela) a resposta é imediata:
  // é só a tela pegando o ponto de partida.
  if (entrada.cursor === undefined) return { cursor, mudou: false };

  while (cursor === entrada.cursor && Date.now() < limite) {
    // A aba fechada ou a conversa trocada abortam o fetch; sem esta
    // saída a função seguiria consultando o banco por mais 20s à toa.
    if (req.signal.aborted) return { cursor, mudou: false };
    await espera(INTERVALO_CHECAGEM_MS);
    cursor = await cursorConversas(db, entrada.customer_id);
  }

  return { cursor, mudou: cursor !== entrada.cursor };
});
