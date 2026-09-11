import mysql from 'mysql2/promise';
import { carregaEnvLocal } from './env-local';

/**
 * Inventário do que cada migração já deixou no banco — e do que falta.
 *
 * Só lê `information_schema`: nenhuma linha é alterada, nenhum DDL é
 * executado. É seguro rodar em produção a qualquer hora.
 *
 *   npm run db:analise
 *
 * Confere o banco central e, depois, cada banco de cliente listado em
 * `ad_accounts`. No fim imprime, em ordem, os arquivos de migração que
 * ainda precisam ser executados e onde.
 */
carregaEnvLocal();

const CENTRAL = 'trakeamento_controle';

type Exigencia =
  | { tipo: 'tabela'; tabela: string }
  | { tipo: 'coluna'; tabela: string; coluna: string }
  | { tipo: 'indice'; tabela: string; indice: string };

type Migracao = { arquivo: string; descricao: string; exige: Exigencia[] };

const MIGRACOES_CENTRAL: Migracao[] = [
  {
    arquivo: '03_App_Auth_Usuarios.sql',
    descricao: 'usuários, convites e auditoria do app',
    exige: [
      { tipo: 'tabela', tabela: 'app_users' },
      { tipo: 'tabela', tabela: 'app_user_clients' },
      { tipo: 'tabela', tabela: 'app_invites' },
      { tipo: 'tabela', tabela: 'app_audit_log' },
    ],
  },
  {
    arquivo: 'migracao_kommo_subdominio.sql',
    descricao: 'subdomínio do Kommo por cliente',
    exige: [{ tipo: 'coluna', tabela: 'ad_accounts', coluna: 'kommo_subdomain' }],
  },
  {
    arquivo: 'migracao_crm_value_field.sql',
    descricao: 'campo de valor do negócio no CRM',
    exige: [{ tipo: 'coluna', tabela: 'ad_accounts', coluna: 'crm_value_field' }],
  },
  {
    arquivo: 'migracao_fee_mensal.sql',
    descricao: 'fee mensal do cliente',
    exige: [{ tipo: 'coluna', tabela: 'ad_accounts', coluna: 'monthly_fee' }],
  },
  {
    arquivo: 'migracao_verba_por_categoria.sql',
    descricao: 'categorias de campanha e verba por categoria',
    exige: [
      { tipo: 'tabela', tabela: 'campaign_categories' },
      { tipo: 'tabela', tabela: 'campaign_category_map' },
    ],
  },
  {
    arquivo: 'migration_painel_metric_prefs.sql',
    descricao: 'métricas escolhidas por usuário no painel',
    exige: [{ tipo: 'tabela', tabela: 'painel_metric_prefs' }],
  },
  {
    arquivo: 'migracao_paginas_central.sql',
    descricao: 'cadastro dos sites do rastreio de páginas de vendas',
    exige: [{ tipo: 'tabela', tabela: 'paginas_sites' }],
  },
];

const MIGRACOES_CLIENTE: Migracao[] = [
  {
    arquivo: 'migracao_etapa_perdido_form.sql',
    descricao: 'etapa de perdido e motivo da perda',
    exige: [
      { tipo: 'coluna', tabela: 'crm_meta_event_map', coluna: 'is_lost' },
      { tipo: 'coluna', tabela: 'customers', coluna: 'lost_reason' },
      { tipo: 'coluna', tabela: 'customers', coluna: 'lost_at' },
    ],
  },
  {
    arquivo: 'migracao_indices_desempenho.sql',
    descricao: 'índices de período (painel lento em base grande)',
    exige: [
      { tipo: 'indice', tabela: 'customers', indice: 'idx_customers_created_at' },
      { tipo: 'indice', tabela: 'customers', indice: 'idx_customers_current_stage' },
      { tipo: 'indice', tabela: 'customers', indice: 'idx_customers_created_stage' },
      { tipo: 'indice', tabela: 'meta_capi_events', indice: 'idx_meta_capi_events_status_evento' },
      { tipo: 'indice', tabela: 'meta_capi_events', indice: 'idx_meta_capi_events_created_at' },
      { tipo: 'indice', tabela: 'meta_capi_events', indice: 'idx_meta_capi_events_lead_status_data' },
      { tipo: 'indice', tabela: 'whatsapp_conversations', indice: 'idx_whatsapp_conversations_updated_at' },
      { tipo: 'indice', tabela: 'whatsapp_conversations', indice: 'idx_whatsapp_conversations_last_message_at' },
      { tipo: 'indice', tabela: 'whatsapp_messages', indice: 'idx_whatsapp_messages_lead_tempo' },
    ],
  },
  {
    arquivo: 'migracao_paginas_cliente.sql',
    descricao: 'visitantes e eventos das páginas de vendas',
    exige: [
      { tipo: 'tabela', tabela: 'paginas_visitantes' },
      { tipo: 'tabela', tabela: 'paginas_eventos' },
    ],
  },
];

type Estado = { tabelas: Set<string>; colunas: Set<string>; indices: Set<string> };

async function leEstado(con: mysql.Connection, banco: string): Promise<Estado> {
  const [tabelas] = await con.query<mysql.RowDataPacket[]>(
    'SELECT table_name n FROM information_schema.tables WHERE table_schema = ?',
    [banco],
  );
  const [colunas] = await con.query<mysql.RowDataPacket[]>(
    'SELECT table_name t, column_name c FROM information_schema.columns WHERE table_schema = ?',
    [banco],
  );
  const [indices] = await con.query<mysql.RowDataPacket[]>(
    'SELECT DISTINCT table_name t, index_name i FROM information_schema.statistics WHERE table_schema = ?',
    [banco],
  );
  return {
    tabelas: new Set(tabelas.map((r) => String(r.n))),
    colunas: new Set(colunas.map((r) => `${r.t}.${r.c}`)),
    indices: new Set(indices.map((r) => `${r.t}.${r.i}`)),
  };
}

function falta(e: Estado, x: Exigencia): boolean {
  if (x.tipo === 'tabela') return !e.tabelas.has(x.tabela);
  if (x.tipo === 'coluna') return !e.tabelas.has(x.tabela) || !e.colunas.has(`${x.tabela}.${x.coluna}`);
  return !e.tabelas.has(x.tabela) || !e.indices.has(`${x.tabela}.${x.indice}`);
}

function descreve(x: Exigencia): string {
  if (x.tipo === 'tabela') return `tabela ${x.tabela}`;
  if (x.tipo === 'coluna') return `coluna ${x.tabela}.${x.coluna}`;
  return `índice ${x.indice} em ${x.tabela}`;
}

/** Imprime o estado de um banco e devolve os arquivos ainda pendentes. */
function confere(banco: string, estado: Estado, migracoes: Migracao[]): string[] {
  const pendentes: string[] = [];
  console.log(`\n=== ${banco} ===`);
  for (const m of migracoes) {
    const faltando = m.exige.filter((x) => falta(estado, x));
    if (faltando.length === 0) {
      console.log(`  ok       ${m.arquivo}`);
      continue;
    }
    const parcial = faltando.length < m.exige.length ? ' (parcial)' : '';
    console.log(`  FALTA${parcial.padEnd(4)} ${m.arquivo} — ${m.descricao}`);
    for (const x of faltando) console.log(`           falta ${descreve(x)}`);
    pendentes.push(`${m.arquivo} em ${banco}`);
  }
  return pendentes;
}

async function main() {
  const con = await mysql.createConnection({
    host: exigido('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: exigido('MYSQL_USER'),
    password: exigido('MYSQL_PASSWORD'),
    ...(process.env.MYSQL_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
  });

  const pendentes = confere(CENTRAL, await leEstado(con, CENTRAL), MIGRACOES_CENTRAL);

  const [clientes] = await con.query<mysql.RowDataPacket[]>(
    `SELECT client_db_name b, account_name n FROM ${CENTRAL}.ad_accounts
      WHERE client_db_name IS NOT NULL AND client_db_name <> '' ORDER BY account_name`,
  );

  for (const c of clientes) {
    const banco = String(c.b);
    const estado = await leEstado(con, banco);
    if (estado.tabelas.size === 0) {
      console.log(`\n=== ${banco} ===\n  BANCO NÃO EXISTE (cadastrado como "${c.n}")`);
      pendentes.push(`banco ${banco} não existe`);
      continue;
    }
    pendentes.push(...confere(`${banco} (${c.n})`, estado, MIGRACOES_CLIENTE));

    // Volume: índice de período só importa a partir de alguns milhares.
    if (estado.tabelas.has('customers')) {
      const [linhas] = await con.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) leads, MAX(created_at) ultimo FROM \`${banco}\`.customers`,
      );
      console.log(`  ${linhas[0].leads} leads · último em ${linhas[0].ultimo ?? '—'}`);
    }
  }

  console.log('\n=== Pendente ===');
  if (pendentes.length === 0) console.log('  Nada. Todas as migrações conhecidas já foram aplicadas.');
  else for (const p of pendentes) console.log(`  - ${p}`);

  await con.end();
}

function exigido(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`Variável de ambiente ausente: ${nome}. Confira o .env.local.`);
    process.exit(1);
  }
  return valor;
}

main().catch((erro) => {
  console.error('Falha na análise:', erro);
  process.exit(1);
});
