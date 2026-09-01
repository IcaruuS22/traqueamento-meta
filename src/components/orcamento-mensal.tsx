import { Card } from '@/components/dados';
import { fmtBRL } from '@/lib/format';
import { fraseOrcamento, type Orcamento, type Recomendacao } from '@/lib/orcamento';

/**
 * Indicador de ritmo de gasto contra o fee mensal do cliente.
 *
 * Server Component sem estado: recebe o orçamento já avaliado por
 * `lib/db/orcamento.ts` e só desenha. O card é sempre do mês corrente,
 * mesmo quando a tela está filtrada por outro período — o fee é mensal, e
 * comparar um teto de mês com o gasto de sete dias não diria nada.
 *
 * Ele recomenda, não age: subir ou descer verba de anúncio é decisão de
 * quem gerencia a conta, e o botão para isso continua sendo o da Meta.
 */

/** Cor da faixa por recomendação. Verde = no alvo, âmbar = ajuste, vermelho = estouro. */
const TONS: Record<Recomendacao, { barra: string; texto: string; rotulo: string }> = {
  aumentar: { barra: 'bg-blue-500', texto: 'text-blue-700', rotulo: 'Aumentar investimento' },
  reduzir: { barra: 'bg-amber-500', texto: 'text-amber-700', rotulo: 'Reduzir investimento' },
  manter: { barra: 'bg-emerald-500', texto: 'text-emerald-700', rotulo: 'No alvo' },
  estourado: { barra: 'bg-red-500', texto: 'text-red-700', rotulo: 'Fee consumido' },
  indefinido: {
    barra: 'bg-[var(--border)]',
    texto: 'text-[var(--text-tertiary)]',
    rotulo: 'Sem parâmetro',
  },
};

export function OrcamentoMensal({ orcamento }: { orcamento: Orcamento }) {
  const tom = TONS[orcamento.recomendacao];
  // A barra passa de 100% quando o mês estourou; travar em 100 esconderia
  // justamente o caso que mais importa ver.
  const largura = Math.min(Math.round(orcamento.consumo * 100), 100);

  return (
    <Card
      titulo="Orçamento do mês"
      descricao={`Gasto em campanhas no mês corrente, contra o fee combinado. Dia ${orcamento.diasDecorridos} de ${orcamento.diasNoMes}.`}
      className="mt-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-medium">
          {fmtBRL(orcamento.gasto)}
          <span className="text-sm font-normal text-[var(--text-tertiary)]">
            {' '}
            de {orcamento.fee > 0 ? fmtBRL(orcamento.fee) : '—'}
          </span>
        </span>
        <span className={`text-sm font-medium ${tom.texto}`}>{tom.rotulo}</span>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--bg-field)]">
        <div className={`h-full ${tom.barra}`} style={{ width: `${largura}%` }} />
      </div>

      <p className={`mt-3 text-sm ${tom.texto}`}>{fraseOrcamento(orcamento)}</p>

      {orcamento.fee > 0 ? (
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-[var(--text-tertiary)] sm:grid-cols-2">
          <div>
            Média diária atual:{' '}
            <span className="text-[var(--text-secondary)]">{fmtBRL(orcamento.diarioAtual)}</span>
          </div>
          <div>
            Diária para fechar no fee:{' '}
            <span className="text-[var(--text-secondary)]">{fmtBRL(orcamento.diarioIdeal)}</span>
          </div>
          <div>
            Projeção de fechamento:{' '}
            <span className="text-[var(--text-secondary)]">{fmtBRL(orcamento.projecao)}</span>
          </div>
          <div>
            Restante do fee:{' '}
            <span className="text-[var(--text-secondary)]">{fmtBRL(orcamento.restante)}</span>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">
          O fee mensal é cadastrado por cliente na área de administração.
        </p>
      )}
    </Card>
  );
}
