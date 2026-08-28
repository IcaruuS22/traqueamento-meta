-- =======================================================
-- Migração: Evolution API (banco CENTRAL trakeamento_controle)
--
-- Até aqui `whatsapp_accounts` só sabia falar Cloud API oficial da
-- Meta: as três colunas `cloud_*` eram obrigatórias. A Evolution API
-- roda no servidor do próprio cliente e não tem phone_number_id nem
-- token da Meta — tem URL base, nome de instância e uma api key.
--
-- Em vez de criar uma segunda tabela (o que duplicaria o vínculo com
-- `ad_accounts` e obrigaria toda leitura a consultar duas), a mesma
-- linha passa a guardar as duas formas de conexão, com uma coluna
-- `provider` dizendo qual delas vale. Isso mantém a regra de negócio
-- que já existia: uma conexão de WhatsApp por cliente.
--
-- Rode isto UMA VEZ no banco central.
-- =======================================================

-- Backup antes de alterar (a tabela é pequena; o custo é irrelevante
-- perto de perder o token da Cloud API de um cliente em produção).
CREATE TABLE IF NOT EXISTS `trakeamento_controle`.`whatsapp_accounts_backup_20260827`
  AS SELECT * FROM `trakeamento_controle`.`whatsapp_accounts`;

-- 1) As colunas da Cloud API deixam de ser obrigatórias: um cliente
--    conectado pela Evolution API não tem valor nenhum para elas.
--    O UNIQUE em `cloud_phone_number_id` continua valendo — no MySQL
--    um índice único aceita vários NULL, então os clientes de
--    Evolution não colidem entre si.
ALTER TABLE `trakeamento_controle`.`whatsapp_accounts`
  MODIFY COLUMN `cloud_phone_number_id` VARCHAR(255) NULL,
  MODIFY COLUMN `cloud_access_token` VARCHAR(512) NULL;

-- 2) Qual conexão vale para este cliente. Todo mundo que já estava na
--    tabela veio da Cloud API, e o DEFAULT preserva isso sem UPDATE.
--    Se as colunas já existirem (rodou a migração 2x), o ALTER falha
--    com "Duplicate column name" -- pode ignorar nesse caso.
ALTER TABLE `trakeamento_controle`.`whatsapp_accounts`
  ADD COLUMN `provider` VARCHAR(20) NOT NULL DEFAULT 'cloud' AFTER `status`,
  ADD COLUMN `evolution_base_url` VARCHAR(255) NULL,
  ADD COLUMN `evolution_instance` VARCHAR(120) NULL,
  ADD COLUMN `evolution_api_key` VARCHAR(255) NULL,
  ADD COLUMN `evolution_webhook_token` VARCHAR(64) NULL,
  ADD COLUMN `evolution_state` VARCHAR(20) NULL,
  ADD COLUMN `evolution_number` VARCHAR(30) NULL;
-- provider ................ 'cloud' | 'evolution'
-- evolution_base_url ...... raiz da API no servidor do cliente, ex.
--                           https://evo.meudominio.com (sem barra final)
-- evolution_instance ...... nome da instância criada na Evolution.
--                           Derivado do client_db_name, único por servidor.
-- evolution_api_key ....... credencial da Evolution (header `apikey`).
--                           Segredo de terceiro em texto puro, mesma
--                           categoria de `cloud_access_token`: nunca sai
--                           do servidor, nem mascarada.
-- evolution_webhook_token . segredo aleatório que a Evolution devolve na
--                           URL do webhook. É o que prova que a chamada
--                           que chega em /api/webhooks/evolution veio do
--                           servidor do cliente, e não de qualquer um que
--                           saiba o nome do banco.
-- evolution_state ......... último estado conhecido ('open' | 'close' |
--                           'connecting'). Cache para a tela abrir sem
--                           esperar a API; a verdade é a Evolution.
-- evolution_number ........ número que atendeu o QR Code, só para exibir.

-- 3) O nome da instância identifica a conexão no webhook, então não pode
--    se repetir entre clientes.
ALTER TABLE `trakeamento_controle`.`whatsapp_accounts`
  ADD CONSTRAINT `whatsapp_accounts_evolution_instance_key` UNIQUE (`evolution_instance`);

-- =======================================================
-- Verificação pós-migração
-- =======================================================
SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.columns
 WHERE table_schema = 'trakeamento_controle'
   AND table_name = 'whatsapp_accounts'
 ORDER BY ORDINAL_POSITION;

SELECT provider, COUNT(*) AS contas
  FROM `trakeamento_controle`.`whatsapp_accounts`
 GROUP BY provider;
