import 'server-only';
import {
  query,
  queryOne,
  execute,
  transacao,
  LacunasDeEsquema,
  lacunaDeEsquema,
} from '@/lib/db/pool';
import { sanitizaNomeBanco } from '@/lib/nomes-banco';
import { derivaProdutos, leProdutos, serializaProdutos, type Produto } from '@/lib/produtos';
import type { DadosFormularios } from '@/lib/produtos-form';

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
 * Test Event Code da conta — o código que a Meta mostra em Gerenciador de
 * Eventos › Testar eventos.
 *
 * Não é segredo (some do painel da Meta em minutos) e vale para todo
 * evento enviado pela CAPI deste cliente: formulários, WhatsApp e Página
 * de vendas saem do mesmo `ad_accounts.meta_test_event_code`. Por isso
 * mora aqui e não no módulo de um produto só.
 */
export async function buscaTestEventCode(clientDb: string): Promise<string | null> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return null;
  const linha = await queryOne<{ meta_test_event_code: string | null }>(
    `SELECT meta_test_event_code
       FROM trakeamento_controle.ad_accounts
      WHERE client_db_name = ?
      LIMIT 1`,
    [nome],
  );
  return linha?.meta_test_event_code ?? null;
}

/** Grava (ou limpa, com `null`) o Test Event Code da conta. */
export async function salvaTestEventCode(clientDb: string, codigo: string | null): Promise<boolean> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return false;
  const r = await execute(
    `UPDATE trakeamento_controle.ad_accounts
        SET meta_test_event_code = ?
      WHERE client_db_name = ?`,
    [codigo, nome],
  );
  return r.affectedRows > 0;
}

/**
 * Troca o pixel/dataset da Meta do cliente.
 *
 * Uma coluna só para todos os produtos: a tag da Página de vendas, a
 * Conversions API dos sites, os eventos de formulário (n8n) e os do
 * WhatsApp leem daqui.
 */
export async function salvaPixelDataset(clientDb: string, pixel: string): Promise<boolean> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return false;
  const r = await execute(
    `UPDATE trakeamento_controle.ad_accounts
        SET meta_pixel_dataset_id = ?
      WHERE client_db_name = ?`,
    [pixel, nome],
  );
  return r.affectedRows > 0;
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

/**
 * Subdomínio do Kommo de cada cliente.
 *
 * No fluxo de eventos o subdomínio chega dentro do webhook do próprio
 * Kommo, então nunca precisou ficar gravado. A automação
 * "Kommo - Sincroniza Perdidos" roda por agenda, sem webhook nenhum, e
 * sem isto não sabe em qual conta perguntar. Cliente sem subdomínio é
 * apenas pulado por ela.
 */
export async function leSubdominiosKommo(): Promise<Map<string, string | null>> {
  const lacunas = new LacunasDeEsquema();
  const linhas = await lacunas.ou(
    query<{ client_db_name: string; kommo_subdomain: string | null }>(
      `SELECT client_db_name, kommo_subdomain FROM trakeamento_controle.ad_accounts
        WHERE client_db_name IS NOT NULL AND client_db_name <> ''`,
    ),
    [],
  );

  const mapa = new Map<string, string | null>();
  for (const l of linhas) {
    const sub = (l.kommo_subdomain ?? '').trim();
    mapa.set(l.client_db_name, sub === '' ? null : sub);
  }
  return mapa;
}

/**
 * Subdomínio de um cliente só.
 *
 * A coluna veio de migração, então banco central atrasado ainda não a
 * tem: a falha vira `null`, como em `leSubdominiosKommo`. Quem chama
 * trata a ausência como "cliente sem Kommo ligado", que é o mesmo
 * caminho de um cliente que nunca preencheu o campo.
 */
export async function buscaSubdominioKommo(clientDb: string): Promise<string | null> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return null;
  try {
    const linha = await queryOne<{ kommo_subdomain: string | null }>(
      `SELECT kommo_subdomain FROM trakeamento_controle.ad_accounts
        WHERE client_db_name = ? LIMIT 1`,
      [nome],
    );
    const sub = (linha?.kommo_subdomain ?? '').trim();
    return sub === '' ? null : sub;
  } catch {
    return null;
  }
}

/** Grava o subdomínio do Kommo. `null` tira o cliente da automação. */
export async function salvaSubdominioKommo(
  clientDb: string,
  subdominio: string | null,
): Promise<void> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  await execute(
    `UPDATE trakeamento_controle.ad_accounts SET kommo_subdomain = ? WHERE client_db_name = ?`,
    [subdominio, nome],
  );
}

export type NovaAdAccount = {
  account_name: string;
  ad_account_id: string;
  crm_account_id: string | null;
  meta_pixel_dataset_id: string | null;
  meta_access_token: string | null;
  kommo_access_token: string | null;
  /** Só o nome da conta: "minhaempresa", não a URL inteira. */
  kommo_subdomain: string | null;
  content_category: string | null;
  /** Texto de `serializaProdutos`, como "landing_page,whatsapp". */
  produtos: string | null;
  client_db_name: string;
};

export type ProdutosDoCliente = {
  produtos: Produto[];
  /** `false` quando a coluna está NULL e a lista foi deduzida. */
  definidos: boolean;
};

/**
 * Produtos de cada cliente: o que está gravado em `ad_accounts.produtos`
 * ou, com a coluna NULL, o que dá para deduzir do que está cadastrado.
 *
 * Quatro consultas pequenas em vez de uma com JOIN: cada tabela veio de
 * uma migração diferente, e banco central atrasado não pode derrubar a
 * lista de clientes inteira por causa de uma delas. A presença do token
 * do Kommo sai do banco como booleano; o valor não.
 */
async function leProdutosDe(clientDb: string | null): Promise<Map<string, ProdutosDoCliente>> {
  const filtro = clientDb ? ' AND client_db_name = ?' : '';
  const params = clientDb ? [clientDb] : [];
  const lacunas = new LacunasDeEsquema();

  const [gravados, crm, whatsapp, sites] = await Promise.all([
    lacunas.ou(
      query<{ client_db_name: string; produtos: string | null }>(
        `SELECT client_db_name, produtos FROM trakeamento_controle.ad_accounts
          WHERE client_db_name IS NOT NULL AND client_db_name <> ''${filtro}`,
        params,
      ),
      [],
    ),
    query<{ client_db_name: string; tem_crm: number }>(
      `SELECT client_db_name,
              (COALESCE(crm_account_id, '') <> '' OR COALESCE(kommo_access_token, '') <> '') AS tem_crm
         FROM trakeamento_controle.ad_accounts
        WHERE client_db_name IS NOT NULL AND client_db_name <> ''${filtro}`,
      params,
    ),
    lacunas.ou(
      query<{ client_db_name: string }>(
        `SELECT DISTINCT client_db_name FROM trakeamento_controle.whatsapp_accounts
          WHERE 1 = 1${filtro}`,
        params,
      ),
      [],
    ),
    lacunas.ou(
      query<{ client_db_name: string }>(
        `SELECT DISTINCT client_db_name FROM trakeamento_controle.paginas_sites
          WHERE 1 = 1${filtro}`,
        params,
      ),
      [],
    ),
  ]);

  const texto = new Map(gravados.map((l) => [l.client_db_name, l.produtos]));
  const comWhatsapp = new Set(whatsapp.map((l) => l.client_db_name));
  const comSites = new Set(sites.map((l) => l.client_db_name));

  const mapa = new Map<string, ProdutosDoCliente>();
  for (const l of crm) {
    const lista = leProdutos(texto.get(l.client_db_name));
    mapa.set(
      l.client_db_name,
      lista
        ? { produtos: lista, definidos: true }
        : {
            produtos: derivaProdutos({
              temCrm: Boolean(Number(l.tem_crm)),
              temWhatsapp: comWhatsapp.has(l.client_db_name),
              temSites: comSites.has(l.client_db_name),
            }),
            definidos: false,
          },
    );
  }
  return mapa;
}

/** Produtos de todos os clientes, para a lista do administrador. */
export function leProdutosDosClientes(): Promise<Map<string, ProdutosDoCliente>> {
  return leProdutosDe(null);
}

/**
 * Produtos de todos os clientes para o menu lateral. `null` se a leitura
 * falhar: o menu cai para "mostra tudo", e uma consulta com problema não
 * derruba o painel inteiro.
 */
export async function produtosParaMenu(): Promise<Map<string, ProdutosDoCliente> | null> {
  try {
    return await leProdutosDe(null);
  } catch (erro) {
    console.error('[cliente] falha ao ler os produtos para o menu', erro);
    return null;
  }
}

export async function buscaProdutosDoCliente(clientDb: string): Promise<ProdutosDoCliente> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return { produtos: [], definidos: false };
  return (await leProdutosDe(nome)).get(nome) ?? { produtos: [], definidos: false };
}

/** Grava a lista de produtos. Lança se a coluna ainda não existe. */
export async function salvaProdutos(clientDb: string, produtos: Produto[]): Promise<void> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');
  await execute(
    `UPDATE trakeamento_controle.ad_accounts SET produtos = ? WHERE client_db_name = ?`,
    [serializaProdutos(produtos) || null, nome],
  );
}

/** Nome do cliente que já usa esta conta do Kommo, fora o próprio. */
export async function crmAccountEmUso(crmAccountId: string, clientDb: string): Promise<string | null> {
  const linha = await queryOne<{ account_name: string }>(
    `SELECT account_name FROM trakeamento_controle.ad_accounts
      WHERE crm_account_id = ? AND client_db_name <> ?
      LIMIT 1`,
    [crmAccountId, clientDb],
  );
  return linha?.account_name ?? null;
}

/**
 * Liga o Kommo a um cliente que já existe (produto Formulários adicionado
 * depois do cadastro). O subdomínio veio de migração própria: sem a
 * coluna, conta e token são gravados assim mesmo e a automação de
 * perdidos só continua pulando o cliente.
 */
export async function salvaCrmCliente(clientDb: string, dados: DadosFormularios): Promise<void> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  await execute(
    `UPDATE trakeamento_controle.ad_accounts
        SET crm_account_id = ?, kommo_access_token = ?
      WHERE client_db_name = ?`,
    [dados.crm_account_id, dados.kommo_access_token, nome],
  );
  if (dados.kommo_subdomain) {
    try {
      await salvaSubdominioKommo(nome, dados.kommo_subdomain);
    } catch (erro) {
      if (!lacunaDeEsquema(erro)) throw erro;
    }
  }
}

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

/**
 * Registra o cliente no catálogo central. Último passo da criação.
 *
 * Banco central sem a migração do subdomínio grava sem ele: cadastrar
 * cliente é operação crítica demais para parar por causa de um campo que
 * só a automação de perdidos usa. O admin preenche depois, na lista.
 */
export async function criaAdAccount(
  dados: NovaAdAccount,
): Promise<{ id: number; produtosGravados: boolean }> {
  type Opcional = 'kommo_subdomain' | 'produtos';
  const insere = async (opcionais: Opcional[]) => {
    const colunas = opcionais.map((c) => `, ${c}`).join('');
    const marcas = opcionais.map(() => ', ?').join('');
    const extra = opcionais.map((c) => dados[c]);
    const { insertId } = await execute(
      `INSERT INTO trakeamento_controle.ad_accounts
         (account_name, ad_account_id, crm_account_id, meta_pixel_dataset_id,
          meta_access_token, kommo_access_token, content_category,
          client_db_name, status${colunas})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE'${marcas})`,
      [
        dados.account_name,
        dados.ad_account_id,
        dados.crm_account_id,
        dados.meta_pixel_dataset_id,
        dados.meta_access_token,
        dados.kommo_access_token,
        dados.content_category,
        dados.client_db_name,
        ...extra,
      ],
    );
    return insertId;
  };

  // Cada coluna opcional veio de uma migração. Banco central atrasado
  // recusa a coluna que não tem; o cadastro entra sem ela, e quem chama
  // fica sabendo se a lista de produtos foi junto.
  const tentativas: Opcional[][] = [['kommo_subdomain', 'produtos'], ['kommo_subdomain'], []];
  for (let i = 0; ; i++) {
    try {
      const id = await insere(tentativas[i]);
      return { id, produtosGravados: tentativas[i].includes('produtos') };
    } catch (erro) {
      if (!lacunaDeEsquema(erro) || i === tentativas.length - 1) throw erro;
    }
  }
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
  paginas: number;
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
    // Tabela de migração opcional: num central que ainda não passou por
    // migracao_paginas_central.sql, não há site nenhum a apagar. Uma
    // instrução que falha dentro da transação do MySQL não desfaz as
    // anteriores, então capturar aqui é seguro.
    const paginas = await afetadas(
      'DELETE FROM trakeamento_controle.paginas_sites WHERE client_db_name = ?',
    ).catch((erro) => {
      if (lacunaDeEsquema(erro)) return 0;
      throw erro;
    });
    const contas = await afetadas(
      'DELETE FROM trakeamento_controle.ad_accounts WHERE client_db_name = ?',
    );
    if (contas === 0) throw new Error(`Cliente \`${nome}\` não está no catálogo`);

    return { vinculos, preferencias, whatsapp, paginas };
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
