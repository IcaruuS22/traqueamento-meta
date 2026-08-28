import { rota } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { disparaWebhook } from '@/lib/n8n';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** Backfill de até 90 dias: minutos, não segundos. */
export const maxDuration = 300;

/**
 * Dispara a importação do histórico de campanhas (até 90 dias).
 *
 * A janela é decidida pelo n8n, não aqui: ele não volta antes do primeiro
 * lead do cliente nem antes de 90 dias, o que for mais recente. Repetir
 * essa regra no app criaria duas versões dela para divergir.
 */
export const POST = rota<{ params: Promise<{ cliente: string }> }>(async (_req, ctx) => {
  const { cliente } = await ctx.params;
  const { usuario, conta } = await requireClientAccess(decodeURIComponent(cliente));

  const r = await disparaWebhook('campanhas-importar-historico', conta.client_db_name, 295_000);

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.BACKFILL_DISPARADO,
    clientDb: conta.client_db_name,
    detalhe: { executou: r.executou },
  });

  return r;
});
