-- =======================================================
-- Migração: Etapas dinâmicas no funil de Conversas WhatsApp
-- (banco POR CLIENTE)
--
-- Contexto: whatsapp_event_map.estagio e whatsapp_conversations.status
-- nasceram como VARCHAR(20) porque o funil era um conjunto fixo de 7
-- estágios (ver migracao_whatsapp_estagios.sql). Agora o cliente pode
-- cadastrar/renomear/excluir estágios livremente pela aba "Configuração
-- de Eventos" do painel (mesma lógica do mapeamento de eventos do
-- formulário) — isso exige nomes de estágio mais longos que 20
-- caracteres, então esta migração só alarga as colunas. Nenhum dado
-- existente é alterado ou perdido.
--
-- Rode isto DENTRO de cada banco de cliente que já rodou
-- migracao_whatsapp_estagios.sql. Novos clientes já nascem com as
-- colunas no tamanho novo (ver build_workflow.js, seção whatsapp_event_map
-- / whatsapp_conversations).
--
-- ANTES DE RODAR: faça backup, ex.:
--   CREATE TABLE whatsapp_event_map_backup_20260821 AS SELECT * FROM whatsapp_event_map;
-- =======================================================

ALTER TABLE `whatsapp_conversations`
  MODIFY COLUMN `status` VARCHAR(60) DEFAULT 'novo' NOT NULL;

ALTER TABLE `whatsapp_event_map`
  MODIFY COLUMN `estagio` VARCHAR(60) NOT NULL;

-- =======================================================
-- Verificação pós-migração
-- =======================================================
SHOW COLUMNS FROM `whatsapp_conversations` LIKE 'status';
SHOW COLUMNS FROM `whatsapp_event_map` LIKE 'estagio';
