import 'server-only';
import mysql from 'mysql2/promise';
import { env } from '@/lib/env';

/**
 * Pool único de conexões MySQL.
 *
 * Este arquivo carrega o risco técnico número 1 da migração (ver
 * ARQUITETURA_APP.md, seção 3.2): funções serverless podem escalar para
 * dezenas de instâncias simultâneas, e cada uma abrindo seu próprio pool
 * estoura o `max_connections` do MySQL do VPS.
 *
 * Três decisões daqui atacam isso:
 *
 * 1. `connectionLimit` vem do env (`MYSQL_POOL_LIMIT`, default 10). No
 *    deploy atual — um único processo `next start` — o pool é um só para o
 *    app inteiro, então 3 conexões estrangulavam todas as telas (a de
 *    métricas dispara ~14 consultas por request). Em Vercel serverless,
 *    onde cada instância tem o próprio pool, baixe o env para que
 *    instâncias × limite não estoure o `max_connections` do MySQL.
 * 2. `maxIdle` = limite do pool: mantém as conexões abertas dentro do
 *    `idleTimeout`. O host do MySQL é remoto (RTT alto), e reabrir conexão
 *    a cada rajada custava handshake TCP + auth a cada onda de consultas.
 *    Em serverless, baixe `MYSQL_POOL_LIMIT` e o `maxIdle` acompanha,
 *    voltando a soltar slots rápido.
 * 3. Guardado em `globalThis` — sobrevive ao hot-reload do Next em
 *    desenvolvimento (senão cada salvamento vaza um pool novo) e ao
 *    reaproveitamento de instância com Fluid Compute em produção.
 */

const POOL_KEY = Symbol.for('trakeamento.mysql.pool');

type GlobalComPool = typeof globalThis & {
  [POOL_KEY]?: mysql.Pool;
};

const globalComPool = globalThis as GlobalComPool;

export function getPool(): mysql.Pool {
  if (!globalComPool[POOL_KEY]) {
    globalComPool[POOL_KEY] = mysql.createPool({
      host: env.mysql.host,
      port: env.mysql.port,
      user: env.mysql.user,
      password: env.mysql.password,
      // Sem `database` fixo: as queries qualificam o banco no próprio SQL
      // (`trakeamento_controle.ad_accounts`, `cliente_x.customers`), o que
      // evita depender de `USE` — que em pool é perigoso, porque a conexão
      // volta para o pool carregando o banco selecionado pela chamada
      // anterior.
      waitForConnections: true,
      connectionLimit: env.mysql.poolLimit,
      maxIdle: env.mysql.poolLimit,
      idleTimeout: 30_000,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      timezone: 'Z',
      charset: 'utf8mb4_unicode_ci',
      // Datas voltam como string para preservar exatamente o que está no
      // banco. O sistema todo trabalha com horário de São Paulo gravado
      // como TIMESTAMP sem fuso; deixar o driver converter para Date
      // aplicaria o fuso do servidor da Vercel (UTC) e deslocaria tudo.
      dateStrings: true,
      ...(env.mysql.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    });
  }
  return globalComPool[POOL_KEY]!;
}

/** Executa uma query e devolve as linhas tipadas. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [linhas] = await getPool().query(sql, params);
  return linhas as T[];
}

/** Executa uma query e devolve a primeira linha, ou null. */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const linhas = await query<T>(sql, params);
  return linhas[0] ?? null;
}

/**
 * Descreve o erro quando ele é "esta parte do esquema não existe neste
 * banco", ou devolve `null` para qualquer outro erro.
 *
 * Os bancos por cliente não estão todos na mesma versão do template: o
 * catálogo tem clientes criados antes de tabelas e colunas atuais
 * existirem, e as migrações são rodadas à mão, um banco por vez. Uma tela
 * que consulta oito tabelas não pode virar erro 500 inteiro porque uma
 * delas está defasada naquele cliente — quem usa o painel perderia também
 * os números que existem.
 */
export function lacunaDeEsquema(erro: unknown): string | null {
  const e = erro as { code?: string; sqlMessage?: string } | null;
  if (!e) return null;
  if (e.code === 'ER_NO_SUCH_TABLE') {
    const m = /Table '(?:[^'.]+\.)?([^'.]+)' doesn't exist/.exec(e.sqlMessage ?? '');
    return `tabela ${m ? m[1] : 'desconhecida'}`;
  }
  if (e.code === 'ER_BAD_FIELD_ERROR') {
    const m = /Unknown column '([^']+)'/.exec(e.sqlMessage ?? '');
    return `coluna ${m ? m[1] : 'desconhecida'}`;
  }
  return null;
}

/**
 * Coletor das lacunas encontradas durante um conjunto de consultas.
 *
 * `ou(consulta, alternativa)` devolve a alternativa quando o esquema está
 * defasado e guarda a descrição, para a tela poder dizer o que faltou em
 * vez de mostrar zero como se fosse dado real. Qualquer outro erro
 * continua subindo — degradar erro de verdade esconderia bug.
 */
export class LacunasDeEsquema {
  private readonly encontradas = new Set<string>();

  async ou<T>(consulta: Promise<T>, alternativa: T): Promise<T> {
    try {
      return await consulta;
    } catch (erro) {
      const lacuna = lacunaDeEsquema(erro);
      if (!lacuna) throw erro;
      this.encontradas.add(lacuna);
      return alternativa;
    }
  }

  lista(): string[] {
    return [...this.encontradas].sort();
  }
}

/** Executa INSERT/UPDATE/DELETE e devolve linhas afetadas e insertId. */
export async function execute(
  sql: string,
  params: unknown[] = [],
): Promise<{ affectedRows: number; insertId: number }> {
  const [resultado] = await getPool().query(sql, params);
  const r = resultado as mysql.ResultSetHeader;
  return { affectedRows: r.affectedRows ?? 0, insertId: r.insertId ?? 0 };
}

/**
 * Executa várias operações na mesma conexão, dentro de uma transação.
 * Use quando um conjunto de escritas precisa valer tudo ou nada.
 */
export async function transacao<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (erro) {
    await conn.rollback();
    throw erro;
  } finally {
    conn.release();
  }
}
