import 'server-only';
import { query, queryOne, execute } from '@/lib/db/pool';
import { sanitizaNomeBanco } from '@/lib/nomes-banco';

/**
 * Acesso aos bancos por cliente (`cliente_<slug>_<id>`).
 *
 * O nome do banco é um identificador SQL, e identificador não pode ser
 * parametrizado com `?` — ele entra por interpolação de texto. Por isso
 * este é o ÚNICO arquivo do projeto autorizado a montar um identificador
 * de banco, e ele o faz atrás de duas barreiras:
 *
 * 1. `sanitizaNomeBanco` — mesma regra já usada nos workflows n8n:
 *    tudo que não for [A-Za-z0-9_] é removido.
 * 2. O chamador precisa ter validado antes que o nome existe em
 *    `trakeamento_controle.ad_accounts` (lib/auth/guard.ts faz isso).
 *    O valor vindo do usuário nunca vira identificador direto: o que é
 *    usado é o valor lido do catálogo.
 */

export { sanitizaNomeBanco } from '@/lib/nomes-banco';

export type AdAccount = {
  id: number;
  account_name: string;
  ad_account_id: string;
  crm_account_id: string | null;
  meta_pixel_dataset_id: string | null;
  content_category: string | null;
  client_db_name: string;
  status: string;
  created_at: string;
  last_sync_started_at: string | null;
};

/**
 * Colunas de `ad_accounts` que podem sair do servidor.
 *
 * `meta_access_token` e `kommo_access_token` estão fora desta lista de
 * propósito e não devem ser adicionados: hoje ficam em texto puro no
 * banco (ver ARQUITETURA_APP.md, seção 3.3), então qualquer rota que os
 * devolvesse ao navegador viraria vazamento de credencial de terceiro.
 */
const COLUNAS_PUBLICAS_AD_ACCOUNTS = `
  id, account_name, ad_account_id, crm_account_id, meta_pixel_dataset_id,
  content_category, client_db_name, status, created_at, last_sync_started_at
`;

/** Busca um cliente pelo nome do banco. Fonte da verdade sobre o que existe. */
export async function buscaAdAccount(clientDb: string): Promise<AdAccount | null> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return null;
  return queryOne<AdAccount>(
    `SELECT ${COLUNAS_PUBLICAS_AD_ACCOUNTS}
       FROM trakeamento_controle.ad_accounts
      WHERE client_db_name = ?
      LIMIT 1`,
    [nome],
  );
}

/** Lista todos os clientes do catálogo. Use `listaAdAccountsDoUsuario` no app. */
export async function listaAdAccounts(): Promise<AdAccount[]> {
  return query<AdAccount>(
    `SELECT ${COLUNAS_PUBLICAS_AD_ACCOUNTS}
       FROM trakeamento_controle.ad_accounts
      WHERE client_db_name IS NOT NULL AND client_db_name <> ''
      ORDER BY account_name ASC`,
  );
}

/**
 * Lê as credenciais de um cliente. Só para uso interno do servidor
 * (chamadas à Graph API / CAPI). O retorno NUNCA pode chegar ao navegador.
 */
export async function buscaCredenciaisCliente(clientDb: string): Promise<{
  meta_pixel_dataset_id: string | null;
  meta_access_token: string | null;
  kommo_access_token: string | null;
  /** Não é segredo, mas anda junto: quem envia evento precisa dos dois. */
  meta_test_event_code: string | null;
} | null> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return null;
  return queryOne(
    `SELECT meta_pixel_dataset_id, meta_access_token, kommo_access_token,
            meta_test_event_code
       FROM trakeamento_controle.ad_accounts
      WHERE client_db_name = ?
      LIMIT 1`,
    [nome],
  );
}

export type NovaAdAccount = {
  account_name: string;
  ad_account_id: string;
  crm_account_id: string | null;
  meta_pixel_dataset_id: string | null;
  meta_access_token: string | null;
  kommo_access_token: string | null;
  content_category: string | null;
  client_db_name: string;
};

/**
 * Diz se algum identificador único do cliente novo já está no catálogo.
 *
 * A tabela tem UNIQUE em `ad_account_id`, `crm_account_id` e
 * `client_db_name`, então o banco recusaria de qualquer forma — mas com
 * uma mensagem de driver. Conferir antes permite dizer QUAL campo
 * colidiu, e evita criar o banco do cliente para só então descobrir que
 * o cadastro não vai entrar.
 */
export async function conflitoDeAdAccount(dados: {
  ad_account_id: string;
  crm_account_id: string | null;
  client_db_name: string;
}): Promise<string | null> {
  const existente = await queryOne<{ account_name: string; campo: string }>(
    `SELECT account_name,
            CASE
              WHEN ad_account_id = ? THEN 'ad_account_id'
              WHEN client_db_name = ? THEN 'client_db_name'
              ELSE 'crm_account_id'
            END AS campo
       FROM trakeamento_controle.ad_accounts
      WHERE ad_account_id = ?
         OR client_db_name = ?
         OR (? IS NOT NULL AND crm_account_id = ?)
      LIMIT 1`,
    [
      dados.ad_account_id,
      dados.client_db_name,
      dados.ad_account_id,
      dados.client_db_name,
      dados.crm_account_id,
      dados.crm_account_id,
    ],
  );
  if (!existente) return null;

  const rotulos: Record<string, string> = {
    ad_account_id: 'ID da conta de anúncios',
    client_db_name: 'nome de banco gerado a partir do nome do cliente',
    crm_account_id: 'ID da conta no CRM',
  };
  return `Já existe um cliente ("${existente.account_name}") com o mesmo ${rotulos[existente.campo] ?? existente.campo}.`;
}

/** Registra o cliente no catálogo central. Último passo da criação. */
export async function criaAdAccount(dados: NovaAdAccount): Promise<number> {
  const { insertId } = await execute(
    `INSERT INTO trakeamento_controle.ad_accounts
       (account_name, ad_account_id, crm_account_id, meta_pixel_dataset_id,
        meta_access_token, kommo_access_token, content_category,
        client_db_name, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [
      dados.account_name,
      dados.ad_account_id,
      dados.crm_account_id,
      dados.meta_pixel_dataset_id,
      dados.meta_access_token,
      dados.kommo_access_token,
      dados.content_category,
      dados.client_db_name,
    ],
  );
  return insertId;
}

/**
 * Handle de acesso a um banco de cliente.
 *
 * `tabela('customers')` devolve o identificador qualificado e escapado,
 * pronto para interpolar no SQL. Os valores continuam sempre indo por `?`.
 */
export class BancoCliente {
  readonly nome: string;

  constructor(clientDb: string) {
    const nome = sanitizaNomeBanco(clientDb);
    if (!nome) throw new Error('Nome de banco de cliente inválido');
    this.nome = nome;
  }

  /** Identificador qualificado e escapado: `` `cliente_x`.`customers` `` */
  tabela(nome: string): string {
    const t = sanitizaNomeBanco(nome);
    if (!t) throw new Error('Nome de tabela inválido');
    return `\`${this.nome}\`.\`${t}\``;
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return query<T>(sql, params);
  }

  queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return queryOne<T>(sql, params);
  }

  execute(sql: string, params: unknown[] = []) {
    return execute(sql, params);
  }
}
