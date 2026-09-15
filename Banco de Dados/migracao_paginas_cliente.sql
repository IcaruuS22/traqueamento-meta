-- ===================================================================
-- MIGRAÇÃO: rastreio de páginas de vendas — banco de cliente
-- Alvo: CADA banco de cliente (cliente_<slug>_<id>), não o
--       trakeamento_controle.
-- Par: migracao_paginas_central.sql, que roda antes, uma vez, no
--      banco central.
-- ===================================================================
--
-- Duas tabelas:
--
--   paginas_visitantes  uma linha por navegador. Guarda a origem da
--                       visita (UTMs, fbclid, id do anúncio) e, quando a
--                       pessoa preenche um formulário na página, o
--                       customer_id do lead. É o que permite atribuir a
--                       compra — que chega dias depois, pelo webhook da
--                       plataforma — ao anúncio que trouxe a pessoa.
--
--   paginas_eventos     uma linha por evento (PageView, Lead,
--                       InitiateCheckout, Purchase...). `event_id` é
--                       UNIQUE e é o mesmo enviado à Meta: é ele que
--                       torna idempotente a compra que a plataforma
--                       reenvia, e que faz a Meta juntar o evento do
--                       pixel com o da Conversions API.
--
-- O lead de formulário da página NÃO fica aqui: ele entra em `customers`,
-- como qualquer outro lead, e segue o mesmo fluxo do Kommo. Estas
-- tabelas guardam só o caminho até ele.
--
-- Segurança da execução: só CREATE TABLE. Não altera tabela existente.
-- Rodar duas vezes é seguro: os índices são declarados dentro do
-- próprio CREATE TABLE IF NOT EXISTS, então não há CREATE INDEX solto
-- para devolver erro 1061 numa segunda execução.
--
-- ATENÇÃO AO BANCO SELECIONADO. Este arquivo não tem USE, porque o nome
-- do banco muda por cliente: as tabelas são criadas no banco que estiver
-- selecionado. No phpMyAdmin, clique no banco do cliente na lista da
-- esquerda e confira o nome no topo da tela ANTES de colar. Se o
-- information_schema estiver selecionado, o MySQL devolve #1044.
--
-- Como aplicar (uma vez por banco de cliente):
--   mysql -u USUARIO -p NOME_DO_BANCO_DO_CLIENTE < migracao_paginas_cliente.sql
-- ===================================================================

CREATE TABLE IF NOT EXISTS paginas_visitantes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  visitor_id CHAR(32) NOT NULL,
  site_id BIGINT NOT NULL,
  customer_id BIGINT NULL,
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  landing_url VARCHAR(1000),
  referrer VARCHAR(1000),
  -- Último toque com origem conhecida. Uma visita direta depois de um
  -- clique no anúncio não apaga a campanha.
  utm_source VARCHAR(255),
  utm_medium VARCHAR(255),
  utm_campaign VARCHAR(255),
  utm_content VARCHAR(255),
  utm_term VARCHAR(255),
  fbclid VARCHAR(500),
  fbc VARCHAR(500),
  fbp VARCHAR(120),
  meta_ad_id VARCHAR(255),
  meta_adset_id VARCHAR(255),
  meta_campaign_id VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent VARCHAR(512),
  CONSTRAINT paginas_visitantes_visitor_id_key UNIQUE (visitor_id),
  INDEX idx_paginas_visitantes_customer_id (customer_id),
  CONSTRAINT paginas_visitantes_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS paginas_eventos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  site_id BIGINT NOT NULL,
  -- NULL quando a compra chegou pelo webhook sem id de visitante.
  visitor_id CHAR(32) NULL,
  customer_id BIGINT NULL,
  event_name VARCHAR(40) NOT NULL,
  event_id VARCHAR(120) NOT NULL,
  page_url VARCHAR(1000),
  -- host + caminho, sem query string: é o que agrupa a tabela por página.
  page_path VARCHAR(500),
  value DECIMAL(14,2) NULL,
  currency VARCHAR(3) NULL,
  order_id VARCHAR(120) NULL,
  plataforma VARCHAR(20) NULL,
  -- Cópia da origem do visitante no momento do evento, para o recorte
  -- por campanha não depender de o visitante ainda existir.
  utm_source VARCHAR(255),
  utm_campaign VARCHAR(255),
  meta_campaign_id VARCHAR(255),
  capi_status VARCHAR(10) NOT NULL DEFAULT 'PENDING',
  capi_error VARCHAR(500),
  CONSTRAINT paginas_eventos_event_id_key UNIQUE (event_id),
  INDEX idx_paginas_eventos_created_evento (created_at, event_name),
  INDEX idx_paginas_eventos_visitor_id (visitor_id),
  INDEX idx_paginas_eventos_site_created (site_id, created_at),
  CONSTRAINT paginas_eventos_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Conferência: deve listar paginas_eventos e paginas_visitantes.
SHOW TABLES LIKE 'paginas%';
