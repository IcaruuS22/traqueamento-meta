import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Carrega `.env.local` (e depois `.env`) para os scripts de linha de
 * comando.
 *
 * Os scripts não passam pelo Next, então não herdam o carregamento
 * automático de variáveis dele. Um parser de 20 linhas evita adicionar
 * `dotenv` como dependência só para dois scripts.
 */
export function carregaEnvLocal(): void {
  for (const arquivo of ['.env.local', '.env']) {
    const caminho = resolve(process.cwd(), arquivo);
    if (!existsSync(caminho)) continue;

    for (const linha of readFileSync(caminho, 'utf8').split(/\r?\n/)) {
      const texto = linha.trim();
      if (!texto || texto.startsWith('#')) continue;

      const separador = texto.indexOf('=');
      if (separador < 0) continue;

      const chave = texto.slice(0, separador).trim();
      let valor = texto.slice(separador + 1).trim();
      if (
        (valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))
      ) {
        valor = valor.slice(1, -1);
      }
      // O primeiro arquivo vence: `.env.local` sobrepõe `.env`.
      if (process.env[chave] === undefined) process.env[chave] = valor;
    }
  }
}
