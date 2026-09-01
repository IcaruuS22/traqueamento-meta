'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { atualizaStatusLocal } from '@/lib/db/campanhas';
import { alteraStatusEntidade } from '@/lib/meta-ads';

/**
 * Ligar e desligar campanha, conjunto e anúncio pela tela de Campanhas.
 *
 * Esta é a primeira ação do painel que ESCREVE na conta de anúncio do
 * cliente — até aqui o app só lia da Meta e escrevia eventos na CAPI.
 * Duas consequências que valem estar registradas:
 *
 *  - A ordem é Meta primeiro, banco depois. Se a Meta recusar, nada muda
 *    localmente e a tela continua honesta. O contrário (gravar local e
 *    tentar a Meta) deixaria o painel mostrando "Pausada" para uma
 *    campanha que segue gastando.
 *  - Não é restrita a administrador. A conta de anúncio é do cliente, e
 *    pausar tem volta pelo mesmo botão — diferente de excluir conversa,
 *    que é irreversível e por isso é só de admin. O registro de quem
 *    clicou fica na auditoria.
 */

export type ResultadoAcao = { ok: true; sucesso: string } | { ok: false; erro: string };

const Schema = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  nivel: z.enum(['campaign', 'adset', 'ad']),
  // Id da Meta é numérico. A validação não é firula: o valor vai direto no
  // caminho da URL da Graph API, e um id vindo do navegador sem checagem
  // permitiria montar outro endpoint no lugar da entidade.
  id: z
    .string()
    .trim()
    .regex(/^\d{1,25}$/, 'Identificador da Meta inválido'),
  status: z.enum(['ACTIVE', 'PAUSED']),
});

const ROTULO_NIVEL = {
  campaign: 'Campanha',
  adset: 'Conjunto',
  ad: 'Anúncio',
} as const;

const ROTULO_STATUS = { ACTIVE: 'ativado', PAUSED: 'pausado' } as const;

export async function acaoAlterarStatus(
  entrada: z.input<typeof Schema>,
): Promise<ResultadoAcao> {
  const analise = Schema.safeParse(entrada);
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = analise.data;

  const { usuario, conta, db } = await requireClientAccess(dados.cliente);

  const resultado = await alteraStatusEntidade(conta.client_db_name, dados.id, dados.status);
  if (!resultado.ok) return { ok: false, erro: resultado.erro };

  await atualizaStatusLocal(db, dados.nivel, dados.id, dados.status);

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.META_STATUS_ALTERADO,
    clientDb: conta.client_db_name,
    detalhe: { nivel: dados.nivel, entidade_id: dados.id, status: dados.status },
  });

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/campanhas`);
  return {
    ok: true,
    sucesso: `${ROTULO_NIVEL[dados.nivel]} ${ROTULO_STATUS[dados.status]} na Meta.`,
  };
}
