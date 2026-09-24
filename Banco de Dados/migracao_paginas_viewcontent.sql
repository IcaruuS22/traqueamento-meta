-- =======================================================
-- Migração: ViewContent automático ao rolar a página
-- (banco CENTRAL — trakeamento_controle)
--
-- Contexto: a tag das páginas de vendas (/t.js) passa a poder mandar um
-- ViewContent quando o visitante rola até uma porcentagem da página. A
-- opção é por site, em Página de vendas › Configuração › Editar site.
--
-- Valores: 0 = desligado; 25, 50, 75 ou 90 = porcentagem da página vista.
-- Sites já cadastrados ficam desligados (DEFAULT 0) até alguém ligar.
--
-- Enquanto esta migração não roda, o app segue funcionando: a tag e a
-- coleta tratam o recurso como desligado, e só o ato de ligá-lo no painel
-- pede a migração.
--
-- ANTES DE RODAR: faça backup, ex.:
--   CREATE TABLE paginas_sites_backup_20260924 AS SELECT * FROM paginas_sites;
-- =======================================================

USE `trakeamento_controle`;

ALTER TABLE `paginas_sites`
  ADD COLUMN `viewcontent_rolagem` TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER `ativo`;

-- Conferência (devolve linha se a coluna existe, "Unknown column" se não):
SELECT id, nome, ativo, viewcontent_rolagem FROM `paginas_sites` ORDER BY nome;
