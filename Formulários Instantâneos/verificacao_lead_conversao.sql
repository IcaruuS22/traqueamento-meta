-- =======================================================
-- Verificação (somente leitura) — lead específico + conversão
-- =======================================================
-- Roda no banco DO CLIENTE (não no `trakeamento_controle`). Troque
-- <ID_DO_LEAD> pelo id do lead que converteu no dia 18.
--
-- Não altera nada — é só para confirmar visualmente que o
-- current_stage do lead já aponta para um status_id marcado como
-- is_conversion = 1 em crm_meta_event_map (o que já é suficiente para
-- ele aparecer como conversão em Métricas Gerais e na campanha de
-- origem, sem precisar de nenhum UPDATE manual).

SELECT
  c.id,
  c.first_name,
  c.last_name,
  c.current_stage,
  c.meta_campaign_id,
  c.meta_campaign_name,
  c.created_at,
  em.status_id,
  em.meta_event,
  em.content_name,
  em.is_conversion
FROM `customers` c
LEFT JOIN `crm_meta_event_map` em ON em.status_id = c.current_stage
WHERE c.id = <ID_DO_LEAD>;

-- Leitura do resultado:
-- * Se `is_conversion` vier 1: o lead já conta como conversão em
--   Métricas Gerais (Taxa de Conversão do Funil) e no CAC da campanha
--   indicada em meta_campaign_id/meta_campaign_name — basta recarregar
--   o painel (F5 ou "Atualizar").
-- * Se vier 0 ou NULL: o current_stage atual do lead está mapeado
--   para um evento diferente do Purchase (ou não está mapeado). Nesse
--   caso o ajuste é conferir/marcar o status_id CORRETO como
--   is_conversion=1 em "Configurações de eventos" no painel — não
--   um UPDATE direto no lead.
