-- =======================================================
-- Migração: subdomínio do Kommo por cliente
-- (banco CENTRAL — trakeamento_controle)
--
-- Contexto: toda chamada à API do Kommo é feita no endereço da conta do
-- cliente (https://<subdominio>.kommo.com/api/v4/...). No fluxo de
-- eventos o subdomínio vem de graça, dentro do webhook que o próprio
-- Kommo manda. A automação "Kommo - Sincroniza Perdidos" não tem
-- webhook: ela acorda sozinha de tempos em tempos e precisa saber para
-- qual endereço perguntar, por isso o subdomínio passa a ficar salvo
-- aqui, ao lado do token.
--
-- Guarde só o subdomínio, não a URL inteira: "minhaempresa", não
-- "https://minhaempresa.kommo.com".
--
-- Cliente sem subdomínio salvo é simplesmente pulado pela automação —
-- nada mais no painel depende desta coluna.
--
-- ANTES DE RODAR: faça backup, ex.:
--   CREATE TABLE ad_accounts_backup_20260903 AS SELECT * FROM ad_accounts;
-- =======================================================

USE `trakeamento_controle`;

ALTER TABLE `ad_accounts`
  ADD COLUMN `kommo_subdomain` VARCHAR(120) NULL DEFAULT NULL AFTER `kommo_access_token`;

-- Conferência (devolve linha se a coluna existe, "Unknown column" se não):
SELECT account_name, kommo_subdomain FROM `ad_accounts` ORDER BY account_name;
