import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { buscaQuadroCrm } from '@/lib/db/crm';
import { ehOrigem, type OrigemLead } from '@/lib/crm';
import { resolvePeriodo, rotuloPeriodo } from '@/lib/periodo';
import { fmtInt } from '@/lib/format';
import { Card, Vazio } from '@/components/dados';
import { PageHero } from '@/components/hero';
import { SeletorPeriodo } from '@/components/seletores';
import { primeiroLeadEm } from '@/lib/db/metricas';
import { FiltrosCrm } from '@/components/filtros-crm';
import { QuadroCrm } from '@/components/quadro-crm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'CRM — Trakeamento' };

/**
 * Tela "CRM" — um quadro só, com lead de formulário e contato de
 * WhatsApp lado a lado.
 *
 * Canal 'geral' de propósito: separar por canal aqui desfaria o motivo
 * da tela existir, que é ver o mesmo contato venha ele de onde vier. O
 * que distingue um do outro é a etiqueta de origem no card e a coluna em
 * que ele cai — cada funil mantém as suas.
 */
export default async function PaginaCrm({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;

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

  // Origem fora da whitelist é descartada, não repassada: viraria um
  // quadro vazio sem explicação.
  const origemBruta = um('origem');
  const origem: OrigemLead | null = ehOrigem(origemBruta) ? origemBruta : null;
  const termo = String(um('search') ?? '').trim().slice(0, 120) || null;

  // `?lead=` abre o quadro já com o contato aberto — é o link que a tela
  // de Conversas usa. Valor inválido é ignorado, não repassado.
  const leadPedido = Number.parseInt(String(um('lead') ?? ''), 10);
  const leadInicial =
    Number.isSafeInteger(leadPedido) && leadPedido > 0 ? leadPedido : null;

  const [quadro, minimo] = await Promise.all([
    buscaQuadroCrm(db, periodo, { origem, busca: termo }),
    primeiroLeadEm(db),
  ]);

  const filtrado = Boolean(origem || termo);

  return (
    <>
      <PageHero
        titulo="CRM"
        descricao="Leads de formulário e contatos de WhatsApp no mesmo quadro, cada card marcado com a origem."
        acoes={<SeletorPeriodo minimo={minimo} />}
      />

      {quadro.lacunas_de_esquema.length ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O banco deste cliente está atrás do template — falta:{' '}
          <strong>{quadro.lacunas_de_esquema.join(', ')}</strong>. Sem isso os contatos de
          WhatsApp não entram no quadro; é falta de migração, não falta de contato.
        </p>
      ) : null}

      <p className="mb-4 text-body-small text-tertiary">
        {rotuloPeriodo(periodo)} · {fmtInt(quadro.total)}{' '}
        {quadro.total === 1 ? 'contato' : 'contatos'}
      </p>

      <Card
        titulo="Funil"
        descricao="Clique no card para abrir o contato. Arraste para mudar a etapa — só vale para contato de WhatsApp."
        acessorio={
          // `useSearchParams` obriga a fronteira de Suspense no Next 15.
          <Suspense fallback={null}>
            <FiltrosCrm />
          </Suspense>
        }
      >
        {quadro.tem_etapas || quadro.total > 0 ? (
          <QuadroCrm
            cliente={conta.client_db_name}
            colunas={quadro.colunas}
            cartoes={quadro.cartoes}
            leadInicial={leadInicial}
          />
        ) : (
          <Vazio>
            Nenhuma etapa cadastrada para montar o quadro. As colunas saem dos estágios ativos em{' '}
            <code>crm_meta_event_map</code> (Formulários) e <code>whatsapp_event_map</code>{' '}
            (WhatsApp).
          </Vazio>
        )}

        {quadro.tem_etapas && quadro.total === 0 ? (
          <p className="mt-3 border-t pt-3 text-xs text-[var(--text-tertiary)]">
            {filtrado
              ? 'Nenhum contato bate com o filtro neste período.'
              : 'As colunas existem, mas nenhum contato entrou no período selecionado.'}
          </p>
        ) : null}
      </Card>

      <p className="mt-3 text-xs text-[var(--text-tertiary)]">
        A etapa do lead de formulário é espelho do CRM do cliente (Kommo), escrita pela automação
        — por isso o card não arrasta. Mudá-la aqui dessincronizaria o funil e ainda contaria
        conversão que não houve.
      </p>
    </>
  );
}
