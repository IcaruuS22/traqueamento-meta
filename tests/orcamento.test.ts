import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avaliaOrcamento,
  diasDoMes,
  fraseOrcamento,
  rotuloDoMes,
  ultimoDiaConsiderado,
} from '../src/lib/orcamento';

/** Abril de 2026 tem 30 dias; hoje é dia 10, nove dias inteiros atrás. */
const MES = '2026-04';
const HOJE = '2026-04-10';

test('gastando exatamente no ritmo, a recomendação é manter', () => {
  // 3000 de fee em 30 dias = 100 por dia. Nove dias fechados a 100 = 900,
  // mais 60 gastos hoje até agora.
  const o = avaliaOrcamento({
    fee: 3000,
    gasto: 960,
    gastoAteOntem: 900,
    mes: MES,
    hoje: HOJE,
  });
  assert.equal(o.recomendacao, 'manter');
  assert.equal(o.diarioAtual, 100);
  assert.equal(o.diasCompletos, 9);
  assert.equal(o.diasRestantes, 21);
  // 960 já gastos mais 100 por dia nos 20 dias inteiros que ainda vêm.
  assert.equal(Math.round(o.projecao), 2960);
});

test('gastando devagar, manda aumentar — e diz quanto', () => {
  // 450 em nove dias fechados = 50/dia. Faltam 2550 em 21 dias = 121,43/dia.
  const o = avaliaOrcamento({
    fee: 3000,
    gasto: 450,
    gastoAteOntem: 450,
    mes: MES,
    hoje: HOJE,
  });
  assert.equal(o.recomendacao, 'aumentar');
  assert.ok(o.ajuste > 1.3 && o.ajuste < 1.5, `ajuste inesperado: ${o.ajuste}`);
  assert.equal(Math.round(o.diarioIdeal), 121);
  assert.equal(Math.round(o.projecao), 1450);
});

test('o gasto de hoje conta no total, mas não na média do ritmo', () => {
  // Dia 2 com 130 ontem e 18 hoje: a média é a de ontem, não 74.
  const o = avaliaOrcamento({
    fee: 4000,
    gasto: 148,
    gastoAteOntem: 130,
    mes: MES,
    hoje: '2026-04-02',
  });
  assert.equal(o.diasCompletos, 1);
  assert.equal(o.diarioAtual, 130);
  assert.equal(o.gasto, 148);
  // 3852 restantes em 29 dias = 132,8/dia: quem gastou 130 ontem está no alvo.
  assert.equal(o.recomendacao, 'manter');
});

test('gastando rápido demais, manda reduzir', () => {
  const o = avaliaOrcamento({
    fee: 3000,
    gasto: 1800,
    gastoAteOntem: 1800,
    mes: MES,
    hoje: HOJE,
  });
  assert.equal(o.recomendacao, 'reduzir');
  assert.ok(o.ajuste < 0);
  assert.equal(Math.round(o.projecao), 5800);
});

test('fee já consumido é estouro, não questão de ritmo', () => {
  const o = avaliaOrcamento({
    fee: 3000,
    gasto: 3200,
    gastoAteOntem: 3000,
    mes: MES,
    hoje: HOJE,
  });
  assert.equal(o.recomendacao, 'estourado');
  assert.equal(o.restante, 0);
  assert.equal(o.consumo > 1, true);
});

test('sem fee, ou sem gasto no mês, não há o que recomendar', () => {
  assert.equal(
    avaliaOrcamento({
      fee: null,
      gasto: 900,
      gastoAteOntem: 900,
      mes: MES,
      hoje: HOJE,
    }).recomendacao,
    'indefinido',
  );
  assert.equal(
    avaliaOrcamento({
      fee: 3000,
      gasto: 0,
      gastoAteOntem: 0,
      mes: MES,
      hoje: HOJE,
    }).recomendacao,
    'indefinido',
  );
});

test('sem gasto o ajuste é zero — nada de dividir por zero', () => {
  const o = avaliaOrcamento({
    fee: 3000,
    gasto: 0,
    gastoAteOntem: 0,
    mes: MES,
    hoje: HOJE,
  });
  assert.equal(o.ajuste, 0);
  assert.ok(Number.isFinite(o.diarioAtual));
});

test('no primeiro dia do mês não há ritmo para medir', () => {
  const o = avaliaOrcamento({
    fee: 3000,
    gasto: 100,
    gastoAteOntem: 0,
    mes: MES,
    hoje: '2026-04-01',
  });
  assert.equal(o.diasDecorridos, 1);
  assert.equal(o.diasCompletos, 0);
  assert.equal(o.diasRestantes, 30);
  assert.equal(o.diarioAtual, 0);
  assert.equal(o.recomendacao, 'indefinido');
  // Sem ritmo, a frase ainda dá a diária que usa o fee: 2900 em 30 dias.
  assert.match(fraseOrcamento(o), /Sem dia inteiro fechado/);
  assert.equal(Math.round(o.diarioIdeal), 97);
});

test('gasto só de hoje também não vira ritmo', () => {
  const o = avaliaOrcamento({
    fee: 3000,
    gasto: 400,
    gastoAteOntem: 0,
    mes: MES,
    hoje: HOJE,
  });
  assert.equal(o.recomendacao, 'indefinido');
  assert.equal(o.ajuste, 0);
});

test('mês já encerrado é histórico: sem recomendação de ajuste', () => {
  // Olhando março em abril: o mês inteiro conta, e não há ritmo a corrigir.
  const o = avaliaOrcamento({
    fee: 3000,
    gasto: 2400,
    mes: '2026-03',
    hoje: HOJE,
  });
  assert.equal(o.recomendacao, 'fechado');
  // Mês sem "hoje": todos os dias são inteiros, e a média sai do mês todo.
  assert.equal(o.diasCompletos, 31);
  assert.equal(o.fechado, true);
  assert.equal(o.diasDecorridos, 31);
  assert.equal(o.diasRestantes, 0);
  assert.equal(o.ajuste, 0);
  // A projeção de um mês fechado é o próprio gasto, não uma extrapolação.
  assert.equal(o.projecao, 2400);
});

test('mês encerrado acima do fee ainda é "fechado", não "estourado"', () => {
  const o = avaliaOrcamento({
    fee: 3000,
    gasto: 4000,
    mes: '2026-03',
    hoje: HOJE,
  });
  assert.equal(o.recomendacao, 'fechado');
  assert.match(fraseOrcamento(o), /acima do fee/);
});

test('mês futuro não recebe opinião', () => {
  const o = avaliaOrcamento({
    fee: 3000,
    gasto: 0,
    mes: '2026-05',
    hoje: HOJE,
  });
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
  const subir = avaliaOrcamento({
    fee: 3000,
    gasto: 450,
    gastoAteOntem: 450,
    mes: MES,
    hoje: HOJE,
  });
  const frase = fraseOrcamento(subir);
  assert.match(frase, /^Suba a diária/);
  assert.doesNotMatch(frase, /%/);

  const semFee = avaliaOrcamento({ fee: 0, gasto: 0, mes: MES, hoje: HOJE });
  assert.match(fraseOrcamento(semFee), /Cadastre o fee mensal/);
});
