/**
 * Tradução do lead da Meta para as colunas de `customers`.
 *
 * Puro, sem `server-only` e sem rede, pelo mesmo motivo que `lib/crm.ts`
 * é separado de `lib/db/crm.ts`: a parte que erra em silêncio é esta —
 * campo com outro nome, telefone com máscara, nome de empresa dividido
 * em dois — e é esta que precisa de teste. A ida à Graph API fica em
 * `lib/meta-leads.ts`.
 */

/** O que sai daqui já está no formato das colunas de `customers`. */
export type LeadDaMeta = {
  meta_lead_id: string;
  /** ISO do `created_time` da Meta. Vira o `created_at` do lead. */
  created_time: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  /** Só dígitos, como o resto da base. */
  phone: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  meta_ad_id: string | null;
  meta_ad_name: string | null;
  meta_adset_id: string | null;
  meta_adset_name: string | null;
  meta_campaign_id: string | null;
  meta_campaign_name: string | null;
  meta_form_id: string | null;
};

export type CampoDoFormulario = { name?: string; values?: unknown[] };

export type RespostaLeadgen = {
  id?: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data?: CampoDoFormulario[];
};

/**
 * Nomes de campo que a Meta usa nos formulários padrão.
 *
 * Campo personalizado do cliente ("qual o tipo de instalação") fica de
 * fora de propósito: `customers` não tem coluna para resposta de
 * formulário, e criar uma aqui seria decidir sozinho um assunto de
 * esquema.
 */
const CAMPOS = {
  nomeCompleto: ['full_name', 'nome_completo'],
  primeiroNome: ['first_name', 'primeiro_nome'],
  sobrenome: ['last_name', 'sobrenome'],
  email: ['email', 'e_mail'],
  telefone: ['phone_number', 'telefone'],
  cidade: ['city', 'cidade'],
  estado: ['state', 'estado'],
  cep: ['zip_code', 'post_code', 'cep'],
} as const;

function primeiroValor(campos: CampoDoFormulario[], nomes: readonly string[]): string | null {
  for (const nome of nomes) {
    const campo = campos.find((c) => (c.name ?? '').toLowerCase() === nome);
    const valor = campo?.values?.[0];
    if (typeof valor === 'string' && valor.trim() !== '') return valor.trim();
  }
  return null;
}

/**
 * Divide o nome como o restante do sistema faz: primeira palavra é o
 * primeiro nome, o resto é sobrenome. Nome de empresa fica dividido de um
 * jeito estranho, mas o hash que a Meta recebe passa a ser o mesmo dos
 * leads que entraram pela automação — e é com esses que ele precisa
 * fechar.
 */
export function separaNome(completo: string): { first: string | null; last: string | null } {
  const partes = completo.trim().split(/\s+/).filter(Boolean);
  const first = partes.shift() ?? null;
  return { first, last: partes.length ? partes.join(' ') : null };
}

/** Mesma normalização do workflow: guarda só os dígitos, sem o `+`. */
export function soDigitos(valor: string | null): string | null {
  if (!valor) return null;
  const digitos = valor.replace(/\D/g, '');
  return digitos === '' ? null : digitos;
}

/**
 * Monta o lead a partir da resposta crua do `leadgen_id`.
 *
 * Os campos de anúncio saem vazios: quem os preenche é `meta-leads.ts`,
 * numa segunda chamada ao próprio anúncio. O objeto do lead traz
 * `ad_id`, mas seus campos `campaign_id`/`campaign_name` apontam para o
 * CONJUNTO, não para a campanha — herança antiga da API, que já produziu
 * dado trocado em painel.
 */
export function montaLeadDaMeta(leadgenId: string, resposta: RespostaLeadgen): LeadDaMeta {
  const campos = Array.isArray(resposta.field_data) ? resposta.field_data : [];

  const nomeCompleto = primeiroValor(campos, CAMPOS.nomeCompleto);
  const separado = nomeCompleto ? separaNome(nomeCompleto) : null;

  return {
    meta_lead_id: resposta.id ?? leadgenId,
    created_time: resposta.created_time ?? null,
    first_name: primeiroValor(campos, CAMPOS.primeiroNome) ?? separado?.first ?? null,
    last_name: primeiroValor(campos, CAMPOS.sobrenome) ?? separado?.last ?? null,
    email: primeiroValor(campos, CAMPOS.email)?.toLowerCase() ?? null,
    phone: soDigitos(primeiroValor(campos, CAMPOS.telefone)),
    city: primeiroValor(campos, CAMPOS.cidade),
    state: primeiroValor(campos, CAMPOS.estado),
    zipcode: primeiroValor(campos, CAMPOS.cep),
    meta_ad_id: resposta.ad_id ?? null,
    meta_ad_name: null,
    meta_adset_id: null,
    meta_adset_name: null,
    meta_campaign_id: null,
    meta_campaign_name: null,
    meta_form_id: resposta.form_id ?? null,
  };
}
