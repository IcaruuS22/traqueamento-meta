-- =======================================================
-- AUTENTICAÇÃO E USUÁRIOS DO APLICATIVO
--
-- Rode APENAS no banco central `trakeamento_controle`.
-- Nenhum banco `cliente_*` é tocado por este script.
--
-- Contexto: hoje o painel é protegido por um único usuário
-- Basic Auth configurado no n8n — quem tem a senha vê todos os
-- clientes. Estas 4 tabelas sustentam a substituição disso por
-- contas reais com papéis e acesso por cliente. Detalhes em
-- ARQUITETURA_APP.md, seção 4.
--
-- ANTES DE RODAR: faça backup do banco central.
-- =======================================================

USE trakeamento_controle;

-- -------------------------------------------------------
-- 1. app_users — uma linha por pessoa que entra no app
--
-- role:
--   'admin'   = acesso total, gestão de usuários e cadastro de clientes
--   'cliente' = vê apenas os clientes vinculados em app_user_clients
--
-- status:
--   'ativo'     = pode entrar
--   'pendente'  = solicitou acesso pelo /signup sem convite; aguarda
--                 aprovação do admin. NÃO consegue fazer login.
--   'bloqueado' = acesso revogado, histórico preservado (por isso
--                 bloqueia-se em vez de excluir: app_audit_log
--                 referencia o usuário).
--
-- password_hash guarda bcrypt (custo 12). Nunca a senha em si.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'cliente',
  status VARCHAR(20) NOT NULL DEFAULT 'pendente',
  email_verified_at TIMESTAMP NULL DEFAULT NULL,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  -- Token de redefinição de senha: uso único, validade curta (1h).
  -- Guardado como hash pelo mesmo motivo da senha: quem lê o banco
  -- não deve conseguir sequestrar uma redefinição em andamento.
  reset_token_hash VARCHAR(255) NULL DEFAULT NULL,
  reset_token_expires_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT app_users_email_key UNIQUE (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_app_users_status ON app_users(status);

-- -------------------------------------------------------
-- 2. app_user_clients — quem enxerga qual cliente
--
-- Esta é a tabela que sustenta o isolamento entre clientes.
-- Toda rota que recebe client_db consulta aqui antes de tocar
-- em qualquer banco de cliente (lib/auth/guard.ts).
--
-- client_db_name referencia ad_accounts.client_db_name (que é
-- UNIQUE), com ON DELETE CASCADE: se um cliente é removido do
-- catálogo, os vínculos somem junto.
--
-- Usuários com role='admin' NÃO precisam de linha aqui — o guard
-- os libera antes de consultar esta tabela.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user_clients (
  user_id BIGINT NOT NULL,
  client_db_name VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, client_db_name),
  CONSTRAINT app_user_clients_user_fkey
    FOREIGN KEY (user_id) REFERENCES app_users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT app_user_clients_client_fkey
    FOREIGN KEY (client_db_name) REFERENCES ad_accounts(client_db_name)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_app_user_clients_client ON app_user_clients(client_db_name);

-- -------------------------------------------------------
-- 3. app_invites — cadastro é por convite
--
-- O convite já carrega o papel e a lista de clientes (JSON com os
-- client_db_name) que o novo usuário receberá ao concluir o
-- cadastro. Isso evita o cenário de alguém se cadastrar sozinho e
-- cair numa tela vazia esperando liberação manual.
--
-- token_hash: o token vai por e-mail/link em texto puro, mas no
-- banco fica só o hash — mesmo raciocínio do reset de senha.
-- used_at != NULL marca o convite como consumido (uso único).
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_invites (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'cliente',
  client_db_names JSON NULL,
  invited_by BIGINT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT app_invites_token_key UNIQUE (token_hash),
  CONSTRAINT app_invites_inviter_fkey
    FOREIGN KEY (invited_by) REFERENCES app_users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_app_invites_email ON app_invites(email);

-- -------------------------------------------------------
-- 4. app_audit_log — quem fez o quê, quando, em qual cliente
--
-- Registra no mínimo: login, convite, aprovação de conta,
-- alteração de vínculo, alteração de credenciais Meta/WhatsApp,
-- envio de mensagem no WhatsApp, alteração e exclusão de
-- mapeamento de eventos, e cadastro de cliente novo.
--
-- user_id é ON DELETE SET NULL para que o registro sobreviva à
-- remoção do usuário — um log de auditoria que some junto com o
-- autor não serve para auditoria.
--
-- client_db_name aqui é texto solto, SEM chave estrangeira: o log
-- precisa continuar legível mesmo depois de o cliente sair do
-- catálogo.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NULL,
  user_email VARCHAR(255) NULL,
  acao VARCHAR(60) NOT NULL,
  client_db_name VARCHAR(64) NULL,
  detalhe JSON NULL,
  ip VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT app_audit_log_user_fkey
    FOREIGN KEY (user_id) REFERENCES app_users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_app_audit_log_created ON app_audit_log(created_at);
CREATE INDEX idx_app_audit_log_client ON app_audit_log(client_db_name, created_at);
CREATE INDEX idx_app_audit_log_user ON app_audit_log(user_id, created_at);

-- =======================================================
-- PRIMEIRO ADMIN
--
-- Não é criado aqui de propósito: gerar um hash bcrypt exige
-- código, e uma senha em texto puro dentro de um arquivo .sql
-- versionado no Git é exatamente o que não se quer.
--
-- Rode, uma única vez, depois de subir o app:
--   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run seed:admin
-- e remova essas variáveis do ambiente em seguida.
-- =======================================================

-- =======================================================
-- Verificação pós-migração
-- =======================================================
SHOW TABLES LIKE 'app\_%';
SELECT COUNT(*) AS total_clientes_no_catalogo FROM ad_accounts;
