/**
 * Regras de nome de banco e divisão do template SQL.
 *
 * Módulo puro, sem `server-only` e sem acesso a banco, por dois motivos:
 * é o que permite testar estas regras com `node --test` (que não resolve
 * `server-only`), e nada aqui toca credencial. Quem executa SQL de fato
 * é `lib/db/provisiona.ts`.
 */

const RE_INVALIDO = /[^A-Za-z0-9_]/g;
const MARCADOR_NOME = /\{\{DB_NAME\}\}/g;

/**
 * Nome de banco é identificador SQL, e identificador não aceita `?`:
 * ele entra por interpolação. Esta função é a barreira — tudo que não
 * for [A-Za-z0-9_] some.
 */
export function sanitizaNomeBanco(nome: string): string {
  return String(nome ?? '').replace(RE_INVALIDO, '');
}

/**
 * Monta o nome do banco a partir do nome do cliente.
 *
 * Mesmo algoritmo do workflow antigo, propositalmente: mudar a regra
 * geraria nomes num formato para clientes novos e noutro para os já
 * existentes, e o nome do banco é a chave que liga catálogo, workflows e
 * app.
 */
export function geraNomeBanco(accountName: string, crmAccountId?: string | null): string {
  const slug = slugify(accountName).slice(0, 40) || 'cliente';

  let sufixo = String(crmAccountId ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .slice(-10);
  if (!sufixo) sufixo = Date.now().toString().slice(-10);

  const nome = `cliente_${slug}_${sufixo}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 64);

  // Banco cujo nome começa por dígito exige crase em todo uso; o prefixo
  // evita esse caso de borda.
  return /^[a-z_]/.test(nome) ? nome : `c_${nome}`;
}

function slugify(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Quebra o template em comandos executáveis, já com o nome do banco no
 * lugar do marcador.
 *
 * O driver roda um comando por chamada (`multipleStatements` fica
 * desligado de propósito — ligá-lo é o que transforma uma injeção de SQL
 * em execução de comandos arbitrários). Por isso o arquivo precisa ser
 * dividido aqui.
 *
 * A divisão é ingênua por escolha: corta o comentário de linha `--` e
 * separa em `;`. Isso só é seguro porque o template é um arquivo do
 * próprio repositório, sem `;` nem `--` dentro de literais — não é um
 * parser de SQL de uso geral e não deve ser usado com SQL de terceiros.
 */
export function separaStatements(sqlBruto: string, clientDb: string): string[] {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco inválido');

  return sqlBruto
    .replace(MARCADOR_NOME, nome)
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((comando) => comando.trim())
    .filter(Boolean);
}
