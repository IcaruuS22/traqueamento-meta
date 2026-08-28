import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { carregaEnvLocal } from './env-local';

/**
 * Cria (ou promove) a primeira conta de administrador.
 *
 * O `03_App_Auth_Usuarios.sql` de propósito NÃO cria nenhum usuário: um
 * hash de senha versionado no repositório vira senha padrão conhecida em
 * produção. Este script existe para isso, lendo a senha do ambiente:
 *
 *   SEED_ADMIN_EMAIL=voce@empresa.com SEED_ADMIN_PASSWORD=... npm run seed:admin
 *
 * Se a conta já existir, ela é promovida a `admin`/`ativo` e a senha é
 * trocada — o mesmo comando serve para recuperar o acesso do dono.
 */
carregaEnvLocal();

const CUSTO_BCRYPT = 12;
const SENHA_MIN = 10;

async function main() {
  const email = exigido('SEED_ADMIN_EMAIL').trim().toLowerCase();
  const senha = exigido('SEED_ADMIN_PASSWORD');
  const nome = process.env.SEED_ADMIN_NAME?.trim() || 'Administrador';

  if (senha.length < SENHA_MIN) {
    console.error(`SEED_ADMIN_PASSWORD precisa ter pelo menos ${SENHA_MIN} caracteres.`);
    process.exit(1);
  }

  const conexao = await mysql.createConnection({
    host: exigido('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: exigido('MYSQL_USER'),
    password: exigido('MYSQL_PASSWORD'),
    ...(process.env.MYSQL_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
  });

  const hash = await bcrypt.hash(senha, CUSTO_BCRYPT);

  const [existentes] = await conexao.query<mysql.RowDataPacket[]>(
    'SELECT id FROM trakeamento_controle.app_users WHERE email = ? LIMIT 1',
    [email],
  );

  if (existentes.length > 0) {
    await conexao.execute(
      `UPDATE trakeamento_controle.app_users
          SET password_hash = ?, name = ?, role = 'admin', status = 'ativo',
              email_verified_at = COALESCE(email_verified_at, NOW()),
              reset_token_hash = NULL, reset_token_expires_at = NULL
        WHERE email = ?`,
      [hash, nome, email],
    );
    console.log(`Conta existente atualizada: ${email} (admin, ativo, senha redefinida).`);
  } else {
    await conexao.execute(
      `INSERT INTO trakeamento_controle.app_users
         (email, password_hash, name, role, status, email_verified_at)
       VALUES (?, ?, ?, 'admin', 'ativo', NOW())`,
      [email, hash, nome],
    );
    console.log(`Administrador criado: ${email}`);
  }

  await conexao.end();
  console.log('Pronto. Entre em /login com este e-mail.');
}

function exigido(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`Variável de ambiente ausente: ${nome}.`);
    process.exit(1);
  }
  return valor;
}

main().catch((erro) => {
  console.error('Falha ao criar o administrador:', erro);
  process.exit(1);
});
