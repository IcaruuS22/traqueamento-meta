import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avaliaOrcamento,
  diasDoMes,
  fraseOrcamento,
  rotuloDoMes,
  ultimoDiaConsiderado,
} from '../src/lib/orcamento';

/** Abril de 2026 tem 30 dias; hoje é dia 10, um terço do mês decorrido. */
const MES = '2026-04';
const HOJE = '2026-04-10';

test('gastando exatamente no ritmo, a recomendação é manter', () => {
  // 3000 de fee em 30 dias = 100 por dia; 10 dias = 1000 gastos.
  const o = avaliaOrcamento({ fee: 3000, gasto: 1000, mes: MES, hoje: HOJE });
  assert.equal(o.recomendacao, 'manter');
  assert.equal(Math.round(o.projecao), 3000);
  assert.equal(o.diasRestantes, 21);
});

test('gastando devagar, manda aumentar — e diz quanto', () => {
  // 500 em 10 dias = 50/dia. Faltam 2500 em 21 dias = 119,05/dia.
  const o = avaliaOrcamento({ fee: 3000, gasto: 500, mes: MES, hoje: HOJE });
  assert.equal(o.recomendacao, 'aumentar');
  assert.ok(o.ajuste > 1.3 && o.ajuste < 1.5, `ajuste inesperado: ${o.ajuste}`);
  assert.equal(Math.round(o.diarioIdeal), 119);
  assert.equal(Math.round(o.projecao), 1500);
});

test('gastando rápido demais, manda reduzir', () => {
  const o = avaliaOrcamento({ fee: 3000, gasto: 2000, mes: MES, hoje: HOJE });
  assert.equal(o.recomendacao, 'reduzir');
  assert.ok(o.ajuste < 0);
  assert.equal(Math.round(o.projecao), 6000);
});

test('fee já consumido é estouro, não questão de ritmo', () => {
  const o = avaliaOrcamento({ fee: 3000, gasto: 3200, mes: MES, hoje: HOJE });
  assert.equal(o.recomendacao, 'estourado');
  assert.equal(o.restante, 0);
  assert.equal(o.consumo > 1, true);
});

test('sem fee, ou sem gasto no mês, não há o que recomendar', () => {
  assert.equal(
    avaliaOrcamento({ fee: null, gasto: 900, mes: MES, hoje: HOJE }).recomendacao,
    'indefinido',
  );
  assert.equal(
    avaliaOrcamento({ fee: 3000, gasto: 0, mes: MES, hoje: HOJE }).recomendacao,
    'indefinido',
  );
});

test('sem gasto o ajuste é zero — nada de dividir por zero', () => {
  const o = avaliaOrcamento({ fee: 3000, gasto: 0, mes: MES, hoje: HOJE });
  assert.equal(o.ajuste, 0);
  assert.ok(Number.isFinite(o.diarioAtual));
});

test('o primeiro dia do mês conta como decorrido', () => {
  const o = avaliaOrcamento({ fee: 3000, gasto: 100, mes: MES, hoje: '2026-04-01' });
  assert.equal(o.diasDecorridos, 1);
  assert.equal(o.diasRestantes, 30);
});

test('mês já encerrado é histórico: sem recomendação de ajuste', () => {
  // Olhando março em abril: o mês inteiro conta, e não há ritmo a corrigir.
  const o = avaliaOrcamento({ fee: 3000, gasto: 2400, mes: '2026-03', hoje: HOJE });
  assert.equal(o.recomendacao, 'fechado');
  assert.equal(o.fechado, true);
  assert.equal(o.diasDecorridos, 31);
  assert.equal(o.diasRestantes, 0);
  assert.equal(o.ajuste, 0);
  // A projeção de um mês fechado é o próprio gasto, não uma extrapolação.
  assert.equal(o.projecao, 2400);
});

test('mês encerrado acima do fee ainda é "fechado", não "estourado"', () => {
  const o = avaliaOrcamento({ fee: 3000, gasto: 4000, mes: '2026-03', hoje: HOJE });
  assert.equal(o.recomendacao, 'fechado');
  assert.match(fraseOrcamento(o), /acima do fee/);
});

test('mês futuro não recebe opinião', () => {
  const o = avaliaOrcamento({ fee: 3000, gasto: 0, mes: '2026-05', hoje: HOJE });
  assert.equal(o.recomendacao, 'indefinido');
  assert.equal(o.diasDecorridos, 0);
  assert.equal(o.diarioAtual, 0);
});

test('a soma do mês corrente para hoje; a do mês fechado vai até o fim', () => {
  assert.equal(ultimoDiaConsiderado('2026-04', HOJE), '2026-04-10');
  assert.equal(ultimoDiaConsiderado('2026-03', HOJE), '2026-03-31');
  assert.equal(ultimoDiaConsiderado('2026-02', HOJE), '2026-02-28');
});

test('o número de dias vem do mês de verdade, fevereiro incluso', () => {
  assert.equal(diasDoMes('2026-02'), 28);
  assert.equal(diasDoMes('2028-02'), 29);
  assert.equal(diasDoMes('2026-04'), 30);
  assert.equal(diasDoMes('2026-12'), 31);
});

test('o rótulo do mês sai por extenso', () => {
  assert.equal(rotuloDoMes('2026-08'), 'agosto de 2026');
  assert.equal(rotuloDoMes('2026-03'), 'março de 2026');
});

test('a frase fala em reais por dia, não em percentual', () => {
  const subir = avaliaOrcamento({ fee: 3000, gasto: 500, mes: MES, hoje: HOJE });
  const frase = fraseOrcamento(subir);
  assert.match(frase, /^Suba a diária/);
  assert.doesNotMatch(frase, /%/);

  const semFee = avaliaOrcamento({ fee: 0, gasto: 0, mes: MES, hoje: HOJE });
  assert.match(fraseOrcamento(semFee), /Cadastre o fee mensal/);
});
