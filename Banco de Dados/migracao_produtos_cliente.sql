-- ===================================================================
-- MIGRAÇÃO: produtos contratados por cliente
-- Alvo: trakeamento_controle (UMA vez). Nenhum banco de cliente muda.
-- ===================================================================
--
-- Motivo. O cadastro de cliente passou a perguntar quais produtos ele
-- usa: Landing page, Formulários Instantâneos e/ou WhatsApp. A escolha
-- decide quais dados o cadastro pede, e fica gravada nesta coluna como
-- texto separado por vírgula, por exemplo "landing_page,whatsapp".
--
-- NULL = não definido. É o caso de todo cliente que já existe quando a
-- migração roda. Para eles, a tela de Clientes deduz os produtos pelo
-- que já está cadastrado (conta do Kommo, conexão de WhatsApp, sites) e
-- grava a lista na primeira vez que um produto é adicionado.
--
-- Segurança da execução: só acrescenta uma coluna que aceita NULL. Não
-- altera nem apaga dado nenhum. Rodar duas vezes devolve
-- "#1060 Duplicate column name 'produtos'", que só confirma que a
-- coluna já existe.
--
-- Nome com o banco na frente e sem USE: funciona com qualquer banco
-- selecionado no phpMyAdmin.
--
-- ANTES DE RODAR: faça backup, ex.:
--   CREATE TABLE trakeamento_controle.ad_accounts_backup_20260915
--     AS SELECT * FROM trakeamento_controle.ad_accounts;
--
-- Como aplicar:
--   mysql -u USUARIO -p < migracao_produtos_cliente.sql
-- ou cole o arquivo inteiro na aba SQL do phpMyAdmin.
-- ===================================================================

ALTER TABLE trakeamento_controle.ad_accounts
  ADD COLUMN produtos VARCHAR(100) NULL DEFAULT NULL AFTER content_category;

-- Conferência: deve listar a coluna produtos (NULL nos clientes atuais).
SHOW COLUMNS FROM trakeamento_controle.ad_accounts LIKE 'produtos';
