import type { EventoFunil, LinhaHierarquia, NivelHierarquia } from '@/lib/db/campanhas';

/**
 * Regras da tabela de campanhas que rodam no navegador.
 *
 * Fica fora de `lib/db/campanhas.ts` porque aquele módulo é `server-only`
 * e a tabela é um componente de cliente (expandir linha busca os filhos sob
 * demanda). Mesmo motivo de `lib/funil.ts` e `lib/crm.ts`. O tipo vem de lá
 * por `import type`, que some na compilação e não arrasta o módulo junto.
 */

/** Status cru da Meta → rótulo [feminino, masculino]. */
const ROTULOS_STATUS: Record<string, readonly [string, string]> = {
  ACTIVE: ['Ativa', 'Ativo'],
  PAUSED: ['Pausada', 'Pausado'],
  ARCHIVED: ['Arquivada', 'Arquivado'],
  DELETED: ['Excluída', 'Excluído'],
};

/**
 * O gênero do rótulo segue o nível: "campanha ativa", "conjunto ativo",
 * "anúncio ativo". Status fora da lista aparece cru — a Meta acrescenta
 * valores novos (`IN_PROCESS`, `WITH_ISSUES`) e inventar tradução para o
 * que não se conhece é pior do que mostrar o termo original.
 */
export function rotuloStatus(
  status: string | null | undefined,
  nivel: NivelHierarquia,
): string {
  const bruto = String(status ?? '').trim();
  if (!bruto) return '—';
  const par = ROTULOS_STATUS[bruto.toUpperCase()];
  if (!par) return bruto.toLowerCase().replace(/_/g, ' ');
  return nivel === 'campaign' ? par[0] : par[1];
}

/**
 * Para onde o clique no status leva, ou `null` quando não há para onde ir.
 *
 * Só ACTIVE e PAUSED se alternam. Arquivado e excluído a Meta não aceita
 * reverter por um POST de status, e os status intermediários que ela
 * inventa (`IN_PROCESS`, `WITH_ISSUES`, `PENDING_REVIEW`) descrevem uma
 * situação dela, não uma escolha do anunciante — escrever por cima seria
 * mandar a Meta desfazer algo que ela está fazendo.
 */
export function proximoStatus(status: string | null | undefined): 'ACTIVE' | 'PAUSED' | null {
  const s = String(status ?? '')
    .trim()
    .toUpperCase();
  if (s === 'ACTIVE') return 'PAUSED';
  if (s === 'PAUSED') return 'ACTIVE';
  return null;
}

export type TomStatus = 'ativo' | 'pausado' | 'atencao';

export function tomStatus(status: string | null | undefined): TomStatus {
  const s = String(status ?? '')
    .trim()
    .toUpperCase();
  if (s === 'ACTIVE') return 'ativo';
  if (s === 'PAUSED' || s === 'ARCHIVED' || s === 'DELETED' || !s) return 'pausado';
  return 'atencao';
}

/**
 * Totais do rodapé da tabela.
 *
 * Alcance e frequência não entram de propósito: alcance é gente única, e
 * somar o alcance de duas campanhas conta duas vezes quem viu as duas. A
 * Meta só sabe deduplicar isso na origem, então o rodapé mostra travessão
 * em vez de um número inflado. Frequência cai junto, por depender dele.
 */
export type TotaisCampanhas = {
  campanhas: number;
  spend: number;
  impressions: number;
  clicks: number;
  total_leads: number;
  total_conversoes: number;
  receita: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpl: number | null;
  cac: number | null;
  funil_eventos: EventoFunil[];
};

/**
 * As médias (CTR, CPC, CPM, CPL, CAC) são recalculadas sobre os totais, e
 * não pela média das linhas: média de médias ignora o peso de cada campanha
 * e daria um CPL que não bate com gasto ÷ leads.
 */
export function somaCampanhas(linhas: LinhaHierarquia[]): TotaisCampanhas {
  const t = {
    campanhas: linhas.length,
    spend: 0,
    impressions: 0,
    clicks: 0,
    total_leads: 0,
    total_conversoes: 0,
    receita: 0,
  };
  const eventos = new Map<string, number>();

  for (const l of linhas) {
    t.spend += Number(l.spend) || 0;
    t.impressions += Number(l.impressions) || 0;
    t.clicks += Number(l.clicks) || 0;
    t.total_leads += Number(l.total_leads) || 0;
    t.total_conversoes += Number(l.total_conversoes) || 0;
    t.receita += Number(l.receita) || 0;
    for (const e of l.funil_eventos) {
      eventos.set(e.event_name, (eventos.get(e.event_name) ?? 0) + (Number(e.total) || 0));
    }
  }

  return {
    ...t,
    ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0,
    cpc: t.clicks > 0 ? t.spend / t.clicks : 0,
    cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0,
    cpl: t.total_leads > 0 ? t.spend / t.total_leads : null,
    cac: t.total_conversoes > 0 ? t.spend / t.total_conversoes : null,
    funil_eventos: [...eventos]
      .map(([event_name, total]) => ({ event_name, total }))
      .sort((a, b) => b.total - a.total || a.event_name.localeCompare(b.event_name)),
  };
}
