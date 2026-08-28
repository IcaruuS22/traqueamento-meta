-- =====================================================================
-- Verificação (somente leitura) — 01_Banco_Central_Controle (Rode no SQL).sql
-- =====================================================================
-- Objetivo: descobrir se as colunas do migration já existem no banco
-- `trakeamento_controle`, sem alterar nada. Rode este script primeiro;
-- ele NÃO faz ALTER TABLE, apenas consulta o catálogo do MySQL.
--
-- Como ler o resultado:
--   - Se a consulta abaixo retornar 2 linhas (uma para cada coluna),
--     o migration JÁ FOI aplicado. Não rode o 01_Banco_Central_Controle
--     de novo (os ALTER TABLE dele dariam erro de "coluna já existe",
--     mas de qualquer forma não é necessário repetir).
--   - Se retornar 0 ou 1 linha, falta aplicar o que estiver faltando.
--     Nesse caso, abra o "01_Banco_Central_Controle (Rode no SQL).sql",
--     faça o backup indicado nos comentários dele e rode os blocos
--     ALTER TABLE correspondentes à coluna que aparecer como ausente.
-- =====================================================================

SELECT
  TABLE_NAME,
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'trakeamento_controle'
  AND (
    (TABLE_NAME = 'ad_accounts' AND COLUMN_NAME = 'last_sync_started_at')
    OR
    (TABLE_NAME = 'painel_metric_prefs' AND COLUMN_NAME = 'client_db_name')
  )
ORDER BY TABLE_NAME, COLUMN_NAME;

-- Extra: confirma também se a PRIMARY KEY de painel_metric_prefs já foi
-- trocada para (client_db_name, metric_key), como o migration faz.
-- Se a coluna client_db_name existir mas a PK ainda for só (metric_key),
-- o ALTER TABLE ainda não foi concluído por completo.
SELECT
  TABLE_NAME,
  GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS colunas_da_chave_primaria
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'trakeamento_controle'
  AND TABLE_NAME = 'painel_metric_prefs'
  AND CONSTRAINT_NAME = 'PRIMARY'
GROUP BY TABLE_NAME;
