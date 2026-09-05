-- =======================================================
-- Migração: verba mensal por categoria de campanha
-- (banco CENTRAL — trakeamento_controle)
--
-- Contexto: `ad_accounts.monthly_fee` guarda um número só — o
-- investimento do mês inteiro. Na prática a verba é combinada em partes:
-- tanto para captação, tanto para remarketing, tanto para institucional.
-- Com um teto único o painel dizia se o mês ia estourar, mas não qual
-- frente estava comendo a verba da outra.
--
-- Duas tabelas:
--
--   campaign_categories     as categorias que o cliente inventou, cada
--                           uma com a sua verba mensal.
--   campaign_category_map   a qual categoria cada campanha pertence.
--
-- As categorias são do cliente, não da Meta: o objetivo da campanha
-- (`meta_campaigns.objective`) continua onde está e serve de atalho na
-- hora de classificar em lote, mas não é a categoria — duas campanhas de
-- OUTCOME_LEADS podem ser uma de captação e outra de remarketing.
--
-- Por que no banco CENTRAL e não no de cada cliente: é dado comercial,
-- vizinho de `monthly_fee`, e assim a migração roda uma vez em vez de
-- uma por cliente. O preço é que `campaign_id` aqui não tem chave
-- estrangeira para `meta_campaigns` — ela vive em outro banco. Campanha
-- apagada na Meta deixa uma linha órfã no mapa, inofensiva: ninguém a
-- consulta, porque o gasto é lido a partir dos insights.
--
-- Rode no banco CENTRAL, uma única vez.
--
-- Enquanto esta migração não roda, o app segue funcionando: a leitura
-- tolera as tabelas ausentes (lacuna de esquema) e o card mostra só o
-- total do mês, como antes.
--
-- ANTES DE RODAR: faça backup do banco central.
-- =======================================================

USE `trakeamento_controle`;

CREATE TABLE IF NOT EXISTS `campaign_categories` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `client_db_name` VARCHAR(64) NOT NULL,
  -- Nome que o cliente deu. 60 caracteres porque ele vira rótulo de
  -- barra no card e de opção no seletor; nome maior que isso não cabe
  -- na tela de ninguém.
  `nome` VARCHAR(60) NOT NULL,
  -- Verba mensal da categoria. NULL = categoria existe para separar o
  -- gasto, mas sem teto próprio — aparece no card com o gasto e sem
  -- barra de consumo, em vez de acusar estouro de um teto de zero.
  `monthly_budget` DECIMAL(12,2) NULL DEFAULT NULL,
  -- Ordem de exibição. Empate cai no nome.
  `ordem` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Dois "Remarketing" no mesmo cliente seriam duas barras iguais no
  -- card, e ninguém saberia em qual das duas mexer.
  CONSTRAINT `campaign_categories_nome_unico` UNIQUE (`client_db_name`, `nome`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `campaign_category_map` (
  -- Uma campanha pertence a uma categoria só: verba dividida entre duas
  -- categorias contaria o mesmo real duas vezes no card.
  `client_db_name` VARCHAR(64) NOT NULL,
  `campaign_id` VARCHAR(255) NOT NULL,
  `category_id` BIGINT NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`client_db_name`, `campaign_id`),
  KEY `campaign_category_map_categoria` (`category_id`),
  -- Categoria apagada leva junto as atribuições: campanha volta a ficar
  -- sem categoria, que é o estado em que ela nasce.
  CONSTRAINT `campaign_category_map_categoria_fk`
    FOREIGN KEY (`category_id`) REFERENCES `campaign_categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Conferência:
-- SELECT c.client_db_name, c.nome, c.monthly_budget, COUNT(m.campaign_id) AS campanhas
--   FROM campaign_categories c
--   LEFT JOIN campaign_category_map m ON m.category_id = c.id
--  GROUP BY c.id ORDER BY c.client_db_name, c.ordem, c.nome;
