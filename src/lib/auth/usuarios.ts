import 'server-only';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { query, queryOne, execute, transacao } from '@/lib/db/pool';
import { sanitizaNomeBanco } from '@/lib/db/cliente';

export type Papel = 'admin' | 'cliente';
export type StatusUsuario = 'ativo' | 'pendente' | 'bloqueado';

export type Usuario = {
  id: number;
  email: string;
  name: string;
  role: Papel;
  status: StatusUsuario;
  email_verified_at: string | null;
  last_login_at: string | null;
  created_at: string;
};

/** `password_hash` fica fora de todo SELECT que não seja o do login. */
const COLUNAS_USUARIO = `id, email, name, role, status, email_verified_at, last_login_at, created_at`;

const CUSTO_BCRYPT = 12;

export function geraHashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, CUSTO_BCRYPT);
}

export function conferaSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}

/**
 * Tokens de convite e de redefinição de senha.
 *
 * O valor bruto vai no link enviado por e-mail; no banco fica apenas o
 * SHA-256. Quem lê o banco não consegue sequestrar um convite ou uma
 * redefinição em andamento. SHA-256 (e não bcrypt) porque o token já é
 * aleatório de 256 bits — não há o que um ataque de dicionário faça, e
 * a verificação precisa ser rápida.
 */
export function geraToken(): { bruto: string; hash: string } {
  const bruto = randomBytes(32).toString('hex');
  return { bruto, hash: hashToken(bruto) };
}

export function hashToken(bruto: string): string {
  return createHash('sha256').update(bruto).digest('hex');
}

export async function buscaUsuarioPorEmail(email: string): Promise<Usuario | null> {
  return queryOne<Usuario>(
    `SELECT ${COLUNAS_USUARIO} FROM trakeamento_controle.app_users WHERE email = ? LIMIT 1`,
    [email.trim().toLowerCase()],
  );
}

export async function buscaUsuarioPorId(id: number): Promise<Usuario | null> {
  return queryOne<Usuario>(
    `SELECT ${COLUNAS_USUARIO} FROM trakeamento_controle.app_users WHERE id = ? LIMIT 1`,
    [id],
  );
}

/**
 * Autentica e-mail + senha.
 *
 * Devolve `null` para credencial errada, conta inexistente e conta não
 * ativa — sem distinguir entre os casos. Distinguir permitiria enumerar
 * quais e-mails existem no sistema. O motivo real do bloqueio aparece
 * apenas no log do servidor.
 */
export async function autentica(email: string, senha: string): Promise<Usuario | null> {
  const linha = await queryOne<Usuario & { password_hash: string }>(
    `SELECT ${COLUNAS_USUARIO}, password_hash
       FROM trakeamento_controle.app_users
      WHERE email = ? LIMIT 1`,
    [email.trim().toLowerCase()],
  );

  if (!linha) {
    // Gasta o mesmo tempo de um bcrypt real para não vazar, pelo tempo de
    // resposta, quais e-mails estão cadastrados.
    await bcrypt.compare(senha, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
    return null;
  }

  const senhaOk = await conferaSenha(senha, linha.password_hash);
  if (!senhaOk) return null;

  if (linha.status !== 'ativo') {
    console.warn(`[auth] login recusado: conta ${linha.email} está ${linha.status}`);
    return null;
  }

  await execute(
    'UPDATE trakeamento_controle.app_users SET last_login_at = NOW() WHERE id = ?',
    [linha.id],
  );

  const { password_hash: _descartado, ...usuario } = linha;
  void _descartado;
  return usuario;
}

// -------------------------------------------------------------------
// Vínculo usuário ↔ cliente
// -------------------------------------------------------------------

/**
 * O usuário tem acesso a este cliente?
 *
 * Consulta direta, sem cache: é a checagem que sustenta o isolamento
 * entre clientes, e um cache errado aqui vira vazamento de dados.
 * `admin` nem chega neste ponto — o guard o libera antes.
 */
export async function temVinculo(userId: number, clientDb: string): Promise<boolean> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return false;
  const linha = await queryOne<{ existe: number }>(
    `SELECT 1 AS existe
       FROM trakeamento_controle.app_user_clients
      WHERE user_id = ? AND client_db_name = ?
      LIMIT 1`,
    [userId, nome],
  );
  return Boolean(linha);
}

export async function listaVinculos(userId: number): Promise<string[]> {
  const linhas = await query<{ client_db_name: string }>(
    `SELECT client_db_name
       FROM trakeamento_controle.app_user_clients
      WHERE user_id = ?`,
    [userId],
  );
  return linhas.map((l) => l.client_db_name);
}

export async function defineVinculos(userId: number, clientDbNames: string[]): Promise<void> {
  const nomes = [...new Set(clientDbNames.map(sanitizaNomeBanco).filter(Boolean))];
  await transacao(async (conn) => {
    await conn.query('DELETE FROM trakeamento_controle.app_user_clients WHERE user_id = ?', [
      userId,
    ]);
    for (const nome of nomes) {
      await conn.query(
        `INSERT INTO trakeamento_controle.app_user_clients (user_id, client_db_name)
         VALUES (?, ?)`,
        [userId, nome],
      );
    }
  });
}

// -------------------------------------------------------------------
// Criação e gestão de contas
// -------------------------------------------------------------------

export async function criaUsuario(dados: {
  email: string;
  senha: string;
  nome: string;
  papel?: Papel;
  status?: StatusUsuario;
}): Promise<number> {
  const email = dados.email.trim().toLowerCase();
  const existente = await buscaUsuarioPorEmail(email);
  if (existente) throw new Error('Já existe uma conta com este e-mail');

  const hash = await geraHashSenha(dados.senha);
  const { insertId } = await execute(
    `INSERT INTO trakeamento_controle.app_users (email, password_hash, name, role, status)
     VALUES (?, ?, ?, ?, ?)`,
    [email, hash, dados.nome.trim(), dados.papel ?? 'cliente', dados.status ?? 'pendente'],
  );
  return insertId;
}

export async function listaUsuarios(): Promise<(Usuario & { clientes: string[] })[]> {
  const usuarios = await query<Usuario>(
    `SELECT ${COLUNAS_USUARIO} FROM trakeamento_controle.app_users ORDER BY created_at DESC`,
  );
  const vinculos = await query<{ user_id: number; client_db_name: string }>(
    'SELECT user_id, client_db_name FROM trakeamento_controle.app_user_clients',
  );
  const porUsuario = new Map<number, string[]>();
  for (const v of vinculos) {
    const lista = porUsuario.get(v.user_id) ?? [];
    lista.push(v.client_db_name);
    porUsuario.set(v.user_id, lista);
  }
  return usuarios.map((u) => ({ ...u, clientes: porUsuario.get(u.id) ?? [] }));
}

export async function alteraStatus(userId: number, status: StatusUsuario): Promise<void> {
  await execute('UPDATE trakeamento_controle.app_users SET status = ? WHERE id = ?', [
    status,
    userId,
  ]);
}

export async function alteraPapel(userId: number, papel: Papel): Promise<void> {
  await execute('UPDATE trakeamento_controle.app_users SET role = ? WHERE id = ?', [papel, userId]);
}

export async function alteraSenha(userId: number, novaSenha: string): Promise<void> {
  const hash = await geraHashSenha(novaSenha);
  await execute(
    `UPDATE trakeamento_controle.app_users
        SET password_hash = ?, reset_token_hash = NULL, reset_token_expires_at = NULL
      WHERE id = ?`,
    [hash, userId],
  );
}

// -------------------------------------------------------------------
// Convites
// -------------------------------------------------------------------

export type Convite = {
  id: number;
  email: string;
  role: Papel;
  client_db_names: string[] | null;
  invited_by: number | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

const DIAS_VALIDADE_CONVITE = 7;

export async function criaConvite(dados: {
  email: string;
  papel: Papel;
  clientes: string[];
  convidadoPor: number;
}): Promise<{ id: number; token: string }> {
  const { bruto, hash } = geraToken();
  const nomes = [...new Set(dados.clientes.map(sanitizaNomeBanco).filter(Boolean))];
  const { insertId } = await execute(
    `INSERT INTO trakeamento_controle.app_invites
       (email, token_hash, role, client_db_names, invited_by, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [
      dados.email.trim().toLowerCase(),
      hash,
      dados.papel,
      JSON.stringify(nomes),
      dados.convidadoPor,
      DIAS_VALIDADE_CONVITE,
    ],
  );
  return { id: insertId, token: bruto };
}

/** Busca um convite pelo token bruto. Devolve `null` se usado ou vencido. */
export async function buscaConviteValido(tokenBruto: string): Promise<Convite | null> {
  const linha = await queryOne<Omit<Convite, 'client_db_names'> & { client_db_names: unknown }>(
    `SELECT id, email, role, client_db_names, invited_by, expires_at, used_at, created_at
       FROM trakeamento_controle.app_invites
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
      LIMIT 1`,
    [hashToken(tokenBruto)],
  );
  if (!linha) return null;
  return { ...linha, client_db_names: normalizaListaJson(linha.client_db_names) };
}

/**
 * Consome um convite: cria a conta já ativa, com os vínculos que o
 * convite carrega, e marca o convite como usado.
 *
 * Tudo numa transação porque uma conta criada sem vínculo (ou um convite
 * queimado sem conta) exigiria correção manual no banco.
 */
export async function consomeConvite(
  tokenBruto: string,
  dados: { nome: string; senha: string },
): Promise<Usuario> {
  const convite = await buscaConviteValido(tokenBruto);
  if (!convite) throw new Error('Convite inválido, já utilizado ou expirado');

  const jaExiste = await buscaUsuarioPorEmail(convite.email);
  if (jaExiste) throw new Error('Já existe uma conta com este e-mail');

  const hashSenha = await geraHashSenha(dados.senha);
  const clientes = convite.client_db_names ?? [];

  const userId = await transacao(async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO trakeamento_controle.app_users
         (email, password_hash, name, role, status, email_verified_at)
       VALUES (?, ?, ?, ?, 'ativo', NOW())`,
      [convite.email, hashSenha, dados.nome.trim(), convite.role],
    );
    const novoId = (res as { insertId: number }).insertId;

    for (const nome of clientes) {
      await conn.query(
        `INSERT INTO trakeamento_controle.app_user_clients (user_id, client_db_name)
         VALUES (?, ?)`,
        [novoId, nome],
      );
    }

    // A condição `used_at IS NULL` é o que impede dois cadastros
    // simultâneos com o mesmo convite: o segundo não afeta linha nenhuma.
    const [upd] = await conn.query(
      `UPDATE trakeamento_controle.app_invites
          SET used_at = NOW()
        WHERE id = ? AND used_at IS NULL`,
      [convite.id],
    );
    if ((upd as { affectedRows: number }).affectedRows === 0) {
      throw new Error('Convite já utilizado');
    }
    return novoId;
  });

  const usuario = await buscaUsuarioPorId(userId);
  if (!usuario) throw new Error('Falha ao criar a conta');
  return usuario;
}

export async function listaConvitesPendentes(): Promise<Convite[]> {
  const linhas = await query<Omit<Convite, 'client_db_names'> & { client_db_names: unknown }>(
    `SELECT id, email, role, client_db_names, invited_by, expires_at, used_at, created_at
       FROM trakeamento_controle.app_invites
      WHERE used_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC`,
  );
  return linhas.map((l) => ({ ...l, client_db_names: normalizaListaJson(l.client_db_names) }));
}

// -------------------------------------------------------------------
// Redefinição de senha
// -------------------------------------------------------------------

const HORAS_VALIDADE_RESET = 1;

/**
 * Registra um pedido de redefinição e devolve o token bruto.
 *
 * Devolve `null` quando o e-mail não existe ou a conta não está ativa —
 * e quem chama deve responder a mesma mensagem de sucesso nos dois casos,
 * senão a tela vira um enumerador de e-mails cadastrados.
 */
export async function iniciaRedefinicaoSenha(email: string): Promise<string | null> {
  const usuario = await buscaUsuarioPorEmail(email);
  if (!usuario || usuario.status !== 'ativo') return null;

  const { bruto, hash } = geraToken();
  await execute(
    `UPDATE trakeamento_controle.app_users
        SET reset_token_hash = ?, reset_token_expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR)
      WHERE id = ?`,
    [hash, HORAS_VALIDADE_RESET, usuario.id],
  );
  return bruto;
}

export async function concluiRedefinicaoSenha(
  tokenBruto: string,
  novaSenha: string,
): Promise<boolean> {
  const linha = await queryOne<{ id: number }>(
    `SELECT id FROM trakeamento_controle.app_users
      WHERE reset_token_hash = ? AND reset_token_expires_at > NOW()
      LIMIT 1`,
    [hashToken(tokenBruto)],
  );
  if (!linha) return false;
  await alteraSenha(linha.id, novaSenha);
  return true;
}

// -------------------------------------------------------------------

/**
 * Normaliza a coluna JSON.
 *
 * O driver devolve `JSON` já parseado em algumas versões do MySQL e como
 * string em outras. Tratar os dois casos evita um bug que só aparece ao
 * trocar a versão do servidor.
 */
function normalizaListaJson(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.map(String);
  if (typeof valor === 'string') {
    try {
      const parsed = JSON.parse(valor);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
