import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliaOrcamento, diasDoMes, fraseOrcamento } from '../src/lib/orcamento';

/** Dia 10 de um mês de 30 dias: um terço do mês decorrido. */
const DIA_10_DE_ABRIL = new Date(2026, 3, 10);

test('gastando exatamente no ritmo, a recomendação é manter', () => {
  // 3000 de fee em 30 dias = 100 por dia; 10 dias = 1000 gastos.
  const o = avaliaOrcamento({ fee: 3000, gasto: 1000, referencia: DIA_10_DE_ABRIL });
  assert.equal(o.recomendacao, 'manter');
  assert.equal(Math.round(o.projecao), 3000);
  assert.equal(o.diasRestantes, 21);
});

test('gastando devagar, manda aumentar — e diz quanto', () => {
  // 500 em 10 dias = 50/dia. Faltam 2500 em 21 dias = 119,05/dia.
  const o = avaliaOrcamento({ fee: 3000, gasto: 500, referencia: DIA_10_DE_ABRIL });
  assert.equal(o.recomendacao, 'aumentar');
  assert.ok(o.ajuste > 1.3 && o.ajuste < 1.5, `ajuste inesperado: ${o.ajuste}`);
  assert.equal(Math.round(o.projecao), 1500);
});

test('gastando rápido demais, manda reduzir', () => {
  const o = avaliaOrcamento({ fee: 3000, gasto: 2000, referencia: DIA_10_DE_ABRIL });
  assert.equal(o.recomendacao, 'reduzir');
  assert.ok(o.ajuste < 0);
  assert.equal(Math.round(o.projecao), 6000);
});

test('fee já consumido é estouro, não questão de ritmo', () => {
  const o = avaliaOrcamento({ fee: 3000, gasto: 3200, referencia: DIA_10_DE_ABRIL });
  assert.equal(o.recomendacao, 'estourado');
  assert.equal(o.restante, 0);
  assert.equal(o.consumo > 1, true);
});

test('sem fee, ou sem gasto no mês, não há o que recomendar', () => {
  assert.equal(
    avaliaOrcamento({ fee: null, gasto: 900, referencia: DIA_10_DE_ABRIL }).recomendacao,
    'indefinido',
  );
  assert.equal(
    avaliaOrcamento({ fee: 3000, gasto: 0, referencia: DIA_10_DE_ABRIL }).recomendacao,
    'indefinido',
  );
});

test('sem gasto o ajuste é zero — nada de dividir por zero', () => {
  const o = avaliaOrcamento({ fee: 3000, gasto: 0, referencia: DIA_10_DE_ABRIL });
  assert.equal(o.ajuste, 0);
  assert.ok(Number.isFinite(o.diarioAtual));
});

test('o primeiro dia do mês conta como decorrido', () => {
  const o = avaliaOrcamento({ fee: 3000, gasto: 100, referencia: new Date(2026, 3, 1) });
  assert.equal(o.diasDecorridos, 1);
  assert.equal(o.diasRestantes, 30);
});

test('o número de dias vem do mês de verdade, fevereiro incluso', () => {
  assert.equal(diasDoMes(new Date(2026, 1, 5)), 28);
  assert.equal(diasDoMes(new Date(2028, 1, 5)), 29);
  assert.equal(diasDoMes(new Date(2026, 3, 5)), 30);
});

test('a frase acompanha a recomendação', () => {
  const subir = avaliaOrcamento({ fee: 3000, gasto: 500, referencia: DIA_10_DE_ABRIL });
  assert.match(fraseOrcamento(subir), /^Aumente o orçamento diário/);
  const semFee = avaliaOrcamento({ fee: 0, gasto: 0, referencia: DIA_10_DE_ABRIL });
  assert.match(fraseOrcamento(semFee), /Cadastre o fee mensal/);
});
