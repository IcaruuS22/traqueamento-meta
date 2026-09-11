import Link from 'next/link';
import { requireClientAccess } from '@/lib/auth/guard';
import { buscaPainelPaginas, type LinhaAgrupada, type PainelPaginas } from '@/lib/db/paginas';
import { listaSites, type SitePagina } from '@/lib/db/paginas-sites';
import { primeiroLeadEm } from '@/lib/db/metricas';
import { lacunaDeEsquema } from '@/lib/db/pool';
import { resolvePeriodo, rotuloPeriodo } from '@/lib/periodo';
import { fmtBRL, fmtDataHora, fmtDec, fmtInt, ouTraco } from '@/lib/format';
import { Card, Funil, KpiCard, Tabela, Vazio } from '@/components/dados';
import { PageHero } from '@/components/hero';
import { Icones } from '@/components/icones';
import { SeletorPeriodo } from '@/components/seletores';

/**
 * Tela "Páginas de vendas" — o funil do site: quem visitou, quem deixou
 * contato, quem foi para o checkout e quem comprou.
 *
 * Visitante, lead e checkout contam pessoas (um visitante que recarrega a
 * página dez vezes é um visitante); compra conta pedidos. A receita é a
 * soma do valor informado pela plataforma de checkout ou pela página de
 * obrigado, sem descontar taxa.
 */

const ROTULO_EVENTO: Record<string, string> = {
  PageView: 'Visita',
  ViewContent: 'Conteúdo',
  Lead: 'Lead',
  InitiateCheckout: 'Checkout',
  Purchase: 'Compra',
};

const ROTULO_CAPI: Record<string, { texto: string; classe: string }> = {
  SENT: { texto: 'Enviado', classe: 'text-emerald-700' },
  SKIPPED: { texto: 'Não enviado', classe: 'text-[var(--text-tertiary)]' },
  ERROR: { texto: 'Erro', classe: 'text-red-700' },
  PENDING: { texto: 'Pendente', classe: 'text-amber-700' },
};

function taxa(parte: number, todo: number): string {
  return todo ? `${fmtDec((parte / todo) * 100, 1)}%` : '-';
}

function TabelaAgrupada({ linhas, rotulo }: { linhas: LinhaAgrupada[]; rotulo: string }) {
  if (!linhas.length) return <Vazio>Nenhum evento no período.</Vazio>;
  return (
    <Tabela colunas={[rotulo, 'Visitantes', 'Leads', 'Checkouts', 'Compras', 'Receita', 'Conversão']}>
      {linhas.map((l) => (
        <tr key={l.chave}>
          <td className="max-w-[320px] truncate" title={l.chave}>
            {l.chave}
          </td>
          <td>{fmtInt(l.visitantes)}</td>
          <td>{fmtInt(l.leads)}</td>
          <td>{fmtInt(l.checkouts)}</td>
          <td>{fmtInt(l.compras)}</td>
          <td className="whitespace-nowrap">{fmtBRL(l.receita)}</td>
          <td>{taxa(l.compras, l.visitantes)}</td>
        </tr>
      ))}
    </Tabela>
  );
}

export async function TelaPaginas({
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

  let sites: SitePagina[] = [];
  let painel: PainelPaginas | null = null;
  let semTabela = false;
  try {
    sites = await listaSites(conta.client_db_name);
    // Site de outro cliente ou inexistente cai para "todos", em vez de
    // virar filtro que nunca casa.
    const pedido = Number(um('site'));
    const siteId = sites.some((s) => s.id === pedido) ? pedido : null;
    painel = await buscaPainelPaginas(db, periodo, siteId);
  } catch (erro) {
    if (!lacunaDeEsquema(erro)) throw erro;
    semTabela = true;
  }
  const minimo = await primeiroLeadEm(db);
  const siteAtual = Number(um('site')) || null;

  const hrefSite = (id: number | null) => {
    const qs = new URLSearchParams();
    for (const chave of ['range', 'date_from', 'date_to'] as const) {
      const v = um(chave);
      if (v) qs.set(chave, v);
    }
    if (id) qs.set('site', String(id));
    const s = qs.toString();
    return `/app/${encodeURIComponent(conta.client_db_name)}/paginas${s ? `?${s}` : ''}`;
  };

  const cabecalho = (
    <PageHero
      titulo="Páginas de vendas"
      descricao="Visita, lead de formulário, checkout e compra das páginas do site, com a campanha de onde cada um veio."
      acoes={<SeletorPeriodo minimo={minimo} />}
    />
  );

  if (semTabela || !painel) {
    return (
      <>
        {cabecalho}
        <p className="rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O rastreio de páginas ainda não foi ativado para este cliente. Falta rodar a migração do
          banco; fale com o administrador.
        </p>
      </>
    );
  }

  if (!sites.length) {
    return (
      <>
        {cabecalho}
        <Vazio>
          Nenhum site cadastrado ainda. O administrador cadastra o site e passa a tag para colar
          na página.
        </Vazio>
      </>
    );
  }

  const t = painel.totais;

  return (
    <>
      {cabecalho}

      <p className="mb-4 text-body-small text-tertiary">{rotuloPeriodo(periodo)}</p>

      {sites.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <Link
            href={hrefSite(null)}
            className={`btn-ghost px-2 py-1 ${siteAtual ? '' : 'font-semibold underline'}`}
          >
            Todos os sites
          </Link>
          {sites.map((s) => (
            <Link
              key={s.id}
              href={hrefSite(s.id)}
              className={`btn-ghost px-2 py-1 ${siteAtual === s.id ? 'font-semibold underline' : ''}`}
            >
              {s.nome}
              {s.ativo ? '' : ' (pausado)'}
            </Link>
          ))}
        </div>
      ) : null}

      {painel.errosCapi > 0 ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-red-50 px-3 py-2 text-sm text-red-700">
          {fmtInt(painel.errosCapi)} evento(s) do período não chegaram à Meta pela Conversions API.
          O motivo aparece passando o mouse sobre “Erro” na lista abaixo.
        </p>
      ) : null}

      <div className="kpi-grid">
        <KpiCard
          rotulo="Visitantes"
          valor={fmtInt(t.visitantes)}
          dica={`Pessoas distintas que abriram alguma página (${fmtInt(t.visualizacoes)} visualizações no total).`}
          icone={Icones.eye}
        />
        <KpiCard
          rotulo="Leads"
          valor={fmtInt(t.leads)}
          dica="Pessoas que enviaram um formulário da página com e-mail ou telefone."
          icone={Icones.users}
        />
        <KpiCard
          rotulo="Foram ao checkout"
          valor={fmtInt(t.checkouts)}
          dica="Pessoas que clicaram no botão de compra e foram para a plataforma de checkout."
          icone={Icones.click}
        />
        <KpiCard
          rotulo="Compras"
          valor={fmtInt(t.compras)}
          dica="Vendas aprovadas no período, vindas do webhook da plataforma ou da página de obrigado."
          icone={Icones.check}
          tom="verde"
        />
        <KpiCard
          rotulo="Receita"
          valor={fmtBRL(t.receita)}
          dica="Soma do valor das compras aprovadas, como a plataforma informou (sem descontar taxa)."
          icone={Icones.dollar}
        />
        <KpiCard
          rotulo="Conversão do site"
          valor={taxa(t.compras, t.visitantes)}
          dica="Compras divididas por visitantes."
          icone={Icones.percent}
        />
      </div>

      <Card titulo="Funil" className="mt-4">
        <Funil
          id="funil-paginas"
          itens={[
            { label: 'Visitantes', count: t.visitantes },
            { label: 'Leads', count: t.leads },
            { label: 'Checkout', count: t.checkouts },
            { label: 'Compras', count: t.compras },
          ]}
        />
      </Card>

      <Card
        titulo="Por campanha"
        descricao="Agrupado pelo utm_campaign da primeira visita da pessoa."
        className="mt-4"
      >
        <TabelaAgrupada linhas={painel.porCampanha} rotulo="Campanha" />
      </Card>

      <Card titulo="Por página" className="mt-4">
        <TabelaAgrupada linhas={painel.porPagina} rotulo="Página" />
      </Card>

      <Card
        titulo="Últimos eventos"
        descricao="Os 50 mais recentes, sem as visitas. Coluna Meta: se o evento chegou pela Conversions API."
        className="mt-4"
      >
        {painel.recentes.length ? (
          <Tabela colunas={['Quando', 'Evento', 'Pessoa', 'Página', 'Valor', 'Origem', 'Meta']}>
            {painel.recentes.map((e, i) => {
              const capi = ROTULO_CAPI[e.capi_status] ?? { texto: e.capi_status, classe: '' };
              return (
                <tr key={`${e.created_at}-${i}`}>
                  <td className="whitespace-nowrap">{fmtDataHora(e.created_at)}</td>
                  <td>{ROTULO_EVENTO[e.event_name] ?? e.event_name}</td>
                  <td>{ouTraco(e.nome)}</td>
                  <td className="max-w-[220px] truncate" title={e.page_path ?? undefined}>
                    {e.page_path ?? (e.plataforma ? `webhook ${e.plataforma}` : '-')}
                  </td>
                  <td className="whitespace-nowrap">{e.value === null ? '-' : fmtBRL(e.value)}</td>
                  <td className="max-w-[200px] truncate">
                    {ouTraco([e.utm_source, e.utm_campaign].filter(Boolean).join(' / '))}
                  </td>
                  <td className={capi.classe} title={e.capi_error ?? undefined}>
                    {capi.texto}
                  </td>
                </tr>
              );
            })}
          </Tabela>
        ) : (
          <Vazio>Nenhum lead, checkout ou compra no período.</Vazio>
        )}
      </Card>
    </>
  );
}
