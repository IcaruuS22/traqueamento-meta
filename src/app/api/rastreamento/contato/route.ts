import { z } from 'zod';
import { rota, queryParams, entradaInvalida, naoEncontrado } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { buscaRastreioContato } from '@/lib/db/rastreamento';
import { buscaConfigWhatsapp } from '@/lib/db/whatsapp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Detalhe do modal "Rastreio do contato".
 *
 * Carregado sob demanda, ao abrir o modal: são três consultas por lead
 * (dados + referência da conversa + conversões enviadas) e a tabela lista
 * 30 por página — trazer tudo junto seria 90 consultas para o usuário
 * abrir, no máximo, uma.
 *
 * `waba_id` e o provedor vêm da conta de WhatsApp do cliente, não do
 * lead: são a mesma conta para todas as conversas. Só esses dois campos
 * saem daqui — token de acesso nunca chega ao navegador.
 */

const Entrada = z.object({
  client_db: z.string().min(1),
  customer_id: z.coerce.number().int().positive(),
});

export const GET = rota(async (req) => {
  const analise = Entrada.safeParse(queryParams(req));
  if (!analise.success) throw entradaInvalida('Parâmetros inválidos', analise.error.flatten());
  const { client_db, customer_id } = analise.data;

  const { db, conta } = await requireClientAccess(client_db);
  const contato = await buscaRastreioContato(db, customer_id);
  if (!contato) throw naoEncontrado('Lead não encontrado neste cliente.');

  // A conta pode nem estar configurada — nesse caso o modal simplesmente
  // não mostra a linha do WABA, em vez de falhar.
  const whatsapp = await buscaConfigWhatsapp(conta.client_db_name).catch(() => null);

  return {
    contato,
    conta: {
      waba_id: whatsapp?.cloud_waba_id ?? null,
      phone_number_id: whatsapp?.cloud_phone_number_id ?? null,
      provider: whatsapp?.provider ?? null,
    },
  };
});
