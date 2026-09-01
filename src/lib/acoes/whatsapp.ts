'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { buscaConfigWhatsapp, salvaConfigWhatsapp } from '@/lib/db/whatsapp';
import { normalizaModoCapi } from '@/lib/capi-politica';
import type { EstadoFormulario } from '@/lib/auth/actions';

/**
 * Ação da tela "Conexão" do WhatsApp — porte de
 * `POST /painel-api/whatsapp-salvar`.
 *
 * O token é write-only: a tela nunca o recebe, então campo vazio só pode
 * significar "não alterar". A única situação em que vazio é recusado é a
 * primeira configuração, quando não há token nenhum guardado.
 *
 * A auditoria registra que a conexão mudou e se o token foi trocado —
 * nunca o valor, nem um pedaço dele.
 */

const schema = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  cloud_phone_number_id: z.string().trim().max(64),
  cloud_waba_id: z.string().trim().max(64).optional(),
  cloud_access_token: z.string().trim().max(512).optional(),
  meta_test_event_code: z.string().trim().max(64).optional(),
  capi_modo: z.string().trim().max(16).optional(),
  capi_dataset_id: z.string().trim().max(64).optional(),
  capi_test_event_code: z.string().trim().max(64).optional(),
  capi_access_token: z.string().trim().max(512).optional(),
});

export async function acaoSalvarConexaoWhatsapp(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = parsed.data;

  const { usuario, conta } = await requireClientAccess(dados.cliente);

  // Mesma exigência e mesmo texto do endpoint antigo.
  if (!dados.cloud_phone_number_id) {
    return { erro: 'Campo obrigatório ausente: ID do número de telefone (phone_number_id).' };
  }

  const atual = await buscaConfigWhatsapp(conta.client_db_name);
  const token = dados.cloud_access_token ?? '';
  if (!token && !atual.token_cadastrado) {
    return { erro: 'Token de acesso obrigatório na primeira configuração.' };
  }

  // O modo passa pelo normalizador em vez de um enum do zod: valor
  // desconhecido vira 'teste', e não um erro de formulário. Recusar o
  // salvamento inteiro por causa do select deixaria a conexão no modo
  // anterior, que pode ser 'producao'.
  const modo = normalizaModoCapi(dados.capi_modo);
  const datasetMensagens = dados.capi_dataset_id || null;

  if (modo === 'producao' && !datasetMensagens) {
    return {
      erro:
        'Para enviar em produção, informe o dataset do pixel de mensagens. ' +
        'Os eventos de WhatsApp nunca usam o pixel dos formulários.',
    };
  }
  if (modo === 'teste' && datasetMensagens && !dados.capi_test_event_code) {
    return {
      erro:
        'No modo teste o Test Event Code do WhatsApp é obrigatório: sem ele a ' +
        'Meta trata o evento como conversão real.',
    };
  }

  try {
    await salvaConfigWhatsapp(conta.client_db_name, {
      cloud_phone_number_id: dados.cloud_phone_number_id,
      cloud_waba_id: dados.cloud_waba_id ?? null,
      cloud_access_token: token,
      meta_test_event_code: dados.meta_test_event_code ?? null,
      // Sem as colunas no catálogo não há onde gravar; a tela já mostra o
      // aviso da migração no lugar dos campos.
      capi: atual.capi.disponivel
        ? {
            modo,
            dataset_id: datasetMensagens,
            test_event_code: dados.capi_test_event_code || null,
            access_token: dados.capi_access_token ?? '',
          }
        : undefined,
    });
  } catch (erro) {
    console.error('[whatsapp] falha ao salvar conexão:', erro);
    return { erro: 'Não foi possível salvar a conexão. Tente novamente.' };
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.WHATSAPP_CONFIG_SALVA,
    clientDb: conta.client_db_name,
    detalhe: {
      cloud_phone_number_id: dados.cloud_phone_number_id,
      cloud_waba_id: dados.cloud_waba_id || null,
      meta_test_event_code: dados.meta_test_event_code || null,
      capi_modo: atual.capi.disponivel ? modo : null,
      capi_dataset_id: datasetMensagens,
      // Nenhum dos dois tokens entra no log de jeito nenhum.
      token_alterado: Boolean(token),
      capi_token_alterado: Boolean(dados.capi_access_token),
    },
  });

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/whatsapp`);
  return { sucesso: 'Configuração de WhatsApp salva com sucesso.' };
}
