-- =======================================================
-- Migracao: hierarquia de Campanhas (Campanha -> Conjunto -> Anuncio)
-- com metricas do Meta Ads + flag de conversao para CAC.
--
-- Rode isto DENTRO de cada banco de cliente (client_db_name na
-- tabela central trakeamento_controle.ad_accounts), uma vez por
-- cliente ja existente. Novos clientes ja vao nascer com este
-- schema (ver ajuste no node "Prepara Cadastro").
--
-- ANTES DE RODAR: faca backup da tabela alterada, ex.:
--   CREATE TABLE crm_meta_event_map_backup_20260818 AS
--   SELECT * FROM crm_meta_event_map;
-- (as tabelas novas nao precisam de backup, sao CREATE TABLE IF NOT EXISTS)
-- =======================================================

-- 1) Flag de conversao no mapeamento de eventos (usado no calculo de CAC).
--    Se a coluna ja existir (rodou a migracao 2x), o ALTER abaixo falha
--    com erro "Duplicate column name" -- pode ignorar nesse caso.
ALTER TABLE `crm_meta_event_map`
  ADD COLUMN `is_conversion` BOOLEAN DEFAULT FALSE NOT NULL AFTER `ativo`;

-- 2) Metadados de campanha (uma linha por campanha, sem historico)
CREATE TABLE IF NOT EXISTS `meta_campaigns` (
  `campaign_id` VARCHAR(255) PRIMARY KEY,
  `campaign_name` VARCHAR(255),
  `status` VARCHAR(50),
  `objective` VARCHAR(100),
  `daily_budget` DECIMAL(12,2),
  `lifetime_budget` DECIMAL(12,2),
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Metadados de conjunto de anuncios
CREATE TABLE IF NOT EXISTS `meta_adsets` (
  `adset_id` VARCHAR(255) PRIMARY KEY,
  `campaign_id` VARCHAR(255),
  `adset_name` VARCHAR(255),
  `status` VARCHAR(50),
  `daily_budget` DECIMAL(12,2),
  `lifetime_budget` DECIMAL(12,2),
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_campaign_id (campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) Metadados de anuncio
CREATE TABLE IF NOT EXISTS `meta_ads` (
  `ad_id` VARCHAR(255) PRIMARY KEY,
  `adset_id` VARCHAR(255),
  `campaign_id` VARCHAR(255),
  `ad_name` VARCHAR(255),
  `status` VARCHAR(50),
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_adset_id (adset_id),
  INDEX idx_campaign_id (campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5) Metricas diarias -- uma tabela unificada com discriminador de nivel.
--    entity_id guarda campaign_id/adset_id/ad_id conforme entity_level;
--    campaign_id/adset_id ficam preenchidos mesmo em linhas de nivel "ad"
--    para permitir GROUP BY em qualquer nivel sem join extra.
--    raw_insights arquiva o payload cru da Graph API (mesmo padrao de
--    meta_capi_events.meta_payload_sent) para nao perder metricas que
--    ainda nao viraram coluna propria.
CREATE TABLE IF NOT EXISTS `meta_insights_daily` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `entity_level` ENUM('campaign','adset','ad') NOT NULL,
  `entity_id` VARCHAR(255) NOT NULL,
  `campaign_id` VARCHAR(255) NOT NULL,
  `adset_id` VARCHAR(255),
  `ad_id` VARCHAR(255),
  `date` DATE NOT NULL,
  `spend` DECIMAL(12,2) DEFAULT 0,
  `impressions` BIGINT DEFAULT 0,
  `reach` BIGINT DEFAULT 0,
  `frequency` DECIMAL(10,4) DEFAULT 0,
  `clicks` BIGINT DEFAULT 0,
  `unique_clicks` BIGINT DEFAULT 0,
  `cpc` DECIMAL(12,4) DEFAULT 0,
  `cpm` DECIMAL(12,4) DEFAULT 0,
  `ctr` DECIMAL(10,4) DEFAULT 0,
  `raw_insights` JSON,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY meta_insights_daily_unique (entity_level, entity_id, date),
  INDEX idx_campaign_date (campaign_id, date),
  INDEX idx_adset_date (adset_id, date),
  INDEX idx_ad_date (ad_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =======================================================
-- Verificacao pos-migracao
-- =======================================================
SELECT COUNT(*) AS tem_coluna_is_conversion
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'crm_meta_event_map' AND column_name = 'is_conversion';

SHOW TABLES LIKE 'meta_%';
