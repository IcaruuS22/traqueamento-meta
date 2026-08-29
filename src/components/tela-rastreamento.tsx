import { Suspense } from 'react';
import { requireClientAccess } from '@/lib/auth/guard';
import { buscaPainelRastreamento } from '@/lib/db/rastreamento';
import { ehFonte, DESCRICAO_FONTE, FONTES, ROTULO_FONTE, type Fonte } from '@/lib/rastreamento';
import { resolvePeriodo, rotuloPeriodo } from '@/lib/periodo';
import { fmtInt, fmtDec } from '@/lib/format';
import { Card, KpiCard, Vazio } from '@/components/dados';
import { PageHero } from '@/components/hero';
import { Icones } from '@/components/icones';
import { SeletorPeriodo } from '@/components/seletores';
import { primeiroLeadEm } from '@/lib/db/metricas';
import { FiltrosRastreamento } from '@/components/filtros-rastreamento';
import { TabelaRastreamento } from '@/components/tabela-rastreamento';

/**
 * Tela "Rastreamento" — de onde cada lead veio e o quanto disso é rastreio
 * de verdade.
 *
 * As outras telas mostram quanto entrou; esta mostra quanto dá para
 * atribuir. Um lead sem identificador de clique conta igual nas métricas
 * e não serve para otimizar anúncio — é essa diferença que os cards de
 * fonte e a coluna de confiança medem.
 *
 * Canal fixo em 'geral': o recorte aqui é a fonte do lead, e separar por
 * canal antes esconderia justamente o caso que interessa, o lead que veio
 * de anúncio e virou conversa.
 */

const ICONE_FONTE = {
  ctwa: Icones.broadcast,
  meta_lead_ads: Icones.users,
  lp_utm: Icones.click,
  outros: Icones.info,
} as const;

export async function TelaRastreamento({
  cliente,
  busca,
}: {
  cliente: string;
  busca: Record<string, string | string[] | undefined>;
}) {
  // A checagem se repete aqui mesmo já existindo no layout: no Next,
  // layout e página são renderizados de forma independente.
  const { conta, db } = await requireClientAccess(decodeURIComponent(cliente));

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

  // Fonte fora da whitelist é descartada, não repassada ao SQL: viraria
  // um filtro que nunca casa e uma tabela vazia sem explicação.
  const fonteBruta = um('fonte');
  const fonte: Fonte | null = ehFonte(fonteBruta) ? fonteBruta : null;
  const termo = String(um('search') ?? '').trim().slice(0, 120) || null;

  const [painel, minimo] = await Promise.all([
    buscaPainelRastreamento(db, periodo, { fonte, search: termo }),
    primeiroLeadEm(db),
  ]);

  const totalPor = (f: Fonte) => painel.por_fonte.find((c) => c.fonte === f)?.total ?? 0;
  const rastreados = painel.total - totalPor('outros');
  const cobertura = painel.total ? Math.round((rastreados / painel.total) * 1000) / 10 : null;

  // Período e filtros acompanham a paginação da tabela.
  const qs = new URLSearchParams();
  for (const chave of ['range', 'date_from', 'date_to'] as const) {
    const v = um(chave);
    if (v) qs.set(chave, v);
  }
  if (fonte) qs.set('fonte', fonte);
  if (termo) qs.set('search', termo);

  const filtrado = Boolean(fonte || termo);

  return (
    <>
      <PageHero
        titulo="Rastreamento"
        descricao="Origem de cada lead: por onde entrou, de qual anúncio veio e o quanto disso é rastreio confirmado."
        acoes={<SeletorPeriodo minimo={minimo} />}
      />

      {painel.lacunas_de_esquema.length ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O banco deste cliente está atrás do template — falta:{' '}
          <strong>{painel.lacunas_de_esquema.join(', ')}</strong>. Sem isso a origem por
          Click to WhatsApp não pode ser apurada, e zero ali é falta de migração, não falta de
          resultado.
        </p>
      ) : null}

      <p className="mb-4 text-body-small text-tertiary">{rotuloPeriodo(periodo)}</p>

      <div className="kpi-grid">
        <KpiCard
          rotulo="Leads no período"
          valor={fmtInt(painel.total)}
          dica="Todos os leads criados no período, rastreados ou não."
          icone={Icones.users}
        />
        {FONTES.filter((f) => f !== 'outros').map((f) => (
          <KpiCard
            key={f}
            rotulo={ROTULO_FONTE[f]}
            valor={fmtInt(totalPor(f))}
            dica={DESCRICAO_FONTE[f]}
            icone={ICONE_FONTE[f]}
          />
        ))}
        <KpiCard
          rotulo="Cobertura de rastreio"
          valor={cobertura === null ? '—' : `${fmtDec(cobertura, 1)}%`}
          dica="Percentual de leads com alguma origem identificada. O resto entrou sem nenhum parâmetro — nem UTM, nem lead_id, nem referência de anúncio."
          icone={Icones.percent}
          destaque={cobertura !== null && cobertura >= 80}
        />
      </div>

      <Card
        titulo="Leads rastreados"
        descricao="Clique em Ver detalhe para abrir o rastreio completo do contato."
        className="mt-4"
        acessorio={
          // `useSearchParams` obriga a fronteira de Suspense no Next 15.
          <Suspense fallback={null}>
            <FiltrosRastreamento />
          </Suspense>
        }
      >
        {painel.leads.length ? (
          <TabelaRastreamento
            cliente={conta.client_db_name}
            iniciais={painel.leads}
            busca={qs.toString()}
          />
        ) : (
          <Vazio>
            {filtrado
              ? 'Nenhum lead bate com o filtro neste período.'
              : 'Nenhum lead registrado no período.'}
          </Vazio>
        )}
      </Card>

      {filtrado ? (
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">
          Os cards acima cobrem o período inteiro e não seguem o filtro de fonte — só a tabela
          segue. A busca, essa sim, vale para os dois.
        </p>
      ) : null}
    </>
  );
}
