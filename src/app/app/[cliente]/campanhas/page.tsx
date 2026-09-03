import type { Metadata } from 'next';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { buscaHierarquia } from '@/lib/db/campanhas';
import { visibilidadeMetricas } from '@/lib/db/prefs';
import { resolvePeriodo, rotuloPeriodo } from '@/lib/periodo';
import { Card, Vazio } from '@/components/dados';
import { PageHero } from '@/components/hero';
import { SeletorPeriodo } from '@/components/seletores';
import { primeiroLeadEm } from '@/lib/db/metricas';
import { TabelaCampanhas } from '@/components/tabela-campanhas';
import { SeletorMetricas } from '@/components/seletor-metricas';
import { BotoesMeta } from '@/components/botoes-meta';
import { fmtBRL } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Campanhas | Trakeamento' };

/**
 * Aba "Campanhas" — hierarquia Campanha → Conjunto → Anúncio no modelo do
 * Gerenciador de Anúncios.
 *
 * O nível raiz é consultado aqui, no servidor. Os filhos são carregados
 * pelo navegador ao expandir uma linha, via `/api/campanhas`.
 *
 * O painel antigo tinha um seletor de período PRÓPRIO nesta aba, cujo
 * padrão era "todo o período" enquanto o das outras era "7 dias". Aqui o
 * seletor é um só, no cabeçalho do cliente, e o padrão é o mesmo do resto
 * do app: um padrão diferente por tela faria o cabeçalho dizer "Últimos 7
 * dias" enquanto a tabela mostra o histórico inteiro.
 */
export default async function PaginaCampanhas({
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
  const periodo = resolvePeriodo({
    range: um('range'),
    date_from: um('date_from'),
    date_to: um('date_to'),
    channel: 'geral',
  });

  // As três vão juntas: cada uma é uma ida ao banco remoto (~150-250ms de
  // RTT). Em série somavam ~600ms; `primeiroLeadEm` não depende das outras,
  // então entra no mesmo Promise.all em vez de esperar no fim.
  const [hierarquia, visiveis, minimo] = await Promise.all([
    buscaHierarquia(db, 'campaign', periodo),
    visibilidadeMetricas(conta.client_db_name),
    primeiroLeadEm(db),
  ]);

  const colunas = {
    receita: visiveis.get('campanhas_receita') !== false,
    roas: visiveis.get('campanhas_roas') !== false,
    roi: visiveis.get('campanhas_roi') !== false,
  };

  // Gasto que existe em `meta_insights_daily` mas não em nenhuma linha da
  // tabela — campanha excluída da conta no Meta. Sem dizer isso, a soma da
  // coluna Gasto não fecharia com o KPI "Gasto (Meta Ads)" da Visão geral e
  // pareceria erro de conta.
  const somaExibida = hierarquia.linhas.reduce((acc, l) => acc + l.spend, 0);
  const gastoForaDaTabela =
    hierarquia.gasto_total_periodo === null
      ? 0
      : Math.round((hierarquia.gasto_total_periodo - somaExibida) * 100) / 100;

  // Só o período viaja para as chamadas de filhos — o resto da query
  // string da tela (se um dia houver) não é filtro de dados.
  const qsPeriodo = new URLSearchParams();
  for (const chave of ['range', 'date_from', 'date_to'] as const) {
    const v = um(chave);
    if (v) qsPeriodo.set(chave, v);
  }

  return (
    <>
      <PageHero
        titulo="Campanhas"
        descricao="Hierarquia Campanha → Conjunto → Anúncio, com métricas do Meta Ads, leads, conversões, CPL e CAC."
        acoes={
          <>
            <SeletorPeriodo minimo={minimo} />
            <SeletorMetricas
              cliente={conta.client_db_name}
              grupo="campanhas"
              visiveis={Object.fromEntries(visiveis)}
            />
            <BotoesMeta cliente={conta.client_db_name} mostrarImportacao />
          </>
        }
      />

      {hierarquia.lacunas_de_esquema.length ? (
        <p className="rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O banco deste cliente está atrás do template. Falta:{' '}
          <strong>{hierarquia.lacunas_de_esquema.join(', ')}</strong>. A hierarquia de campanhas
          depende dessas tabelas e por isso aparece vazia; não é falta de campanha, é falta de
          migração.
        </p>
      ) : null}

      <p className="mb-4 text-body-small text-tertiary">
        {rotuloPeriodo(periodo)} · ativas e pausadas, ordenadas pelas ativas primeiro
      </p>

      <Card>
        {hierarquia.linhas.length ? (
          <TabelaCampanhas
            cliente={conta.client_db_name}
            linhas={hierarquia.linhas}
            busca={qsPeriodo.toString()}
            colunas={colunas}
          />
        ) : (
          <Vazio>
            Nenhuma campanha com atividade no período. Se este cliente nunca sincronizou o Meta
            Ads, as tabelas de campanha estão vazias. Rode a importação de histórico.
          </Vazio>
        )}

        {gastoForaDaTabela > 0.01 ? (
          <p className="mt-3 border-t pt-3 text-xs text-[var(--text-tertiary)]">
            Mais <strong className="tabular-nums">{fmtBRL(gastoForaDaTabela)}</strong> de gasto no
            período vêm de campanhas que não existem mais na conta do Meta (excluídas ou
            arquivadas): o histórico de gasto delas ficou no banco, o cadastro não. Por isso a
            soma da coluna Gasto fica abaixo do total de{' '}
            <span className="tabular-nums">{fmtBRL(hierarquia.gasto_total_periodo)}</span> mostrado
            na Visão geral.
          </p>
        ) : null}
      </Card>
    </>
  );
}
