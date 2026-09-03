'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { apagaLead } from '@/lib/db/conversas';
import { buscaLeadExistente, insereLeadDeFormulario } from '@/lib/db/crm';
import { buscaLeadNaMeta } from '@/lib/meta-leads';
import { buscaNegocioNoKommo } from '@/lib/kommo';
import type { EstadoFormulario } from '@/lib/auth/actions';

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
    return { ok: false, erro: 'Lead não encontrado. Pode já ter sido excluído.' };
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

/**
 * Inclusão manual de um lead de Formulário Instantâneo.
 *
 * Existe para o buraco que as automações não cobrem: lead que entrou
 * antes de elas existirem, ou dia em que o webhook do Kommo falhou. O
 * caminho normal continua sendo o n8n — este botão é conserto, não
 * cadastro.
 *
 * A pessoa informa dois IDs e nada mais. Nome, telefone, campanha e
 * anúncio vêm da Meta; etapa e valor vêm do Kommo. Isso não é conforto:
 * foi digitando `current_stage` à mão que um lead foi parar numa coluna
 * inventada, porque o valor certo ali é um `status_id` que ninguém
 * decora.
 *
 * O que esta ação NÃO faz, e não deve passar a fazer sem decisão
 * explícita: não envia evento à Meta e não escreve no Kommo. O lead
 * aparece no painel e conta como conversão se a etapa dele for de
 * conversão; a receita continua saindo dos eventos que os workflows
 * realmente enviaram.
 */

const adicionarSchema = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  leadgen_id: z
    .string()
    .trim()
    .min(1, 'Informe o leadgen_id do lead na Meta')
    .regex(/^\d+$/, 'O leadgen_id tem só números'),
  crm_lead_id: z
    .string()
    .trim()
    .min(1, 'Informe o ID do lead no Kommo')
    .regex(/^\d+$/, 'O ID do lead no Kommo tem só números'),
});

export async function acaoAdicionarLead(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const analise = adicionarSchema.safeParse({
    cliente: form.get('cliente'),
    leadgen_id: form.get('leadgen_id'),
    crm_lead_id: form.get('crm_lead_id'),
  });
  if (!analise.success) {
    return { erro: analise.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = analise.data;

  const { usuario, conta, db } = await requireClientAccess(dados.cliente);

  // Mesma régua do excluir: Server Action é endpoint, e esconder o botão
  // no cliente não impede ninguém de chamá-la.
  if (usuario.papel !== 'admin') {
    return { erro: 'Apenas administradores podem adicionar leads.' };
  }

  const jaExiste = await buscaLeadExistente(db, dados.crm_lead_id, dados.leadgen_id);
  if (jaExiste) {
    return { erro: `Esse lead já está no painel (id ${jaExiste.id}).` };
  }

  const naMeta = await buscaLeadNaMeta(conta.client_db_name, dados.leadgen_id);
  if (!naMeta.ok) return { erro: naMeta.erro };

  // O Kommo é opcional de propósito: cliente sem token ou sem subdomínio
  // cadastrado ainda consegue trazer o lead, só que sem etapa. Erro de
  // verdade do Kommo (token vencido, negócio inexistente) para a ação —
  // seguir ali daria um lead mudo em coluna nenhuma sem ninguém saber.
  const noKommo = await buscaNegocioNoKommo(conta.client_db_name, dados.crm_lead_id);
  if (!noKommo.ok && !noKommo.semConfiguracao) return { erro: noKommo.erro };
  const negocio = noKommo.ok ? noKommo.negocio : null;

  let customerId: number;
  try {
    customerId = await insereLeadDeFormulario(db, {
      ad_account_id: conta.ad_account_id,
      crm_lead_id: dados.crm_lead_id,
      meta_lead_id: naMeta.lead.meta_lead_id,
      current_stage: negocio?.status_id ?? null,
      crm_value: negocio?.price ?? null,
      created_at: naMeta.lead.created_time,
      first_name: naMeta.lead.first_name,
      last_name: naMeta.lead.last_name,
      email: naMeta.lead.email,
      phone: naMeta.lead.phone,
      city: naMeta.lead.city,
      state: naMeta.lead.state,
      zipcode: naMeta.lead.zipcode,
      meta_ad_id: naMeta.lead.meta_ad_id,
      meta_ad_name: naMeta.lead.meta_ad_name,
      meta_adset_id: naMeta.lead.meta_adset_id,
      meta_adset_name: naMeta.lead.meta_adset_name,
      meta_campaign_id: naMeta.lead.meta_campaign_id,
      meta_campaign_name: naMeta.lead.meta_campaign_name,
      meta_form_id: naMeta.lead.meta_form_id,
    });
  } catch (erro) {
    console.error('[leads] falha ao adicionar lead:', erro);
    return { erro: 'Não foi possível gravar o lead. Tente novamente.' };
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.LEAD_ADICIONADO,
    clientDb: conta.client_db_name,
    detalhe: {
      customer_id: customerId,
      leadgen_id: dados.leadgen_id,
      crm_lead_id: dados.crm_lead_id,
      current_stage: negocio?.status_id ?? null,
      origem: 'inclusao_manual',
    },
  });

  const base = `/app/${encodeURIComponent(conta.client_db_name)}`;
  for (const rota of ['/formularios/crm', '/formularios/kanban', '/visao-geral', '/rastreamento']) {
    revalidatePath(base + rota);
  }

  const nome = [naMeta.lead.first_name, naMeta.lead.last_name].filter(Boolean).join(' ') || 'Lead';
  const semEtapa = negocio
    ? ''
    : ' Ele entrou sem etapa porque o Kommo deste cliente não está configurado no painel.';
  const foraDoPeriodo = naMeta.lead.created_time
    ? ` A data de entrada é a da Meta (${naMeta.lead.created_time.slice(0, 10)}), então ajuste o período para vê-lo.`
    : '';

  return { sucesso: `${nome} foi adicionado.${semEtapa}${foraDoPeriodo}` };
}
