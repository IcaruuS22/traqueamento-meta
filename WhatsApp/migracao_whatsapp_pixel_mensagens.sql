-- =======================================================
-- Migração: pixel de mensagens próprio (banco CENTRAL trakeamento_controle)
--
-- Até aqui os eventos de WhatsApp saíam pelo mesmo dataset dos leads de
-- formulário (`ad_accounts.meta_pixel_dataset_id`), porque era o único
-- que existia. O efeito é que conversa de WhatsApp virava conversão no
-- pixel do site, misturada com os leads de formulário — e o
-- `meta_test_event_code`, por ser da mesma linha, não dava para ligar em
-- um funil sem marcar o outro como teste também.
--
-- A partir daqui o WhatsApp tem dataset, token e código de teste
-- próprios, guardados na linha da conexão em `whatsapp_accounts`. É o
-- mesmo raciocínio de `provider`: o que é do WhatsApp mora com o
-- WhatsApp.
--
-- IMPORTANTE: `capi_modo` nasce em 'teste'. Depois desta migração,
-- nenhum evento de WhatsApp conta como conversão real até alguém trocar
-- o modo para 'producao' na tela de Conexão. Isso é intencional — o modo
-- anterior mandava para o pixel errado, e voltar a mandar sozinho seria
-- repetir o problema com outro destino.
--
-- Rode isto UMA VEZ no banco central.
-- =======================================================

-- Backup antes de alterar (tabela pequena; o custo é irrelevante perto
-- de perder a credencial de conexão de um cliente em produção).
CREATE TABLE IF NOT EXISTS `trakeamento_controle`.`whatsapp_accounts_backup_20260901`
  AS SELECT * FROM `trakeamento_controle`.`whatsapp_accounts`;

-- Se as colunas já existirem (rodou a migração 2x), o ALTER falha com
-- "Duplicate column name" -- pode ignorar nesse caso.
ALTER TABLE `trakeamento_controle`.`whatsapp_accounts`
  ADD COLUMN `capi_modo` VARCHAR(16) NOT NULL DEFAULT 'teste',
  ADD COLUMN `capi_dataset_id` VARCHAR(64) NULL,
  ADD COLUMN `capi_access_token` VARCHAR(512) NULL,
  ADD COLUMN `capi_test_event_code` VARCHAR(64) NULL;
-- capi_modo ............... 'desligado' | 'teste' | 'producao'
--                           desligado: nada sai para a Meta.
--                           teste: sai com test_event_code, aparece em
--                             "Testar eventos" e não vira conversão.
--                           producao: sai valendo.
-- capi_dataset_id ......... dataset/pixel de MENSAGENS. Sem ele nenhum
--                           evento sai, em modo nenhum: não há mais
--                           queda para o dataset dos formulários.
-- capi_access_token ....... token da CAPI desse dataset. Vazio faz o
--                           envio usar `ad_accounts.meta_access_token`,
--                           que serve quando os dois datasets estão na
--                           mesma conta de negócios. Segredo de terceiro
--                           em texto puro, mesma categoria de
--                           `cloud_access_token`: nunca sai do servidor.
-- capi_test_event_code .... código de teste só do WhatsApp. Separado de
--                           `ad_accounts.meta_test_event_code` de
--                           propósito: é ele que permite testar as
--                           mensagens sem marcar os formulários.

-- =======================================================
-- Verificação pós-migração
-- =======================================================
SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.columns
 WHERE table_schema = 'trakeamento_controle'
   AND table_name = 'whatsapp_accounts'
   AND COLUMN_NAME LIKE 'capi\_%'
 ORDER BY ORDINAL_POSITION;

SELECT client_db_name, capi_modo,
       (capi_dataset_id IS NOT NULL AND capi_dataset_id <> '') AS tem_dataset,
       (capi_test_event_code IS NOT NULL AND capi_test_event_code <> '') AS tem_codigo_teste
  FROM `trakeamento_controle`.`whatsapp_accounts`;
