'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { buscaConfigWhatsapp, salvaConfigWhatsapp } from '@/lib/db/whatsapp';
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

  try {
    await salvaConfigWhatsapp(conta.client_db_name, {
      cloud_phone_number_id: dados.cloud_phone_number_id,
      cloud_waba_id: dados.cloud_waba_id ?? null,
      cloud_access_token: token,
      meta_test_event_code: dados.meta_test_event_code ?? null,
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
      // O valor do token não entra no log de jeito nenhum.
      token_alterado: Boolean(token),
    },
  });

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/whatsapp`);
  return { sucesso: 'Configuração de WhatsApp salva com sucesso.' };
}
