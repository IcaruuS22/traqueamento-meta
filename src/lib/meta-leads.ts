import 'server-only';
import { buscaCredenciaisCliente } from '@/lib/db/cliente';
import { montaLeadDaMeta, type LeadDaMeta, type RespostaLeadgen } from '@/lib/lead-formulario';

/**
 * Leitura de um lead de Formulário Instantâneo na Graph API.
 *
 * Serve ao botão "Adicionar lead" do CRM de Formulários: o lead existe na
 * Meta e no Kommo, mas não em `customers` — porque chegou antes das
 * automações, ou porque o webhook falhou naquele dia. Em vez de digitar
 * nome, telefone e IDs de campanha à mão, o painel busca tudo pelo
 * `leadgen_id`.
 *
 * Só leitura. Nada aqui escreve na Meta.
 *
 * Fica separado de `meta-ads.ts` porque aquele módulo escreve status de
 * entidade pela Marketing API; este lê dado de lead. O token é o mesmo,
 * mas a permissão não: ler lead exige `leads_retrieval`, e um token que
 * liga e desliga campanha pode não ter isso.
 */

export const VERSAO_GRAPH_LEADS = 'v25.0';

const TIMEOUT_MS = 15_000;

export type ResultadoLead = { ok: true; lead: LeadDaMeta } | { ok: false; erro: string };

type ErroGraph = { message?: string; error_user_msg?: string; code?: number };

function mensagemDeErro(erro: ErroGraph | undefined, statusHttp: number): string {
  if (erro?.code === 190) {
    return 'O token da Meta deste cliente expirou ou foi revogado. Atualize-o no cadastro do cliente.';
  }
  if (erro?.code === 200 || erro?.code === 10) {
    return 'O token da Meta deste cliente não tem permissão de ler leads (leads_retrieval).';
  }
  if (erro?.code === 100) {
    return 'A Meta não encontrou esse leadgen_id. Confira se o ID está certo e é deste cliente.';
  }
  const texto = erro?.error_user_msg || erro?.message;
  return texto ? `A Meta recusou a consulta: ${texto}` : `A Meta respondeu HTTP ${statusHttp}.`;
}

/**
 * O token vai no cabeçalho, não na query string: a URL aparece em log de
 * proxy e em relatório de erro; o cabeçalho, não. Mesmo cuidado que
 * `meta-ads.ts` tem ao mandar o token no corpo do POST.
 */
async function pegaDaGraph<T>(
  caminho: string,
  campos: string,
  token: string,
): Promise<{ ok: true; dados: T } | { ok: false; erro: string }> {
  const base = `https://graph.facebook.com/${VERSAO_GRAPH_LEADS}/${encodeURIComponent(caminho)}`;
  const url = `${base}?fields=${encodeURIComponent(campos)}`;
  try {
    const r = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const corpo = (await r.json().catch(() => ({}))) as { error?: ErroGraph } & T;
    if (!r.ok || corpo.error) return { ok: false, erro: mensagemDeErro(corpo.error, r.status) };
    return { ok: true, dados: corpo };
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : 'falha de rede';
    return { ok: false, erro: `Não foi possível falar com a Meta: ${detalhe}` };
  }
}

/**
 * Busca o lead e, em seguida, o anúncio que o gerou.
 *
 * São duas chamadas porque o objeto do lead traz `ad_id` mas não os
 * nomes, e porque os campos de campanha que ele traz apontam para o
 * conjunto (ver `lead-formulario.ts`). Perguntar ao anúncio
 * (`adset{id,name},campaign{id,name}`) elimina a ambiguidade.
 *
 * Falha na segunda chamada não derruba a primeira: o lead entra com o
 * que já se sabe e os nomes ficam vazios. Lead no painel sem nome de
 * campanha é melhor do que lead nenhum.
 */
export async function buscaLeadNaMeta(
  clientDb: string,
  leadgenId: string,
): Promise<ResultadoLead> {
  const credenciais = await buscaCredenciaisCliente(clientDb);
  if (!credenciais?.meta_access_token) {
    return { ok: false, erro: 'Este cliente não tem token da Meta cadastrado.' };
  }
  const token = credenciais.meta_access_token;

  const bruto = await pegaDaGraph<RespostaLeadgen>(
    leadgenId,
    'id,created_time,ad_id,form_id,field_data',
    token,
  );
  if (!bruto.ok) return bruto;

  const lead = montaLeadDaMeta(leadgenId, bruto.dados);

  if (lead.meta_ad_id) {
    const anuncio = await pegaDaGraph<{
      name?: string;
      adset?: { id?: string; name?: string };
      campaign?: { id?: string; name?: string };
    }>(lead.meta_ad_id, 'name,adset{id,name},campaign{id,name}', token);

    if (anuncio.ok) {
      lead.meta_ad_name = anuncio.dados.name ?? null;
      lead.meta_adset_id = anuncio.dados.adset?.id ?? null;
      lead.meta_adset_name = anuncio.dados.adset?.name ?? null;
      lead.meta_campaign_id = anuncio.dados.campaign?.id ?? null;
      lead.meta_campaign_name = anuncio.dados.campaign?.name ?? null;
    }
  }

  return { ok: true, lead };
}
