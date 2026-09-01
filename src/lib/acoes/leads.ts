'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { apagaLead } from '@/lib/db/conversas';

/**
 * Exclusão definitiva de um lead.
 *
 * Fica em arquivo próprio, e não junto das ações de Conversas ou do CRM,
 * porque as duas telas chamam a mesma coisa: o lead é o mesmo registro
 * em `customers` venha ele de formulário ou de WhatsApp.
 *
 * Diferente de `acaoExcluirConversa`, que apaga só as mensagens e deixa
 * o contato de pé. Aqui sai tudo — mensagens, mídia, estado da conversa,
 * eventos enviados à Meta e o contato.
 *
 * O que isto NÃO faz, e é importante saber: não apaga nada do lado da
 * Meta. Os eventos que já foram enviados continuam lá, no Gerenciador de
 * Eventos, e as métricas de campanha (`meta_insights_daily`) não mudam,
 * porque são agregados da própria Meta e não têm lead nenhum dentro.
 * Some o lead do painel; não some a conversão que ele gerou lá fora.
 */

export type ResultadoAcao = { ok: true; sucesso: string } | { ok: false; erro: string };

const Schema = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  customer_id: z.coerce.number().int().positive(),
});

export async function acaoExcluirLead(entrada: z.input<typeof Schema>): Promise<ResultadoAcao> {
  const analise = Schema.safeParse(entrada);
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = analise.data;

  const { usuario, conta, db } = await requireClientAccess(dados.cliente);

  // A restrição é feita aqui, no servidor, e não escondendo o botão: uma
  // Server Action é um endpoint, e qualquer sessão autenticada consegue
  // chamá-la direto. Esconder o botão é conveniência de tela.
  if (usuario.papel !== 'admin') {
    return { ok: false, erro: 'Apenas administradores podem excluir leads.' };
  }

  let resultado: { mensagens: number; eventos: number; existia: boolean };
  try {
    resultado = await apagaLead(db, dados.customer_id);
  } catch (erro) {
    console.error('[leads] falha ao excluir lead:', erro);
    return { ok: false, erro: 'Não foi possível excluir o lead. Tente novamente.' };
  }

  if (!resultado.existia) {
    return { ok: false, erro: 'Lead não encontrado — pode já ter sido excluído.' };
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.LEAD_EXCLUIDO,
    clientDb: conta.client_db_name,
    detalhe: {
      customer_id: dados.customer_id,
      mensagens_apagadas: resultado.mensagens,
      eventos_apagados: resultado.eventos,
    },
  });

  const base = `/app/${encodeURIComponent(conta.client_db_name)}`;
  for (const rota of [
    '/whatsapp/conversas',
    '/whatsapp/crm',
    '/formularios/crm',
    '/formularios/kanban',
    '/visao-geral',
  ]) {
    revalidatePath(base + rota);
  }

  return {
    ok: true,
    sucesso:
      `Lead excluído: ${resultado.mensagens} ${resultado.mensagens === 1 ? 'mensagem' : 'mensagens'} ` +
      `e ${resultado.eventos} ${resultado.eventos === 1 ? 'evento' : 'eventos'} apagados.`,
  };
}
