-- =======================================================
-- Migração: valor extraído pela IA das conversas de WhatsApp
-- (banco POR CLIENTE)
--
-- Contexto: o workflow "WhatsApp IA - Classificacao Automatica" passou a
-- pedir à Groq, junto do estágio, o valor financeiro citado nas próprias
-- mensagens ("comprei", "paguei 19,90"). Quando esse valor existe, ele é
-- gravado aqui e vai como `value` no evento Meta CAPI disparado pela
-- mudança de estágio, no lugar do valor fixo cadastrado em
-- whatsapp_event_map — que é um ticket médio estimado, não a venda real.
--
-- Rode isto DENTRO de cada banco de cliente que já tem a tabela
-- whatsapp_conversations (ver migracao_whatsapp_messages.sql e
-- migracao_whatsapp_ia_classificacao.sql). Novos clientes já nascem com
-- a coluna (ver 02_Template_Banco_Por_Cliente.sql).
--
-- Enquanto esta migração não roda, o workflow continua funcionando: a
-- gravação do valor é um UPDATE separado, com erro tolerado, e o disparo
-- do CAPI usa o valor direto da resposta da IA. O que se perde sem a
-- coluna é só o valor guardado para auditoria no painel.
--
-- ANTES DE RODAR: faça backup, ex.:
--   CREATE TABLE whatsapp_conversations_backup_20260901 AS SELECT * FROM whatsapp_conversations;
-- =======================================================

ALTER TABLE `whatsapp_conversations`
  ADD COLUMN `ai_last_value` DECIMAL(12,2) NULL DEFAULT NULL AFTER `ai_last_reason`;

-- =======================================================
-- Verificação pós-migração
-- =======================================================
SHOW COLUMNS FROM `whatsapp_conversations` LIKE 'ai_last_value';
