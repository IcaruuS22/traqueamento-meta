import { requireClientAccess } from '@/lib/auth/guard';
import { primeiroLeadEm } from '@/lib/db/metricas';
import { resolvePeriodo, rotuloPeriodo, type Canal } from '@/lib/periodo';
import { AnaliseIa } from '@/components/analise-ia';
import { PageHero } from '@/components/hero';
import { SeletorPeriodo } from '@/components/seletores';

/**
 * Tela "Análise por IA" — porte de `POST /painel-api/ia-analise`.
 *
 * Uma implementação só para as duas rotas (Formulários e WhatsApp), pelo
 * mesmo motivo de "Últimos eventos": a única diferença é o canal, que já
 * é parâmetro. O painel antigo tinha duas abas com o mesmo código
 * duplicado (`IA_TAB_CHANNEL = { 'ia-form': 'form', 'ia-whatsapp': 'whatsapp' }`).
 *
 * Quem chama a Groq é a Server Action, não esta função: a análise é
 * disparada por botão, e renderizá-la no servidor a cada abertura de
 * página gastaria token toda vez que alguém trocasse de aba.
 */
export async function TelaIa({
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

  const minimo = await primeiroLeadEm(db);

  return (
    <>
      <PageHero
        titulo="Análise por IA"
        descricao="Resumo automático da performance da conta (gasto, leads, conversões, receita e funil), gerado por IA a partir dos mesmos números da aba Métricas Gerais."
        acoes={<SeletorPeriodo minimo={minimo} />}
      />

      <p className="mb-4 text-body-small text-tertiary">
        A IA recebe os mesmos números da tela de métricas — <strong>{rotuloPeriodo(periodo)}</strong>,{' '}
        {canal === 'whatsapp' ? 'canal WhatsApp' : 'canal Formulários'}. Ela não tem acesso a
        mensagens, nomes ou telefones de leads.
      </p>

      <AnaliseIa
        cliente={conta.client_db_name}
        canal={canal}
        range={periodo.range}
        dateFrom={periodo.customFrom}
        dateTo={periodo.customTo}
      />
    </>
  );
}
