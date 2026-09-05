/**
 * Objetivo da campanha na Meta, como rótulo legível.
 *
 * `meta_campaigns.objective` chega cru da API ("OUTCOME_LEADS"), e é o
 * que o sync grava. Aqui ele vira o nome que a Meta mostra em português
 * no Gerenciador de Anúncios — quem classifica campanha reconhece
 * "Cadastros", não "OUTCOME_LEADS".
 *
 * O objetivo não é a categoria de verba: a categoria é do cliente, ele
 * inventa ("Captação", "Remarketing", "Institucional"). O objetivo entra
 * como apoio — é o que permite atribuir dezenas de campanhas de uma vez
 * em vez de uma a uma, e é a pista mais confiável do que a campanha faz
 * quando o nome dela não diz nada.
 *
 * A Meta trocou os objetivos em 2022 (ODAX): campanhas antigas ainda
 * carregam os nomes velhos, e a conta do cliente tem as duas gerações
 * misturadas. Por isso os dois conjuntos estão aqui.
 *
 * Objetivo desconhecido não vira erro: aparece como veio. A Meta cria
 * objetivo novo sem avisar, e uma campanha sem rótulo bonito ainda é uma
 * campanha que gastou dinheiro e precisa aparecer na conta.
 */

const ROTULOS: Record<string, string> = {
  // ODAX (2022 em diante).
  OUTCOME_LEADS: 'Cadastros',
  OUTCOME_SALES: 'Vendas',
  OUTCOME_TRAFFIC: 'Tráfego',
  OUTCOME_AWARENESS: 'Reconhecimento',
  OUTCOME_ENGAGEMENT: 'Engajamento',
  OUTCOME_APP_PROMOTION: 'Promoção do app',

  // Anteriores ao ODAX, ainda presentes em campanhas antigas.
  LEAD_GENERATION: 'Geração de cadastros',
  CONVERSIONS: 'Conversões',
  LINK_CLICKS: 'Cliques no link',
  BRAND_AWARENESS: 'Reconhecimento da marca',
  REACH: 'Alcance',
  POST_ENGAGEMENT: 'Engajamento na publicação',
  PAGE_LIKES: 'Curtidas na página',
  VIDEO_VIEWS: 'Visualizações do vídeo',
  MESSAGES: 'Mensagens',
  APP_INSTALLS: 'Instalações do app',
  PRODUCT_CATALOG_SALES: 'Vendas do catálogo',
  CATALOG_SALES: 'Vendas do catálogo',
  STORE_VISITS: 'Visitas à loja',
  STORE_TRAFFIC: 'Movimento na loja',
  EVENT_RESPONSES: 'Respostas ao evento',
  LOCAL_AWARENESS: 'Reconhecimento local',
};

/** Rótulo do objetivo. Vazio ou nulo vira "Sem objetivo". */
export function rotuloObjetivo(objetivo: string | null | undefined): string {
  const chave = (objetivo ?? '').trim().toUpperCase();
  if (!chave) return 'Sem objetivo';
  return ROTULOS[chave] ?? chave;
}

/**
 * Chave normalizada do objetivo, para agrupar.
 *
 * String vazia representa "sem objetivo": a campanha existe e gastou, mas
 * o sync não trouxe o campo. Usar `null` aqui obrigaria toda a cadeia a
 * distinguir `null` de `''` só para dizer a mesma coisa.
 */
export function chaveObjetivo(objetivo: string | null | undefined): string {
  return (objetivo ?? '').trim().toUpperCase();
}
