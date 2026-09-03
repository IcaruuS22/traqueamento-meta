import mysql from 'mysql2/promise';
import { carregaEnvLocal } from './env-local';

/**
 * Traz para o painel o valor das vendas que já estão fechadas no Kommo.
 *
 * O fluxo do n8n só aprendeu a consultar o preço na API do Kommo agora;
 * antes dependia de o `price` chegar no webhook, e o webhook da etapa de
 * fechamento costuma vir sem preço nenhum. O resultado é um histórico de
 * leads ganhos com `crm_value` vazio e receita zerada no painel — é isso
 * que este script conserta, lead a lead, lendo o negócio no Kommo.
 *
 * Nada é reenviado à Meta: o que ela recebeu não se corrige (o mesmo
 * `event_id` é descartado por deduplicação, e um novo contaria conversão
 * duplicada). O ajuste é só do lado de cá.
 *
 * Como rodar — simulação primeiro, que é o padrão:
 *
 *   npx tsx scripts/backfill-crm-value.ts --subdominio=minhaconta
 *   npx tsx scripts/backfill-crm-value.ts --subdominio=minhaconta --aplicar
 *
 * Opções:
 *   --subdominio=<sub>  obrigatório: o `sub` de https://<sub>.kommo.com.
 *                       Vale por conta do Kommo; com mais de uma conta,
 *                       rode uma vez por cliente com `--cliente`.
 *   --cliente=<banco>   limita a um `client_db_name`. Sem isso, roda em
 *                       todos os clientes ativos do catálogo.
 *   --aplicar           grava. Sem ele o script só mostra o que faria.
 */
carregaEnvLocal();

/** Teto de ids por chamada; a API do Kommo aceita até 250 por página. */
const POR_PAGINA = 200;

/** Rótulos de campo personalizado usados quando o cliente não preenche "Venda". */
const NOMES_DE_VALOR = ['venda', 'valor', 'valor do contrato', 'valor da venda', 'ticket'];

type Conta = {
  client_db_name: string;
  account_name: string;
  kommo_access_token: string | null;
  /** Campo personalizado do Kommo com o valor. NULL = rótulos conhecidos. */
  crm_value_field: string | null;
};

type LeadLocal = { id: number; crm_lead_id: string; crm_value: number | null };

async function main() {
  const args = leArgumentos();
  const subdominio = args.get('subdominio');
  if (!subdominio) {
    console.error('Falta --subdominio=<sub> (o "sub" de https://<sub>.kommo.com).');
    process.exit(1);
  }
  const aplicar = args.has('aplicar');
  const somenteCliente = args.get('cliente');

  const conexao = await mysql.createConnection({
    host: exigido('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: exigido('MYSQL_USER'),
    password: exigido('MYSQL_PASSWORD'),
    ...(process.env.MYSQL_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
  });

  const contas = await leContas(conexao);

  const alvos = contas.filter(
    (c) => !somenteCliente || c.client_db_name === somenteCliente,
  );
  if (alvos.length === 0) {
    console.error(
      somenteCliente
        ? `Nenhum cliente ativo com client_db_name = ${somenteCliente}.`
        : 'Nenhum cliente ativo no catálogo.',
    );
    process.exit(1);
  }

  console.log(
    aplicar ? 'Modo: APLICANDO alterações.' : 'Modo: simulação (use --aplicar para gravar).',
  );

  for (const conta of alvos) {
    console.log(`\n== ${conta.account_name} (${conta.client_db_name})`);
    if (!conta.kommo_access_token) {
      console.log('  sem kommo_access_token no catálogo, pulando.');
      continue;
    }
    await processaCliente(conexao, conta, subdominio, aplicar);
  }

  await conexao.end();
}

async function processaCliente(
  conexao: mysql.Connection,
  conta: Conta,
  subdominio: string,
  aplicar: boolean,
): Promise<void> {
  const banco = escapaIdent(conta.client_db_name);

  // Só interessam os leads que o CRM já considera convertidos: são eles
  // que entram na receita do painel, e são eles que costumam ter valor
  // preenchido no Kommo.
  const [linhas] = await conexao.query<mysql.RowDataPacket[]>(
    `SELECT c.id, c.crm_lead_id, c.crm_value
       FROM ${banco}.customers c
       JOIN ${banco}.crm_meta_event_map em
         ON em.status_id = c.current_stage AND em.is_conversion = 1
      WHERE c.crm_lead_id IS NOT NULL AND c.crm_lead_id <> ''
      ORDER BY c.id`,
  );
  const leads = linhas as LeadLocal[];
  console.log(`  leads convertidos com id do Kommo: ${leads.length}`);
  if (leads.length === 0) return;

  const precos = await buscaPrecos(
    subdominio,
    conta.kommo_access_token as string,
    leads.map((l) => l.crm_lead_id),
    conta.crm_value_field,
  );

  let atualizados = 0;
  let semValor = 0;
  let jaCertos = 0;

  for (const lead of leads) {
    const preco = precos.get(String(lead.crm_lead_id));
    if (!preco) {
      semValor += 1;
      continue;
    }
    if (Number(lead.crm_value) === preco) {
      jaCertos += 1;
      continue;
    }
    atualizados += 1;
    console.log(
      `  lead ${lead.id} (Kommo ${lead.crm_lead_id}): ${lead.crm_value ?? 'sem valor'} -> ${preco}`,
    );
    if (aplicar) await gravaValor(conexao, banco, lead.id, preco);
  }

  console.log(
    `  resumo: ${atualizados} atualizados, ${jaCertos} já corretos, ${semValor} sem valor no Kommo.`,
  );
}

/**
 * Grava o preço no lead e no evento que o painel conta como receita.
 *
 * A receita do painel soma `meta_capi_events.value` dos eventos enviados
 * dos leads convertidos — todos eles, não só o de conversão. Por isso o
 * valor vai para o evento enviado mais recente e os outros do mesmo lead
 * ficam zerados: um lead que fechou por 11.210 tem que somar 11.210 na
 * receita, não 11.210 vezes o número de etapas por que ele passou.
 */
async function gravaValor(
  conexao: mysql.Connection,
  banco: string,
  customerId: number,
  preco: number,
): Promise<void> {
  await conexao.query(`UPDATE ${banco}.customers SET crm_value = ? WHERE id = ?`, [
    preco,
    customerId,
  ]);

  const [eventos] = await conexao.query<mysql.RowDataPacket[]>(
    `SELECT id FROM ${banco}.meta_capi_events
      WHERE customer_id = ? AND status = 'SENT'
      ORDER BY id DESC LIMIT 1`,
    [customerId],
  );
  const alvo = eventos[0]?.id as number | undefined;
  if (!alvo) return;

  await conexao.query(
    `UPDATE ${banco}.meta_capi_events
        SET value = ?, currency = COALESCE(NULLIF(currency, ''), 'BRL')
      WHERE id = ?`,
    [preco, alvo],
  );
  await conexao.query(
    `UPDATE ${banco}.meta_capi_events
        SET value = 0
      WHERE customer_id = ? AND status = 'SENT' AND id <> ? AND value > 0`,
    [customerId, alvo],
  );
}

/**
 * Preço de cada negócio, pela API do Kommo.
 *
 * Vai em páginas de ids em vez de um GET por lead: são centenas de leads
 * por cliente, e a API do Kommo limita as chamadas por segundo.
 */
async function buscaPrecos(
  subdominio: string,
  token: string,
  ids: string[],
  campoConfigurado: string | null,
): Promise<Map<string, number>> {
  const precos = new Map<string, number>();

  for (let i = 0; i < ids.length; i += POR_PAGINA) {
    const pagina = ids.slice(i, i + POR_PAGINA);
    const params = new URLSearchParams({ limit: String(POR_PAGINA) });
    for (const id of pagina) params.append('filter[id][]', id);

    const url = `https://${subdominio}.kommo.com/api/v4/leads?${params.toString()}`;
    const resposta = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    // 204 é a resposta do Kommo para "a busca não achou nada", não é erro.
    if (resposta.status === 204) continue;
    if (!resposta.ok) {
      throw new Error(
        `Kommo respondeu ${resposta.status}. ` +
          (resposta.status === 401
            ? 'Token inválido ou vencido: refaça o kommo_access_token do cliente.'
            : 'Confira o subdomínio e tente de novo.'),
      );
    }

    const corpo = (await resposta.json()) as {
      _embedded?: { leads?: Record<string, unknown>[] };
    };
    for (const negocio of corpo._embedded?.leads ?? []) {
      const preco = precoDoNegocio(negocio, campoConfigurado);
      if (preco > 0) precos.set(String(negocio.id), preco);
    }
  }

  return precos;
}

/**
 * Preço do negócio: o campo nativo "Venda" e, na falta dele, o personalizado.
 *
 * `campoConfigurado` é o `crm_value_field` do cliente — o id numérico do
 * campo ou o rótulo exato. Sem ele valem os rótulos conhecidos. A
 * comparação é exata: por semelhança, um campo como "Valor de conta"
 * ("Acima de R$ 1.000,00") viraria um valor de venda inventado.
 */
export function precoDoNegocio(
  negocio: Record<string, unknown>,
  campoConfigurado: string | null = null,
): number {
  const nativo = paraNumero(negocio.price);
  if (nativo > 0) return nativo;

  const campos = negocio.custom_fields_values;
  if (!Array.isArray(campos)) return 0;
  const alvo = (campoConfigurado ?? '').trim().toLowerCase();
  for (const campo of campos as {
    field_id?: unknown;
    field_name?: string;
    values?: { value?: unknown }[];
  }[]) {
    const nome = String(campo?.field_name ?? '')
      .trim()
      .toLowerCase();
    const id = String(campo?.field_id ?? '')
      .trim()
      .toLowerCase();
    const bate = alvo ? id === alvo || nome === alvo : NOMES_DE_VALOR.includes(nome);
    if (!bate) continue;
    const achado = paraNumero(campo?.values?.[0]?.value);
    if (achado > 0) return achado;
  }
  return 0;
}

/**
 * Contas ativas do catálogo.
 *
 * `crm_value_field` só existe depois da migração; onde ela não rodou, a
 * consulta cai para a versão sem a coluna em vez de o script morrer.
 */
async function leContas(conexao: mysql.Connection): Promise<Conta[]> {
  const base = `FROM trakeamento_controle.ad_accounts
      WHERE client_db_name IS NOT NULL AND client_db_name <> ''
        AND status = 'ACTIVE'
      ORDER BY account_name`;
  try {
    const [linhas] = await conexao.query<mysql.RowDataPacket[]>(
      `SELECT client_db_name, account_name, kommo_access_token, crm_value_field ${base}`,
    );
    return linhas as Conta[];
  } catch {
    const [linhas] = await conexao.query<mysql.RowDataPacket[]>(
      `SELECT client_db_name, account_name, kommo_access_token ${base}`,
    );
    return (linhas as Omit<Conta, 'crm_value_field'>[]).map((c) => ({
      ...c,
      crm_value_field: null,
    }));
  }
}

/** Número do Kommo: aceita "11210", "11.210,00" e "R$ 11.210". */
export function paraNumero(bruto: unknown): number {
  const texto = String(bruto ?? '').replace(/[^0-9,.-]/g, '');
  if (!texto) return 0;
  // Com vírgula, o ponto é separador de milhar. Sem vírgula ele costuma
  // ser decimal ("2500.50"), exceto quando separa grupos de três dígitos
  // — "11.210" é onze mil, não onze reais e vinte e um centavos.
  const limpo = texto.includes(',')
    ? texto.split('.').join('').replace(',', '.')
    : /^-?\d{1,3}(\.\d{3})+$/.test(texto)
      ? texto.split('.').join('')
      : texto;
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function leArgumentos(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith('--')) continue;
    const [chave, valor = ''] = arg.slice(2).split('=');
    mapa.set(chave, valor);
  }
  return mapa;
}

/** Nome de banco vindo do catálogo, pronto para entrar no SQL. */
function escapaIdent(nome: string): string {
  return '`' + nome.replace(/`/g, '') + '`';
}

function exigido(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`Variável de ambiente ausente: ${nome}. Confira o .env.local.`);
    process.exit(1);
  }
  return valor;
}

// Os testes importam `precoDoNegocio` e `paraNumero`; só a execução
// direta pelo terminal abre conexão com o banco.
if (process.argv[1]?.includes('backfill-crm-value')) {
  main().catch((erro) => {
    console.error('Falha no backfill:', erro);
    process.exit(1);
  });
}
