-- =======================================================
-- Migração: valor do negócio vindo do CRM (banco POR CLIENTE)
--
-- Rode DENTRO de cada banco `cliente_*` que já existe, uma vez por
-- cliente. Bancos criados depois desta data já nascem com isto
-- (ver 02_Template_Banco_Por_Cliente.sql).
--
-- O que muda: o webhook do Kommo já mandava o `price` do negócio, e o
-- fluxo do n8n descartava. A partir daqui o preço é guardado no lead e
-- vai como `custom_data.value` no evento enviado à Meta — o que também
-- faz a receita e o ROAS do painel deixarem de ser sempre zero, já que
-- os dois somam `meta_capi_events.value`.
--
-- Rodar duas vezes devolve "Duplicate column name" — pode ignorar nesse
-- caso, nada além da coluna é criado aqui.
-- =======================================================

-- Por que fica em `customers`, e não em `meta_capi_events`:
-- `meta_capi_events` já tem `value`, mas é o registro do que foi
-- enviado, um por evento. O preço precisa sobreviver entre um evento e
-- outro: o Kommo só manda o `price` no webhook em que ele muda, e o
-- Purchase costuma ser disparado numa etapa posterior, cujo webhook
-- pode vir sem preço nenhum. Guardado no lead, o último preço conhecido
-- está sempre disponível na hora de montar o evento.
--
-- DECIMAL(14,2) e não FLOAT: valor monetário, arredondamento binário
-- aqui viraria centavo errado no relatório.
ALTER TABLE `customers`
  ADD COLUMN `crm_value` DECIMAL(14,2) NULL AFTER `current_stage`;

-- =======================================================
-- Conferência
-- =======================================================
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.columns
 WHERE table_schema = DATABASE()
   AND table_name = 'customers'
   AND COLUMN_NAME = 'crm_value';
