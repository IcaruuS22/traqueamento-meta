-- =======================================================
-- Migração: Classificação automática por IA das Conversas WhatsApp
-- (banco POR CLIENTE)
--
-- Contexto: o workflow "WhatsApp IA - Classificacao Automatica" analisa
-- conversas paradas (60s+ sem mensagem nova) via Groq e aplica o novo
-- estágio automaticamente, sem confirmação humana (inclusive podendo
-- disparar evento Meta CAPI quando o novo estágio tiver mapeamento
-- ativo em whatsapp_event_map). Esta migração adiciona as 3 colunas
-- que esse workflow usa para controlar o debounce (evitar reanalisar
-- a mesma conversa repetidamente) e para exibir a última classificação
-- + motivo na aba Conversas do painel, para auditoria.
--
-- Rode isto DENTRO de cada banco de cliente que já tem a tabela
-- whatsapp_conversations (ver migracao_whatsapp_messages.sql). Novos
-- clientes já nascem com essas colunas (ver
-- 02_Template_Banco_Por_Cliente.sql).
--
-- ANTES DE RODAR: faça backup, ex.:
--   CREATE TABLE whatsapp_conversations_backup_20260824 AS SELECT * FROM whatsapp_conversations;
-- =======================================================

ALTER TABLE `whatsapp_conversations`
  ADD COLUMN `ai_last_analyzed_at` TIMESTAMP NULL DEFAULT NULL AFTER `last_inbound_at`,
  ADD COLUMN `ai_last_classification` VARCHAR(60) NULL DEFAULT NULL AFTER `ai_last_analyzed_at`,
  ADD COLUMN `ai_last_reason` VARCHAR(500) NULL DEFAULT NULL AFTER `ai_last_classification`;

-- Índice para a busca de conversas pendentes, que roda a cada minuto em
-- TODOS os bancos de cliente:
--   WHERE last_inbound_at IS NOT NULL
--     AND last_inbound_at <= NOW() - INTERVAL 60 SECOND
--     AND (ai_last_analyzed_at IS NULL OR ai_last_analyzed_at < last_inbound_at)
--   ORDER BY last_inbound_at ASC
-- Sem ele, essa query vira full table scan a cada minuto. A comparação
-- entre as duas colunas não é indexável, mas o filtro de faixa em
-- last_inbound_at (a parte seletiva) e o ORDER BY são — o índice já
-- entrega as linhas na ordem certa, sem filesort.
ALTER TABLE `whatsapp_conversations`
  ADD INDEX `idx_whatsapp_conversations_ia_pendentes` (`last_inbound_at`, `ai_last_analyzed_at`);

-- =======================================================
-- Verificação pós-migração
-- =======================================================
SHOW COLUMNS FROM `whatsapp_conversations` LIKE 'ai_last%';
SHOW INDEX FROM `whatsapp_conversations` WHERE Key_name = 'idx_whatsapp_conversations_ia_pendentes';
