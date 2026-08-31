-- =======================================================
-- TEMPLATE: BANCO ISOLADO POR CLIENTE (MySQL)
-- Este script NÃO é executado manualmente — é o modelo que o
-- workflow n8n "Cria Cliente - Formulario" reproduz
-- dinamicamente (nós MySQL "Cria Database do Cliente",
-- "Cria Tabela customers", "Cria Tabela crm_meta_event_map",
-- "Cria Tabela meta_capi_events", "Cria Tabela meta_campaigns",
-- "Cria Tabela meta_adsets", "Cria Tabela meta_ads" e
-- "Cria Tabela meta_insights_daily"), substituindo {{DB_NAME}}
-- pelo nome gerado para cada cliente (coluna
-- ad_accounts.client_db_name no banco central).
--
-- customers, crm_meta_event_map, meta_capi_events, meta_campaigns,
-- meta_adsets, meta_ads, meta_insights_daily e whatsapp_messages
-- são todas dinâmicas por cliente: só o registro de roteamento
-- (ad_accounts, whatsapp_accounts) fica no banco central.
--
-- Guarde este arquivo como referência/documentação do schema.
-- =======================================================

CREATE DATABASE IF NOT EXISTS `{{DB_NAME}}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `{{DB_NAME}}`;

-- 1. TABELA: customers
-- Sem FK para ad_accounts: essa tabela agora vive num banco
-- diferente do banco central (MySQL não suporta FK entre
-- bancos), então ad_account_id fica como referência solta.
CREATE TABLE IF NOT EXISTS customers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  ad_account_id VARCHAR(255),
  crm_lead_id VARCHAR(255),
  crm_contact_id VARCHAR(255),
  meta_lead_id VARCHAR(255),
  current_stage VARCHAR(255),
  -- Valor do negócio vindo do CRM. O Kommo manda `price` no webhook de
  -- criação e no de mudança de status, mas só no momento em que ele
  -- muda: sem persistir aqui, um Purchase disparado numa etapa
  -- posterior não teria valor nenhum para mandar à Meta. Só é
  -- sobrescrito quando o webhook traz preço maior que zero, para uma
  -- mudança de etapa sem preço não zerar o que já estava salvo.
  crm_value DECIMAL(14,2) NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  city VARCHAR(255),
  state VARCHAR(255), -- UF do lead (ex.: "sp", "mg"). Fonte do hash "st" enviado à Meta;
                       -- resolvido por lead (via ddd_state_map ou dado do CRM), não fixo por cliente.
  zipcode VARCHAR(20),
  country VARCHAR(10) DEFAULT 'br',
  ip_address VARCHAR(45),
  user_agent VARCHAR(512),
  utm_source VARCHAR(255),
  utm_medium VARCHAR(255),
  utm_campaign VARCHAR(255),
  utm_content VARCHAR(255),
  utm_term VARCHAR(255),
  fbclid VARCHAR(255),
  meta_ad_id VARCHAR(255),
  meta_ad_name VARCHAR(255),
  meta_adset_id VARCHAR(255),
  meta_adset_name VARCHAR(255),
  meta_campaign_id VARCHAR(255),
  meta_campaign_name VARCHAR(255),
  meta_form_id VARCHAR(255),
  meta_adgroup_id VARCHAR(255),
  meta_page_id VARCHAR(255),
  whatsapp_contact_capi_sent_at TIMESTAMP NULL DEFAULT NULL -- marca quando já disparamos
    -- o evento CAPI de "contato via WhatsApp vindo de anúncio" pra esse
    -- customer, pra nunca disparar duas vezes (ver migracao_whatsapp_messages.sql)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_customers_meta_lead_id ON customers(meta_lead_id);
CREATE INDEX idx_customers_crm_lead_id ON customers(crm_lead_id);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_meta_campaign_id ON customers(meta_campaign_id);
CREATE INDEX idx_customers_meta_adset_id ON customers(meta_adset_id);

-- 2. TABELA: crm_meta_event_map
-- Dinâmica por cliente (antes vivia no banco central). Não
-- precisa mais de crm_account_id: o próprio banco já identifica
-- o cliente, então a unicidade é só por pipeline_id + status_id.
CREATE TABLE IF NOT EXISTS crm_meta_event_map (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  pipeline_id VARCHAR(255) NOT NULL,
  status_id VARCHAR(255) NOT NULL,
  meta_event VARCHAR(255) NOT NULL,
  content_name VARCHAR(255),
  currency VARCHAR(3) DEFAULT 'BRL',
  value_type VARCHAR(255) DEFAULT 'price',
  ativo BOOLEAN DEFAULT TRUE NOT NULL,
  -- Marca o status_id como "conversão" para fins de cálculo de CAC
  -- na aba Campanhas (CAC = gasto / nº de leads cujo current_stage
  -- bate com um status_id is_conversion=1). Configurável na aba
  -- Eventos do painel.
  is_conversion BOOLEAN DEFAULT FALSE NOT NULL,
  CONSTRAINT crm_meta_event_map_unique UNIQUE (pipeline_id, status_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_crm_meta_map_lookup ON crm_meta_event_map(pipeline_id, status_id, ativo);

-- 3. TABELA: meta_capi_events
-- event_id tem UNIQUE: é o que sustenta a lógica de
-- "Duplicado?" no workflow principal (a inserção duplicada
-- falha com erro do MySQL, tratado como evento repetido).
CREATE TABLE IF NOT EXISTS meta_capi_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  customer_id BIGINT,
  ad_account_id VARCHAR(255),
  event_name VARCHAR(255) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  event_time_unix BIGINT NOT NULL,
  event_source_url TEXT,
  action_source VARCHAR(255) NOT NULL,
  value DECIMAL(10,2) DEFAULT 0.00,
  currency VARCHAR(10) DEFAULT 'BRL',
  content_name VARCHAR(255),
  content_category VARCHAR(255),
  custom_event_type VARCHAR(255),
  lead_event_source VARCHAR(255),
  user_data_hashed JSON,
  custom_data JSON,
  meta_payload_sent JSON,
  meta_response JSON,
  status VARCHAR(20) DEFAULT 'PENDING',
  error_message TEXT,
  CONSTRAINT meta_capi_events_event_id_key UNIQUE (event_id),
  CONSTRAINT meta_capi_events_customer_id_fkey
    FOREIGN KEY (customer_id)
    REFERENCES customers(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT meta_capi_events_status_check
    CHECK (status IN (
      'pending', 'sent', 'success', 'failed', 'error', 'duplicate',
      'PENDING', 'SENT', 'SUCCESS', 'FAILED', 'ERROR', 'DUPLICATE'
    ))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. TABELA: meta_campaigns
-- Metadados de campanha (uma linha por campanha, sem histórico).
-- Populada pelo workflow "Meta Insights - Sincronização Periódica"
-- (a cada 6h) e pelo backfill manual de 90 dias.
CREATE TABLE IF NOT EXISTS meta_campaigns (
  campaign_id VARCHAR(255) PRIMARY KEY,
  campaign_name VARCHAR(255),
  status VARCHAR(50),
  objective VARCHAR(100),
  daily_budget DECIMAL(12,2),
  lifetime_budget DECIMAL(12,2),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. TABELA: meta_adsets
-- Metadados de conjunto de anúncios.
CREATE TABLE IF NOT EXISTS meta_adsets (
  adset_id VARCHAR(255) PRIMARY KEY,
  campaign_id VARCHAR(255),
  adset_name VARCHAR(255),
  status VARCHAR(50),
  daily_budget DECIMAL(12,2),
  lifetime_budget DECIMAL(12,2),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_meta_adsets_campaign_id ON meta_adsets(campaign_id);

-- 6. TABELA: meta_ads
-- Metadados de anúncio.
CREATE TABLE IF NOT EXISTS meta_ads (
  ad_id VARCHAR(255) PRIMARY KEY,
  adset_id VARCHAR(255),
  campaign_id VARCHAR(255),
  ad_name VARCHAR(255),
  status VARCHAR(50),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_meta_ads_adset_id ON meta_ads(adset_id);
CREATE INDEX idx_meta_ads_campaign_id ON meta_ads(campaign_id);

-- 7. TABELA: meta_insights_daily
-- Métricas diárias — uma tabela unificada com discriminador de nível
-- (entity_level). entity_id guarda campaign_id/adset_id/ad_id conforme
-- o nível; campaign_id/adset_id ficam preenchidos mesmo em linhas de
-- nível "ad" para permitir GROUP BY em qualquer nível sem join extra.
-- raw_insights arquiva o payload cru da Graph API (mesmo padrão de
-- meta_capi_events.meta_payload_sent) para não perder métricas que
-- ainda não viraram coluna própria.
--
-- IMPORTANTE: reach/frequency não são somáveis entre dias (uma pessoa
-- alcançada em dois dias não pode ser contada duas vezes) — agregações
-- multi-dia no painel são aproximadas (soma/média dos valores diários).
CREATE TABLE IF NOT EXISTS meta_insights_daily (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_level ENUM('campaign','adset','ad') NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  campaign_id VARCHAR(255) NOT NULL,
  adset_id VARCHAR(255),
  ad_id VARCHAR(255),
  date DATE NOT NULL,
  spend DECIMAL(12,2) DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  reach BIGINT DEFAULT 0,
  frequency DECIMAL(10,4) DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  unique_clicks BIGINT DEFAULT 0,
  cpc DECIMAL(12,4) DEFAULT 0,
  cpm DECIMAL(12,4) DEFAULT 0,
  ctr DECIMAL(10,4) DEFAULT 0,
  raw_insights JSON,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT meta_insights_daily_unique UNIQUE (entity_level, entity_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_meta_insights_campaign_date ON meta_insights_daily(campaign_id, date);
CREATE INDEX idx_meta_insights_adset_date ON meta_insights_daily(adset_id, date);
CREATE INDEX idx_meta_insights_ad_date ON meta_insights_daily(ad_id, date);

-- 8. TABELA: whatsapp_messages
-- Mensagens trocadas via WhatsApp Cloud API (oficial da Meta).
-- wa_message_id tem UNIQUE: sustenta a lógica de idempotência
-- (mesmo padrão de meta_capi_events.event_id) contra reentregas
-- de webhook. customer_id é resolvido por telefone (últimos
-- 10-11 dígitos, ver build_whatsapp_cloud_workflow.js) ou criado
-- na hora se a conversa nascer direto no WhatsApp.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  customer_id BIGINT,
  direction VARCHAR(10) NOT NULL,       -- 'inbound' | 'outbound'
  wa_message_id VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,           -- normalizado: só dígitos + prefixo 55
  message_type VARCHAR(50),
  message_text TEXT,
  message_timestamp_unix BIGINT,
  referral_ad_id VARCHAR(255),
  referral_ctwa_clid VARCHAR(255),      -- click-id de anúncio "Clique p/ WhatsApp"
  capi_event_id VARCHAR(255),
  raw_payload JSON,
  -- Mídia (imagem/áudio/vídeo/documento). Os bytes ficam em
  -- whatsapp_media; aqui fica só o que a tela precisa para desenhar a
  -- bolha sem carregar arquivo. media_status: 'ok' | 'pendente' |
  -- 'grande' | 'falha' | NULL (texto, ou mensagem anterior à captura).
  media_mime VARCHAR(120),
  media_filename VARCHAR(255),
  media_size INT,
  media_seconds INT,
  media_status VARCHAR(20),
  CONSTRAINT whatsapp_messages_wa_message_id_key UNIQUE (wa_message_id),
  CONSTRAINT whatsapp_messages_customer_id_fkey
    FOREIGN KEY (customer_id)
    REFERENCES customers(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_whatsapp_messages_phone ON whatsapp_messages(phone);
CREATE INDEX idx_whatsapp_messages_customer_id ON whatsapp_messages(customer_id);

-- 8.1 TABELA: whatsapp_media
-- Os bytes dos arquivos recebidos/enviados no WhatsApp, um por
-- mensagem. Tabela separada porque um LONGBLOB dentro de
-- whatsapp_messages faria toda leitura da thread arrastar o arquivo do
-- disco; aqui ele só é lido pela rota que serve a mídia.
-- ON DELETE CASCADE acompanha a exclusão de conversa feita no painel.
CREATE TABLE IF NOT EXISTS whatsapp_media (
  message_id BIGINT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  bytes LONGBLOB NOT NULL,
  CONSTRAINT whatsapp_media_message_id_fkey
    FOREIGN KEY (message_id)
    REFERENCES whatsapp_messages(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. TABELA: whatsapp_conversations
-- Estado da conversa por lead (CRM da aba "Conversas" do painel):
-- status/notas/tags/contagem de não-lidas, e o timestamp da última
-- mensagem recebida (last_inbound_at) usado para checar a janela de
-- 24h da Meta antes de liberar o envio de mensagem livre pelo painel.
-- ai_last_* são usadas pelo workflow "WhatsApp IA - Classificacao
-- Automatica" (classificação automática por Groq): ai_last_analyzed_at
-- controla o debounce (evita reanalisar a mesma conversa repetidamente)
-- e ai_last_classification/ai_last_reason guardam a última decisão da
-- IA para auditoria na aba Conversas do painel.
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  customer_id BIGINT PRIMARY KEY,
  status VARCHAR(60) DEFAULT 'novo' NOT NULL,   -- ver whatsapp_event_map para a lista de estágios (dinâmica, definida pelo cliente)
  notes TEXT,
  tags VARCHAR(500),                               -- lista separada por vírgula
  unread_count INT DEFAULT 0 NOT NULL,
  last_message_at TIMESTAMP NULL,
  last_inbound_at TIMESTAMP NULL,
  ai_last_analyzed_at TIMESTAMP NULL DEFAULT NULL,
  ai_last_classification VARCHAR(60) NULL DEFAULT NULL,
  ai_last_reason VARCHAR(500) NULL DEFAULT NULL,
  -- Por que a conversa foi perdida, preenchido no painel na hora de
  -- mover para o estágio `perdido` (tela CRM ou Conversas). Alimenta a
  -- tela "Analytics do funil". Voltam a NULL quando a conversa sai de
  -- `perdido`: perda desfeita não continua contando no relatório.
  lost_reason VARCHAR(120) NULL,
  lost_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT whatsapp_conversations_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sustenta a busca de conversas pendentes de análise, que o workflow de
-- classificação por IA roda a cada minuto em todos os bancos de cliente
-- (filtro de faixa em last_inbound_at + ORDER BY last_inbound_at). Sem
-- ele, é full table scan a cada minuto.
CREATE INDEX idx_whatsapp_conversations_ia_pendentes
  ON whatsapp_conversations(last_inbound_at, ai_last_analyzed_at);

-- 10. TABELA: whatsapp_event_map
-- Equivalente a crm_meta_event_map, mas para o funil de conversas do
-- WhatsApp: em vez de pipeline_id/status_id dinâmicos do Kommo, o
-- cliente cadastra livremente suas próprias etapas (coluna `estagio`,
-- mesmos valores aceitos em whatsapp_conversations.status) pela aba
-- "Configuração de Eventos" do painel — mesma lógica de
-- adicionar/editar/excluir livremente usada em crm_meta_event_map.
-- Cada estágio pode disparar um evento CAPI quando a conversa muda
-- para ele (POST /painel-api/whatsapp-lead-salvar, ver
-- build_admin_panel_workflow.js). value é um número fixo (não há campo
-- de "valor do negócio" numa conversa de WhatsApp, ao contrário do
-- value_type dinâmico do Kommo).
CREATE TABLE IF NOT EXISTS whatsapp_event_map (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  estagio VARCHAR(60) NOT NULL,
  meta_event VARCHAR(255),
  content_name VARCHAR(255),
  currency VARCHAR(3) DEFAULT 'BRL',
  value DECIMAL(10,2) DEFAULT 0.00,
  ativo BOOLEAN DEFAULT FALSE NOT NULL,
  is_conversion BOOLEAN DEFAULT FALSE NOT NULL,
  CONSTRAINT whatsapp_event_map_estagio_unique UNIQUE (estagio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
