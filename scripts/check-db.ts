import mysql from 'mysql2/promise';
import { carregaEnvLocal } from './env-local';

/**
 * Prova de vida da conexão com o MySQL do VPS.
 *
 * Rode antes de qualquer outra coisa: se este script não passa, nada do
 * app funciona, e o problema é de rede/credencial, não de código.
 *
 *   npm run db:check
 */
carregaEnvLocal();

const TABELAS_CONTROLE = ['ad_accounts', 'app_users', 'app_user_clients', 'app_invites', 'app_audit_log'];

async function main() {
  const inicio = Date.now();

  const conexao = await mysql.createConnection({
    host: exigido('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: exigido('MYSQL_USER'),
    password: exigido('MYSQL_PASSWORD'),
    ...(process.env.MYSQL_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
  });

  console.log(`Conectado em ${Date.now() - inicio} ms.`);

  const [versao] = await conexao.query<mysql.RowDataPacket[]>(
    'SELECT VERSION() AS versao, @@max_connections AS max_conexoes, @@time_zone AS fuso',
  );
  console.log(
    `MySQL ${versao[0].versao} · max_connections=${versao[0].max_conexoes} · time_zone=${versao[0].fuso}`,
  );

  const [tabelas] = await conexao.query<mysql.RowDataPacket[]>(
    `SELECT table_name AS nome FROM information_schema.tables
      WHERE table_schema = 'trakeamento_controle'`,
  );
  const existentes = new Set(tabelas.map((t) => String(t.nome)));

  console.log('\nTabelas em trakeamento_controle:');
  for (const nome of TABELAS_CONTROLE) {
    console.log(`  ${existentes.has(nome) ? 'ok  ' : 'FALTA'} ${nome}`);
  }
  const faltando = TABELAS_CONTROLE.filter((t) => !existentes.has(t));
  if (faltando.length > 0) {
    console.log(
      `\nRode "Banco de Dados/03_App_Auth_Usuarios.sql" no servidor para criar: ${faltando.join(', ')}`,
    );
  }

  const [clientes] = await conexao.query<mysql.RowDataPacket[]>(
    `SELECT client_db_name, account_name FROM trakeamento_controle.ad_accounts
      WHERE client_db_name IS NOT NULL AND client_db_name <> ''
      ORDER BY account_name`,
  );
  console.log(`\nClientes no catálogo: ${clientes.length}`);
  for (const c of clientes) console.log(`  ${c.account_name} → ${c.client_db_name}`);

  await conexao.end();
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
  console.error('Falha na verificação:', erro);
  process.exit(1);
});
