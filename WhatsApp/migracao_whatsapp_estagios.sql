-- =======================================================
-- Migração: Estágios ricos do funil de Conversas WhatsApp
-- + mapeamento de eventos por estágio (banco POR CLIENTE)
--
-- Rode isto DENTRO de cada banco de cliente (client_db_name na
-- tabela central trakeamento_controle.ad_accounts), uma vez por
-- cliente já existente que já tenha rodado migracao_whatsapp_messages.sql
-- (precisa que whatsapp_conversations já exista). Novos clientes já
-- nascem com este schema (ver build_workflow.js, node "Cria Tabela
-- whatsapp_event_map" + "Expande Estágios").
--
-- ANTES DE RODAR: faça backup, ex.:
--   CREATE TABLE whatsapp_conversations_backup_20260821 AS SELECT * FROM whatsapp_conversations;
-- =======================================================

-- 1) Troca o funil de 3 estágios (aberta/aguardando/resolvida) para um
--    funil de 7 estágios (novo/em_atendimento/aguardando/qualificado/
--    proposta/ganho/perdido). Mapeamento de migração dos dados
--    existentes (decisão: "aberta" vira "novo", "resolvida" vira
--    "ganho" -- ajuste manualmente depois se algum caso for "perdido"):
UPDATE `whatsapp_conversations` SET `status` = 'novo' WHERE `status` = 'aberta';
UPDATE `whatsapp_conversations` SET `status` = 'ganho' WHERE `status` = 'resolvida';
-- 'aguardando' já existe igual no novo funil, não precisa migrar.

ALTER TABLE `whatsapp_conversations`
  MODIFY COLUMN `status` VARCHAR(20) DEFAULT 'novo' NOT NULL;

-- 2) Mapeamento de evento Meta por estágio (equivalente a
--    crm_meta_event_map, mas com lista fixa de 7 estágios em vez de
--    pipeline/status dinâmicos do Kommo).
CREATE TABLE IF NOT EXISTS `whatsapp_event_map` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `estagio` VARCHAR(20) NOT NULL,
  `meta_event` VARCHAR(255),
  `content_name` VARCHAR(255),
  `currency` VARCHAR(3) DEFAULT 'BRL',
  `value` DECIMAL(10,2) DEFAULT 0.00,
  `ativo` BOOLEAN DEFAULT FALSE NOT NULL,
  `is_conversion` BOOLEAN DEFAULT FALSE NOT NULL,
  CONSTRAINT `whatsapp_event_map_estagio_unique` UNIQUE (`estagio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Semeia as 7 linhas fixas (inativas, sem evento configurado --
--    o cliente ativa e escolhe o evento depois, na aba "Configuração
--    de Eventos" do painel). INSERT IGNORE: seguro rodar 2x.
INSERT IGNORE INTO `whatsapp_event_map` (`estagio`, `ativo`, `is_conversion`) VALUES
  ('novo', 0, 0),
  ('em_atendimento', 0, 0),
  ('aguardando', 0, 0),
  ('qualificado', 0, 0),
  ('proposta', 0, 0),
  ('ganho', 0, 1),
  ('perdido', 0, 0);

-- =======================================================
-- Verificação pós-migração
-- =======================================================
SHOW TABLES LIKE 'whatsapp_event_map';
SELECT `status`, COUNT(*) AS total FROM `whatsapp_conversations` GROUP BY `status`;
SELECT `estagio`, `ativo`, `is_conversion` FROM `whatsapp_event_map` ORDER BY `id` ASC;
