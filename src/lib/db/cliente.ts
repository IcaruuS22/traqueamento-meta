import 'server-only';
import { query, queryOne, execute, transacao, LacunasDeEsquema } from '@/lib/db/pool';
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


/**
 * Quantos usuários estão vinculados a cada cliente.
 *
 * Uma consulta só para a lista inteira: a tela de administração mostra o
 * número em cada cartão, e uma consulta por cliente seria N idas ao
 * banco remoto para exibir um inteiro. Cliente sem ninguém vinculado não
 * aparece no resultado — quem lê usa `?? 0`.
 */
export async function contaVinculosPorCliente(): Promise<Record<string, number>> {
  const linhas = await query<{ client_db_name: string; total: number }>(
    `SELECT client_db_name, COUNT(*) AS total
       FROM trakeamento_controle.app_user_clients
      GROUP BY client_db_name`,
  );
  return Object.fromEntries(linhas.map((l) => [l.client_db_name, Number(l.total)]));
}


/**
 * Qual campo do Kommo guarda o valor do negócio, por cliente.
 *
 * O fluxo do n8n lê o campo nativo "Venda" (price) primeiro; esta
 * configuração diz qual campo PERSONALIZADO consultar quando o nativo
 * vem zerado. Vale o rótulo exato ("Valor do contrato") ou o id numérico
 * do campo, que é o mais seguro: sobrevive a alguém renomear o campo no
 * Kommo.
 *
 * Cliente sem configuração fica com `null`, e o fluxo cai na lista de
 * rótulos conhecidos. Banco sem a migração devolve o mapa vazio em vez
 * de derrubar a tela de administração.
 */
export async function leCamposValorCrm(): Promise<Map<string, string | null>> {
  const lacunas = new LacunasDeEsquema();
  const linhas = await lacunas.ou(
    query<{ client_db_name: string; crm_value_field: string | null }>(
      `SELECT client_db_name, crm_value_field FROM trakeamento_controle.ad_accounts
        WHERE client_db_name IS NOT NULL AND client_db_name <> ''`,
    ),
    [],
  );

  const mapa = new Map<string, string | null>();
  for (const l of linhas) {
    const campo = (l.crm_value_field ?? '').trim();
    mapa.set(l.client_db_name, campo === '' ? null : campo);
  }
  return mapa;
}

/** Grava o campo de valor do CRM. `null` volta ao comportamento padrão. */
export async function salvaCampoValorCrm(
  clientDb: string,
  campo: string | null,
): Promise<void> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  await execute(
    `UPDATE trakeamento_controle.ad_accounts SET crm_value_field = ? WHERE client_db_name = ?`,
    [campo, nome],
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
 * Apaga o cliente do catálogo central. NÃO TEM VOLTA.
 *
 * O que sai daqui, em uma transação só:
 *
 *  - `painel_metric_prefs`: não tem chave estrangeira para `ad_accounts`,
 *    então ninguém a limparia sozinha. O `<> ''` protege a linha global,
 *    que é a preferência padrão de TODOS os clientes;
 *  - `app_user_clients` e `whatsapp_accounts`: têm ON DELETE CASCADE e
 *    sairiam de qualquer jeito. São apagadas explicitamente para render
 *    contagem (o administrador precisa saber quantos usuários perderam o
 *    vínculo) e para o resultado não depender de a instalação ter mesmo
 *    as chaves estrangeiras do template;
 *  - `ad_accounts`: a linha do cliente, por último.
 *
 * `app_audit_log` fica intacta de propósito: é o histórico de quem fez o
 * quê, e apagá-lo junto do cliente removeria justamente o registro da
 * exclusão. As linhas continuam com o `client_db_name` antigo, que ali é
 * texto solto, sem chave estrangeira.
 *
 * Convites pendentes (`app_invites.client_db_names`) também ficam: o
 * cliente excluído some da lista quando o convite é aceito, porque o
 * vínculo é conferido contra o catálogo.
 */
export async function removeAdAccount(clientDb: string): Promise<{
  vinculos: number;
  preferencias: number;
  whatsapp: number;
}> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  return transacao(async (conn) => {
    const afetadas = async (sql: string) => {
      const [r] = await conn.query(sql, [nome]);
      return (r as { affectedRows?: number }).affectedRows ?? 0;
    };

    const preferencias = await afetadas(
      `DELETE FROM trakeamento_controle.painel_metric_prefs
        WHERE client_db_name = ? AND client_db_name <> ''`,
    );
    const vinculos = await afetadas(
      'DELETE FROM trakeamento_controle.app_user_clients WHERE client_db_name = ?',
    );
    const whatsapp = await afetadas(
      'DELETE FROM trakeamento_controle.whatsapp_accounts WHERE client_db_name = ?',
    );
    const contas = await afetadas(
      'DELETE FROM trakeamento_controle.ad_accounts WHERE client_db_name = ?',
    );
    if (contas === 0) throw new Error(`Cliente \`${nome}\` não está no catálogo`);

    return { vinculos, preferencias, whatsapp };
  });
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
