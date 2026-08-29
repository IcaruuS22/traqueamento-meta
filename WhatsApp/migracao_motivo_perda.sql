-- =======================================================
-- Migração: motivo de perda das conversas (banco POR CLIENTE)
--
-- Rode DENTRO de cada banco `cliente_*` que já existe, uma vez por
-- cliente. Bancos criados depois desta data já nascem com isto
-- (ver 02_Template_Banco_Por_Cliente.sql).
--
-- O que muda: ao mover uma conversa para o estágio `perdido` (no CRM ou
-- na tela de Conversas), o painel passa a registrar POR QUE ela foi
-- perdida. A tela "Analytics do funil" lê esses motivos e mostra o
-- ranking, junto do funil por etapa e das perdas por campanha.
--
-- Rodar duas vezes devolve "Duplicate column name" — pode ignorar nesse
-- caso, nada além das colunas é criado aqui.
-- =======================================================

-- Por que fica em `whatsapp_conversations`, e não em `customers`:
-- o motivo é preenchido por quem atende, no painel, e o painel só é dono
-- do funil do WhatsApp. A etapa do lead de formulário é espelho do CRM
-- do cliente (Kommo) — ela muda pela automação do n8n, sem ninguém na
-- tela para dizer o motivo. Guardar a coluna em `customers` daria a
-- impressão de que os dois funis registram perda, quando só um registra.
--
-- lost_at é separado de `updated_at` de propósito: `updated_at` muda a
-- cada salvamento de nota ou tag, então não serve para datar a perda.
-- Quando a conversa sai de `perdido`, os dois voltam a NULL — perda
-- desfeita não pode continuar contando no relatório.
ALTER TABLE `whatsapp_conversations`
  ADD COLUMN `lost_reason` VARCHAR(120) NULL,
  ADD COLUMN `lost_at` TIMESTAMP NULL;

-- =======================================================
-- Conferência
-- =======================================================
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.columns
 WHERE table_schema = DATABASE()
   AND table_name = 'whatsapp_conversations'
   AND COLUMN_NAME IN ('lost_reason', 'lost_at')
 ORDER BY ORDINAL_POSITION;
