import { Suspense } from 'react';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { buscaQuadroCrm } from '@/lib/db/crm';
import type { OrigemLead } from '@/lib/crm';
import { resolvePeriodo, rotuloPeriodo } from '@/lib/periodo';
import { fmtInt } from '@/lib/format';
import { Card, Vazio } from '@/components/dados';
import { PageHero } from '@/components/hero';
import { SeletorPeriodo } from '@/components/seletores';
import { primeiroLeadEm } from '@/lib/db/metricas';
import { FiltrosCrm } from '@/components/filtros-crm';
import { QuadroCrm } from '@/components/quadro-crm';

/**
 * O quadro do CRM, montado para uma origem só.
 *
 * São duas telas — uma em Formulários, outra em WhatsApp — porque são
 * dois funis de verdade: as etapas do formulário são espelho do Kommo e
 * o card não arrasta, as do WhatsApp são do painel e arrastam. Juntar as
 * duas no mesmo quadro colocava lado a lado colunas que não se falam, e
 * quem arrastava um card de formulário descobria a regra só ao errar.
 *
 * O corpo é um só porque a diferença entre as duas telas é a origem
 * fixada e o texto; a montagem das colunas, o filtro de período, a busca
 * e o modal do lead são idênticos. `montaQuadro` já sabia filtrar por
 * origem — o que mudou foi de onde vem esse valor: antes de um `?origem=`
 * que a pessoa escolhia, agora da rota.
 */

type Textos = {
  titulo: string;
  descricao: string;
  arrastar: string;
  tabelaDeEtapas: string;
  rodape: string | null;
};

const TEXTO: Record<OrigemLead, Textos> = {
  form: {
    titulo: 'CRM — Formulários',
    descricao: 'Leads que chegaram por Formulário Instantâneo, na etapa em que o funil do Kommo os deixou.',
    arrastar: 'Clique no card para abrir o contato. A etapa vem do Kommo, então o card não arrasta.',
    tabelaDeEtapas: 'crm_meta_event_map',
    rodape:
      'A etapa do lead de formulário é espelho do CRM do cliente (Kommo), escrita pela automação — por isso o card não arrasta. Mudá-la aqui dessincronizaria o funil e ainda contaria conversão que não houve.',
  },
  whatsapp: {
    titulo: 'CRM — WhatsApp',
    descricao: 'Contatos que chegaram por conversa de WhatsApp, na etapa do funil do painel.',
    arrastar: 'Clique no card para abrir o contato. Arraste o card para mudar a etapa.',
    tabelaDeEtapas: 'whatsapp_event_map',
    rodape:
      'Mudar a etapa aqui dispara o evento de conversão cadastrado para ela em Configuração de Eventos.',
  },
};

export async function TelaCrm({
  cliente,
  origem,
  searchParams,
}: {
  cliente: string;
  origem: OrigemLead;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { usuario, conta, db } = await requireClientAccessPagina(decodeURIComponent(cliente));
  const texto = TEXTO[origem];

  const um = (chave: string) => {
    const v = searchParams[chave];
    return Array.isArray(v) ? v[0] : v;
  };
  const periodo = resolvePeriodo({
    range: um('range'),
    date_from: um('date_from'),
    date_to: um('date_to'),
    channel: 'geral',
  });

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

  return (
    <>
      <PageHero
        titulo={texto.titulo}
        descricao={texto.descricao}
        acoes={<SeletorPeriodo minimo={minimo} />}
      />

      {quadro.lacunas_de_esquema.length ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O banco deste cliente está atrás do template — falta:{' '}
          <strong>{quadro.lacunas_de_esquema.join(', ')}</strong>. Sem isso parte dos contatos
          não entra no quadro; é falta de migração, não falta de contato.
        </p>
      ) : null}

      <p className="mb-4 text-body-small text-tertiary">
        {rotuloPeriodo(periodo)} · {fmtInt(quadro.total)}{' '}
        {quadro.total === 1 ? 'contato' : 'contatos'}
      </p>

      <Card
        titulo="Funil"
        descricao={texto.arrastar}
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
            podeExcluir={usuario.papel === 'admin'}
          />
        ) : (
          <Vazio>
            Nenhuma etapa cadastrada para montar o quadro. As colunas saem dos estágios ativos em{' '}
            <code>{texto.tabelaDeEtapas}</code>.
          </Vazio>
        )}

        {quadro.tem_etapas && quadro.total === 0 ? (
          <p className="mt-3 border-t pt-3 text-xs text-[var(--text-tertiary)]">
            {termo
              ? 'Nenhum contato bate com a busca neste período.'
              : 'As colunas existem, mas nenhum contato entrou no período selecionado.'}
          </p>
        ) : null}
      </Card>

      {texto.rodape ? (
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">{texto.rodape}</p>
      ) : null}
    </>
  );
}
