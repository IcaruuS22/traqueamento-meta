-- =======================================================
-- Migração: WhatsApp Cloud API (banco CENTRAL trakeamento_controle)
--
-- Adiciona o roteamento de mensagens de WhatsApp por cliente
-- (whatsapp_accounts, 1 conexão por cliente, só Meta Cloud API
-- oficial) e o código de teste do Gerenciador de Eventos usado
-- para disparar os eventos de "Contato via WhatsApp" em modo de
-- teste até serem validados (ad_accounts.meta_test_event_code).
--
-- Rode isto UMA VEZ no banco central. Novos clientes não precisam
-- de nada aqui automaticamente — a conexão de WhatsApp de cada
-- cliente é cadastrada manualmente na aba WhatsApp do painel
-- (grava direto em whatsapp_accounts).
-- =======================================================

-- Backup antes de alterar ad_accounts
CREATE TABLE IF NOT EXISTS `trakeamento_controle`.`ad_accounts_backup_20260820`
  AS SELECT * FROM `trakeamento_controle`.`ad_accounts`;

-- Se a coluna já existir (rodou a migração 2x), o ALTER abaixo falha
-- com erro "Duplicate column name" -- pode ignorar nesse caso.
ALTER TABLE `trakeamento_controle`.`ad_accounts`
  ADD COLUMN `meta_test_event_code` VARCHAR(50) NULL AFTER `meta_access_token`;
-- Código de teste do Gerenciador de Eventos (aba Test Events). Enquanto
-- preenchido, os eventos de Contato via WhatsApp saem em modo de teste
-- (não contam como conversão real). Deixar em branco quando for pra
-- produção.

CREATE TABLE IF NOT EXISTS `trakeamento_controle`.`whatsapp_accounts` (
  `client_db_name` VARCHAR(64) PRIMARY KEY,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  `status` VARCHAR(20) DEFAULT 'ACTIVE' NOT NULL,
  `cloud_phone_number_id` VARCHAR(255) NOT NULL,
  `cloud_waba_id` VARCHAR(255),
  `cloud_access_token` VARCHAR(512) NOT NULL,
  CONSTRAINT `whatsapp_accounts_phone_number_id_key` UNIQUE (`cloud_phone_number_id`),
  CONSTRAINT `whatsapp_accounts_client_fkey`
    FOREIGN KEY (`client_db_name`) REFERENCES `trakeamento_controle`.`ad_accounts`(`client_db_name`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =======================================================
-- Verificação pós-migração
-- =======================================================
SELECT COUNT(*) AS tem_coluna_meta_test_event_code
FROM information_schema.columns
WHERE table_schema = 'trakeamento_controle' AND table_name = 'ad_accounts' AND column_name = 'meta_test_event_code';

SHOW TABLES LIKE 'whatsapp_accounts';
