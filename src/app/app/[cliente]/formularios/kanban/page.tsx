import type { Metadata } from 'next';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { buscaKanban } from '@/lib/db/kanban';
import { resolvePeriodo, rotuloPeriodo, type Canal } from '@/lib/periodo';
import { fmtInt } from '@/lib/format';
import { Card, Vazio } from '@/components/dados';
import { PageHero } from '@/components/hero';
import { SeletorPeriodo } from '@/components/seletores';
import { primeiroLeadEm } from '@/lib/db/metricas';
import { QuadroKanban } from '@/components/quadro-kanban';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Kanban — Trakeamento' };

/**
 * Aba "CRM · Kanban" — leads do período agrupados pelo estágio atual.
 *
 * Duas diferenças conscientes em relação ao painel antigo:
 *
 *  - o canal é `form`. O painel antigo não filtrava por canal aqui
 *    (a aba nasceu antes do WhatsApp), então um lead de WhatsApp entrava
 *    num board montado com os estágios do Kommo. Como a tela vive na
 *    seção "Formulários", o recorte segue a seção. A diferença já é
 *    visível: em `cliente_anrg_energia_solar_33633175`, período "max", o
 *    painel antigo conta 177 leads e abre uma coluna extra
 *    "whatsapp_contact" com 1 card; aqui são 176 e a coluna não existe.
 *    Todas as outras colunas batem card a card;
 *  - o período usa o seletor único do cabeçalho, com o mesmo padrão do
 *    resto do app (7 dias). No painel antigo esta aba tinha seletor
 *    próprio, com padrão "todo o período".
 */
export default async function PaginaKanban({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;

  const { db } = await requireClientAccessPagina(decodeURIComponent(cliente));

  const um = (chave: string) => {
    const v = busca[chave];
    return Array.isArray(v) ? v[0] : v;
  };
  const periodo = resolvePeriodo({
    range: um('range'),
    date_from: um('date_from'),
    date_to: um('date_to'),
    channel: 'form' satisfies Canal,
  });

  const [kanban, minimo] = await Promise.all([buscaKanban(db, periodo), primeiroLeadEm(db)]);
  const temLead = kanban.total > 0;

  return (
    <>
      <PageHero
        titulo="CRM · Kanban"
        descricao="Estágio atual de cada lead, com base no último evento enviado à Meta."
        acoes={<SeletorPeriodo minimo={minimo} />}
      />

      {kanban.lacunas_de_esquema.length ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O banco deste cliente está atrás do template — falta:{' '}
          <strong>{kanban.lacunas_de_esquema.join(', ')}</strong>. O board depende dessas tabelas e
          por isso aparece vazio; não é falta de lead, é falta de migração.
        </p>
      ) : null}

      <p className="mb-4 text-body-small text-tertiary">
        {rotuloPeriodo(periodo)} · {fmtInt(kanban.total)}{' '}
        {kanban.total === 1 ? 'lead' : 'leads'} de formulário
      </p>

      <Card>
        {kanban.tem_estagios || temLead ? (
          <QuadroKanban colunas={kanban.colunas} />
        ) : (
          <Vazio>
            Nenhum estágio configurado ainda para montar o Kanban. As colunas saem dos estágios
            ativos em <code>crm_meta_event_map</code> — cadastre os estágios do CRM deste cliente.
          </Vazio>
        )}

        {kanban.tem_estagios && !temLead ? (
          <p className="mt-3 border-t pt-3 text-xs text-[var(--text-tertiary)]">
            As colunas existem, mas nenhum lead de formulário foi gerado no período selecionado.
          </p>
        ) : null}
      </Card>
    </>
  );
}
