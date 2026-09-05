import { Card, Vazio } from '@/components/dados';
import { fmtBRL } from '@/lib/format';
import { fraseOrcamento, type Orcamento, type Recomendacao } from '@/lib/orcamento';
import { avisoDistribuicao, type OrcamentoPorCategoria } from '@/lib/orcamento-categorias';

/**
 * Indicador de ritmo de gasto contra o investimento mensal do cliente.
 *
 * Server Component sem estado: recebe o orçamento já avaliado por
 * `lib/db/orcamento.ts` e só desenha. O mês é o do período escolhido na
 * tela, não o corrente — quem filtra agosto quer ver agosto — mas a
 * comparação continua sendo de mês inteiro contra mês inteiro: confrontar
 * um teto mensal com o gasto de sete dias não diria nada.
 *
 * Ele recomenda, não age: subir ou descer verba de anúncio é decisão de
 * quem gerencia a conta, e o botão para isso continua sendo o da Meta.
 *
 * O percentual ao lado do rótulo é de consumo do investimento, não de ajuste. Vem
 * escrito "% do investimento" porque "Aumentar · 4%" se lia como uma ordem de
 * subir 4%, enquanto a frase logo abaixo pedia quase o dobro da diária.
 */

/** Cor da faixa por recomendação. Verde = no alvo, âmbar = ajuste, vermelho = estouro. */
const TONS: Record<Recomendacao, { barra: string; texto: string; rotulo: string }> = {
  aumentar: { barra: 'bg-blue-500', texto: 'text-blue-500', rotulo: 'Aumentar' },
  reduzir: { barra: 'bg-amber-500', texto: 'text-amber-500', rotulo: 'Reduzir' },
  manter: { barra: 'bg-emerald-500', texto: 'text-emerald-500', rotulo: 'No alvo' },
  estourado: { barra: 'bg-red-500', texto: 'text-red-500', rotulo: 'Estourado' },
  fechado: {
    barra: 'bg-[var(--text-tertiary)]',
    texto: 'text-[var(--text-tertiary)]',
    rotulo: 'Mês fechado',
  },
  indefinido: {
    barra: 'bg-[var(--border)]',
    texto: 'text-[var(--text-tertiary)]',
    rotulo: 'Sem parâmetro',
  },
};

export function OrcamentoMensal({ orcamento }: { orcamento: Orcamento }) {
  const tom = TONS[orcamento.recomendacao];
  // A barra trava em 100% porque acima disso ela não distingue mais nada;
  // o quanto passou está dito em reais na frase.
  const largura = Math.min(Math.round(orcamento.consumo * 100), 100);
  const pct = Math.round(orcamento.consumo * 100);

  return (
    <Card
      titulo={`Orçamento de ${orcamento.mesRotulo}`}
      descricao={
        orcamento.fechado
          ? 'Gasto em campanhas no mês, contra o investimento combinado.'
          : `Gasto do mês inteiro contra o investimento combinado, não o do período da tela. Dia ${orcamento.diasDecorridos} de ${orcamento.diasNoMes}.`
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-lg font-medium tabular-nums">
          {fmtBRL(orcamento.gasto)}
          <span className="text-sm font-normal text-[var(--text-tertiary)]">
            {' '}
            de {orcamento.investimento > 0 ? fmtBRL(orcamento.investimento) : '-'}
          </span>
        </span>
        <span className={`text-xs font-medium ${tom.texto}`}>
          {tom.rotulo}
          {orcamento.investimento > 0 ? ` · ${pct}% do investimento` : ''}
        </span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-field)]">
        <div className={`h-full ${tom.barra}`} style={{ width: `${largura}%` }} />
      </div>

      <p className="mt-2 text-xs text-[var(--text-secondary)]">{fraseOrcamento(orcamento)}</p>

      {orcamento.investimento > 0 ? (
        <p className="mt-2 text-xs text-[var(--text-tertiary)] tabular-nums">
          Diária dos dias fechados {fmtBRL(orcamento.diarioAtual)}
          {orcamento.fechado ? null : (
            <> · Projeção {fmtBRL(orcamento.projecao)} · Restam {fmtBRL(orcamento.restante)}</>
          )}
        </p>
      ) : (
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          O investimento mensal é cadastrado por cliente na área de administração.
        </p>
      )}
    </Card>
  );
}

/**
 * Quebra da verba do mês por categoria de campanha.
 *
 * O card acima diz se o mês vai estourar; este diz por causa de qual
 * frente. São as categorias que o cliente inventou — captação,
 * remarketing, institucional — cada uma com a sua verba e o seu ritmo.
 *
 * Cada linha passou pelo mesmo `avaliaOrcamento` do card geral, então o
 * rótulo colorido significa exatamente a mesma coisa nos dois lugares.
 *
 * Categoria sem verba cadastrada não ganha barra de consumo: mostrar uma
 * barra cheia por dividir por zero diria "estourou" sobre um teto que
 * ninguém combinou. Ela aparece com o gasto e com a fatia que representa
 * do mês, que é a informação que existe.
 */
export function VerbaPorCategoria({
  categorias,
  mesRotulo,
  cliente,
  className,
}: {
  categorias: OrcamentoPorCategoria;
  mesRotulo: string;
  cliente: string;
  className?: string;
}) {
  const aviso = avisoDistribuicao(categorias);
  const gerir = `/app/${encodeURIComponent(cliente)}/campanhas/verba`;

  return (
    <Card
      titulo={`Verba por categoria — ${mesRotulo}`}
      descricao="Quanto cada frente de campanha combinou e quanto já gastou no mês."
      className={className}
      acessorio={
        <a href={gerir} className="btn btn-secondary btn-sm">
          Gerenciar categorias
        </a>
      }
    >
      {categorias.linhas.length === 0 ? (
        <Vazio>
          {categorias.temCategorias
            ? 'Nenhum gasto no mês para dividir entre as categorias.'
            : 'Nenhuma categoria de verba cadastrada. Crie as suas frentes de campanha e separe a verba entre elas.'}
        </Vazio>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {categorias.linhas.map((linha) => {
              const o = linha.orcamento;
              const tom = TONS[o.recomendacao];
              const largura = Math.min(Math.round(o.consumo * 100), 100);

              return (
                <li key={linha.id ?? 'sem-categoria'}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span
                      className={`text-sm font-medium ${
                        linha.id === null ? 'text-[var(--text-tertiary)]' : ''
                      }`}
                    >
                      {linha.nome}
                    </span>
                    <span className="text-sm tabular-nums">
                      {fmtBRL(o.gasto)}
                      <span className="text-xs text-[var(--text-tertiary)]">
                        {linha.semVerba
                          ? ` · ${Math.round(linha.fatiaDoGasto * 100)}% do gasto do mês`
                          : ` de ${fmtBRL(o.investimento)}`}
                      </span>
                    </span>
                  </div>

                  {linha.semVerba ? null : (
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-field)]">
                      <div className={`h-full ${tom.barra}`} style={{ width: `${largura}%` }} />
                    </div>
                  )}

                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    {linha.semVerba ? (
                      linha.id === null ? (
                        // Não é uma frente de investimento: é classificação
                        // pendente. Dizer "sem verba" aqui sugeriria cadastrar
                        // uma, quando o que falta é marcar as campanhas.
                        'Campanhas ainda não atribuídas a nenhuma categoria.'
                      ) : (
                        'Sem verba própria cadastrada.'
                      )
                    ) : (
                      <>
                        <span className={tom.texto}>{tom.rotulo}</span> · {fraseOrcamento(o)}
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>

          {aviso ? (
            <p className="mt-3 border-t pt-3 text-xs text-amber-600">
              {aviso} A soma das categorias não precisa bater com o investimento mensal, mas quando
              não bate o card geral e estas barras contam histórias diferentes.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
