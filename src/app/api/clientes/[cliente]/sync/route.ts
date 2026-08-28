import { rota } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { disparaWebhook } from '@/lib/n8n';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/**
 * A sincronização varre 3 dias de insights da conta inteira e só responde
 * no fim. O padrão da Vercel (10s) cortaria a resposta no meio de uma
 * execução que continuaria rodando no n8n, e o usuário veria erro numa
 * atualização que deu certo.
 */
export const maxDuration = 120;

/**
 * Dispara a sincronização com a Meta.
 *
 * Rota, e não Server Action, por causa do tempo: `maxDuration` é
 * configurável por rota, e ações herdam o limite da página que as chamou.
 *
 * A trava de 60s continua sendo do n8n (`ad_accounts.last_sync_started_at`).
 * O app não duplica a trava: duas travas com relógios diferentes é como se
 * consegue "sincronização em andamento" eterna.
 */
export const POST = rota<{ params: Promise<{ cliente: string }> }>(async (_req, ctx) => {
  const { cliente } = await ctx.params;
  const { usuario, conta } = await requireClientAccess(decodeURIComponent(cliente));

  const r = await disparaWebhook('sync-meta-agora', conta.client_db_name, 115_000);

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.SYNC_DISPARADA,
    clientDb: conta.client_db_name,
    detalhe: { executou: r.executou },
  });

  return r;
});
