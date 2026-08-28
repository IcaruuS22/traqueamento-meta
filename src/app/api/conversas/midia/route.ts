import { z } from 'zod';
import { rota, queryParams, entradaInvalida, naoEncontrado } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { buscaMidia } from '@/lib/db/conversas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Arquivo de uma mensagem (imagem, áudio, vídeo, documento).
 *
 * É o `src` das bolhas da tela de Conversas, então passa pelo mesmo
 * `requireClientAccess` das outras rotas: o anexo é conteúdo do cliente
 * como qualquer outro, e uma rota pública com o id na URL entregaria
 * conversa de lead a quem chutasse números.
 *
 * `Cache-Control: private` porque o navegador pode guardar (a mesma
 * imagem é pedida a cada atualização da thread, de 5 em 5 segundos), mas
 * nenhum proxy no caminho pode.
 */

const Entrada = z.object({
  client_db: z.string().min(1),
  customer_id: z.coerce.number().int().positive(),
  message_id: z.coerce.number().int().positive(),
  /** `1` troca a exibição na página por download. */
  baixar: z.coerce.number().int().optional(),
});

export const GET = rota(async (req) => {
  const analise = Entrada.safeParse(queryParams(req));
  if (!analise.success) throw entradaInvalida('Parâmetros inválidos', analise.error.flatten());
  const entrada = analise.data;

  const { db } = await requireClientAccess(entrada.client_db);
  const midia = await buscaMidia(db, entrada.customer_id, entrada.message_id);
  if (!midia) throw naoEncontrado('Arquivo não encontrado.');

  // `filename` só com o que não quebra o cabeçalho: o nome vem do
  // WhatsApp, ou seja, de fora.
  const nome = (midia.nome ?? '').replace(/[^\w.\- ]+/g, '').slice(0, 120);
  const disposicao = entrada.baixar === 1 ? 'attachment' : 'inline';

  return new Response(new Uint8Array(midia.bytes), {
    headers: {
      'Content-Type': midia.mime_type || 'application/octet-stream',
      'Content-Length': String(midia.bytes.length),
      'Content-Disposition': nome ? `${disposicao}; filename="${nome}"` : disposicao,
      'Cache-Control': 'private, max-age=86400',
    },
  });
});
