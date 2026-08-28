import { z } from 'zod';
import { rota, queryParams, entradaInvalida } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { buscaHierarquia } from '@/lib/db/campanhas';
import { resolvePeriodo } from '@/lib/periodo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Filhos de um nível da hierarquia de campanhas.
 *
 * Esta é uma das poucas rotas `/api` do app: as telas de leitura consultam
 * o MySQL direto no Server Component, mas aqui o navegador precisa chamar
 * sozinho — os conjuntos de uma campanha só são carregados quando alguém
 * expande a linha, e carregar os três níveis de antemão significaria dezenas
 * de consultas por render para dados que quase nunca são abertos.
 *
 * O nível raiz (campanhas) não passa por aqui: ele já vem renderizado com a
 * página.
 */

const Entrada = z.object({
  client_db: z.string().min(1),
  nivel: z.enum(['adset', 'ad']),
  pai: z.string().min(1),
  range: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
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

  return buscaHierarquia(db, entrada.nivel, periodo, entrada.pai);
});
