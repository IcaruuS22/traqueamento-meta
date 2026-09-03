-- =======================================================
-- BANCO CENTRAL DE CONTROLE (MySQL)
-- Guarda apenas o registro OFICIAL de clientes (roteamento).
-- Tudo que é específico de cada cliente — customers,
-- crm_meta_event_map e meta_capi_events — vive num banco
-- isolado por cliente, criado automaticamente pelo workflow
-- "Cria Cliente - Formulario" (veja 02_Template_Banco_Por_Cliente.sql).
-- =======================================================

CREATE DATABASE IF NOT EXISTS trakeamento_controle CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE trakeamento_controle;

-- 1. TABELA: ad_accounts
-- Um registro por cliente. client_db_name aponta para o banco
-- MySQL isolado que guarda os dados desse cliente (customers,
-- crm_meta_event_map, meta_capi_events).
-- Não guarda "state": o hash de estado (st) enviado à Meta é
-- resolvido por LEAD (customers.state), não por cliente — nem
-- todo cliente atua numa única UF fixa.
CREATE TABLE IF NOT EXISTS ad_accounts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  ad_account_id VARCHAR(255) NOT NULL,
  crm_account_id VARCHAR(255),
  meta_pixel_dataset_id VARCHAR(255),
  meta_access_token VARCHAR(512),
  kommo_access_token TEXT,
  content_category VARCHAR(255),
  -- Campo personalizado do Kommo que guarda o valor do negócio: o
  -- rótulo exato ou o id numérico do campo. NULL = usa o campo nativo
  -- "Venda" e, na falta dele, os rótulos conhecidos.
  crm_value_field VARCHAR(120) NULL DEFAULT NULL,
  -- Valor mensal combinado com o cliente para mídia. NULL = não
  -- combinado. Alimenta o indicador de ritmo de gasto da aba Métricas.
  monthly_fee DECIMAL(12,2) NULL DEFAULT NULL,
  client_db_name VARCHAR(64),
  status VARCHAR(50) DEFAULT 'ACTIVE',
  -- Lock/cooldown da sincronização sob demanda (substitui o cron de 6h):
  -- cada clique em "Atualizar" tenta marcar last_sync_started_at = NOW()
  -- e só segue se a marcação anterior tiver mais de 60s (ou nunca tiver
  -- existido). Não precisa de "unlock" explícito.
  last_sync_started_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT ad_accounts_ad_account_id_key UNIQUE (ad_account_id),
  CONSTRAINT ad_accounts_crm_account_id_key UNIQUE (crm_account_id),
  CONSTRAINT ad_accounts_client_db_name_key UNIQUE (client_db_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. TABELA DE SUPORTE: ddd_state_map
-- Referência genérica (DDD -> UF), não é específica de cliente,
-- por isso continua central. É usada para resolver customers.state
-- a partir do telefone do lead.
CREATE TABLE IF NOT EXISTS ddd_state_map (
  ddd INT PRIMARY KEY,
  state VARCHAR(2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =======================================================
-- ÍNDICES DE PERFORMANCE
-- =======================================================
CREATE INDEX idx_ad_accounts_meta_id ON ad_accounts(ad_account_id);
CREATE INDEX idx_ad_accounts_crm_id ON ad_accounts(crm_account_id);

-- =======================================================
-- MIGRAÇÃO (rodar apenas se a tabela ad_accounts já existir
-- sem as colunas novas, vindo da versão anterior do schema)
-- =======================================================
-- ALTER TABLE ad_accounts ADD COLUMN kommo_access_token TEXT AFTER meta_access_token;
-- ALTER TABLE ad_accounts ADD COLUMN content_category VARCHAR(255) AFTER kommo_access_token;
-- ALTER TABLE ad_accounts ADD COLUMN client_db_name VARCHAR(64) UNIQUE AFTER content_category;
-- -- Se a coluna "state" existir de uma versão anterior, ela deve ser removida
-- -- (o estado agora é resolvido por lead em customers.state, não por cliente):
-- -- ALTER TABLE ad_accounts DROP COLUMN state;
-- -- Se a tabela crm_meta_event_map existir aqui de uma versão anterior, os dados
-- -- devem ser migrados para o banco de cada cliente (veja 02_Template) e a tabela
-- -- central removida:
-- -- DROP TABLE crm_meta_event_map;

-- =======================================================
-- MIGRAÇÃO: sync sob demanda (lock/cooldown) + painel_metric_prefs
-- por cliente — rodar apenas se ad_accounts/painel_metric_prefs já
-- existirem sem as colunas novas (backup antes, não é destrutivo mas
-- é boa prática seguida no resto do projeto):
-- =======================================================
-- CREATE TABLE `trakeamento_controle`.`ad_accounts_backup_20260818`
--   AS SELECT * FROM `trakeamento_controle`.`ad_accounts`;
-- CREATE TABLE `trakeamento_controle`.`painel_metric_prefs_backup_20260818`
--   AS SELECT * FROM `trakeamento_controle`.`painel_metric_prefs`;
--
-- ALTER TABLE `trakeamento_controle`.`ad_accounts`
--   ADD COLUMN `last_sync_started_at` TIMESTAMP NULL DEFAULT NULL AFTER `status`;
--
-- -- painel_metric_prefs passa a admitir override por cliente (mantém
-- -- compatibilidade total com as métricas já existentes, que continuam
-- -- usando client_db_name = '' = "global"; ver migration_painel_metric_prefs.sql):
-- ALTER TABLE `trakeamento_controle`.`painel_metric_prefs`
--   ADD COLUMN `client_db_name` VARCHAR(191) NOT NULL DEFAULT '' AFTER `metric_key`,
--   DROP PRIMARY KEY,
--   ADD PRIMARY KEY (`client_db_name`, `metric_key`);
