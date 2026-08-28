'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { conflitoDeAdAccount, criaAdAccount } from '@/lib/db/cliente';
import { criaBancoDoCliente } from '@/lib/db/provisiona';
import { geraNomeBanco } from '@/lib/nomes-banco';
import type { EstadoFormulario } from '@/lib/auth/actions';

/**
 * Cadastro de cliente novo — porte do formulário `novo-cliente-form.html`
 * mais o workflow "Cria Cliente - Formulário".
 *
 * O que mudou em relação ao fluxo antigo, de propósito:
 *
 *  - o formulário antigo exigia CRM (Kommo) e ao menos um mapeamento de
 *    evento no próprio cadastro. Cliente que só usa WhatsApp não tem
 *    conta de CRM, e os mapeamentos hoje têm tela própria ("Configuração
 *    de eventos"), com edição e exclusão. Exigir os dois na criação
 *    obrigava a inventar dado para poder cadastrar;
 *  - o disparo ficava aberto na internet, com o formulário HTML chamando
 *    o webhook direto. Aqui é Server Action atrás de `requireAdmin()`.
 */

const schema = z.object({
  account_name: z.string().trim().min(2, 'Nome do cliente é obrigatório').max(255),
  ad_account_id: z
    .string()
    .trim()
    .min(1, 'ID da conta de anúncios é obrigatório')
    .max(255)
    .transform((v) => v.replace(/^act_/i, '')),
  meta_pixel_dataset_id: z.string().trim().min(1, 'ID do pixel/dataset é obrigatório').max(255),
  meta_access_token: z.string().trim().min(20, 'Token da Meta parece curto demais').max(512),
  crm_account_id: z.string().trim().max(255).optional(),
  kommo_access_token: z.string().trim().max(4000).optional(),
  content_category: z.string().trim().max(255).optional(),
});

export async function acaoCriarCliente(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const admin = await requireAdmin();

  const parsed = schema.safeParse({
    account_name: form.get('account_name'),
    ad_account_id: form.get('ad_account_id'),
    meta_pixel_dataset_id: form.get('meta_pixel_dataset_id'),
    meta_access_token: form.get('meta_access_token'),
    crm_account_id: form.get('crm_account_id') || undefined,
    kommo_access_token: form.get('kommo_access_token') || undefined,
    content_category: form.get('content_category') || undefined,
  });
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = parsed.data;

  const clientDb = geraNomeBanco(dados.account_name, dados.crm_account_id ?? null);
  const crmAccountId = dados.crm_account_id ?? null;

  const conflito = await conflitoDeAdAccount({
    ad_account_id: dados.ad_account_id,
    crm_account_id: crmAccountId,
    client_db_name: clientDb,
  });
  if (conflito) return { erro: conflito };

  // Dois passos, sem transação possível entre eles: DDL faz commit
  // implícito. Se o segundo falhar, o banco fica criado e vazio — repetir
  // o cadastro com os mesmos dados o reaproveita, então a mensagem de
  // erro precisa dizer em qual passo parou, e não só "deu erro".
  try {
    await criaBancoDoCliente(clientDb);
  } catch (erro) {
    console.error('[clientes] falha ao criar o banco', clientDb, erro);
    await registraAuditoria({
      userId: admin.id,
      userEmail: admin.email,
      acao: ACOES.CLIENTE_CRIADO,
      clientDb,
      detalhe: { passo: 'banco', ok: false },
    });
    return {
      erro:
        `Não foi possível criar o banco \`${clientDb}\`. O cliente NÃO foi cadastrado; ` +
        'confira o log do servidor e tente de novo com os mesmos dados.',
    };
  }

  try {
    await criaAdAccount({
      account_name: dados.account_name,
      ad_account_id: dados.ad_account_id,
      crm_account_id: crmAccountId,
      meta_pixel_dataset_id: dados.meta_pixel_dataset_id,
      meta_access_token: dados.meta_access_token,
      kommo_access_token: dados.kommo_access_token ?? null,
      content_category: dados.content_category ?? null,
      client_db_name: clientDb,
    });
  } catch (erro) {
    console.error('[clientes] banco criado mas catálogo não registrou', clientDb, erro);
    await registraAuditoria({
      userId: admin.id,
      userEmail: admin.email,
      acao: ACOES.CLIENTE_CRIADO,
      clientDb,
      detalhe: { passo: 'catalogo', ok: false },
    });
    return {
      erro:
        `O banco \`${clientDb}\` foi criado, mas o registro em ad_accounts falhou. ` +
        'Repetir o cadastro com os mesmos dados reaproveita o banco já criado.',
    };
  }

  // O token da Meta fica de fora do detalhe da auditoria de propósito:
  // o log é lido por gente, e credencial de terceiro não entra nele.
  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.CLIENTE_CRIADO,
    clientDb,
    detalhe: {
      passo: 'concluido',
      ok: true,
      account_name: dados.account_name,
      ad_account_id: dados.ad_account_id,
      com_crm: Boolean(crmAccountId),
    },
  });

  revalidatePath('/app');
  return {
    sucesso:
      `Cliente "${dados.account_name}" criado. Banco: ${clientDb}. ` +
      'Configure os eventos e a conexão do WhatsApp pela tela do cliente.',
  };
}
