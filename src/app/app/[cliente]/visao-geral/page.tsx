import type { Metadata } from 'next';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { buscaMetricas, primeiroLeadEm, type Metricas } from '@/lib/db/metricas';
import { visibilidadeMetricas } from '@/lib/db/prefs';
import {
  resolvePeriodo,
  preencheDias,
  agrupaSerie,
  rotuloPeriodo,
  CANAIS,
  type Canal,
} from '@/lib/periodo';
import { fmtBRL, fmtInt, fmtDec, fmtPct } from '@/lib/format';
import {
  Card,
  KpiCard,
  Funil,
  GraficoDiario,
  TempoEntreEtapas,
  Vazio,
} from '@/components/dados';
import { PageHero } from '@/components/hero';
import { Icones } from '@/components/icones';
import { SeletorPeriodo } from '@/components/seletores';
import { ListaLeads } from '@/components/lista-leads';
import { SeletorMetricas } from '@/components/seletor-metricas';
import { BotoesMeta } from '@/components/botoes-meta';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Visão geral — Trakeamento' };

/**
 * Visão geral do cliente — porte da aba "Métricas Gerais" do painel.
 *
 * Server Component que consulta o MySQL direto, sem passar por uma rota
 * `/api` intermediária: o painel antigo precisava do fetch porque o HTML
 * era estático, mas aqui isso só acrescentaria um round-trip e uma
 * segunda conexão ao banco por render. As rotas `/api` ficam para o que
 * o navegador realmente precisa chamar sozinho (paginação, lazy-load).
 */

/**
 * Métricas que vêm do Meta Ads e não são atribuíveis por canal — não há
 * como ligar uma linha de `meta_insights_daily` a um lead específico.
 * Some na visão de WhatsApp, igual ao painel atual.
 */
const KPIS_DE_ANUNCIO = new Set([
  'total_spend',
  'cpl',
  'impressions',
  'reach',
  'frequency',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'roas',
]);

type Kpi = {
  /** Chave do catálogo de preferências. Não é `key`: o objeto é
   *  espalhado em `<KpiCard {...k}>`, e `key` ali seria consumido pelo
   *  React em vez de chegar ao componente. */
  id: string;
  rotulo: string;
  valor: string;
  dica: string;
  icone: (typeof Icones)[keyof typeof Icones];
  atual?: unknown;
  anterior?: unknown;
  melhorQuandoCai?: boolean;
  destaque?: boolean;
  spark?: number[];
};

function montaKpis(m: Metricas, serie: number[]): Kpi[] {
  const cmp = m.comparativo_anterior;
  return [
    {
      id: 'total_leads',
      icone: Icones.users,
      rotulo: 'Total de Leads',
      valor: fmtInt(m.total_leads),
      dica: 'Total de leads capturados no período selecionado.',
      atual: m.total_leads,
      anterior: cmp?.total_leads,
      spark: serie,
    },
    {
      id: 'total_spend',
      icone: Icones.dollar,
      rotulo: 'Gasto (Meta Ads)',
      valor: fmtBRL(m.total_spend),
      dica: 'Total investido em anúncios no Meta durante o período selecionado.',
      atual: m.total_spend,
      anterior: cmp?.total_spend,
    },
    {
      id: 'cpl',
      icone: Icones.target,
      rotulo: 'CPL',
      valor: m.cpl === null ? '—' : fmtBRL(m.cpl),
      dica: 'Custo por Lead: gasto total dividido pelo número de leads capturados no período.',
      atual: m.cpl,
      anterior: cmp?.cpl,
      melhorQuandoCai: true,
    },
    {
      id: 'impressions',
      icone: Icones.eye,
      rotulo: 'Impressões',
      valor: fmtInt(m.impressions),
      dica: 'Total de impressões dos anúncios no Meta durante o período selecionado.',
    },
    {
      id: 'reach',
      icone: Icones.broadcast,
      rotulo: 'Alcance',
      valor: fmtInt(m.reach),
      dica: 'Soma dos valores diários. Não é deduplicado entre dias quando o período tem mais de um dia — use como aproximação.',
    },
    {
      id: 'frequency',
      icone: Icones.repeat,
      rotulo: 'Frequência',
      valor: fmtDec(m.frequency, 2),
      dica: 'Média dos valores diários. Aproximado quando o período tem mais de um dia.',
    },
    {
      id: 'clicks',
      icone: Icones.click,
      rotulo: 'Cliques',
      valor: fmtInt(m.clicks),
      dica: 'Total de cliques nos anúncios no Meta durante o período selecionado.',
    },
    {
      id: 'ctr',
      icone: Icones.percent,
      rotulo: 'CTR',
      valor: fmtPct(m.ctr),
      dica: 'Click-Through Rate: percentual de cliques em relação às impressões.',
    },
    {
      id: 'cpc',
      icone: Icones.dollar,
      rotulo: 'CPC',
      valor: fmtBRL(m.cpc),
      dica: 'Custo por Clique médio no período selecionado.',
    },
    {
      id: 'cpm',
      icone: Icones.dollar,
      rotulo: 'CPM',
      valor: fmtBRL(m.cpm),
      dica: 'Custo por Mil impressões médio no período selecionado.',
    },
    {
      id: 'conversoes',
      icone: Icones.check,
      rotulo: 'Conversão',
      valor: fmtInt(m.total_conversoes),
      dica: 'Leads que chegaram a uma etapa marcada como conversão em Configurações de eventos, no período selecionado.',
      atual: m.total_conversoes,
      anterior: cmp?.total_conversoes,
    },
    {
      id: 'taxa_conversao',
      icone: Icones.target,
      rotulo: 'Taxa de Conversão do Funil',
      valor: m.taxa_conversao === null ? '—' : `${fmtDec(m.taxa_conversao, 1)}%`,
      dica: `Percentual de leads que chegaram a uma etapa marcada como conversão (${fmtInt(m.total_conversoes)} de ${fmtInt(m.total_leads)} leads).`,
      destaque: m.taxa_conversao !== null && m.taxa_conversao >= 20,
      atual: m.taxa_conversao,
      anterior: cmp?.taxa_conversao,
    },
    {
      id: 'receita',
      icone: Icones.dollar,
      rotulo: 'Receita',
      valor: fmtBRL(m.receita),
      dica: 'Soma do valor das conversões no período. Depende de o evento carregar o campo "value" corretamente.',
      atual: m.receita,
      anterior: cmp?.receita,
    },
    {
      id: 'roas',
      icone: Icones.target,
      rotulo: 'ROAS',
      valor: m.roas === null ? '—' : `${fmtDec(m.roas, 2)}x`,
      dica: 'Receita dividida pelo Gasto (Meta Ads) no período. Depende de Receita estar configurada corretamente.',
      atual: m.roas,
      anterior: cmp?.roas,
    },
  ];
}

/** Rótulo do período no título do gráfico, como no painel. */
function rotuloGrafico(range: string, periodo: Parameters<typeof rotuloPeriodo>[0]): string {
  if (range === 'custom') return 'período personalizado';
  return rotuloPeriodo(periodo).toLowerCase();
}

export default async function PaginaVisaoGeral({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;

  // A checagem se repete aqui mesmo já existindo no layout: no Next,
  // layout e página são renderizados de forma independente.
  const { conta, db } = await requireClientAccessPagina(decodeURIComponent(cliente));

  const um = (chave: string) => {
    const v = busca[chave];
    return Array.isArray(v) ? v[0] : v;
  };

  // O canal vem da URL: o menu lateral tem uma entrada de "Métricas" em
  // Geral, outra em Formulários e outra em WhatsApp, e as três caem
  // nesta mesma rota — exatamente como as três abas do painel.
  const canalBruto = String(um('channel') ?? 'geral').toLowerCase();
  const canal: Canal = (CANAIS as readonly string[]).includes(canalBruto)
    ? (canalBruto as Canal)
    : 'geral';

  const periodo = resolvePeriodo({
    range: um('range'),
    date_from: um('date_from'),
    date_to: um('date_to'),
    channel: canal,
  });

  // As três consultas disparam em paralelo e são aguardadas aqui, no mesmo
  // molde de Campanhas: cada uma é uma ida ao banco remoto e não dependem
  // entre si, então vão juntas em vez de em série. As métricas ficam
  // resolvidas antes do JSX — o corpo é um Server Component síncrono que só
  // recebe os dados prontos, sem promise cruzando fronteira de componente.
  const [metricas, visiveis, minimo] = await Promise.all([
    buscaMetricas(db, periodo),
    visibilidadeMetricas(conta.client_db_name),
    primeiroLeadEm(db),
  ]);

  // Período e canal acompanham a paginação de "Últimos leads"; o resto da
  // query string da tela não é filtro de dados.
  const qsLeads = new URLSearchParams({ channel: periodo.canal });
  for (const chave of ['range', 'date_from', 'date_to'] as const) {
    const v = um(chave);
    if (v) qsLeads.set(chave, v);
  }

  return (
    <>
      <PageHero
        titulo="Métricas Gerais"
        descricao="Visão geral dos leads e eventos enviados para a Meta CAPI."
        acoes={
          <>
            <SeletorPeriodo minimo={minimo} />
            <SeletorMetricas
              cliente={conta.client_db_name}
              grupo="kpi"
              visiveis={Object.fromEntries(visiveis)}
            />
            <BotoesMeta cliente={conta.client_db_name} />
          </>
        }
      />

      <CorpoMetricas
        metricas={metricas}
        periodo={periodo}
        visiveis={visiveis}
        cliente={conta.client_db_name}
        qsLeads={qsLeads.toString()}
      />
    </>
  );
}

/**
 * Corpo da visão geral: KPIs, funil, gráfico diário e últimos leads.
 *
 * Recebe as métricas já resolvidas pela página. Separá-lo em um componente
 * mantém a função principal legível; a busca de dados fica toda no
 * `Promise.all` da página, e o corpo só formata o que já chegou pronto.
 */
function CorpoMetricas({
  metricas,
  periodo,
  visiveis,
  cliente,
  qsLeads,
}: {
  metricas: Metricas;
  periodo: ReturnType<typeof resolvePeriodo>;
  visiveis: Map<string, boolean>;
  cliente: string;
  qsLeads: string;
}) {
  const serie = preencheDias(metricas.leads_por_dia, periodo.inicioSec, periodo.fimSec);
  const kpis = montaKpis(
    metricas,
    serie.map((p) => p.total),
  ).filter((k) => {
    if (periodo.canal === 'whatsapp' && KPIS_DE_ANUNCIO.has(k.id)) return false;
    return visiveis.get(k.id) !== false;
  });

  return (
    <>
      {metricas.lacunas_de_esquema.length ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O banco deste cliente está atrás do template — falta:{' '}
          <strong>{metricas.lacunas_de_esquema.join(', ')}</strong>. As métricas que dependem
          disso aparecem como zero, e zero aqui é falta de migração, não falta de resultado.
        </p>
      ) : null}

      {kpis.length ? (
        <div className="kpi-grid">
          {kpis.map((k) => (
            <KpiCard key={k.id} {...k} />
          ))}
        </div>
      ) : (
        <Vazio>Nenhuma métrica está visível. Marque alguma em &quot;Personalizar&quot;.</Vazio>
      )}

      <div className="panel-grid">
        <Card titulo="Funil de vendas">
          <Funil
            id="eventosPorNome"
            itens={metricas.eventos_por_nome.map((e) => ({
              label: e.event_name,
              count: Number(e.total),
            }))}
          />
        </Card>

        <Card titulo={`Leads capturados — ${rotuloGrafico(periodo.range, periodo)}`}>
          <GraficoDiario serie={agrupaSerie(serie)} />
        </Card>
      </div>

      <Card titulo="Tempo médio entre etapas" className="mt-4">
        <TempoEntreEtapas itens={metricas.tempo_medio_entre_etapas} />
      </Card>

      <Card titulo="Últimos leads" className="mt-4">
        {metricas.ultimos_leads.length ? (
          <ListaLeads cliente={cliente} iniciais={metricas.ultimos_leads} busca={qsLeads} />
        ) : (
          <Vazio>Nenhum lead no período.</Vazio>
        )}
      </Card>
    </>
  );
}
