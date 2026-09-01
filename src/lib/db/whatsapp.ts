import 'server-only';
import { queryOne, execute, transacao, LacunasDeEsquema } from '@/lib/db/pool';
import { sanitizaNomeBanco } from '@/lib/db/cliente';

/**
 * Configuração do WhatsApp Cloud API de um cliente — porte de
 * `GET /painel-api/whatsapp-config`.
 *
 * Leitura e escrita (`POST /painel-api/whatsapp-salvar`). O endpoint
 * antigo devolvia o token como a string `'•••• configurado'`; aqui a
 * coluna do token nunca é SELECIONADA — o que sai do banco é só um
 * booleano calculado no próprio SQL. Mascarar depois de trazer o valor
 * para a memória do processo funciona até alguém logar o objeto inteiro;
 * não trazer não tem esse modo de falha.
 *
 * `whatsapp_accounts` vive em `trakeamento_controle`, não no banco do
 * cliente: é catálogo, igual a `ad_accounts`.
 */

/**
 * Texto único do aviso de migração pendente.
 *
 * Aparece na tela de Conexão e no retorno de toda ação da Evolution: sem
 * as colunas, nenhuma delas tem onde gravar, e o usuário precisa ler a
 * mesma instrução venha por onde vier.
 */
export const AVISO_MIGRACAO_EVOLUTION =
  'As colunas da Evolution ainda não existem no catálogo. Rode a migração ' +
  'migracao_whatsapp_evolution.sql no banco trakeamento_controle antes de conectar.';

/** Qual das duas conexões vale para o cliente. */
export type ProvedorWhatsapp = 'cloud' | 'evolution';

export type ConfigWhatsapp = {
  /** Mesma definição do painel antigo: existe phone_number_id cadastrado. */
  configurado: boolean;
  cloud_phone_number_id: string | null;
  cloud_waba_id: string | null;
  status: string | null;
  updated_at: string | null;
  /** Nunca o valor — só se existe. */
  token_cadastrado: boolean;
  /** Vem de `ad_accounts`, não de `whatsapp_accounts`. */
  meta_test_event_code: string | null;
  /** Conexão ativa. `cloud` para tudo que existia antes da Evolution. */
  provider: ProvedorWhatsapp;
  evolution: ConfigEvolution;
  /**
   * O catálogo já tem as colunas da Evolution. Falso enquanto
   * `migracao_whatsapp_evolution.sql` não rodou naquele banco — e aí a
   * tela mostra o card inerte em vez do formulário, porque qualquer
   * ação dele bateria na mesma coluna que não existe.
   */
  evolution_disponivel: boolean;
  lacunas_de_esquema: string[];
};

/**
 * Parte da conexão que a tela da Evolution mostra.
 *
 * A api key segue a mesma regra do token da Cloud API: a tela só sabe se
 * existe. O que ela precisa exibir é o endereço do servidor e o estado
 * da instância, e nada disso é segredo.
 */
export type ConfigEvolution = {
  base_url: string | null;
  instancia: string | null;
  /** Nunca o valor — só se existe. */
  api_key_cadastrada: boolean;
  /** Último estado conhecido: 'open' | 'close' | 'connecting'. */
  estado: string | null;
  numero: string | null;
  /** A instância já foi criada no servidor da Evolution. */
  criada: boolean;
};

const EVOLUTION_VAZIA: ConfigEvolution = {
  base_url: null,
  instancia: null,
  api_key_cadastrada: false,
  estado: null,
  numero: null,
  criada: false,
};

type LinhaConta = {
  cloud_phone_number_id: string | null;
  cloud_waba_id: string | null;
  status: string | null;
  updated_at: string | null;
  tem_token: number;
};

type LinhaEvolution = {
  provider: string | null;
  evolution_base_url: string | null;
  evolution_instance: string | null;
  evolution_state: string | null;
  evolution_number: string | null;
  tem_api_key: number;
};

export async function buscaConfigWhatsapp(clientDb: string): Promise<ConfigWhatsapp> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  const lacunas = new LacunasDeEsquema();
  // As colunas da Evolution saem numa consulta separada de propósito: se
  // fossem para o mesmo SELECT, um banco que ainda não rodou a migração
  // perderia junto a leitura da conexão Cloud API, que funciona sem elas.
  // O coletor delas também é separado: é o que diz à tela se o card da
  // Evolution pode ser interativo, sem confundir com uma lacuna vinda de
  // outra tabela.
  const lacunasEvolution = new LacunasDeEsquema();
  const [conta, adAccount, evolucao] = await Promise.all([
    lacunas.ou(
      queryOne<LinhaConta>(
        `SELECT cloud_phone_number_id, cloud_waba_id, status, updated_at,
                (cloud_access_token IS NOT NULL AND cloud_access_token <> '') AS tem_token
           FROM trakeamento_controle.whatsapp_accounts
          WHERE client_db_name = ?
          LIMIT 1`,
        [nome],
      ),
      null,
    ),
    lacunas.ou(
      queryOne<{ meta_test_event_code: string | null }>(
        `SELECT meta_test_event_code
           FROM trakeamento_controle.ad_accounts
          WHERE client_db_name = ?
          LIMIT 1`,
        [nome],
      ),
      null,
    ),
    lacunasEvolution.ou(
      queryOne<LinhaEvolution>(
        `SELECT provider, evolution_base_url, evolution_instance,
                evolution_state, evolution_number,
                (evolution_api_key IS NOT NULL AND evolution_api_key <> '') AS tem_api_key
           FROM trakeamento_controle.whatsapp_accounts
          WHERE client_db_name = ?
          LIMIT 1`,
        [nome],
      ),
      null,
    ),
  ]);

  const provider: ProvedorWhatsapp = evolucao?.provider === 'evolution' ? 'evolution' : 'cloud';

  return {
    configurado:
      provider === 'evolution'
        ? Boolean(evolucao?.evolution_instance)
        : Boolean(conta?.cloud_phone_number_id),
    cloud_phone_number_id: conta?.cloud_phone_number_id ?? null,
    cloud_waba_id: conta?.cloud_waba_id ?? null,
    status: conta?.status ?? null,
    updated_at: conta?.updated_at ?? null,
    token_cadastrado: Boolean(conta?.tem_token),
    meta_test_event_code: adAccount?.meta_test_event_code ?? null,
    provider,
    evolution: evolucao
      ? {
          base_url: evolucao.evolution_base_url,
          instancia: evolucao.evolution_instance,
          api_key_cadastrada: Boolean(evolucao.tem_api_key),
          estado: evolucao.evolution_state,
          numero: evolucao.evolution_number,
          criada: Boolean(evolucao.evolution_instance),
        }
      : EVOLUTION_VAZIA,
    evolution_disponivel: lacunasEvolution.lista().length === 0,
    lacunas_de_esquema: [...lacunas.lista(), ...lacunasEvolution.lista()].sort(),
  };
}

export type EntradaConfigWhatsapp = {
  cloud_phone_number_id: string;
  cloud_waba_id: string | null;
  /** Vazio significa "não alterar" — nunca "apagar". */
  cloud_access_token: string;
  meta_test_event_code: string | null;
};

/**
 * Grava a conexão — porte de `POST /painel-api/whatsapp-salvar`.
 *
 * Duas diferenças em relação ao endpoint antigo:
 *
 *  - o token antigo não é lido para ser regravado. O n8n fazia
 *    `SELECT cloud_access_token` e devolvia o mesmo valor no INSERT;
 *    aqui quem decide é o próprio MySQL
 *    (`COALESCE(NULLIF(?, ''), cloud_access_token)`), então o valor nunca
 *    passa pelo processo do app só para voltar igual ao banco;
 *  - as duas escritas (conexão e test event code) vão numa transação. No
 *    fluxo antigo a segunda podia falhar sozinha e a resposta ainda era
 *    "salva com sucesso" — os dois nodes de erro caíam no mesmo node de
 *    sucesso.
 *
 * A checagem de "primeira configuração" continua sendo feita antes, com
 * o booleano `token_cadastrado` da leitura: sem token nenhum no banco e
 * sem token no formulário, a linha nasceria inutilizável.
 */
export async function salvaConfigWhatsapp(
  clientDb: string,
  entrada: EntradaConfigWhatsapp,
): Promise<void> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  const waba = entrada.cloud_waba_id || null;
  const token = entrada.cloud_access_token;
  const testCode = entrada.meta_test_event_code || null;

  await transacao(async (conn) => {
    await conn.query(
      `INSERT INTO trakeamento_controle.whatsapp_accounts
         (client_db_name, cloud_phone_number_id, cloud_waba_id, cloud_access_token, status)
       VALUES (?, ?, ?, ?, 'ACTIVE')
       ON DUPLICATE KEY UPDATE
         cloud_phone_number_id = ?,
         cloud_waba_id = ?,
         cloud_access_token = COALESCE(NULLIF(?, ''), cloud_access_token),
         status = 'ACTIVE'`,
      [nome, entrada.cloud_phone_number_id, waba, token,
       entrada.cloud_phone_number_id, waba, token],
    );

    await conn.query(
      `UPDATE trakeamento_controle.ad_accounts
          SET meta_test_event_code = ?
        WHERE client_db_name = ?`,
      [testCode, nome],
    );
  });
}

// -------------------------------------------------------------------
// Evolution API
// -------------------------------------------------------------------

/**
 * Credenciais da Evolution de um cliente.
 *
 * Mesma regra do `dadosParaEnvio` da tela de conversas: este objeto sai
 * do banco para ir direto ao cliente HTTP da Evolution. Nenhuma rota,
 * ação ou log pode devolvê-lo inteiro — `api_key` e `webhook_token` são
 * segredos, e `webhook_token` em particular é o que impede qualquer um
 * de injetar mensagens falsas na conversa de um lead.
 */
export type CredenciaisEvolutionCliente = {
  base_url: string | null;
  api_key: string | null;
  instancia: string | null;
  webhook_token: string | null;
};

export async function buscaCredenciaisEvolution(
  clientDb: string,
): Promise<CredenciaisEvolutionCliente | null> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  return queryOne<CredenciaisEvolutionCliente>(
    `SELECT evolution_base_url AS base_url,
            evolution_api_key AS api_key,
            evolution_instance AS instancia,
            evolution_webhook_token AS webhook_token
       FROM trakeamento_controle.whatsapp_accounts
      WHERE client_db_name = ?
      LIMIT 1`,
    [nome],
  );
}

export type EntradaConexaoEvolution = {
  base_url: string;
  /** Vazio significa "não alterar" — nunca "apagar". */
  api_key: string;
  instancia: string;
  webhook_token: string;
};

/**
 * Grava a conexão da Evolution e marca o cliente como `provider =
 * 'evolution'`.
 *
 * A linha é a mesma de `salvaConfigWhatsapp`: um cliente tem uma conexão
 * de WhatsApp, e trocar de provedor é trocar o valor da coluna, não
 * criar um segundo registro. As colunas da Cloud API ficam onde estão —
 * se o cliente voltar para a conexão oficial, o que já estava cadastrado
 * continua lá.
 *
 * O `COALESCE(NULLIF(?, ''), ...)` na api key repete o que já é feito com
 * o token da Cloud API: quem reenvia o formulário sem preencher o campo
 * mantém a chave gravada, sem que o valor precise passar pelo processo do
 * app só para voltar igual ao banco.
 */
export async function salvaConexaoEvolution(
  clientDb: string,
  entrada: EntradaConexaoEvolution,
): Promise<void> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  await execute(
    `INSERT INTO trakeamento_controle.whatsapp_accounts
       (client_db_name, provider, status,
        evolution_base_url, evolution_api_key, evolution_instance, evolution_webhook_token)
     VALUES (?, 'evolution', 'ACTIVE', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       provider = 'evolution',
       status = 'ACTIVE',
       evolution_base_url = ?,
       evolution_api_key = COALESCE(NULLIF(?, ''), evolution_api_key),
       evolution_instance = ?,
       evolution_webhook_token = COALESCE(evolution_webhook_token, ?)`,
    [
      nome,
      entrada.base_url,
      entrada.api_key,
      entrada.instancia,
      entrada.webhook_token,
      entrada.base_url,
      entrada.api_key,
      entrada.instancia,
      entrada.webhook_token,
    ],
  );
}

/**
 * Troca a api key gravada pela chave própria da instância.
 *
 * A v2 da Evolution devolve um `hash` no `/instance/create`: a partir daí
 * é ele, e não a chave global do servidor, que autentica as chamadas
 * daquela instância. Guardar a chave da instância limita o estrago de um
 * vazamento a um cliente em vez do servidor inteiro.
 */
export async function atualizaApiKeyEvolution(clientDb: string, apiKey: string): Promise<void> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');
  if (!apiKey) return;

  await execute(
    `UPDATE trakeamento_controle.whatsapp_accounts
        SET evolution_api_key = ?
      WHERE client_db_name = ?`,
    [apiKey, nome],
  );
}

/**
 * Guarda o último estado conhecido da instância.
 *
 * É cache: a verdade está na Evolution, e a tela consulta a API ao abrir.
 * Serve para a página renderizar já com o estado certo no servidor, sem
 * esperar a primeira consulta do navegador.
 */
export async function atualizaEstadoEvolution(
  clientDb: string,
  estado: string,
  numero: string | null,
): Promise<void> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  await execute(
    `UPDATE trakeamento_controle.whatsapp_accounts
        SET evolution_state = ?,
            evolution_number = COALESCE(?, evolution_number)
      WHERE client_db_name = ?`,
    [estado, numero, nome],
  );
}

/**
 * Apaga a conexão da Evolution do catálogo e devolve o cliente para a
 * Cloud API. Não toca nas mensagens já recebidas.
 */
export async function removeConexaoEvolution(clientDb: string): Promise<void> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  await execute(
    `UPDATE trakeamento_controle.whatsapp_accounts
        SET provider = 'cloud',
            evolution_base_url = NULL,
            evolution_api_key = NULL,
            evolution_instance = NULL,
            evolution_webhook_token = NULL,
            evolution_state = NULL,
            evolution_number = NULL
      WHERE client_db_name = ?`,
    [nome],
  );
}

/**
 * Descobre de qual cliente é uma chamada de webhook.
 *
 * A rota do webhook não tem sessão — quem chama é o servidor da
 * Evolution. O que identifica o cliente é o nome da instância no corpo
 * do payload, e o que autoriza é o token comparado aqui pelo chamador.
 */
export type ContaPorInstancia = {
  client_db_name: string;
  evolution_webhook_token: string | null;
  /**
   * Credenciais para baixar a mídia da mensagem que acabou de chegar. O
   * webhook manda os metadados do arquivo, nunca o arquivo — quem o tem
   * é o servidor da Evolution, e falar com ele exige a mesma chave usada
   * pela tela de conexão.
   */
  evolution_base_url: string | null;
  evolution_api_key: string | null;
  evolution_instance: string | null;
  /**
   * Número do aparelho que atendeu o QR. Serve para o webhook reconhecer
   * a conversa do painel consigo mesmo e não transformá-la em lead.
   */
  evolution_number: string | null;
};

export async function buscaContaPorInstanciaEvolution(
  instancia: string,
): Promise<ContaPorInstancia | null> {
  const limpo = instancia.replace(/[^A-Za-z0-9_]/g, '');
  if (!limpo) return null;

  return queryOne<ContaPorInstancia>(
    `SELECT client_db_name, evolution_webhook_token,
            evolution_base_url, evolution_api_key, evolution_instance,
            evolution_number
       FROM trakeamento_controle.whatsapp_accounts
      WHERE evolution_instance = ? AND provider = 'evolution' AND status = 'ACTIVE'
      LIMIT 1`,
    [limpo],
  );
}
