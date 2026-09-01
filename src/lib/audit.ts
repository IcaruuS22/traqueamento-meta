import 'server-only';
import { headers } from 'next/headers';
import { execute } from '@/lib/db/pool';

/**
 * Registro de auditoria.
 *
 * Substitui o modelo atual, em que qualquer ação no painel é anônima
 * (todo mundo entra com a mesma credencial Basic Auth). Com contas por
 * pessoa, é isto que responde "quem alterou o mapeamento de eventos
 * deste cliente na semana passada".
 */

export const ACOES = {
  LOGIN: 'login',
  CONVITE_CRIADO: 'convite_criado',
  CONTA_CRIADA: 'conta_criada',
  CONTA_APROVADA: 'conta_aprovada',
  CONTA_BLOQUEADA: 'conta_bloqueada',
  VINCULO_ALTERADO: 'vinculo_alterado',
  SENHA_REDEFINIDA: 'senha_redefinida',
  CREDENCIAIS_ALTERADAS: 'credenciais_alteradas',
  WHATSAPP_CONFIG_SALVA: 'whatsapp_config_salva',
  WHATSAPP_MENSAGEM_ENVIADA: 'whatsapp_mensagem_enviada',
  WHATSAPP_LEAD_SALVO: 'whatsapp_lead_salvo',
  WHATSAPP_CONVERSA_EXCLUIDA: 'whatsapp_conversa_excluida',
  WHATSAPP_EVOLUTION_CONECTADA: 'whatsapp_evolution_conectada',
  WHATSAPP_EVOLUTION_DESCONECTADA: 'whatsapp_evolution_desconectada',
  WHATSAPP_EVOLUTION_REMOVIDA: 'whatsapp_evolution_removida',
  WHATSAPP_EVOLUTION_WEBHOOK: 'whatsapp_evolution_webhook',
  CRM_LEAD_MOVIDO: 'crm_lead_movido',
  CRM_LEAD_SALVO: 'crm_lead_salvo',
  EVENTO_MAPEAMENTO_SALVO: 'evento_mapeamento_salvo',
  EVENTO_MAPEAMENTO_EXCLUIDO: 'evento_mapeamento_excluido',
  METRICAS_PREFS_SALVAS: 'metricas_prefs_salvas',
  CLIENTE_CRIADO: 'cliente_criado',
  CLIENTE_FEE_ALTERADO: 'cliente_fee_alterado',
  CLIENTE_EXCLUIDO: 'cliente_excluido',
  SYNC_DISPARADA: 'sync_disparada',
  BACKFILL_DISPARADO: 'backfill_disparado',
  IA_ANALISE_EXECUTADA: 'ia_analise_executada',
  META_STATUS_ALTERADO: 'meta_status_alterado',
} as const;

export type Acao = (typeof ACOES)[keyof typeof ACOES];

export async function registraAuditoria(dados: {
  userId?: number | null;
  userEmail?: string | null;
  acao: Acao;
  clientDb?: string | null;
  detalhe?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const ip = await ipDaRequisicao();
    await execute(
      `INSERT INTO trakeamento_controle.app_audit_log
         (user_id, user_email, acao, client_db_name, detalhe, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        dados.userId ?? null,
        dados.userEmail ?? null,
        dados.acao,
        dados.clientDb ?? null,
        dados.detalhe ? JSON.stringify(dados.detalhe) : null,
        ip,
      ],
    );
  } catch (erro) {
    // Auditoria nunca derruba a operação auditada: perder um registro de
    // log é ruim, mas impedir o usuário de responder uma mensagem porque
    // o INSERT do log falhou é pior. A falha vai para o log do servidor.
    console.error('[auditoria] falha ao registrar:', erro);
  }
}

async function ipDaRequisicao(): Promise<string | null> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim().slice(0, 64);
    return h.get('x-real-ip')?.slice(0, 64) ?? null;
  } catch {
    // `headers()` não existe fora de um contexto de requisição (scripts).
    return null;
  }
}

export type LinhaAuditoria = {
  id: number;
  user_id: number | null;
  user_email: string | null;
  acao: string;
  client_db_name: string | null;
  detalhe: unknown;
  ip: string | null;
  created_at: string;
};
