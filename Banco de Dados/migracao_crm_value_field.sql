-- =======================================================
-- Migração: campo do valor do negócio no CRM, por cliente
-- (banco CENTRAL — trakeamento_controle)
--
-- Contexto: o valor que vai no evento de conversão sai do campo nativo
-- "Venda" (price) do negócio no Kommo. Nem todo cliente usa esse campo:
-- alguns guardam o valor num campo personalizado, com o rótulo que
-- quiseram ("Valor do contrato", "Ticket médio", "Fechamento"). Sem
-- saber o rótulo, o fluxo só acertava por sorte — e procurar por
-- semelhança de nome era pior, porque um campo como "Valor de conta"
-- ("Acima de R$ 1.000,00") viraria um valor inventado no evento.
--
-- Esta coluna guarda, por cliente, qual campo personalizado consultar:
-- o rótulo exato (field_name) ou o id numérico do campo (field_id), que
-- é o mais seguro porque não muda quando alguém renomeia o campo.
--
-- Rode no banco CENTRAL, uma única vez. Novos clientes já nascem com a
-- coluna (ver 00_Banco_Central_Do_Zero e 01_Banco_Central_Controle).
--
-- Enquanto esta migração não roda, tudo segue funcionando: o painel
-- tolera a coluna ausente e o fluxo do n8n cai na lista de rótulos
-- conhecidos ("venda", "valor", "valor do contrato", ...).
--
-- ANTES DE RODAR: faça backup, ex.:
--   CREATE TABLE ad_accounts_backup_20260903 AS SELECT * FROM ad_accounts;
-- =======================================================

USE `trakeamento_controle`;

ALTER TABLE `ad_accounts`
  ADD COLUMN `crm_value_field` VARCHAR(120) NULL DEFAULT NULL AFTER `content_category`;

-- crm_value_field ... rótulo exato ou id numérico do campo personalizado
--                     do Kommo que guarda o valor do negócio. NULL = usa
--                     o campo nativo "Venda" e, na falta dele, a lista de
--                     rótulos conhecidos.

-- Conferência (devolve linha se a coluna existe, "Unknown column" se não):
SELECT account_name, crm_value_field FROM `ad_accounts` ORDER BY account_name;
