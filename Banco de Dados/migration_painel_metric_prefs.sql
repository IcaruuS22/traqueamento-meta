-- =======================================================
-- Migração: painel_metric_prefs (tabela GLOBAL/central)
-- =======================================================
-- Roda UMA VEZ no banco `trakeamento_controle` (o banco central de
-- admin, o mesmo que já guarda `ad_accounts`) — NÃO é por cliente,
-- então não precisa ser repetida em cada banco de cliente e não
-- precisa ser adicionada ao node "Prepara Cadastro" do workflow
-- "Cria Cliente - Formulario.json" (aquele node só provisiona schema
-- por cliente).
--
-- Guarda uma única preferência global de "essa métrica aparece no
-- grid de KPIs da aba Métricas Gerais?" — vale para todos os
-- clientes/navegadores, no formato pedido (estilo UTMify: liga/desliga
-- card por card).
--
-- Recomendação de segurança antes de rodar: se quiser um backup
-- rápido antes de criar a tabela nova (não é destrutivo, mas é boa
-- prática seguida no resto do projeto), não há nada para copiar aqui
-- ainda, pois a tabela não existe — CREATE TABLE IF NOT EXISTS é
-- seguro de rodar mesmo que já exista.

CREATE TABLE IF NOT EXISTS `trakeamento_controle`.`painel_metric_prefs` (
  `metric_key` VARCHAR(50) NOT NULL,
  -- '' = preferência GLOBAL (vale para todo cliente que não tenha override
  -- próprio); um client_db_name específico = override só daquele cliente
  -- (usado pelas métricas marcadas clientScoped: true no catálogo, ex.
  -- Receita/ROAS). Ver seção de migração abaixo se a tabela já existir
  -- sem esta coluna.
  `client_db_name` VARCHAR(191) NOT NULL DEFAULT '',
  `visible` BOOLEAN NOT NULL DEFAULT TRUE,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`client_db_name`, `metric_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Nada mais a fazer: métricas sem linha nesta tabela são tratadas como
-- visíveis por padrão pelo painel (o catálogo do front-end já define
-- os defaults) — a tabela só guarda os "toggles" que o usuário mexeu.

-- =======================================================
-- MIGRAÇÃO (rodar apenas se a tabela já existir na forma antiga,
-- sem client_db_name — versão anterior a 2026-08-18):
-- =======================================================
-- CREATE TABLE `trakeamento_controle`.`painel_metric_prefs_backup_20260818`
--   AS SELECT * FROM `trakeamento_controle`.`painel_metric_prefs`;
--
-- ALTER TABLE `trakeamento_controle`.`painel_metric_prefs`
--   ADD COLUMN `client_db_name` VARCHAR(191) NOT NULL DEFAULT '' AFTER `metric_key`,
--   DROP PRIMARY KEY,
--   ADD PRIMARY KEY (`client_db_name`, `metric_key`);
