import 'server-only';
import { randomBytes } from 'node:crypto';
import { execute, lacunaDeEsquema, query, queryOne } from '@/lib/db/pool';
import { sanitizaNomeBanco } from '@/lib/nomes-banco';
import { ehOpcaoRolagem } from '@/lib/paginas-rolagem';

/**
 * Cadastro dos sites rastreados (`trakeamento_controle.paginas_sites`).
 *
 * Duas chaves por site, com papéis opostos:
 *
 *  - `site_key` é PÚBLICA. Vai na tag `<script>` da página e qualquer
 *    visitante a lê no código-fonte. Sozinha ela não autoriza nada: a
 *    coleta só aceita evento vindo de um dos domínios cadastrados.
 *  - `webhook_token` é SEGREDO. Vai só na URL do webhook de compra, que
 *    fica guardada no painel da plataforma de checkout. É a única coisa
 *    que separa uma venda real de um POST forjado virando Purchase no
 *    pixel do cliente — por isso nunca sai para a tela do cliente, só
 *    para a do administrador.
 */

export type SitePagina = {
  id: number;
  client_db_name: string;
  nome: string;
  site_key: string;
  dominios: string[];
  ativo: boolean;
  /**
   * ViewContent automático ao rolar: 0 = desligado; senão, a porcentagem
   * da página que o visitante precisa ter visto (25, 50, 75 ou 90).
   */
  viewcontent_rolagem: number;
  created_at: string;
};

/** Só para o administrador e para as rotas públicas conferirem o token. */
export type SitePaginaComToken = SitePagina & { webhook_token: string };

/** O site já com o que a coleta precisa saber do cliente dono dele. */
export type SiteDaColeta = SitePaginaComToken & {
  ad_account_id: string;
  meta_pixel_dataset_id: string | null;
};

type Linha = Omit<SitePaginaComToken, 'dominios' | 'ativo' | 'viewcontent_rolagem'> & {
  dominios: string;
  ativo: number | boolean;
  viewcontent_rolagem: number | string | null;
};

const COLUNAS_BASE = `
  s.id, s.client_db_name, s.nome, s.site_key, s.webhook_token, s.dominios,
  s.ativo, s.created_at
`;

const COLUNAS = `${COLUNAS_BASE}, s.viewcontent_rolagem`;

/*
 * `viewcontent_rolagem` chegou depois da tabela
 * (`migracao_paginas_viewcontent.sql`). Até a migração rodar, as leituras
 * repetem a consulta sem a coluna e tratam o recurso como desligado: a
 * tag e a coleta não podem parar por causa de uma coluna opcional.
 */
const COLUNAS_SEM_ROLAGEM = `${COLUNAS_BASE}, 0 AS viewcontent_rolagem`;

/** O erro é a falta de `viewcontent_rolagem` (migração não rodou)? */
export function faltaColunaRolagem(erro: unknown): boolean {
  return Boolean(lacunaDeEsquema(erro)?.includes('viewcontent_rolagem'));
}

async function comFallbackRolagem<T>(consulta: (colunas: string) => Promise<T>): Promise<T> {
  try {
    return await consulta(COLUNAS);
  } catch (erro) {
    if (!faltaColunaRolagem(erro)) throw erro;
    return consulta(COLUNAS_SEM_ROLAGEM);
  }
}

function deLinha<T extends Linha>(l: T) {
  const rolagem = Number(l.viewcontent_rolagem) || 0;
  return {
    ...l,
    dominios: l.dominios ? l.dominios.split(',').filter(Boolean) : [],
    ativo: Boolean(l.ativo),
    viewcontent_rolagem: ehOpcaoRolagem(rolagem) ? rolagem : 0,
  };
}

function semToken({ webhook_token: _token, ...site }: SitePaginaComToken): SitePagina {
  void _token;
  return site;
}

/** 24 caracteres base64url. Curta o bastante para caber confortável na tag. */
export function novaChaveSite(): string {
  return randomBytes(18).toString('base64url');
}

/** 64 caracteres hexadecimais: 256 bits, fora do alcance de tentativa. */
export function novoTokenWebhook(): string {
  return randomBytes(32).toString('hex');
}

/** Formato de `site_key`. Conferido antes de ir ao banco. */
export function ehChaveSite(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{16,32}$/.test(v);
}

/** Sites de um cliente, com o token. Só para a tela do administrador. */
export async function listaSitesComToken(clientDb: string): Promise<SitePaginaComToken[]> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) return [];
  const linhas = await comFallbackRolagem((colunas) =>
    query<Linha>(
      `SELECT ${colunas}
         FROM trakeamento_controle.paginas_sites s
        WHERE s.client_db_name = ?
        ORDER BY s.nome ASC, s.id ASC`,
      [nome],
    ),
  );
  return linhas.map(deLinha);
}

/** Sites de um cliente sem o token — o que a tela do cliente pode ver. */
export async function listaSites(clientDb: string): Promise<SitePagina[]> {
  return (await listaSitesComToken(clientDb)).map(semToken);
}

/**
 * Cache curto das consultas por chave.
 *
 * A coleta recebe um evento a cada página vista em todos os sites de
 * todos os clientes, e cada um precisaria de uma ida ao banco central só
 * para descobrir de quem é a chave. Sessenta segundos seguram esse
 * volume sem deixar uma alteração no cadastro esperando muito: quem
 * desativa um site ou troca o token vê a mudança valer em até um minuto
 * (ou na hora, no mesmo processo, porque as escritas limpam o cache).
 */
const CACHE_MS = 60_000;
const CHAVE_CACHE = Symbol.for('trakeamento.paginas.sites');
const global = globalThis as unknown as {
  [CHAVE_CACHE]?: Map<string, { ate: number; site: SiteDaColeta | null }>;
};
const cache = (global[CHAVE_CACHE] ??= new Map());

function limpaCache(): void {
  cache.clear();
}

/**
 * Para quem altera dado da conta que a tag também lê (o pixel): sem
 * isto, este processo seguiria servindo o valor antigo até o cache vencer.
 */
export function limpaCacheDeSites(): void {
  limpaCache();
}

/**
 * O site dono de uma chave, com os dados do cliente. `null` se não
 * existe. Site inativo volta também — quem chama decide o que fazer.
 */
export async function buscaSitePorChave(siteKey: string): Promise<SiteDaColeta | null> {
  if (!ehChaveSite(siteKey)) return null;
  const agora = Date.now();
  const guardado = cache.get(siteKey);
  if (guardado && guardado.ate > agora) return guardado.site;

  const linha = await comFallbackRolagem((colunas) =>
    queryOne<Linha & { ad_account_id: string; meta_pixel_dataset_id: string | null }>(
      `SELECT ${colunas}, a.ad_account_id, a.meta_pixel_dataset_id
         FROM trakeamento_controle.paginas_sites s
         JOIN trakeamento_controle.ad_accounts a ON a.client_db_name = s.client_db_name
        WHERE s.site_key = ?
        LIMIT 1`,
      [siteKey],
    ),
  );
  const site = linha ? deLinha(linha) : null;

  if (cache.size > 5_000) cache.clear();
  cache.set(siteKey, { ate: agora + CACHE_MS, site });
  return site;
}

export type DadosSite = {
  nome: string;
  dominios: string[];
  ativo: boolean;
  viewcontent_rolagem: number;
};

/**
 * Escrita com a coluna nova; sem ela no banco, repete sem — mas só quando
 * o valor pedido é "desligado", que é o que a leitura já assume. Ligar o
 * recurso antes da migração sobe o erro, e a tela pede para rodá-la.
 */
async function escreveComRolagem<T>(dados: DadosSite, com: () => Promise<T>, sem: () => Promise<T>): Promise<T> {
  try {
    return await com();
  } catch (erro) {
    if (!faltaColunaRolagem(erro) || dados.viewcontent_rolagem !== 0) throw erro;
    return sem();
  }
}

/*
 * As colunas `kommo_pipeline_id`, `kommo_status_id` e `envia_kommo` ainda
 * existem na tabela, mas o rastreio de páginas não fala mais com o Kommo:
 * o site é um produto separado do CRM. As escritas zeram as três para que
 * nenhum cadastro antigo pareça ligado a um funil.
 */

export async function criaSite(clientDb: string, dados: DadosSite): Promise<number> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');
  const base = [nome, dados.nome, novaChaveSite(), novoTokenWebhook(), dados.dominios.join(','), dados.ativo];
  const { insertId } = await escreveComRolagem(
    dados,
    () =>
      execute(
        `INSERT INTO trakeamento_controle.paginas_sites
           (client_db_name, nome, site_key, webhook_token, dominios,
            kommo_pipeline_id, kommo_status_id, envia_kommo, ativo, viewcontent_rolagem)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, FALSE, ?, ?)`,
        [...base, dados.viewcontent_rolagem],
      ),
    () =>
      execute(
        `INSERT INTO trakeamento_controle.paginas_sites
           (client_db_name, nome, site_key, webhook_token, dominios,
            kommo_pipeline_id, kommo_status_id, envia_kommo, ativo)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, FALSE, ?)`,
        base,
      ),
  );
  limpaCache();
  return insertId;
}

/**
 * Atualiza um site. O `client_db_name` entra no WHERE junto do id: um
 * formulário adulterado com o id de um site de outro cliente não acha
 * linha nenhuma, em vez de editar o cadastro alheio.
 */
export async function atualizaSite(clientDb: string, id: number, dados: DadosSite): Promise<boolean> {
  const onde = [id, sanitizaNomeBanco(clientDb)];
  const { affectedRows } = await escreveComRolagem(
    dados,
    () =>
      execute(
        `UPDATE trakeamento_controle.paginas_sites
            SET nome = ?, dominios = ?, kommo_pipeline_id = NULL, kommo_status_id = NULL,
                envia_kommo = FALSE, ativo = ?, viewcontent_rolagem = ?
          WHERE id = ? AND client_db_name = ?`,
        [dados.nome, dados.dominios.join(','), dados.ativo, dados.viewcontent_rolagem, ...onde],
      ),
    () =>
      execute(
        `UPDATE trakeamento_controle.paginas_sites
            SET nome = ?, dominios = ?, kommo_pipeline_id = NULL, kommo_status_id = NULL,
                envia_kommo = FALSE, ativo = ?
          WHERE id = ? AND client_db_name = ?`,
        [dados.nome, dados.dominios.join(','), dados.ativo, ...onde],
      ),
  );
  limpaCache();
  return affectedRows > 0;
}

/**
 * Troca o token do webhook de compra. A URL antiga para de funcionar na
 * hora (ou em até um minuto em outro processo), então a URL nova precisa
 * ser recadastrada na plataforma de checkout.
 */
export async function trocaTokenSite(clientDb: string, id: number): Promise<boolean> {
  const { affectedRows } = await execute(
    `UPDATE trakeamento_controle.paginas_sites
        SET webhook_token = ?
      WHERE id = ? AND client_db_name = ?`,
    [novoTokenWebhook(), id, sanitizaNomeBanco(clientDb)],
  );
  limpaCache();
  return affectedRows > 0;
}

/**
 * Apaga o cadastro. Os eventos e visitantes já gravados no banco do
 * cliente ficam: são histórico de campanha, e o painel continua
 * mostrando o que aconteceu enquanto o site existia.
 */
export async function removeSite(clientDb: string, id: number): Promise<boolean> {
  const { affectedRows } = await execute(
    'DELETE FROM trakeamento_controle.paginas_sites WHERE id = ? AND client_db_name = ?',
    [id, sanitizaNomeBanco(clientDb)],
  );
  limpaCache();
  return affectedRows > 0;
}
