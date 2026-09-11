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
 * Leitura só com GET: nenhuma alteração de negócio existente sai do
 * painel, pela mesma razão das automações de perdidos e ganhos — o CRM
 * é do cliente e a fonte da verdade do funil é ele.
 *
 * A única escrita é `criaLeadNoKommo`, e ela só CRIA: é o lead que
 * preencheu um formulário numa página de vendas entrando no funil, o
 * mesmo papel que o formulário instantâneo da Meta cumpre sozinho. Dali
 * em diante o negócio é do Kommo, e as mudanças de etapa voltam pelo
 * webhook de sempre, no n8n.
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

export type LeadNovoKommo = {
  nome: string;
  telefone: string | null;
  email: string | null;
  primeiroNome: string | null;
  sobrenome: string | null;
  pipelineId: string | null;
  statusId: string | null;
  tags: string[];
  utm: Partial<Record<'source' | 'medium' | 'campaign' | 'content' | 'term', string | null>>;
  fbclid: string | null;
};

export type ResultadoCriacao =
  | { ok: true; lead_id: string; contact_id: string | null }
  | { ok: false; erro: string; semConfiguracao?: boolean };

/**
 * Cria o negócio e o contato de uma vez (`/api/v4/leads/complex`).
 *
 * As UTMs vão nos campos de rastreio padrão do Kommo (`UTM_SOURCE`...).
 * Conta que apagou algum deles responde 400 para o corpo inteiro; nesse
 * caso a criação é refeita sem os campos de rastreio — o lead entrar no
 * funil importa mais que a UTM aparecer no card, e a origem continua
 * guardada em `customers` de qualquer jeito.
 *
 * Funil e etapa vazios deixam o Kommo escolher: funil principal, etapa
 * inicial.
 */
export async function criaLeadNoKommo(
  clientDb: string,
  lead: LeadNovoKommo,
): Promise<ResultadoCriacao> {
  const [credenciais, subdominio] = await Promise.all([
    buscaCredenciaisCliente(clientDb),
    buscaSubdominioKommo(clientDb),
  ]);
  if (!credenciais?.kommo_access_token) {
    return { ok: false, erro: 'Cliente sem token do Kommo cadastrado.', semConfiguracao: true };
  }
  if (!subdominio) {
    return { ok: false, erro: 'Cliente sem subdomínio do Kommo cadastrado.', semConfiguracao: true };
  }

  const camposContato: Record<string, unknown>[] = [];
  if (lead.telefone) {
    camposContato.push({ field_code: 'PHONE', values: [{ value: `+${lead.telefone}`, enum_code: 'WORK' }] });
  }
  if (lead.email) {
    camposContato.push({ field_code: 'EMAIL', values: [{ value: lead.email, enum_code: 'WORK' }] });
  }

  const contato: Record<string, unknown> = { name: lead.nome };
  if (lead.primeiroNome) contato.first_name = lead.primeiroNome;
  if (lead.sobrenome) contato.last_name = lead.sobrenome;
  if (camposContato.length) contato.custom_fields_values = camposContato;

  const rastreio: Record<string, unknown>[] = [];
  const addRastreio = (codigo: string, valor: string | null | undefined) => {
    if (valor) rastreio.push({ field_code: codigo, values: [{ value: valor.slice(0, 250) }] });
  };
  addRastreio('UTM_SOURCE', lead.utm.source);
  addRastreio('UTM_MEDIUM', lead.utm.medium);
  addRastreio('UTM_CAMPAIGN', lead.utm.campaign);
  addRastreio('UTM_CONTENT', lead.utm.content);
  addRastreio('UTM_TERM', lead.utm.term);
  addRastreio('FBCLID', lead.fbclid);

  const monta = (comRastreio: boolean) => {
    const negocio: Record<string, unknown> = {
      name: lead.nome,
      _embedded: {
        contacts: [contato],
        ...(lead.tags.length ? { tags: lead.tags.map((name) => ({ name })) } : {}),
      },
    };
    if (lead.pipelineId) negocio.pipeline_id = Number(lead.pipelineId);
    if (lead.statusId) negocio.status_id = Number(lead.statusId);
    if (comRastreio && rastreio.length) negocio.custom_fields_values = rastreio;
    return [negocio];
  };

  const url = `https://${subdominio}.kommo.com/api/v4/leads/complex`;
  const envia = async (comRastreio: boolean): Promise<Response | string> => {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credenciais.kommo_access_token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(monta(comRastreio)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return e instanceof Error ? e.message : 'falha de rede';
    }
  };

  let resposta = await envia(true);
  if (typeof resposta !== 'string' && resposta.status === 400 && rastreio.length) {
    resposta = await envia(false);
  }
  if (typeof resposta === 'string') {
    return { ok: false, erro: `Não foi possível falar com o Kommo: ${resposta}` };
  }
  if (resposta.status === 401 || resposta.status === 403) {
    return { ok: false, erro: 'O token do Kommo deste cliente expirou ou não tem permissão.' };
  }
  if (!resposta.ok) {
    return { ok: false, erro: `O Kommo respondeu HTTP ${resposta.status} ao criar o lead.` };
  }

  const corpo = (await resposta.json().catch(() => null)) as
    | { id?: number; contact_id?: number | null }[]
    | null;
  const criado = Array.isArray(corpo) ? corpo[0] : null;
  if (!criado?.id) {
    return { ok: false, erro: 'O Kommo respondeu num formato que o painel não entendeu.' };
  }
  return {
    ok: true,
    lead_id: String(criado.id),
    contact_id: criado.contact_id ? String(criado.contact_id) : null,
  };
}
