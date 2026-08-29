'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { buscaMapeamentoEstagio, buscaTelefone } from '@/lib/db/conversas';
import { etapaWhatsappAtiva, moveEtapaWhatsapp, salvaDadosLeadCrm } from '@/lib/db/crm';
import { enviaEventoEstagio } from '@/lib/meta-capi';
import { ehEtapaDePerda, normalizaMotivo, TAMANHO_MOTIVO } from '@/lib/funil';

/**
 * Ações do CRM unificado.
 *
 * Mover card e salvar dados são duas ações separadas porque têm efeitos
 * diferentes: mover pode disparar evento para a Meta, salvar nunca
 * dispara. Juntar as duas faria um simples ajuste de e-mail correr o
 * risco de mandar conversão.
 *
 * A etapa de destino é conferida no servidor contra o cadastro do
 * cliente (`whatsapp_event_map`), e não contra a lista que a tela
 * mandou: Server Action é endpoint, e a lista da tela pode estar velha
 * ou nem ser a nossa tela.
 */

export type ResultadoAcao = { ok: true; sucesso: string } | { ok: false; erro: string };

const SchemaMover = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  customer_id: z.coerce.number().int().positive(),
  etapa: z.string().trim().min(1, 'Etapa não informada').max(60),
  /** Só é gravado quando a etapa de destino é a de perda. */
  motivo_perda: z.string().max(TAMANHO_MOTIVO).optional(),
});

export async function acaoMoverLeadCrm(
  entrada: z.input<typeof SchemaMover>,
): Promise<ResultadoAcao> {
  const analise = SchemaMover.safeParse(entrada);
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = analise.data;

  const { usuario, conta, db } = await requireClientAccess(dados.cliente);

  if (!(await etapaWhatsappAtiva(db, dados.etapa))) {
    return {
      ok: false,
      erro: 'Etapa não está cadastrada como ativa no funil de WhatsApp deste cliente.',
    };
  }

  const perda = ehEtapaDePerda(dados.etapa);
  const motivo = perda ? normalizaMotivo(dados.motivo_perda) : null;

  let statusAnterior: string | null;
  let motivoGravado = false;
  try {
    ({ status_anterior: statusAnterior, motivo_gravado: motivoGravado } =
      await moveEtapaWhatsapp(db, dados.customer_id, dados.etapa, motivo));
  } catch (erro) {
    console.error('[crm] falha ao mover lead:', erro);
    return { ok: false, erro: 'Não foi possível mover o lead. Tente novamente.' };
  }

  // Mesma regra da tela de Conversas: evento só quando a etapa mudou de
  // fato e existe mapeamento ativo para a nova. Falha no envio não
  // desfaz a movimentação — o card já está na coluna certa.
  let capi: string | null = null;
  if ((statusAnterior ?? '') !== dados.etapa) {
    try {
      const mapa = await buscaMapeamentoEstagio(db, dados.etapa);
      if (mapa?.meta_event) {
        const phone = await buscaTelefone(db, dados.customer_id);
        const r = await enviaEventoEstagio(conta.client_db_name, db, {
          customerId: dados.customer_id,
          phone,
          estagio: dados.etapa,
          meta_event: mapa.meta_event,
          content_name: mapa.content_name,
          currency: mapa.currency,
          value: mapa.value,
        });
        capi = r.enviado ? `enviado (${mapa.meta_event})` : `não enviado: ${r.motivo}`;
      }
    } catch (erro) {
      console.error('[crm] falha no disparo do evento de estágio:', erro);
      capi = 'não enviado: erro inesperado';
    }
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.CRM_LEAD_MOVIDO,
    clientDb: conta.client_db_name,
    detalhe: {
      customer_id: dados.customer_id,
      etapa: dados.etapa,
      etapa_anterior: statusAnterior,
      motivo_perda: motivo,
      capi,
    },
  });

  const base = `/app/${encodeURIComponent(conta.client_db_name)}`;
  revalidatePath(`${base}/crm`);
  revalidatePath(`${base}/funil`);
  revalidatePath(`${base}/whatsapp/conversas`);

  const mensagem = capi ? `Lead movido · evento ${capi}.` : 'Lead movido.';
  // Motivo pedido mas não gravado é falta da migração das colunas de
  // perda naquele banco; dizer isso aqui é melhor do que o motivo sumir
  // sem explicação e o relatório do funil parecer incompleto.
  const aviso =
    motivo && !motivoGravado
      ? ' O motivo não foi gravado: o banco deste cliente ainda não rodou a migração de motivo de perda.'
      : '';

  return { ok: true, sucesso: mensagem + aviso };
}

const SchemaSalvar = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  customer_id: z.coerce.number().int().positive(),
  first_name: z.string().trim().max(120).optional(),
  last_name: z.string().trim().max(120).optional(),
  email: z.string().trim().max(190).optional(),
  notes: z.string().max(10_000).optional(),
  tags: z.string().trim().max(500).optional(),
  /** Lead que já tem conversa: notas e tags podem ser gravadas. */
  tem_conversa: z.boolean().optional(),
});

export async function acaoSalvarLeadCrm(
  entrada: z.input<typeof SchemaSalvar>,
): Promise<ResultadoAcao> {
  const analise = SchemaSalvar.safeParse(entrada);
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = analise.data;

  const { usuario, conta, db } = await requireClientAccess(dados.cliente);

  const notes = dados.notes?.trim() || null;
  const tags = dados.tags || null;

  try {
    await salvaDadosLeadCrm(db, {
      customerId: dados.customer_id,
      first_name: dados.first_name || null,
      last_name: dados.last_name || null,
      email: dados.email || null,
      notes,
      tags,
      gravaConversa: Boolean(dados.tem_conversa) || notes !== null || tags !== null,
    });
  } catch (erro) {
    console.error('[crm] falha ao salvar lead:', erro);
    return { ok: false, erro: 'Não foi possível salvar os dados do lead. Tente novamente.' };
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.CRM_LEAD_SALVO,
    clientDb: conta.client_db_name,
    // Notas são conteúdo do lead e já estão na tabela do cliente;
    // repetir aqui só espalharia dado pessoal por mais um lugar.
    detalhe: { customer_id: dados.customer_id, com_notas: notes !== null },
  });

  const base = `/app/${encodeURIComponent(conta.client_db_name)}`;
  revalidatePath(`${base}/crm`);
  revalidatePath(`${base}/funil`);
  revalidatePath(`${base}/whatsapp/conversas`);

  return { ok: true, sucesso: 'Dados do lead salvos.' };
}
