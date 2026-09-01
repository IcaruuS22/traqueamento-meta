import type { Metadata } from 'next';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { buscaMetricas, primeiroLeadEm, type Metricas } from '@/lib/db/metricas';
import { visibilidadeMetricas } from '@/lib/db/prefs';
import { buscaOrcamentoDoMes } from '@/lib/db/orcamento';
import {
  resolvePeriodo,
  preencheDias,
  agrupaSerie,
  rotuloPeriodo,
  CANAIS,
  type Canal,
} from '@/lib/periodo';
import { kpisDoEscopo } from '@/lib/kpis';
import type { Orcamento } from '@/lib/orcamento';
import {
  Card,
  KpiCard,
  Funil,
  GraficoDiario,
  TempoEntreEtapas,
  Vazio,
  type TomKpi,
} from '@/components/dados';
import { PageHero } from '@/components/hero';
import { Icones } from '@/components/icones';
import { SeletorPeriodo } from '@/components/seletores';
import { ListaLeads } from '@/components/lista-leads';
import { SeletorMetricas } from '@/components/seletor-metricas';
import { BotoesMeta } from '@/components/botoes-meta';
import { ExportarPdf } from '@/components/exportar-pdf';
import { OrcamentoMensal } from '@/components/orcamento-mensal';

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

/** Ícone de cada KPI. Só a tela usa: o PDF não desenha ícone. */
const ICONES_KPI: Record<string, (typeof Icones)[keyof typeof Icones]> = {
  total_leads: Icones.users,
  total_spend: Icones.dollar,
  cpl: Icones.target,
  impressions: Icones.eye,
  reach: Icones.broadcast,
  frequency: Icones.repeat,
  clicks: Icones.click,
  ctr: Icones.percent,
  cpc: Icones.dollar,
  cpm: Icones.dollar,
  conversoes: Icones.check,
  taxa_conversao: Icones.target,
  receita: Icones.dollar,
  roas: Icones.target,
};

/**
 * Cor do ícone por significado do KPI. Só o que tem referência óbvia
 * ganha cor: dinheiro que entra e resultado em verde, custo em âmbar. O
 * resto — leads, impressões, alcance, frequência, cliques, CTR — fica no
 * azul padrão, porque pintar tudo transformaria a cor em enfeite e ela
 * deixaria de significar alguma coisa.
 */
const TONS_KPI: Record<string, TomKpi> = {
  total_spend: 'ambar',
  cpl: 'ambar',
  cpc: 'ambar',
  cpm: 'ambar',
  conversoes: 'verde',
  taxa_conversao: 'verde',
  receita: 'verde',
  roas: 'verde',
};

/**
 * Monta os cards a partir do catálogo compartilhado com o PDF.
 *
 * O que é só da tela — ícone, minigráfico e o destaque da taxa alta —
 * entra aqui; rótulo, formatação e regra de canal vêm de `lib/kpis` para
 * que a exportação nunca mostre um número diferente do da tela.
 */
function montaKpis(m: Metricas, serie: number[], canal: Canal, visiveis: Map<string, boolean>) {
  const cmp = m.comparativo_anterior;
  return kpisDoEscopo(canal, visiveis).map((k) => ({
    id: k.id,
    icone: ICONES_KPI[k.id],
    tom: TONS_KPI[k.id],
    rotulo: k.rotulo,
    valor: k.valor(m),
    dica: k.dica(m),
    atual: k.atual?.(m),
    anterior: cmp && k.anterior ? k.anterior(cmp) : undefined,
    melhorQuandoCai: k.melhorQuandoCai,
    destaque: k.id === 'taxa_conversao' && m.taxa_conversao !== null && m.taxa_conversao >= 20,
    spark: k.id === 'total_leads' ? serie : undefined,
  }));
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
  const [metricas, visiveis, minimo, orcamento] = await Promise.all([
    buscaMetricas(db, periodo),
    visibilidadeMetricas(conta.client_db_name),
    primeiroLeadEm(db),
    // O mês do período escolhido, e não o período em si: o fee é mensal,
    // e compará-lo com o gasto de sete dias não diria nada.
    buscaOrcamentoDoMes(conta.client_db_name, db, periodo.fimSec),
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
            <ExportarPdf cliente={conta.client_db_name} />
          </>
        }
      />

      <CorpoMetricas
        metricas={metricas}
        orcamento={orcamento}
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
  orcamento,
  periodo,
  visiveis,
  cliente,
  qsLeads,
}: {
  metricas: Metricas;
  orcamento: Orcamento;
  periodo: ReturnType<typeof resolvePeriodo>;
  visiveis: Map<string, boolean>;
  cliente: string;
  qsLeads: string;
}) {
  const serie = preencheDias(metricas.leads_por_dia, periodo.inicioSec, periodo.fimSec);
  const kpis = montaKpis(
    metricas,
    serie.map((p) => p.total),
    periodo.canal,
    visiveis,
  );

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

      <div className="panel-grid mt-4">
        <OrcamentoMensal orcamento={orcamento} />

        <Card titulo="Tempo médio entre etapas">
          <TempoEntreEtapas itens={metricas.tempo_medio_entre_etapas} />
        </Card>
      </div>

      <Card titulo="Últimos leads" className="mt-4">
        {metricas.ultimos_leads.length ? (
          <ListaLeads
            cliente={cliente}
            iniciais={metricas.ultimos_leads}
            busca={qsLeads}
            etapas={metricas.etapas_de_leads}
          />
        ) : (
          <Vazio>Nenhum lead no período.</Vazio>
        )}
      </Card>
    </>
  );
}
