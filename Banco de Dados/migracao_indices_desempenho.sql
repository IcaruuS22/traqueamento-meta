-- ===================================================================
-- MIGRAÇÃO: índices de desempenho
-- Alvo: CADA banco de cliente (cliente_<slug>_<id>), não o
--       trakeamento_controle.
-- ===================================================================
--
-- Motivo. O template nasceu com índices para as buscas por identidade
-- (meta_lead_id, crm_lead_id, email, phone) e para as agregações de
-- insights. Nenhum deles cobre o que o painel realmente faz o dia
-- inteiro: recortar por PERÍODO. Praticamente toda consulta de métricas
-- filtra `customers.created_at BETWEEN ? AND ?`, a lista de leads ordena
-- por essa mesma coluna, e o funil cruza `meta_capi_events` por data e
-- status. Sem índice, cada uma dessas consultas varre a tabela inteira —
-- e a Visão Geral dispara 15 delas em paralelo por carregamento.
--
-- Enquanto a base é pequena isso não aparece. Aparece de uma vez, quando
-- o cliente passa de alguns milhares de leads, e aparece como "o painel
-- ficou lento" sem nada no código ter mudado.
--
-- Segurança da execução. Só CREATE INDEX: não altera coluna, não move
-- dado, não apaga nada. O InnoDB cria índice secundário sem bloquear
-- escrita (ALGORITHM=INPLACE, LOCK=NONE por padrão). Rode fora do pico
-- mesmo assim — em tabela grande consome I/O enquanto constrói.
--
-- Rodar duas vezes é seguro. O MySQL não tem "CREATE INDEX IF NOT
-- EXISTS", e por isso o arquivo cria um procedimento temporário que
-- consulta o information_schema antes de cada índice: o que já existe é
-- pulado com uma linha de aviso, em vez do erro 1061 que interrompia a
-- execução no meio do arquivo. O procedimento se apaga no fim.
--
-- Como aplicar (uma vez por banco de cliente):
--   mysql -u USUARIO -p NOME_DO_BANCO_DO_CLIENTE < migracao_indices_desempenho.sql
--
-- No phpMyAdmin, cole o arquivo inteiro: ele já trata o DELIMITER.
--
-- Para conferir o resultado:
--   SHOW INDEX FROM customers;
--   SHOW INDEX FROM meta_capi_events;
--   SHOW INDEX FROM whatsapp_conversations;
--   SHOW INDEX FROM whatsapp_messages;
--
-- Ou, do app: npm run db:analise
-- ===================================================================

DROP PROCEDURE IF EXISTS trk_cria_indice;

DELIMITER $$

-- Cria o índice só se ainda não houver um com esse nome na tabela.
-- `colunas` entra como texto ("created_at, current_stage") e é montado
-- por SQL dinâmico — nada aqui vem de fora do arquivo.
CREATE PROCEDURE trk_cria_indice(
  IN p_tabela VARCHAR(64),
  IN p_indice VARCHAR(64),
  IN p_colunas VARCHAR(255)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = p_tabela
       AND index_name = p_indice
  ) THEN
    SET @ddl = CONCAT('CREATE INDEX `', p_indice, '` ON `', p_tabela, '` (', p_colunas, ')');
    PREPARE st FROM @ddl;
    EXECUTE st;
    DEALLOCATE PREPARE st;
    SELECT CONCAT('criado: ', p_indice) AS resultado;
  ELSE
    SELECT CONCAT('já existia: ', p_indice) AS resultado;
  END IF;
END$$

DELIMITER ;

-- -------------------------------------------------------------------
-- customers
-- -------------------------------------------------------------------

-- O índice mais importante do arquivo. `created_at` é a coluna do
-- recorte de período de quase toda métrica, e também o ORDER BY da
-- listagem de leads e do board do CRM (`ultimosLeads`). Sem ele, todo
-- recorte de "últimos 7 dias" lê a tabela inteira para descartar 99%.
CALL trk_cria_indice('customers', 'idx_customers_created_at', '`created_at`');

-- Cruzamento com crm_meta_event_map (tradução de status_id para nome do
-- estágio) e agrupamentos por estágio no funil.
CALL trk_cria_indice('customers', 'idx_customers_current_stage', '`current_stage`');

-- Composto para o caso mais frequente de todos: "leads deste período,
-- agrupados por estágio". Na ordem (created_at, current_stage) o MySQL
-- corta o período pelo índice e já lê o estágio dele, sem voltar à
-- tabela. Não substitui os dois de cima — o índice só serve a partir da
-- primeira coluna, então uma busca só por current_stage não o usa.
CALL trk_cria_indice('customers', 'idx_customers_created_stage', '`created_at`, `current_stage`');

-- -------------------------------------------------------------------
-- meta_capi_events
-- -------------------------------------------------------------------

-- `tempoEntreEtapas` e as contagens de funil filtram por status='SENT'
-- e agrupam por customer_id + event_name. A única chave existente é a
-- UNIQUE de event_id, que não serve para nenhuma dessas consultas.
CALL trk_cria_indice('meta_capi_events', 'idx_meta_capi_events_status_evento', '`status`, `event_name`');

-- Recorte por data dos eventos (relatório e analytics de funil).
CALL trk_cria_indice('meta_capi_events', 'idx_meta_capi_events_created_at', '`created_at`');

-- O mais caro de todos, e o menos óbvio. `ultimosLeads` traz a coluna
-- `last_moved_at` por subconsulta correlacionada — COUNT(*) e
-- MAX(created_at) dos eventos SENT daquele lead, executados UMA VEZ POR
-- LINHA. Na lista de 10 leads passa despercebido; no board do CRM, que
-- carrega até 5.000 leads de uma vez, são 5.000 subconsultas por
-- abertura da tela. Nesta ordem as três colunas saem do próprio índice e
-- a subconsulta nunca toca a tabela.
CALL trk_cria_indice(
  'meta_capi_events',
  'idx_meta_capi_events_lead_status_data',
  '`customer_id`, `status`, `created_at`'
);

-- -------------------------------------------------------------------
-- whatsapp_conversations
-- -------------------------------------------------------------------

-- O long polling da aba Conversas consulta o "cursor" (MAX(updated_at),
-- MAX(last_message_at)) a cada poucos segundos, por aba aberta. Com
-- índice, MAX() vira uma leitura da ponta do índice em vez de varredura.
-- As contagens da mesma consulta continuam varrendo — isso é limitação
-- do agregado, não do índice — mas o custo cai bastante.
CALL trk_cria_indice('whatsapp_conversations', 'idx_whatsapp_conversations_updated_at', '`updated_at`');

-- Ordenação padrão da lista de conversas (mais recente primeiro).
CALL trk_cria_indice(
  'whatsapp_conversations',
  'idx_whatsapp_conversations_last_message_at',
  '`last_message_at`'
);

-- -------------------------------------------------------------------
-- whatsapp_messages
-- -------------------------------------------------------------------

-- Abrir uma conversa lê as mensagens daquele lead em ordem cronológica.
-- Existe índice só por customer_id; com o tempo junto, a leitura da
-- thread sai ordenada do índice e dispensa o sort.
CALL trk_cria_indice(
  'whatsapp_messages',
  'idx_whatsapp_messages_lead_tempo',
  '`customer_id`, `message_timestamp_unix`'
);

DROP PROCEDURE IF EXISTS trk_cria_indice;
