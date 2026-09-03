import { Suspense } from 'react';
import { requireClientAccess } from '@/lib/auth/guard';
import { buscaPainelEventos, type ContagemStatus } from '@/lib/db/eventos';
import { resolvePeriodo, rotuloPeriodo, type Canal } from '@/lib/periodo';
import { fmtInt, fmtDec } from '@/lib/format';
import { Card, KpiCard, BarrasHorizontais, Vazio } from '@/components/dados';
import { PageHero } from '@/components/hero';
import { Icones } from '@/components/icones';
import { SeletorPeriodo } from '@/components/seletores';
import { primeiroLeadEm } from '@/lib/db/metricas';
import { FiltrosEventos } from '@/components/filtros-eventos';
import { TabelaEventos } from '@/components/tabela-eventos';

/**
 * Tela "Últimos eventos" — porte de `GET /painel-api/eventos-recentes`.
 *
 * Uma implementação só, usada pelas duas rotas (Formulários e WhatsApp):
 * a única diferença entre elas é o canal, que já é o parâmetro que decide
 * o recorte da consulta. Duplicar a tela para trocar uma constante seria
 * garantir que as duas divergissem na primeira correção.
 */

const STATUS_VALIDOS = new Set(['PENDING', 'SENT', 'ERROR', 'DUPLICATE']);

const ROTULOS_STATUS: Record<string, string> = {
  SENT: 'Enviado',
  ERROR: 'Erro',
  PENDING: 'Pendente',
  DUPLICATE: 'Duplicado',
};

function total(contagens: ContagemStatus[] | null, status: string): number | undefined {
  if (!contagens) return undefined;
  return contagens.find((c) => c.status === status)?.total ?? 0;
}

/**
 * Percentual de sucesso entre as TENTATIVAS de envio.
 *
 * `PENDING` e `DUPLICATE` ficam de fora do denominador: um evento
 * pendente ainda não falhou, e um duplicado nem chegou a ser enviado.
 * Contá-los puxaria a taxa para baixo sem que nada tenha dado errado.
 * `null` quando não houve tentativa nenhuma — aí não há taxa, e não zero.
 */
function taxaSucesso(contagens: ContagemStatus[] | null): number | null {
  if (!contagens) return null;
  const enviados = total(contagens, 'SENT') ?? 0;
  const erros = total(contagens, 'ERROR') ?? 0;
  const tentativas = enviados + erros;
  if (!tentativas) return null;
  return Math.round((enviados / tentativas) * 1000) / 10;
}

export async function TelaEventos({
  cliente,
  canal,
  busca,
}: {
  cliente: string;
  canal: Canal;
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
    channel: canal,
  });

  // Status fora da whitelist é descartado, não repassado ao SQL: viraria
  // um filtro que nunca casa e uma tabela vazia sem explicação.
  const statusBruto = String(um('status') ?? '').toUpperCase();
  const status = STATUS_VALIDOS.has(statusBruto) ? statusBruto : null;
  const termo = String(um('search') ?? '').trim().slice(0, 120) || null;

  const [painel, minimo] = await Promise.all([
    buscaPainelEventos(db, periodo, { status, search: termo }),
    primeiroLeadEm(db),
  ]);

  const enviados = total(painel.por_status, 'SENT') ?? 0;
  const erros = total(painel.por_status, 'ERROR') ?? 0;
  const pendentes = total(painel.por_status, 'PENDING') ?? 0;
  const taxa = taxaSucesso(painel.por_status);
  const taxaAnterior = taxaSucesso(painel.por_status_anterior);

  // Período, canal e filtros acompanham a paginação da tabela.
  const qs = new URLSearchParams({ channel: periodo.canal });
  for (const chave of ['range', 'date_from', 'date_to'] as const) {
    const v = um(chave);
    if (v) qs.set(chave, v);
  }
  if (status) qs.set('status', status);
  if (termo) qs.set('search', termo);

  const barras = painel.por_status
    .slice()
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ rotulo: ROTULOS_STATUS[c.status] ?? c.status, valor: c.total }));

  const filtrado = Boolean(status || termo);

  return (
    <>
      <PageHero
        titulo="Últimos Eventos Enviados"
        descricao="Histórico de eventos enviados à Meta CAPI para este cliente."
        acoes={<SeletorPeriodo minimo={minimo} />}
      />

      {painel.lacunas_de_esquema.length ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O banco deste cliente está atrás do template. Falta:{' '}
          <strong>{painel.lacunas_de_esquema.join(', ')}</strong>. O que depende disso aparece
          como zero, e zero aqui é falta de migração, não falta de resultado.
        </p>
      ) : null}

      <p className="mb-4 text-body-small text-tertiary">
        {rotuloPeriodo(periodo)}
        {painel.por_status_anterior
          ? ' · variações comparadas ao período anterior de mesma duração'
          : null}
      </p>

      <div className="kpi-grid">
        <KpiCard
          rotulo="Eventos enviados"
          valor={fmtInt(enviados)}
          dica="Eventos aceitos pela API de Conversões da Meta no período."
          icone={Icones.check}
          tom="verde"
          atual={enviados}
          anterior={total(painel.por_status_anterior, 'SENT')}
        />
        <KpiCard
          rotulo="Eventos com erro"
          valor={fmtInt(erros)}
          dica="Eventos que a Meta recusou. O motivo aparece na coluna Erro da tabela."
          icone={Icones.info}
          tom="vermelho"
          atual={erros}
          anterior={total(painel.por_status_anterior, 'ERROR')}
          melhorQuandoCai
        />
        <KpiCard
          rotulo="Pendentes"
          valor={fmtInt(pendentes)}
          dica="Eventos registrados que ainda não foram enviados à Meta."
          icone={Icones.clock}
          tom="ambar"
          atual={pendentes}
          anterior={total(painel.por_status_anterior, 'PENDING')}
          melhorQuandoCai
        />
        <KpiCard
          rotulo="Taxa de sucesso"
          valor={taxa === null ? '-' : `${fmtDec(taxa, 1)}%`}
          dica="Enviados dividido por enviados + com erro. Pendentes e duplicados ficam de fora: nenhum dos dois chegou a ser uma tentativa de envio."
          icone={Icones.percent}
          tom="verde"
          atual={taxa}
          anterior={taxaAnterior}
        />
      </div>

      <Card titulo="Eventos por status" className="mt-4">
        {barras.length ? <BarrasHorizontais itens={barras} /> : <Vazio />}
      </Card>

      <Card
        titulo="Últimos eventos"
        className="mt-4"
        acessorio={
          // `useSearchParams` obriga a fronteira de Suspense no Next 15.
          <Suspense fallback={null}>
            <FiltrosEventos />
          </Suspense>
        }
      >
        {painel.eventos.length ? (
          // `key` amarrada ao filtro de propósito: a tabela guarda a
          // lista em estado de cliente, e React ignora o valor inicial de
          // `useState` quando só re-renderiza. Sem trocar a chave, mudar
          // status, busca ou período trazia a lista nova do servidor e a
          // tela continuava mostrando a antiga.
          <TabelaEventos
            key={qs.toString()}
            cliente={conta.client_db_name}
            iniciais={painel.eventos}
            busca={qs.toString()}
          />
        ) : (
          <Vazio>
            {filtrado
              ? 'Nenhum evento bate com o filtro neste período.'
              : 'Nenhum evento registrado no período.'}
          </Vazio>
        )}
      </Card>

      {filtrado ? (
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">
          Os cards e o gráfico acima cobrem o período inteiro e não seguem o filtro de status
          nem a busca: só a tabela segue.
        </p>
      ) : null}
    </>
  );
}
