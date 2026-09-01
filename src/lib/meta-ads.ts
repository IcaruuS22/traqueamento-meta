import 'server-only';
import { buscaCredenciaisCliente } from '@/lib/db/cliente';

/**
 * Escrita no Gerenciador de Anúncios: liga e desliga campanha, conjunto
 * ou anúncio pela Marketing API.
 *
 * Fica separado de `meta-capi.ts` de propósito. Aquele módulo fala com a
 * Conversions API (envio de evento, dataset, hash de dado pessoal); este
 * fala com a Marketing API (entidade de anúncio, conta de anúncio). São
 * duas APIs diferentes com escopos de token diferentes — um token de
 * pixel que envia evento sem problema pode não ter `ads_management`, e
 * misturar as duas no mesmo arquivo esconde essa distinção de quem for
 * ler depois.
 *
 * O `meta_access_token` nunca sai daqui: entra no CORPO da requisição, e
 * não na query string como na CAPI, porque a URL aparece em log de proxy
 * e em relatório de erro, e o corpo de um POST não.
 */

export const VERSAO_GRAPH_ADS = 'v25.0';

const TIMEOUT_MS = 15_000;

/**
 * Os únicos status que o painel escreve.
 *
 * `ARCHIVED` e `DELETED` ficam de fora porque não têm volta pelo mesmo
 * caminho: a Meta recusa `ARCHIVED → ACTIVE` num POST simples de status,
 * e um botão que desarquiva pela metade é pior do que não ter botão.
 */
export type StatusEditavel = 'ACTIVE' | 'PAUSED';

export type ResultadoStatus = { ok: true } | { ok: false; erro: string };

/**
 * Muda o status de uma entidade de anúncio na Meta.
 *
 * A Graph API trata campanha, conjunto e anúncio pelo mesmo endpoint:
 * `POST /{id}` com o campo `status`. O nível não entra na chamada — o id
 * já diz à Meta o que ele é. Por isso esta função não recebe nível; quem
 * chama usa o nível só para saber qual tabela local atualizar depois.
 */
export async function alteraStatusEntidade(
  clientDb: string,
  entidadeId: string,
  status: StatusEditavel,
): Promise<ResultadoStatus> {
  const credenciais = await buscaCredenciaisCliente(clientDb);
  if (!credenciais?.meta_access_token) {
    return { ok: false, erro: 'Este cliente não tem token da Meta cadastrado.' };
  }

  const corpo = new URLSearchParams({
    status,
    access_token: credenciais.meta_access_token,
  });

  try {
    const r = await fetch(`https://graph.facebook.com/${VERSAO_GRAPH_ADS}/${entidadeId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const resposta = (await r.json().catch(() => ({}))) as {
      success?: boolean;
      error?: { message?: string; error_user_msg?: string; code?: number };
    };

    if (!r.ok || resposta.error) {
      return { ok: false, erro: mensagemDeErro(resposta.error, r.status) };
    }
    return { ok: true };
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : 'falha de rede';
    return { ok: false, erro: `Não foi possível falar com a Meta: ${detalhe}` };
  }
}

/**
 * A Meta manda duas mensagens: `error_user_msg`, escrita para o anunciante
 * ler, e `message`, escrita para quem programou. A primeira só vem em
 * parte dos erros, então a segunda é o fallback.
 *
 * O código 200 (permissão) e o 190 (token) são os dois que mais aparecem
 * aqui e os dois que a mensagem crua da Meta explica mal — quem lê o
 * painel precisa saber que o problema é o token do cliente, não o clique.
 */
function mensagemDeErro(
  erro: { message?: string; error_user_msg?: string; code?: number } | undefined,
  statusHttp: number,
): string {
  if (erro?.code === 190) {
    return 'O token da Meta deste cliente expirou ou foi revogado. Atualize-o no cadastro do cliente.';
  }
  if (erro?.code === 200) {
    return 'O token da Meta deste cliente não tem permissão de gerenciar anúncios (ads_management).';
  }
  const texto = erro?.error_user_msg || erro?.message;
  return texto ? `A Meta recusou a alteração: ${texto}` : `A Meta respondeu HTTP ${statusHttp}.`;
}
