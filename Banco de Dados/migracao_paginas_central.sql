-- ===================================================================
-- MIGRAÇÃO: rastreio de páginas de vendas — banco central
-- Alvo: trakeamento_controle (UMA vez).
-- Par: migracao_paginas_cliente.sql, que roda em cada banco de cliente.
-- ===================================================================
--
-- Motivo. Até aqui o app só enxergava leads de formulário instantâneo
-- (via n8n) e conversas de WhatsApp. Páginas de vendas — WordPress,
-- Lovable, sites em Vercel, HTML próprio — ficavam de fora: a visita, o
-- formulário preenchido na página, o clique no checkout e a compra não
-- chegavam ao painel nem à Conversions API.
--
-- Esta tabela é o cadastro dos sites. Cada linha é uma página (ou um
-- conjunto de páginas do mesmo domínio) de um cliente, com:
--
--   site_key       identificador PÚBLICO que vai na tag <script> da
--                  página. Não é segredo: qualquer visitante o vê no
--                  código-fonte. O que impede alguém de usá-lo em outro
--                  site é a lista de domínios.
--   webhook_token  segredo que vai SÓ na URL do webhook de compra
--                  cadastrada na plataforma de checkout (Hotmart,
--                  Kiwify...). É ele que impede uma compra falsa de
--                  virar Purchase no pixel do cliente.
--   dominios       hosts autorizados a mandar eventos com esta site_key,
--                  separados por vírgula. Subdomínios entram junto
--                  ("exemplo.com" libera "www.exemplo.com" e
--                  "lp.exemplo.com"). Vazio = nenhum evento aceito.
--   kommo_*        etapa em que o lead de formulário da página entra no
--                  Kommo. Vazio = etapa inicial do funil principal.
--
-- Fica no central, e não no banco do cliente, porque a coleta é pública:
-- a rota recebe só a site_key e precisa descobrir DE QUAL cliente ela é
-- antes de saber em qual banco escrever. Guardar no banco do cliente
-- obrigaria a procurar a chave em todos eles.
--
-- ANTES DE RODAR: faça backup do banco central.
-- Segurança da execução: só CREATE TABLE. Não altera tabela existente.
--
-- Como aplicar:
--   mysql -u USUARIO -p < migracao_paginas_central.sql
-- ===================================================================

USE trakeamento_controle;

CREATE TABLE IF NOT EXISTS paginas_sites (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  client_db_name VARCHAR(64) NOT NULL,
  nome VARCHAR(120) NOT NULL,
  site_key VARCHAR(32) NOT NULL,
  webhook_token CHAR(64) NOT NULL,
  dominios VARCHAR(1000) NOT NULL DEFAULT '',
  kommo_pipeline_id VARCHAR(40) NULL DEFAULT NULL,
  kommo_status_id VARCHAR(40) NULL DEFAULT NULL,
  envia_kommo BOOLEAN NOT NULL DEFAULT TRUE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT paginas_sites_site_key_key UNIQUE (site_key),
  CONSTRAINT paginas_sites_client_db_name_fkey
    FOREIGN KEY (client_db_name)
    REFERENCES ad_accounts(client_db_name)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Conferência
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.columns
 WHERE table_schema = 'trakeamento_controle'
   AND table_name = 'paginas_sites'
 ORDER BY ORDINAL_POSITION;
