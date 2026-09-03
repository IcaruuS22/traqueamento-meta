import 'server-only';
import { buscaCredenciaisCliente, buscaSubdominioKommo } from '@/lib/db/cliente';

/**
 * Leitura de um negócio no Kommo.
 *
 * Existe para o botão "Adicionar lead": sabendo o id do negócio, o painel
 * pergunta ao CRM em que etapa ele está e por quanto foi fechado, em vez
 * de a pessoa digitar um `status_id` à mão — foi digitando à mão que um
 * lead foi parar numa coluna que não existia.
 *
 * Só GET. Nenhuma escrita no Kommo sai do painel, pela mesma razão das
 * automações de perdidos e ganhos: o CRM é do cliente e a fonte da
 * verdade do funil é ele.
 *
 * O Kommo responde `application/hal+json`. `fetch` não liga para o
 * `Content-Type` na hora de chamar `.json()`, então aqui isso não é
 * problema — foi no n8n que essa mesma resposta chegou como texto cru e
 * fez uma automação inteira não achar nada.
 */

const TIMEOUT_MS = 15_000;

export type NegocioKommo = {
  id: number;
  /** `status_id` cru, que é o que `customers.current_stage` guarda. */
  status_id: string;
  pipeline_id: string;
  /** `price` do Kommo. `null` quando é zero ou ausente. */
  price: number | null;
  nome: string | null;
};

export type ResultadoNegocio =
  | { ok: true; negocio: NegocioKommo }
  | { ok: false; erro: string; semConfiguracao?: boolean };

type RespostaKommo = {
  id?: number;
  name?: string;
  price?: number;
  status_id?: number;
  pipeline_id?: number;
};

/**
 * Busca o negócio pelo id.
 *
 * `semConfiguracao` distingue "o cliente não tem Kommo ligado no painel"
 * de "o Kommo recusou": no primeiro caso quem chama segue em frente sem
 * etapa, no segundo o certo é parar e mostrar o erro.
 */
export async function buscaNegocioNoKommo(
  clientDb: string,
  leadId: string,
): Promise<ResultadoNegocio> {
  const [credenciais, subdominio] = await Promise.all([
    buscaCredenciaisCliente(clientDb),
    buscaSubdominioKommo(clientDb),
  ]);

  if (!credenciais?.kommo_access_token) {
    return { ok: false, erro: 'Este cliente não tem token do Kommo cadastrado.', semConfiguracao: true };
  }
  if (!subdominio) {
    return {
      ok: false,
      erro: 'Este cliente não tem o subdomínio do Kommo cadastrado.',
      semConfiguracao: true,
    };
  }

  const url = `https://${subdominio}.kommo.com/api/v4/leads/${encodeURIComponent(leadId)}`;

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      headers: {
        authorization: `Bearer ${credenciais.kommo_access_token}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : 'falha de rede';
    return { ok: false, erro: `Não foi possível falar com o Kommo: ${detalhe}` };
  }

  if (resposta.status === 401 || resposta.status === 403) {
    return { ok: false, erro: 'O token do Kommo deste cliente expirou ou não tem permissão.' };
  }
  if (resposta.status === 404) {
    return { ok: false, erro: 'O Kommo não encontrou esse negócio. Confira o ID do lead.' };
  }
  if (!resposta.ok) {
    return { ok: false, erro: `O Kommo respondeu HTTP ${resposta.status}.` };
  }

  const corpo = (await resposta.json().catch(() => null)) as RespostaKommo | null;
  if (!corpo || corpo.status_id === undefined) {
    return { ok: false, erro: 'O Kommo respondeu num formato que o painel não entendeu.' };
  }

  const preco = Number(corpo.price);

  return {
    ok: true,
    negocio: {
      id: Number(corpo.id ?? leadId),
      status_id: String(corpo.status_id),
      pipeline_id: String(corpo.pipeline_id ?? ''),
      price: Number.isFinite(preco) && preco > 0 ? preco : null,
      nome: (corpo.name ?? '').trim() || null,
    },
  };
}
