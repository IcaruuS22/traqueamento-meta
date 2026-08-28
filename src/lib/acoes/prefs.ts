'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { salvaPreferenciaMetrica } from '@/lib/db/prefs';
import { CATALOGO_METRICAS } from '@/lib/metricas-catalogo';

/**
 * Ação do seletor de métricas — porte de
 * `POST /painel-api/metricas-prefs-salvar`.
 *
 * A checagem de acesso vale mesmo para as métricas globais: só quem já
 * pode ver algum cliente é que pode mexer no que aparece na tela dele.
 * E, como no painel antigo, desligar uma métrica global vale para todos
 * os clientes — por isso a auditoria guarda o escopo que foi realmente
 * gravado.
 */

const CHAVES = CATALOGO_METRICAS.map((m) => m.key) as [string, ...string[]];

const schema = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  metric_key: z.enum(CHAVES),
  visible: z.union([z.literal('1'), z.literal('0')]),
});

export type ResultadoPref = { ok: true } | { ok: false; erro: string };

export async function acaoSalvarPreferenciaMetrica(
  entrada: z.input<typeof schema>,
): Promise<ResultadoPref> {
  const parsed = schema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const { cliente, metric_key, visible } = parsed.data;
  const visivel = visible === '1';

  const { usuario, conta } = await requireClientAccess(cliente);

  let escopo: 'cliente' | 'global';
  try {
    ({ escopo } = await salvaPreferenciaMetrica(conta.client_db_name, metric_key, visivel));
  } catch (erro) {
    console.error('[prefs] falha ao salvar preferência de métrica:', erro);
    return { ok: false, erro: 'Erro ao salvar preferência de métrica.' };
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.METRICAS_PREFS_SALVAS,
    // Preferência global não pertence a cliente nenhum; registrar o
    // cliente da tela aqui faria parecer que a mudança foi só dele.
    clientDb: escopo === 'cliente' ? conta.client_db_name : null,
    detalhe: { metric_key, visible: visivel, escopo, tela: conta.client_db_name },
  });

  const base = `/app/${encodeURIComponent(conta.client_db_name)}`;
  revalidatePath(`${base}/visao-geral`);
  revalidatePath(`${base}/campanhas`);
  return { ok: true };
}
