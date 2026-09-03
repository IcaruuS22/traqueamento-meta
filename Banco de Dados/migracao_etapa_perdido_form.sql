-- =======================================================
-- Migração: etapa "perdido" no funil de Formulários
-- (banco DE CADA CLIENTE — rode uma vez por client_db_name)
--
-- Contexto: o funil do Kommo tem a etapa de perda, mas o painel não
-- sabia disso. Toda etapa cadastrada em crm_meta_event_map existia para
-- disparar evento à Meta; a de perda não dispara nada — ela só move o
-- lead e registra por que o negócio caiu.
--
-- O que cada coluna faz:
--
--   crm_meta_event_map.is_lost  marca a etapa como "etapa de perda". A
--                               tela de Configuração de Eventos passa a
--                               aceitar essa linha sem Evento Meta, e
--                               grava ativo = 0 junto: é o ativo = 0 que
--                               garante, sem depender de reimportar
--                               workflow nenhum, que o fluxo de eventos
--                               nunca case com essa etapa e nunca envie
--                               evento por causa dela. O quadro do CRM
--                               continua mostrando a coluna, porque
--                               passa a ler `ativo = 1 OR is_lost = 1`.
--
--   customers.lost_reason       motivo da perda vindo do Kommo (ou
--                               digitado). Mesmo tamanho de
--                               whatsapp_conversations.lost_reason, que
--                               guarda o motivo do outro funil.
--   customers.lost_at           quando o lead foi marcado como perdido.
--                               É também o que a automação
--                               "Kommo - Sincroniza Perdidos" usa para
--                               não reconferir o mesmo lead todo ciclo.
--
-- Enquanto esta migração não roda, o painel segue funcionando: a leitura
-- das três colunas é tolerante à ausência delas (o quadro cai na
-- consulta antiga, e o lead aparece sem motivo de perda).
--
-- ANTES DE RODAR: faça backup, ex.:
--   CREATE TABLE customers_backup_20260903 AS SELECT * FROM customers;
-- =======================================================

-- Troque pelo banco do cliente (ad_accounts.client_db_name).
USE `{{DB_NAME}}`;

ALTER TABLE `crm_meta_event_map`
  ADD COLUMN `is_lost` BOOLEAN DEFAULT FALSE NOT NULL AFTER `is_conversion`;

ALTER TABLE `customers`
  ADD COLUMN `lost_reason` VARCHAR(120) NULL DEFAULT NULL AFTER `crm_value`,
  ADD COLUMN `lost_at` TIMESTAMP NULL DEFAULT NULL AFTER `lost_reason`;

-- Conferência (devolve linha se as colunas existem, "Unknown column" se não):
SELECT status_id, content_name, ativo, is_conversion, is_lost
  FROM `crm_meta_event_map` ORDER BY id ASC;
SELECT COUNT(*) AS leads_perdidos FROM `customers` WHERE lost_at IS NOT NULL;
