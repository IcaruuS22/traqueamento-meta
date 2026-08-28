-- =======================================================
-- Migração: mídia das conversas de WhatsApp (banco POR CLIENTE)
--
-- Rode DENTRO de cada banco `cliente_*` que já existe, uma vez por
-- cliente. Bancos criados depois desta data já nascem com isto
-- (ver 02_Template_Banco_Por_Cliente.sql).
--
-- O que muda: imagem, áudio, vídeo, documento, figurinha e localização
-- deixam de ser só um rótulo na bolha ("📎 Imagem recebida") e passam a
-- ser exibidos de verdade na tela de Conversas.
--
-- Rodar duas vezes devolve "Duplicate column name" no ALTER — pode
-- ignorar nesse caso; o CREATE TABLE é IF NOT EXISTS.
-- =======================================================

-- 1) Descrição da mídia, junto da mensagem
--
-- Fica em `whatsapp_messages` porque é o que a lista e a thread leem a
-- cada atualização: manter aqui evita um JOIN com a tabela de bytes só
-- para saber se existe arquivo e como rotulá-lo.
--
-- media_status diz por que a mídia pode não estar disponível:
--   'ok'       -> os bytes estão em whatsapp_media
--   'pendente' -> mensagem gravada, download do arquivo ainda em curso
--                 (some sozinho na próxima atualização da tela)
--   'grande'   -> passou do limite que o app guarda (16 MB)
--   'falha'    -> a Evolution não devolveu o arquivo (mensagem apagada,
--                 mídia expirada no servidor, erro de rede)
--   NULL       -> mensagem de texto, ou mensagem gravada antes desta
--                 migração
ALTER TABLE `whatsapp_messages`
  ADD COLUMN `media_mime` VARCHAR(120) NULL,
  ADD COLUMN `media_filename` VARCHAR(255) NULL,
  ADD COLUMN `media_size` INT NULL,
  ADD COLUMN `media_seconds` INT NULL,
  ADD COLUMN `media_status` VARCHAR(20) NULL;

-- 2) Os bytes, em tabela própria
--
-- Tabela separada de propósito: um LONGBLOB na mesma tabela faria toda
-- leitura da thread carregar páginas de arquivo do disco mesmo com
-- `SELECT` sem a coluna. Aqui os bytes só são lidos pela rota que serve
-- o arquivo, uma mensagem por vez.
--
-- ON DELETE CASCADE: apagar a conversa (função de administrador do
-- painel) tem que levar os arquivos junto, senão o banco cresce com
-- mídia órfã que ninguém mais alcança.
CREATE TABLE IF NOT EXISTS `whatsapp_media` (
  `message_id` BIGINT PRIMARY KEY,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `mime_type` VARCHAR(120) NOT NULL,
  `bytes` LONGBLOB NOT NULL,
  CONSTRAINT `whatsapp_media_message_id_fkey`
    FOREIGN KEY (`message_id`) REFERENCES `whatsapp_messages`(`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =======================================================
-- Conferência
-- =======================================================
SELECT COLUMN_NAME, COLUMN_TYPE
  FROM information_schema.columns
 WHERE table_schema = DATABASE()
   AND table_name = 'whatsapp_messages'
   AND COLUMN_NAME LIKE 'media_%'
 ORDER BY ORDINAL_POSITION;
