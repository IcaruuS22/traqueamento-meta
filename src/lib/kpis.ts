import type { Metricas, Totais } from '@/lib/db/metricas';
import type { Canal } from '@/lib/periodo';
import { fmtBRL, fmtInt, fmtDec, fmtPct } from '@/lib/format';

/**
 * Catálogo dos KPIs da tela "Métricas Gerais".
 *
 * Existe fora da página porque os mesmos números saem por dois canos: a
 * tela e o PDF exportado. Enquanto rótulo, formatação e regra de canal
 * viviam só dentro do componente, qualquer mudança precisava ser repetida
 * no relatório — e o projeto já tem a cicatriz desse padrão nos dois
 * tutoriais que divergiram por serem escritos duas vezes.
 *
 * Módulo puro de propósito: nada de `server-only` aqui, porque a tela é
 * um Server Component e o PDF roda numa rota de API, mas o seletor de
 * métricas que decide o que fica visível roda no navegador.
 */

export type DefinicaoKpi = {
  id: string;
  rotulo: string;
  /** Texto do `title` na tela e da legenda no PDF. */
  dica: (m: Metricas) => string;
  valor: (m: Metricas) => string;
  /** Valor cru, para comparar com o período anterior. */
  atual?: (m: Metricas) => number | null;
  anterior?: (t: Totais) => number | null;
  /** Queda é melhora: CPL menor é resultado melhor, não pior. */
  melhorQuandoCai?: boolean;
  /**
   * Vem do Meta Ads e não é atribuível por canal — não há como ligar uma
   * linha de `meta_insights_daily` a um lead específico. Some quando o
   * escopo é WhatsApp.
   */
  deAnuncio?: boolean;
};

export const KPIS: DefinicaoKpi[] = [
  {
    id: 'total_leads',
    rotulo: 'Total de Leads',
    dica: () => 'Total de leads capturados no período selecionado.',
    valor: (m) => fmtInt(m.total_leads),
    atual: (m) => m.total_leads,
    anterior: (t) => t.total_leads,
  },
  {
    id: 'total_spend',
    rotulo: 'Gasto (Meta Ads)',
    dica: () => 'Total investido em anúncios no Meta durante o período selecionado.',
    valor: (m) => fmtBRL(m.total_spend),
    atual: (m) => m.total_spend,
    anterior: (t) => t.total_spend,
    deAnuncio: true,
  },
  {
    id: 'cpl',
    rotulo: 'CPL',
    dica: () =>
      'Custo por Lead: gasto total dividido pelo número de leads capturados no período.',
    valor: (m) => (m.cpl === null ? '—' : fmtBRL(m.cpl)),
    atual: (m) => m.cpl,
    anterior: (t) => t.cpl,
    melhorQuandoCai: true,
    deAnuncio: true,
  },
  {
    id: 'impressions',
    rotulo: 'Impressões',
    dica: () => 'Total de impressões dos anúncios no Meta durante o período selecionado.',
    valor: (m) => fmtInt(m.impressions),
    deAnuncio: true,
  },
  {
    id: 'reach',
    rotulo: 'Alcance',
    dica: () =>
      'Soma dos valores diários. Não é deduplicado entre dias quando o período tem mais de um dia — use como aproximação.',
    valor: (m) => fmtInt(m.reach),
    deAnuncio: true,
  },
  {
    id: 'frequency',
    rotulo: 'Frequência',
    dica: () => 'Média dos valores diários. Aproximado quando o período tem mais de um dia.',
    valor: (m) => fmtDec(m.frequency, 2),
    deAnuncio: true,
  },
  {
    id: 'clicks',
    rotulo: 'Cliques',
    dica: () => 'Total de cliques nos anúncios no Meta durante o período selecionado.',
    valor: (m) => fmtInt(m.clicks),
    deAnuncio: true,
  },
  {
    id: 'ctr',
    rotulo: 'CTR',
    dica: () => 'Click-Through Rate: percentual de cliques em relação às impressões.',
    valor: (m) => fmtPct(m.ctr),
    deAnuncio: true,
  },
  {
    id: 'cpc',
    rotulo: 'CPC',
    dica: () => 'Custo por Clique médio no período selecionado.',
    valor: (m) => fmtBRL(m.cpc),
    deAnuncio: true,
  },
  {
    id: 'cpm',
    rotulo: 'CPM',
    dica: () => 'Custo por Mil impressões médio no período selecionado.',
    valor: (m) => fmtBRL(m.cpm),
    deAnuncio: true,
  },
  {
    id: 'conversoes',
    rotulo: 'Conversão',
    dica: () =>
      'Leads que chegaram a uma etapa marcada como conversão em Configurações de eventos, no período selecionado.',
    valor: (m) => fmtInt(m.total_conversoes),
    atual: (m) => m.total_conversoes,
    anterior: (t) => t.total_conversoes,
  },
  {
    id: 'taxa_conversao',
    rotulo: 'Taxa de Conversão do Funil',
    dica: (m) =>
      `Percentual de leads que chegaram a uma etapa marcada como conversão (${fmtInt(
        m.total_conversoes,
      )} de ${fmtInt(m.total_leads)} leads).`,
    valor: (m) => (m.taxa_conversao === null ? '—' : `${fmtDec(m.taxa_conversao, 1)}%`),
    atual: (m) => m.taxa_conversao,
    anterior: (t) => t.taxa_conversao,
  },
  {
    id: 'receita',
    rotulo: 'Receita',
    dica: () =>
      'Soma do valor das conversões no período. Depende de o evento carregar o campo "value" corretamente.',
    valor: (m) => fmtBRL(m.receita),
    atual: (m) => m.receita,
    anterior: (t) => t.receita,
  },
  {
    id: 'roas',
    rotulo: 'ROAS',
    dica: () =>
      'Receita dividida pelo Gasto (Meta Ads) no período. Depende de Receita estar configurada corretamente.',
    valor: (m) => (m.roas === null ? '—' : `${fmtDec(m.roas, 2)}x`),
    atual: (m) => m.roas,
    anterior: (t) => t.roas,
    deAnuncio: true,
  },
];

/**
 * Filtra o catálogo pelo escopo da tela: canal do período e o que o
 * cliente escolheu esconder no seletor "Personalizar".
 *
 * KPI ausente do mapa de visibilidade conta como visível — cliente que
 * nunca abriu o seletor vê tudo, e KPI novo aparece sem precisar de
 * migração de preferências.
 */
export function kpisDoEscopo(canal: Canal, visiveis: Map<string, boolean>): DefinicaoKpi[] {
  return KPIS.filter((k) => {
    if (canal === 'whatsapp' && k.deAnuncio) return false;
    return visiveis.get(k.id) !== false;
  });
}
