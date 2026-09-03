/**
 * Catálogo de métricas — quais existem, como se chamam na tela e quais
 * aceitam preferência por cliente.
 *
 * Vive fora de `lib/db/prefs.ts` porque o seletor de métricas é um
 * componente de cliente: `prefs.ts` importa `server-only` e arrastaria o
 * pool de MySQL para o bundle do navegador. Aqui não há nada além de
 * dados, então os dois lados podem importar.
 *
 * Porte de `METRIC_CATALOG` do `painel-admin.html`, com os mesmos valores
 * de `clientScoped` e `defaultVisible`.
 */

export type Metrica = {
  key: string;
  label: string;
  /** Aceita override por cliente, além do global. */
  porCliente?: boolean;
  /** Sem nenhuma preferência salva, aparece? */
  padrao?: boolean;
  /** 'kpi' (grid de KPIs) ou 'campanhas' (colunas da tabela de campanhas). */
  grupo?: 'kpi' | 'campanhas';
};

export const CATALOGO_METRICAS: Metrica[] = [
  { key: 'total_leads', label: 'Total de Leads' },
  { key: 'total_spend', label: 'Gasto (Meta Ads)' },
  { key: 'cpl', label: 'CPL' },
  { key: 'impressions', label: 'Impressões' },
  { key: 'reach', label: 'Alcance' },
  { key: 'frequency', label: 'Frequência' },
  { key: 'clicks', label: 'Cliques' },
  { key: 'ctr', label: 'CTR' },
  { key: 'cpc', label: 'CPC' },
  { key: 'cpm', label: 'CPM' },
  { key: 'conversoes', label: 'Conversão' },
  { key: 'taxa_conversao', label: 'Taxa de Conversão do Funil' },
  { key: 'receita', label: 'Receita', porCliente: true, padrao: false },
  { key: 'roas', label: 'ROAS', porCliente: true, padrao: false },
  // Colunas da tabela de Campanhas — mesmo catálogo e mesma tabela de
  // preferências, separadas por grupo para não aparecerem no seletor
  // errado. A chave é 'campanhas_' + a chave da coluna em
  // 'components/tabela-campanhas.tsx'; a ordem aqui é a ordem da tabela.
  //
  // Nome e Status não entram: sem eles a linha não identifica de qual
  // campanha é, nem dá para ligar e desligar a entrega.
  { key: 'campanhas_orcamento', label: 'Orçamento', grupo: 'campanhas' },
  { key: 'campanhas_spend', label: 'Gasto', grupo: 'campanhas' },
  { key: 'campanhas_impressions', label: 'Impressões', grupo: 'campanhas' },
  { key: 'campanhas_reach', label: 'Alcance', grupo: 'campanhas' },
  { key: 'campanhas_frequency', label: 'Frequência', grupo: 'campanhas' },
  { key: 'campanhas_clicks', label: 'Cliques', grupo: 'campanhas' },
  { key: 'campanhas_ctr', label: 'CTR', grupo: 'campanhas' },
  { key: 'campanhas_cpc', label: 'CPC', grupo: 'campanhas' },
  { key: 'campanhas_cpm', label: 'CPM', grupo: 'campanhas' },
  { key: 'campanhas_leads', label: 'Leads', grupo: 'campanhas' },
  { key: 'campanhas_conversoes', label: 'Conversões', grupo: 'campanhas' },
  { key: 'campanhas_cpl', label: 'CPL', grupo: 'campanhas' },
  { key: 'campanhas_cac', label: 'CAC', grupo: 'campanhas' },
  { key: 'campanhas_receita', label: 'Receita', porCliente: true, padrao: false, grupo: 'campanhas' },
  { key: 'campanhas_roas', label: 'ROAS', porCliente: true, padrao: false, grupo: 'campanhas' },
  { key: 'campanhas_roi', label: 'ROI', porCliente: true, padrao: false, grupo: 'campanhas' },
  { key: 'campanhas_funil', label: 'Funil de eventos', grupo: 'campanhas' },
];

const POR_CHAVE = new Map(CATALOGO_METRICAS.map((m) => [m.key, m]));

export function metricaPorChave(key: string): Metrica | undefined {
  return POR_CHAVE.get(key);
}

export function rotuloMetrica(key: string): string {
  return POR_CHAVE.get(key)?.label ?? key;
}

/** As do grid de KPIs (tudo que não é coluna de Campanhas). */
export function metricasDoGrupo(grupo: 'kpi' | 'campanhas'): Metrica[] {
  return CATALOGO_METRICAS.filter((m) => (m.grupo ?? 'kpi') === grupo);
}
