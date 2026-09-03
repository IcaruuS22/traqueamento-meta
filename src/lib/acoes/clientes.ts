'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import {
  buscaAdAccount,
  conflitoDeAdAccount,
  criaAdAccount,
  removeAdAccount,
  salvaCampoValorCrm,
} from '@/lib/db/cliente';
import { apagaBancoDoCliente, criaBancoDoCliente } from '@/lib/db/provisiona';
import { salvaInvestimentoMensal } from '@/lib/db/orcamento';
import { lacunaDeEsquema } from '@/lib/db/pool';
import { confirmacaoDeExclusaoBate, geraNomeBanco } from '@/lib/nomes-banco';
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


/**
 * Exclusão de cliente. Definitiva, sem lixeira e sem desfazer.
 *
 * Some tudo do cliente de uma vez: o banco `cliente_*` inteiro (leads,
 * conversas, mensagens, campanhas, eventos, mapeamentos) e o registro no
 * catálogo central, com os vínculos de usuário, a conexão de WhatsApp e
 * as preferências de métrica. Não existe backup automático — quem quiser
 * guardar precisa ter feito o dump antes.
 *
 * Por isso o campo de confirmação: o administrador digita o nome do
 * cliente, e nada acontece enquanto o texto não bater. Clique errado não
 * apaga cliente nenhum.
 *
 * A ordem é a inversa da criação, pelo mesmo motivo dela: catálogo
 * primeiro, banco depois. Linha no catálogo apontando para um banco que
 * não existe mais quebraria todas as telas daquele cliente; banco órfão,
 * sem linha no catálogo, é inerte — nenhuma tela chega nele, e ele pode
 * ser apagado à mão depois.
 */
const schemaExclusao = z.object({
  client_db: z.string().trim().min(1, 'Cliente não informado').max(64),
  confirmacao: z.string().trim().max(255),
});

export async function acaoExcluirCliente(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const admin = await requireAdmin();

  const parsed = schemaExclusao.safeParse({
    client_db: form.get('client_db'),
    confirmacao: form.get('confirmacao'),
  });
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };

  // O nome do banco usado daqui em diante é o do catálogo, nunca o que
  // veio do formulário — mesma regra do guard de cliente.
  const conta = await buscaAdAccount(parsed.data.client_db);
  if (!conta) return { erro: 'Cliente não encontrado no catálogo.' };

  if (!confirmacaoDeExclusaoBate(parsed.data.confirmacao, [conta.account_name, conta.client_db_name])) {
    return {
      erro: `A confirmação não bate. Digite exatamente "${conta.account_name}" para excluir: nada foi apagado.`,
    };
  }

  let removidos: { vinculos: number; preferencias: number; whatsapp: number };
  try {
    removidos = await removeAdAccount(conta.client_db_name);
  } catch (erro) {
    console.error('[clientes] falha ao remover do catálogo', conta.client_db_name, erro);
    return {
      erro:
        'Não foi possível remover o cliente do catálogo. Nada foi apagado. ' +
        'confira o log do servidor e tente de novo.',
    };
  }

  // Daqui em diante o cliente já sumiu do painel. Se o DROP falhar, o
  // que resta é um banco órfão ocupando disco: é aviso, não erro.
  let bancoApagado = true;
  let aviso = '';
  try {
    await apagaBancoDoCliente(conta.client_db_name);
  } catch (erro) {
    console.error('[clientes] catálogo limpo mas o DROP DATABASE falhou', conta.client_db_name, erro);
    bancoApagado = false;
    aviso =
      ` Atenção: o banco \`${conta.client_db_name}\` continua no servidor: ` +
      'o cliente já saiu do painel, mas os dados só somem com um DROP DATABASE manual.';
  }

  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.CLIENTE_EXCLUIDO,
    clientDb: conta.client_db_name,
    detalhe: {
      account_name: conta.account_name,
      ad_account_id: conta.ad_account_id,
      banco_apagado: bancoApagado,
      vinculos_removidos: removidos.vinculos,
      whatsapp_removido: removidos.whatsapp > 0,
    },
  });

  revalidatePath('/app');
  revalidatePath('/admin/clientes');
  return {
    sucesso:
      `Cliente "${conta.account_name}" excluído em definitivo.` +
      (removidos.vinculos > 0
        ? ` ${removidos.vinculos} ${removidos.vinculos === 1 ? 'usuário perdeu o vínculo' : 'usuários perderam o vínculo'}.`
        : '') +
      aviso,
  };
}

/**
 * Investimento (budget) mensal combinado com o cliente.
 *
 * Fica com o administrador, e não na tela de métricas do cliente, porque
 * é dado comercial: quem olha o painel precisa ver o teto e o ritmo, mas
 * mudar o teto é decisão de contrato. Campo vazio limpa o valor — cliente
 * sem investimento combinado volta ao indicador neutro.
 */
const schemaInvestimento = z.object({
  client_db: z.string().trim().min(1).max(64),
  monthly_fee: z
    .string()
    .trim()
    .max(20)
    // Aceita "3.500,00" e "3500.00": o campo é digitado por pessoa, e o
    // separador varia com o teclado e com o hábito de quem digita.
    .transform((v) => v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')),
});

export async function acaoSalvarInvestimentoMensal(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const admin = await requireAdmin();

  const parsed = schemaInvestimento.safeParse({
    client_db: form.get('client_db'),
    monthly_fee: form.get('monthly_fee') ?? '',
  });
  if (!parsed.success) return { erro: 'Dados inválidos' };

  const conta = await buscaAdAccount(parsed.data.client_db);
  if (!conta) return { erro: 'Cliente não encontrado no catálogo.' };

  const bruto = parsed.data.monthly_fee;
  let investimento: number | null = null;
  if (bruto !== '') {
    const numero = Number(bruto);
    if (!Number.isFinite(numero) || numero < 0) {
      return { erro: 'Informe um valor em números, como 3500 ou 3500,00.' };
    }
    investimento = numero > 0 ? Math.round(numero * 100) / 100 : null;
  }

  try {
    await salvaInvestimentoMensal(conta.client_db_name, investimento);
  } catch (erro) {
    const lacuna = lacunaDeEsquema(erro);
    if (lacuna) {
      return {
        erro:
          'O banco central ainda não tem a coluna do investimento mensal. ' +
          'Rode "Banco de Dados/migracao_fee_mensal.sql" e tente de novo.',
      };
    }
    console.error('[clientes] falha ao salvar o investimento mensal', conta.client_db_name, erro);
    return { erro: 'Não foi possível salvar o investimento mensal.' };
  }

  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.CLIENTE_FEE_ALTERADO,
    clientDb: conta.client_db_name,
    detalhe: { monthly_fee: investimento },
  });

  revalidatePath('/admin/clientes');
  revalidatePath(`/app/${conta.client_db_name}/visao-geral`);
  return {
    sucesso:
      investimento === null
        ? 'Investimento mensal removido.'
        : `Investimento mensal salvo: ${investimento.toFixed(2)}.`,
  };
}

/**
 * Campo do Kommo que guarda o valor do negócio, por cliente.
 *
 * Vale o rótulo exato do campo personalizado ("Valor do contrato") ou o
 * id numérico dele. O id é o preferível: o rótulo muda no dia em que
 * alguém renomeia o campo no Kommo, e aí o valor volta a não ser lido.
 * Campo vazio remove a configuração e o fluxo volta a procurar pelos
 * rótulos conhecidos.
 */
const schemaCampoValorCrm = z.object({
  client_db: z.string().trim().min(1).max(64),
  crm_value_field: z.string().trim().max(120),
});

export async function acaoSalvarCampoValorCrm(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const admin = await requireAdmin();

  const parsed = schemaCampoValorCrm.safeParse({
    client_db: form.get('client_db'),
    crm_value_field: form.get('crm_value_field') ?? '',
  });
  if (!parsed.success) return { erro: 'Dados inválidos' };

  const conta = await buscaAdAccount(parsed.data.client_db);
  if (!conta) return { erro: 'Cliente não encontrado no catálogo.' };

  const campo = parsed.data.crm_value_field === '' ? null : parsed.data.crm_value_field;

  try {
    await salvaCampoValorCrm(conta.client_db_name, campo);
  } catch (erro) {
    if (lacunaDeEsquema(erro)) {
      return {
        erro:
          'O banco central ainda não tem a coluna do campo de valor do CRM. ' +
          'Rode "Banco de Dados/migracao_crm_value_field.sql" e tente de novo.',
      };
    }
    console.error('[clientes] falha ao salvar o campo de valor do CRM', conta.client_db_name, erro);
    return { erro: 'Não foi possível salvar o campo de valor do CRM.' };
  }

  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.CLIENTE_CAMPO_VALOR_ALTERADO,
    clientDb: conta.client_db_name,
    detalhe: { crm_value_field: campo },
  });

  revalidatePath('/admin/clientes');
  return {
    sucesso:
      campo === null
        ? 'Configuração removida. O valor volta a ser procurado pelos rótulos conhecidos.'
        : `Campo do valor salvo: ${campo}. Vale para os próximos eventos.`,
  };
}
