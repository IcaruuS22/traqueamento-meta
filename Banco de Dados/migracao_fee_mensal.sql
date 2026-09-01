-- =======================================================
-- Migração: fee (budget) mensal por cliente
-- (banco CENTRAL — trakeamento_controle)
--
-- Contexto: a aba "Métricas Gerais" passou a mostrar um indicador de
-- ritmo de gasto — quanto das campanhas já foi gasto no mês corrente
-- contra o valor combinado com o cliente, e se o orçamento diário deve
-- subir ou descer para o mês fechar no combinado. O valor combinado é
-- este campo. O gasto continua vindo de meta_insights_daily (nível
-- 'campaign'), como em todo o resto do painel — a migração não guarda
-- gasto nenhum, só o limite.
--
-- Rode no banco CENTRAL, uma única vez. Novos clientes já nascem com a
-- coluna (ver 00_Banco_Central_Do_Zero e 01_Banco_Central_Controle).
--
-- Enquanto esta migração não roda, o app segue funcionando: a leitura do
-- fee tolera a coluna ausente (lacuna de esquema) e o card aparece
-- pedindo que o valor seja cadastrado.
--
-- ANTES DE RODAR: faça backup, ex.:
--   CREATE TABLE ad_accounts_backup_20260901 AS SELECT * FROM ad_accounts;
-- =======================================================

USE `trakeamento_controle`;

ALTER TABLE `ad_accounts`
  ADD COLUMN `monthly_fee` DECIMAL(12,2) NULL DEFAULT NULL AFTER `content_category`;

-- monthly_fee ... valor mensal combinado com o cliente para mídia, na
--                 moeda da conta de anúncios. NULL = não combinado; o
--                 indicador fica neutro em vez de acusar estouro de um
--                 limite de zero.

-- Conferência:
-- SELECT account_name, monthly_fee FROM ad_accounts ORDER BY account_name;
