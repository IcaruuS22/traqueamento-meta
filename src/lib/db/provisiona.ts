import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '@/lib/env';
import { ehBancoProtegido, sanitizaNomeBanco, separaStatements } from '@/lib/nomes-banco';

/**
 * Criação do banco isolado de um cliente novo.
 *
 * Porte do workflow n8n "Cria Cliente - Formulário"
 * (`Cadastro de Clientes/build_workflow.js`), com uma diferença
 * importante: lá o DDL estava reescrito à mão dentro de nós de Code,
 * em paralelo ao arquivo `02_Template_Banco_Por_Cliente.sql` que servia
 * de "documentação". Duas cópias da mesma verdade divergiram — o
 * workflow criava 6 tabelas enquanto o template já descrevia 10.
 *
 * Aqui existe UMA fonte: `Banco de Dados/02_Template_Banco_Por_Cliente.sql`
 * — o mesmo arquivo que o README já indica como template do esquema —,
 * lido em tempo de execução. Adicionar tabela ou índice ao template passa
 * a valer para todo cliente novo sem tocar em código.
 */

const NOME_TEMPLATE = '02_Template_Banco_Por_Cliente.sql';
const PASTA_TEMPLATE = 'Banco de Dados';

/**
 * Onde procurar o template, em ordem.
 *
 * `process.cwd()` é o caminho certo na Vercel, onde o processo sobe na
 * raiz do projeto — mas em desenvolvimento o servidor pode ter sido
 * iniciado de outro diretório, e aí o `readFile` falharia só ali. O
 * segundo candidato parte do próprio módulo (`src/lib/db/` → raiz), que
 * vale enquanto o código não está empacotado. Quem achar primeiro vence;
 * se nenhum achar, o erro diz onde se procurou.
 */
function candidatosDoTemplate(): string[] {
  const daRaizDoModulo = path.resolve(
    fileURLToPath(import.meta.url),
    '../../../..',
    PASTA_TEMPLATE,
    NOME_TEMPLATE,
  );
  return [path.join(process.cwd(), PASTA_TEMPLATE, NOME_TEMPLATE), daRaizDoModulo];
}

async function leTemplate(): Promise<string> {
  const tentados: string[] = [];
  for (const caminho of candidatosDoTemplate()) {
    tentados.push(caminho);
    try {
      return await readFile(caminho, 'utf8');
    } catch (erro) {
      if ((erro as { code?: string }).code !== 'ENOENT') throw erro;
    }
  }
  throw new Error(`Template de banco não encontrado. Procurado em: ${tentados.join(' | ')}`);
}

/**
 * Estágios iniciais do funil de WhatsApp.
 *
 * Nascem inativos e sem `meta_event`: são só o ponto de partida da tela
 * "Estágios e eventos", onde o cliente renomeia, exclui e adiciona à
 * vontade. Sem isso a tela "Conversas" abre sem nenhum estágio para
 * escolher, o que parece defeito.
 */
const ESTAGIOS_INICIAIS: { estagio: string; conversao: boolean }[] = [
  { estagio: 'novo', conversao: false },
  { estagio: 'em_atendimento', conversao: false },
  { estagio: 'aguardando', conversao: false },
  { estagio: 'qualificado', conversao: false },
  { estagio: 'proposta', conversao: false },
  { estagio: 'ganho', conversao: true },
  { estagio: 'perdido', conversao: false },
];

/**
 * Conexão fora do pool, para os comandos que mexem no banco em si.
 *
 * O template contém `USE <banco>`: numa conexão de pool o banco
 * selecionado ficaria grudado na conexão devolvida e a próxima
 * requisição herdaria o banco de outro cliente. Esta conexão é
 * encerrada por quem a abriu, nunca reaproveitada.
 */
function conexaoDireta() {
  return mysql.createConnection({
    host: env.mysql.host,
    port: env.mysql.port,
    user: env.mysql.user,
    password: env.mysql.password,
    charset: 'utf8mb4_unicode_ci',
    multipleStatements: false,
    ...(env.mysql.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}

/**
 * Cria o banco do cliente e popula os estágios iniciais.
 *
 * Usa conexão própria, fora do pool da aplicação, porque o template
 * contém `USE <banco>`: numa conexão de pool o banco selecionado ficaria
 * grudado na conexão devolvida e a próxima requisição herdaria o banco
 * de outro cliente. Esta conexão é encerrada no fim, nunca reaproveitada.
 *
 * Roda fora de transação — DDL faz commit implícito no MySQL, então não
 * existe "desfazer" aqui. Quem chama precisa lidar com sucesso parcial;
 * é por isso que a criação do banco vem ANTES do registro no catálogo, e
 * não depois: banco criado sem linha em `ad_accounts` é inofensivo (e a
 * repetição o reaproveita), enquanto linha no catálogo apontando para um
 * banco incompleto quebraria todas as telas daquele cliente.
 */
export async function criaBancoDoCliente(clientDb: string): Promise<{ comandos: number }> {
  const template = await leTemplate();
  const comandos = separaStatements(template, clientDb);
  const nome = sanitizaNomeBanco(clientDb);

  const conexao = await conexaoDireta();

  try {
    for (const comando of comandos) {
      try {
        await conexao.query(comando);
      } catch (erro) {
        // `CREATE INDEX` não aceita `IF NOT EXISTS` no MySQL. Numa
        // segunda tentativa (a primeira falhou no meio, ou o banco já
        // existia) o índice já criado faria o processo inteiro parar,
        // então esse caso específico é ignorado. Todo o resto sobe.
        if ((erro as { code?: string }).code !== 'ER_DUP_KEYNAME') throw erro;
      }
    }

    for (const { estagio, conversao } of ESTAGIOS_INICIAIS) {
      await conexao.query(
        `INSERT IGNORE INTO \`${nome}\`.whatsapp_event_map (estagio, ativo, is_conversion)
         VALUES (?, 0, ?)`,
        [estagio, conversao ? 1 : 0],
      );
    }
  } finally {
    await conexao.end();
  }

  return { comandos: comandos.length };
}

/**
 * Apaga o banco inteiro de um cliente. NÃO TEM VOLTA.
 *
 * Usa conexão própria pelo mesmo motivo da criação: `DROP DATABASE` é
 * DDL, faz commit implícito, e a conexão não volta para o pool com
 * estado estranho. Só é chamada depois que o cliente já saiu do catálogo
 * — ver `acaoExcluirCliente`.
 *
 * `ehBancoProtegido` é a última barreira: nome de banco entra em SQL por
 * interpolação (identificador não aceita `?`), então além da sanitização
 * existe uma lista do que nunca pode ser apagado.
 */
export async function apagaBancoDoCliente(clientDb: string): Promise<void> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');
  if (ehBancoProtegido(nome)) {
    throw new Error(`Recusado: \`${nome}\` não é banco de cliente`);
  }

  const conexao = await conexaoDireta();
  try {
    await conexao.query(`DROP DATABASE IF EXISTS \`${nome}\``);
  } finally {
    await conexao.end();
  }
}
