import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

/**
 * Apoio comum dos testes de integração da Fase 4.
 *
 * Estes testes falam com o servidor de verdade e com o MySQL de verdade —
 * é isso que os torna úteis e é isso que os torna perigosos. Duas regras
 * valem para tudo o que estiver aqui: nada é criado fora de
 * `trakeamento_controle.app_users`/`app_user_clients`, e o que é criado é
 * removido no fim, inclusive quando o teste falha.
 */

export const BASE = process.env.TESTE_BASE_URL ?? 'http://localhost:3000';

export function leEnv(): Record<string, string> {
  const arquivo = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(arquivo)) return {};
  const out: Record<string, string> = {};
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    if (!linha.includes('=') || linha.trimStart().startsWith('#')) continue;
    const i = linha.indexOf('=');
    out[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
  }
  return out;
}

/** Jar de cookies mínimo — o `fetch` do Node não guarda cookie sozinho. */
export class Cookies {
  private jar = new Map<string, string>();

  absorve(resposta: Response) {
    for (const bruto of resposta.headers.getSetCookie()) {
      const [par] = bruto.split(';');
      const i = par.indexOf('=');
      if (i > 0) this.jar.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }

  cabecalho(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

export async function servidorNoAr(): Promise<boolean> {
  try {
    // Folga alta de propósito: em `next dev` a primeira requisição ainda
    // espera a compilação da rota, e 3s davam "servidor indisponível" com
    // o servidor no ar — o teste passava a ser pulado sem ninguém notar.
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(30_000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Distingue `next dev` de `next start`.
 *
 * O endpoint do overlay de erro só existe em desenvolvimento — em
 * produção a rota nem é registrada. Isso importa porque o servidor de
 * desenvolvimento anexa ao payload RSC os valores que as funções de
 * servidor devolveram (é o que alimenta o painel de depuração), e um
 * deles é a linha do catálogo do cliente. Em produção esse anexo não
 * existe; a verificação de vazamento portanto só faz sentido lá.
 */
export async function emDesenvolvimento(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/__nextjs_original-stack-frames`, {
      signal: AbortSignal.timeout(5000),
    });
    return r.status !== 404;
  } catch {
    return false;
  }
}

/** Login pelo fluxo real do Auth.js (CSRF + callback de credenciais). */
export async function login(email: string, senha: string): Promise<Cookies> {
  const cookies = new Cookies();

  const rCsrf = await fetch(`${BASE}/api/auth/csrf`);
  cookies.absorve(rCsrf);
  const { csrfToken } = (await rCsrf.json()) as { csrfToken: string };

  const rLogin = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookies.cabecalho(),
    },
    body: new URLSearchParams({ email, senha, csrfToken, callbackUrl: `${BASE}/app` }),
  });
  cookies.absorve(rLogin);

  const sessao = await fetch(`${BASE}/api/auth/session`, {
    headers: { cookie: cookies.cabecalho() },
  });
  const dados = (await sessao.json()) as { user?: { email?: string } };
  assert.equal(dados.user?.email, email, 'login do usuário de teste não completou');

  return cookies;
}

export type ClienteCatalogo = { client_db_name: string; account_name: string };

export async function conecta(): Promise<mysql.Connection | null> {
  const env = leEnv();
  if (!env.MYSQL_HOST) return null;
  return mysql.createConnection({
    host: env.MYSQL_HOST,
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
  });
}

export async function listaClientes(conexao: mysql.Connection): Promise<ClienteCatalogo[]> {
  const [linhas] = await conexao.query<mysql.RowDataPacket[]>(
    'SELECT client_db_name, account_name FROM trakeamento_controle.ad_accounts ORDER BY id',
  );
  return linhas.map((l) => ({
    client_db_name: String(l.client_db_name),
    account_name: String(l.account_name),
  }));
}

export type UsuarioTeste = { id: number; email: string; senha: string };

/**
 * Cria (recriando, se sobrou de uma execução interrompida) um usuário de
 * teste com os vínculos pedidos. A senha é sorteada a cada execução: um
 * valor fixo no repositório viraria credencial de verdade no dia em que
 * alguém rodasse isto contra um ambiente exposto.
 */
export async function criaUsuarioTeste(
  conexao: mysql.Connection,
  dados: { email: string; papel?: 'admin' | 'cliente'; clientes?: string[] },
): Promise<UsuarioTeste> {
  const email = dados.email;
  const senha = 'Teste-' + Math.random().toString(36).slice(2, 12);

  await removeUsuarioTeste(conexao, email);

  const hash = await bcrypt.hash(senha, 12);
  const [ins] = await conexao.query<mysql.ResultSetHeader>(
    `INSERT INTO trakeamento_controle.app_users (email, password_hash, name, role, status)
     VALUES (?, ?, 'Teste de integracao', ?, 'ativo')`,
    [email, hash, dados.papel ?? 'cliente'],
  );

  for (const clientDb of dados.clientes ?? []) {
    await conexao.query(
      'INSERT INTO trakeamento_controle.app_user_clients (user_id, client_db_name) VALUES (?, ?)',
      [ins.insertId, clientDb],
    );
  }

  return { id: ins.insertId, email, senha };
}

export async function removeUsuarioTeste(conexao: mysql.Connection, email: string): Promise<void> {
  // A subconsulta extra existe porque o MySQL não deixa referenciar na
  // subconsulta a mesma tabela que o DELETE altera.
  await conexao.query(
    `DELETE FROM trakeamento_controle.app_user_clients
      WHERE user_id IN (SELECT id FROM (SELECT id FROM trakeamento_controle.app_users WHERE email = ?) AS u)`,
    [email],
  );
  await conexao.query('DELETE FROM trakeamento_controle.app_users WHERE email = ?', [email]);
}

/** Conexões abertas no MySQL neste instante. */
export async function threadsConectadas(conexao: mysql.Connection): Promise<number> {
  const [linhas] = await conexao.query<mysql.RowDataPacket[]>(
    "SHOW STATUS LIKE 'Threads_connected'",
  );
  return Number(linhas[0]?.Value ?? 0);
}
