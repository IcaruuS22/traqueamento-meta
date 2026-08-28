-- =======================================================
-- Migração: WhatsApp Cloud API (banco POR CLIENTE)
--
-- Rode isto DENTRO de cada banco de cliente (client_db_name na
-- tabela central trakeamento_controle.ad_accounts), uma vez por
-- cliente já existente. Novos clientes já vão nascer com este
-- schema (ver ajuste no node "Prepara Cadastro" / build_workflow.js).
--
-- ANTES DE RODAR: faça backup da tabela alterada, ex.:
--   CREATE TABLE customers_backup_20260820 AS SELECT * FROM customers;
-- (whatsapp_messages não precisa de backup, é CREATE TABLE IF NOT EXISTS)
-- =======================================================

-- 1) Coluna-guarda: marca quando já disparamos o evento CAPI de
--    "contato via WhatsApp vindo de anúncio" pra esse customer, pra
--    nunca disparar duas vezes. Se a coluna já existir (rodou a
--    migração 2x), o ALTER abaixo falha com "Duplicate column name"
--    -- pode ignorar nesse caso.
ALTER TABLE `customers`
  ADD COLUMN `whatsapp_contact_capi_sent_at` TIMESTAMP NULL DEFAULT NULL;

-- 2) Mensagens de WhatsApp recebidas/enviadas
CREATE TABLE IF NOT EXISTS `whatsapp_messages` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `customer_id` BIGINT,
  `direction` VARCHAR(10) NOT NULL,       -- 'inbound' | 'outbound'
  `wa_message_id` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,           -- normalizado: só dígitos + prefixo 55
  `message_type` VARCHAR(50),
  `message_text` TEXT,
  `message_timestamp_unix` BIGINT,
  `referral_ad_id` VARCHAR(255),
  `referral_ctwa_clid` VARCHAR(255),
  `capi_event_id` VARCHAR(255),
  `raw_payload` JSON,
  CONSTRAINT `whatsapp_messages_wa_message_id_key` UNIQUE (`wa_message_id`),
  CONSTRAINT `whatsapp_messages_customer_id_fkey`
    FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX `idx_whatsapp_messages_phone` ON `whatsapp_messages`(`phone`);
CREATE INDEX `idx_whatsapp_messages_customer_id` ON `whatsapp_messages`(`customer_id`);

-- 3) Estado da conversa por lead (CRM da aba "Conversas" do painel):
--    status/notas/tags/contagem de não-lidas e o timestamp da última
--    mensagem recebida, usado para checar a janela de 24h da Meta
--    antes de liberar o envio de mensagem livre pelo painel.
CREATE TABLE IF NOT EXISTS `whatsapp_conversations` (
  `customer_id` BIGINT PRIMARY KEY,
  `status` VARCHAR(20) DEFAULT 'aberta' NOT NULL,   -- aberta | aguardando | resolvida
  `notes` TEXT,
  `tags` VARCHAR(500),
  `unread_count` INT DEFAULT 0 NOT NULL,
  `last_message_at` TIMESTAMP NULL,
  `last_inbound_at` TIMESTAMP NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `whatsapp_conversations_customer_id_fkey`
    FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =======================================================
-- Verificação pós-migração
-- =======================================================
SELECT COUNT(*) AS tem_coluna_whatsapp_contact_capi_sent_at
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'whatsapp_contact_capi_sent_at';

SHOW TABLES LIKE 'whatsapp_messages';
SHOW TABLES LIKE 'whatsapp_conversations';
