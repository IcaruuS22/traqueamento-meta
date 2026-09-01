-- =======================================================
-- BANCO CENTRAL DE CONTROLE — INSTALAÇÃO DO ZERO
--
-- Use ESTE arquivo para montar um ambiente novo. Ele já vem com
-- tudo que as migrações foram acrescentando ao banco central desde
-- a versão original:
--
--   01_Banco_Central_Controle ............ ad_accounts, ddd_state_map
--   WhatsApp/migration_whatsapp .......... whatsapp_accounts e
--                                          ad_accounts.meta_test_event_code
--   WhatsApp/migracao_whatsapp_evolution . provider e colunas evolution_*
--   migration_painel_metric_prefs ........ painel_metric_prefs
--
-- Em um banco NOVO, rode só este arquivo — as migrações acima já
-- estão embutidas, e rodá-las depois só devolveria "Duplicate column".
-- Em um banco QUE JÁ EXISTE, NÃO rode este arquivo: use as migrações
-- individuais, que são o que sabe alterar tabela com dado dentro.
--
-- Ordem completa de uma instalação limpa:
--   1. este arquivo                       (banco central)
--   2. 03_App_Auth_Usuarios.sql           (banco central, login do app)
--   3. 02_Template_Banco_Por_Cliente.sql  (uma vez por cliente, dentro
--                                          do banco cliente_<algo> dele)
-- =======================================================

CREATE DATABASE IF NOT EXISTS trakeamento_controle
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE trakeamento_controle;

-- -------------------------------------------------------
-- 1. ad_accounts — o catálogo de clientes
--
-- Uma linha por cliente. `client_db_name` aponta para o banco
-- isolado daquele cliente (customers, meta_capi_events, conversas
-- de WhatsApp — ver 02_Template_Banco_Por_Cliente.sql).
--
-- Não guarda "state": o hash de estado (st) enviado à Meta é
-- resolvido por LEAD (customers.state), não por cliente.
--
-- meta_access_token e kommo_access_token são credenciais de terceiro
-- guardadas em texto puro. Nenhuma tela do app devolve esses valores,
-- nem mascarados (ver ARQUITETURA_APP.md, seção 3.3).
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_accounts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  ad_account_id VARCHAR(255) NOT NULL,
  crm_account_id VARCHAR(255),
  meta_pixel_dataset_id VARCHAR(255),
  meta_access_token VARCHAR(512),
  -- Código do Gerenciador de Eventos (aba Test Events). Enquanto
  -- preenchido, os eventos saem em modo de teste e não contam como
  -- conversão real. Vazio = produção.
  meta_test_event_code VARCHAR(50) NULL,
  kommo_access_token TEXT,
  content_category VARCHAR(255),
  -- Valor mensal combinado com o cliente para mídia. NULL = não
  -- combinado. Alimenta o indicador de ritmo de gasto da aba Métricas.
  monthly_fee DECIMAL(12,2) NULL DEFAULT NULL,
  client_db_name VARCHAR(64),
  status VARCHAR(50) DEFAULT 'ACTIVE',
  -- Lock/cooldown da sincronização sob demanda (substituiu o cron de
  -- 6h): cada clique em "Atualizar" tenta marcar NOW() e só segue se a
  -- marcação anterior tiver mais de 60s. Não precisa de unlock.
  last_sync_started_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT ad_accounts_ad_account_id_key UNIQUE (ad_account_id),
  CONSTRAINT ad_accounts_crm_account_id_key UNIQUE (crm_account_id),
  CONSTRAINT ad_accounts_client_db_name_key UNIQUE (client_db_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_ad_accounts_meta_id ON ad_accounts(ad_account_id);
CREATE INDEX idx_ad_accounts_crm_id ON ad_accounts(crm_account_id);

-- -------------------------------------------------------
-- 2. ddd_state_map — referência DDD -> UF
--
-- Genérica, não é de cliente nenhum: por isso fica no central. É o
-- que resolve customers.state a partir do telefone do lead.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ddd_state_map (
  ddd INT PRIMARY KEY,
  state VARCHAR(2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------
-- 3. whatsapp_accounts — a conexão de WhatsApp de cada cliente
--
-- Uma conexão por cliente, em duas formas possíveis, e `provider`
-- diz qual delas vale:
--
--   'cloud'     -> Cloud API oficial da Meta (colunas cloud_*)
--   'evolution' -> Evolution API no servidor do cliente (evolution_*)
--
-- As duas moram na mesma linha de propósito: uma segunda tabela
-- duplicaria o vínculo com ad_accounts e obrigaria toda leitura a
-- consultar as duas. Por isso as colunas cloud_* aceitam NULL — um
-- cliente de Evolution não tem phone_number_id nem token da Meta.
--
-- cloud_access_token e evolution_api_key são segredos de terceiro em
-- texto puro; as telas só informam se existem, nunca o valor.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_accounts (
  client_db_name VARCHAR(64) PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  status VARCHAR(20) DEFAULT 'ACTIVE' NOT NULL,
  provider VARCHAR(20) NOT NULL DEFAULT 'cloud',

  -- WhatsApp Cloud API (Meta)
  cloud_phone_number_id VARCHAR(255) NULL,
  cloud_waba_id VARCHAR(255),
  cloud_access_token VARCHAR(512) NULL,

  -- Evolution API (conexão por QR Code)
  -- base_url ......... raiz da API, ex. https://evo.dominio.com (sem
  --                    barra no fim)
  -- instance ......... nome da instância, derivado do client_db_name.
  --                    É por ele que o webhook descobre de qual cliente
  --                    a mensagem é, então não pode repetir.
  -- api_key .......... credencial da Evolution (header `apikey`)
  -- webhook_token .... segredo aleatório que viaja na URL do webhook.
  --                    É o que prova que a chamada em
  --                    /api/webhooks/evolution veio do servidor do
  --                    cliente, e não de quem souber o nome da instância.
  -- state ............ último estado conhecido ('open' | 'close' |
  --                    'connecting'). Cache de tela; a verdade é a
  --                    própria Evolution.
  -- number ........... número que atendeu o QR Code, só para exibir.
  evolution_base_url VARCHAR(255) NULL,
  evolution_instance VARCHAR(120) NULL,
  evolution_api_key VARCHAR(255) NULL,
  evolution_webhook_token VARCHAR(64) NULL,
  evolution_state VARCHAR(20) NULL,
  evolution_number VARCHAR(30) NULL,

  -- O MySQL aceita vários NULL num índice único, então clientes sem
  -- Cloud API (ou sem Evolution) não colidem entre si.
  CONSTRAINT whatsapp_accounts_phone_number_id_key UNIQUE (cloud_phone_number_id),
  CONSTRAINT whatsapp_accounts_evolution_instance_key UNIQUE (evolution_instance),
  CONSTRAINT whatsapp_accounts_client_fkey
    FOREIGN KEY (client_db_name) REFERENCES ad_accounts(client_db_name)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------
-- 4. painel_metric_prefs — quais cards de métrica aparecem
--
-- client_db_name = '' é a preferência GLOBAL, que vale para todo
-- cliente sem override próprio. Um client_db_name preenchido é o
-- override daquele cliente (métricas marcadas clientScoped no
-- catálogo do app, como Receita e ROAS).
--
-- Métrica sem linha aqui é tratada como visível: a tabela guarda só
-- os toggles que alguém mexeu.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS painel_metric_prefs (
  metric_key VARCHAR(50) NOT NULL,
  client_db_name VARCHAR(191) NOT NULL DEFAULT '',
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (client_db_name, metric_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =======================================================
-- Conferência
-- =======================================================
SELECT TABLE_NAME
  FROM information_schema.tables
 WHERE table_schema = 'trakeamento_controle'
 ORDER BY TABLE_NAME;

SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.columns
 WHERE table_schema = 'trakeamento_controle'
   AND table_name = 'whatsapp_accounts'
 ORDER BY ORDINAL_POSITION;
