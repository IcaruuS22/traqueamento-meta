import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  avisoDistribuicao,
  montaOrcamentoPorCategoria,
  NOME_SEM_CATEGORIA,
  type CategoriaVerba,
  type GastoCategoria,
} from '../src/lib/orcamento-categorias';

/**
 * Testes da quebra do orçamento por categoria.
 *
 * O risco aqui não é o cálculo de ritmo — esse é do `avaliaOrcamento`, já
 * testado. É a distribuição: verba somando errado, gasto de campanha não
 * classificada sumindo da conta, categoria sem verba ganhando barra de
 * consumo cheia. Todos são erros que a tela desenha sem reclamar.
 */

const cat = (id: number, nome: string, verba: number | null, ordem = 0): CategoriaVerba => ({
  id,
  nome,
  verba,
  ordem,
});

const gasto = (total: number, ateOntem = total): GastoCategoria => ({ total, ateOntem });

/** Meio de um mês de 30 dias: dia 15, 14 dias inteiros para trás. */
const MES = '2026-04';
const HOJE = '2026-04-15';

function monta(
  categorias: CategoriaVerba[],
  gastos: Array<[number | null, GastoCategoria]>,
  investimento: number | null = 4000,
) {
  return montaOrcamentoPorCategoria({
    categorias,
    gastos: new Map(gastos),
    investimento,
    mes: MES,
    hoje: HOJE,
  });
}

describe('montaOrcamentoPorCategoria', () => {
  test('uma linha por categoria cadastrada, na ordem definida', () => {
    const r = monta(
      [cat(1, 'Remarketing', 1000, 2), cat(2, 'Captação', 3000, 1)],
      [
        [1, gasto(200)],
        [2, gasto(900)],
      ],
    );
    assert.deepEqual(
      r.linhas.map((l) => l.nome),
      ['Captação', 'Remarketing'],
    );
  });

  test('empate na ordem é desempatado pelo nome', () => {
    const r = monta([cat(1, 'Zebra', 100, 5), cat(2, 'Abacate', 100, 5)], []);
    assert.deepEqual(
      r.linhas.map((l) => l.nome),
      ['Abacate', 'Zebra'],
    );
  });

  test('categoria cadastrada sem gasto continua na lista', () => {
    // Verba parada é justamente o que precisa aparecer: some da tela e
    // ninguém descobre que a frente nunca subiu.
    const r = monta([cat(1, 'Institucional', 500)], []);
    assert.equal(r.linhas.length, 1);
    assert.equal(r.linhas[0].orcamento.gasto, 0);
  });

  test('gasto sem categoria vira uma linha própria, sempre por último', () => {
    const r = monta(
      [cat(1, 'Captação', 3000)],
      [
        [1, gasto(900)],
        [null, gasto(120)],
      ],
    );
    const ultima = r.linhas[r.linhas.length - 1];
    assert.equal(ultima.id, null);
    assert.equal(ultima.nome, NOME_SEM_CATEGORIA);
    assert.equal(r.gastoSemCategoria, 120);
  });

  test('sem gasto não classificado, a linha "Sem categoria" não aparece', () => {
    const r = monta([cat(1, 'Captação', 3000)], [[1, gasto(900)]]);
    assert.ok(r.linhas.every((l) => l.id !== null));
    assert.equal(r.gastoSemCategoria, 0);
  });

  test('a linha "Sem categoria" nunca recebe verba', () => {
    // Não é frente de investimento, é classificação pendente. Dar teto a
    // ela seria inventar um combinado que ninguém fez.
    const r = monta([], [[null, gasto(300)]]);
    assert.equal(r.linhas[0].semVerba, true);
    assert.equal(r.linhas[0].orcamento.investimento, 0);
  });

  test('categoria sem verba é marcada, para a tela não desenhar barra', () => {
    const r = monta([cat(1, 'Testes', null)], [[1, gasto(80)]]);
    assert.equal(r.linhas[0].semVerba, true);
  });

  test('verba zero conta como sem verba', () => {
    const r = monta([cat(1, 'Testes', 0)], [[1, gasto(80)]]);
    assert.equal(r.linhas[0].semVerba, true);
    assert.equal(r.verbaDistribuida, 0);
  });

  test('a fatia do gasto é sobre o gasto total, incluindo o não classificado', () => {
    const r = monta(
      [cat(1, 'A', 1000), cat(2, 'B', 1000)],
      [
        [1, gasto(500)],
        [2, gasto(300)],
        [null, gasto(200)],
      ],
    );
    assert.equal(r.gasto, 1000);
    assert.equal(r.linhas[0].fatiaDoGasto, 0.5);
    assert.equal(r.linhas[1].fatiaDoGasto, 0.3);
    assert.equal(r.linhas[2].fatiaDoGasto, 0.2);
  });

  test('gasto zero no mês não divide por zero', () => {
    const r = monta([cat(1, 'A', 1000)], []);
    assert.equal(r.gasto, 0);
    assert.equal(r.linhas[0].fatiaDoGasto, 0);
  });

  test('a verba distribuída soma só as categorias com verba', () => {
    const r = monta([cat(1, 'A', 1000), cat(2, 'B', null), cat(3, 'C', 500)], []);
    assert.equal(r.verbaDistribuida, 1500);
    assert.equal(r.diferenca, 2500);
  });

  test('categorias somando mais que o investimento dão diferença negativa', () => {
    const r = monta([cat(1, 'A', 3000), cat(2, 'B', 2000)], [], 4000);
    assert.equal(r.diferenca, -1000);
  });

  test('sem investimento cadastrado não há diferença a apontar', () => {
    const r = monta([cat(1, 'A', 1000)], [], null);
    assert.equal(r.investimento, 0);
    assert.equal(r.diferenca, 0);
  });

  test('cada categoria é avaliada pela própria verba, não pelo total', () => {
    // Metade do mês, metade da verba gasta: no alvo. Se a avaliação
    // usasse o investimento total, os mesmos R$ 500 pareceriam folga.
    const r = monta([cat(1, 'A', 1000)], [[1, gasto(500, 466.67)]], 4000);
    assert.equal(r.linhas[0].orcamento.investimento, 1000);
    assert.equal(r.linhas[0].orcamento.consumo, 0.5);
  });

  test('temCategorias distingue "nada cadastrado" de "nada gasto"', () => {
    assert.equal(monta([], []).temCategorias, false);
    assert.equal(monta([cat(1, 'A', 100)], []).temCategorias, true);
  });
});

describe('avisoDistribuicao', () => {
  test('silencia quando a soma bate com o investimento', () => {
    const r = monta([cat(1, 'A', 3000), cat(2, 'B', 1000)], [], 4000);
    assert.equal(avisoDistribuicao(r), null);
  });

  test('tolera diferença menor que um real', () => {
    // "1.333,33" três vezes não fecha 4000 por um centavo; apontar isso
    // seria ruído.
    const r = monta([cat(1, 'A', 1333.33), cat(2, 'B', 1333.33), cat(3, 'C', 1333.33)], [], 4000);
    assert.equal(avisoDistribuicao(r), null);
  });

  test('avisa quando sobra verba não distribuída', () => {
    const r = monta([cat(1, 'A', 1000)], [], 4000);
    const aviso = avisoDistribuicao(r);
    assert.ok(aviso && aviso.includes('não estão em nenhuma categoria'));
  });

  test('avisa quando as categorias passam do investimento', () => {
    const r = monta([cat(1, 'A', 5000)], [], 4000);
    const aviso = avisoDistribuicao(r);
    assert.ok(aviso && aviso.includes('a mais do que o investimento'));
  });

  test('silencia enquanto nenhuma categoria tem verba', () => {
    // Só categorias de separação, sem teto: não há distribuição a conferir.
    const r = monta([cat(1, 'A', null), cat(2, 'B', null)], [], 4000);
    assert.equal(avisoDistribuicao(r), null);
  });

  test('silencia sem investimento cadastrado', () => {
    const r = monta([cat(1, 'A', 1000)], [], null);
    assert.equal(avisoDistribuicao(r), null);
  });
});
