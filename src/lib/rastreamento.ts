/**
 * Vocabulário do rastreamento de origem dos leads.
 *
 * Fica fora de `src/lib/db/` de propósito: rótulos, cores e links são
 * usados também pelos componentes de cliente, e `@/lib/db/*` é
 * `server-only`. Aqui não há nenhuma consulta — só o que a mesma
 * classificação significa na tela.
 *
 * A classificação em si é feita no SQL (`@/lib/db/rastreamento`), porque
 * contar por fonte e paginar por fonte precisa acontecer no banco. Este
 * módulo guarda o significado; aquele guarda a expressão.
 */

export const FONTES = ['ctwa', 'meta_lead_ads', 'lp_utm', 'outros'] as const;
export type Fonte = (typeof FONTES)[number];

export const CONFIANCAS = ['alta', 'media', 'baixa'] as const;
export type Confianca = (typeof CONFIANCAS)[number];

export const ROTULO_FONTE: Record<Fonte, string> = {
  ctwa: 'Click to WhatsApp',
  meta_lead_ads: 'Meta Lead Ads',
  lp_utm: 'Landing Page (UTM)',
  outros: 'Outros',
};

export const DESCRICAO_FONTE: Record<Fonte, string> = {
  ctwa: 'Lead que abriu a conversa por um anúncio "Clique para o WhatsApp" — a mensagem chegou com o click-id do anúncio (ctwa_clid).',
  meta_lead_ads: 'Lead preenchido no Formulário Instantâneo dentro da própria Meta — veio com lead_id e form_id.',
  lp_utm: 'Lead que passou por uma página própria: chegou com UTMs e/ou fbclid na URL.',
  outros: 'Sem nenhum identificador de origem gravado. Entrada manual, importação ou perda de parâmetro no caminho.',
};

/** Classes do badge de fonte. Mesmos tons das etiquetas de status. */
export const CLASSE_FONTE: Record<Fonte, string> = {
  ctwa: 'bg-[var(--green-50)] text-[var(--green-700)]',
  meta_lead_ads: 'bg-[var(--brand-soft)] text-[var(--brand)]',
  lp_utm: 'bg-[var(--amber-50)] text-[var(--amber-700)]',
  outros: 'bg-[var(--bg-field-on-canvas)] text-[var(--text-secondary)]',
};

export const ROTULO_CONFIANCA: Record<Confianca, string> = {
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
};

export const DICA_CONFIANCA: Record<Confianca, string> = {
  alta: 'Há um identificador de clique (ctwa_clid, fbclid) ou o par lead_id + ad_id. A ligação com o anúncio é direta, não inferida.',
  media: 'Há campanha ou UTM, mas nenhum identificador de clique. Dá para saber de onde veio, não exatamente de qual clique.',
  baixa: 'Nenhum identificador de origem. O que aparecer aqui é inferência, não rastreio.',
};

export const CLASSE_CONFIANCA: Record<Confianca, string> = {
  alta: 'bg-[var(--green-50)] text-[var(--green-700)]',
  media: 'bg-[var(--amber-50)] text-[var(--amber-700)]',
  baixa: 'bg-[var(--red-50)] text-[var(--red-700)]',
};

export function ehFonte(valor: unknown): valor is Fonte {
  return typeof valor === 'string' && (FONTES as readonly string[]).includes(valor);
}

export function ehConfianca(valor: unknown): valor is Confianca {
  return typeof valor === 'string' && (CONFIANCAS as readonly string[]).includes(valor);
}

/**
 * Como o rastreio daquele lead foi feito, em uma frase.
 *
 * Não repete o rótulo da fonte: a fonte diz de onde o lead veio, o método
 * diz qual dado provou isso — é essa a diferença entre "veio de anúncio"
 * e "temos como provar de qual anúncio veio".
 */
export function metodoDeCaptura(sinais: {
  fonte: Fonte;
  ctwa_clid?: string | null;
  fbclid?: string | null;
  meta_lead_id?: string | null;
  ad_id?: string | null;
  utm_source?: string | null;
}): string {
  if (sinais.ctwa_clid) return 'click-id do anúncio na mensagem (ctwa_clid)';
  if (sinais.fonte === 'ctwa') return 'referência de anúncio na mensagem (ad_id), sem click-id';
  if (sinais.meta_lead_id) {
    return sinais.ad_id
      ? 'lead_id do Formulário Instantâneo + ad_id do anúncio'
      : 'lead_id do Formulário Instantâneo, sem anúncio identificado';
  }
  if (sinais.fbclid) return 'fbclid na URL de destino';
  if (sinais.utm_source) return 'parâmetros UTM na URL de destino';
  return 'sem identificador de origem';
}

/**
 * Link para o anúncio dentro do Gerenciador de Anúncios.
 *
 * A Biblioteca de Anúncios indexa por archive_id, que não é o `ad_id` que
 * guardamos — mandar para lá daria "anúncio não encontrado". O
 * Gerenciador aceita `selected_ad_ids` e é onde o cliente já trabalha.
 */
export function linkAdsManager(alvo: {
  adAccountId?: string | null;
  adId?: string | null;
  adsetId?: string | null;
  campaignId?: string | null;
}): string | null {
  const params = new URLSearchParams();
  const conta = String(alvo.adAccountId ?? '').replace(/^act_/, '');
  if (conta) params.set('act', conta);

  let nivel: string;
  if (alvo.adId) {
    params.set('selected_ad_ids', alvo.adId);
    nivel = 'ads';
  } else if (alvo.adsetId) {
    params.set('selected_adset_ids', alvo.adsetId);
    nivel = 'adsets';
  } else if (alvo.campaignId) {
    params.set('selected_campaign_ids', alvo.campaignId);
    nivel = 'campaigns';
  } else {
    return null;
  }
  return `https://adsmanager.facebook.com/adsmanager/manage/${nivel}?${params.toString()}`;
}
