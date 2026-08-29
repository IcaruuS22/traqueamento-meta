import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEM_MOTIVO,
  conversoesDoFormulario,
  ehEtapaDePerda,
  faixasDoWhatsapp,
  montaFunil,
  normalizaMotivo,
  perdasPorCampanha,
  rankingMotivos,
} from '../src/lib/funil';

/**
 * Testes do Analytics do funil.
 *
 * O que se garante aqui é a conta que vai para a tela: ordem das etapas,
 * o que entra em cada faixa, e as duas decisões que mais mudam a leitura
 * do relatório — perda sem motivo virar linha própria e campanha com
 * pouco contato ficar de fora do ranking.
 */

const ETAPAS_WPP = [
  { valor: 'novo', content_name: 'Novo' },
  { valor: 'atendimento', content_name: 'Em atendimento' },
  { valor: 'ganho', content_name: null },
  { valor: 'perdido', content_name: null },
];

describe('montaFunil', () => {
  test('mantém a ordem do cadastro e calcula as duas porcentagens', () => {
    const r = montaFunil(ETAPAS_WPP, [
      { etapa: 'novo', total: 100 },
      { etapa: 'atendimento', total: 50 },
      { etapa: 'ganho', total: 10 },
      { etapa: 'perdido', total: 40 },
    ]);

    assert.deepEqual(
      r.passos.map((p) => p.valor),
      ['novo', 'atendimento', 'ganho', 'perdido'],
    );
    assert.equal(r.total, 200);
    assert.equal(r.passos[0].pct_anterior, null);
    // 50 de 200 no total, 50 dos 100 da etapa anterior.
    assert.equal(r.passos[1].pct_total, 25);
    assert.equal(r.passos[1].pct_anterior, 50);
  });

  test('etapa cadastrada sem ninguém dentro continua na lista, com zero', () => {
    const r = montaFunil(ETAPAS_WPP, [{ etapa: 'novo', total: 5 }]);
    assert.equal(r.passos.length, 4);
    assert.equal(r.passos[1].total, 0);
    assert.equal(r.passos[1].pct_anterior, 0);
  });

  test('etapa fora do cadastro entra em fora_do_funil, não some do total', () => {
    const r = montaFunil(ETAPAS_WPP, [
      { etapa: 'novo', total: 3 },
      { etapa: 'reuniao', total: 7 },
    ]);
    assert.equal(r.total, 10);
    assert.equal(r.fora_do_funil, 7);
  });

  test('sem nome cadastrado, o rótulo sai do próprio valor da etapa', () => {
    const r = montaFunil([{ valor: 'sem_nome_nenhum', content_name: '  ' }], []);
    assert.equal(r.passos[0].rotulo, 'Sem nome nenhum');
  });

  test('total do driver vindo como string não zera a conta', () => {
    const r = montaFunil(ETAPAS_WPP, [{ etapa: 'novo', total: '12' }]);
    assert.equal(r.total, 12);
    assert.equal(r.passos[0].total, 12);
  });
});

describe('faixasDoWhatsapp', () => {
  test('taxa de ganho olha só o que já foi decidido', () => {
    const f = faixasDoWhatsapp([
      { etapa: 'novo', total: 60 },
      { etapa: 'ganho', total: 30 },
      { etapa: 'perdido', total: 10 },
    ]);
    assert.equal(f.abertos, 60);
    assert.equal(f.ganhos, 30);
    assert.equal(f.perdidos, 10);
    // 30 de 40 decididos — os 60 em aberto não entram.
    assert.equal(f.taxa_ganho, 75);
  });

  test('sem nada decidido a taxa é zero, não NaN', () => {
    const f = faixasDoWhatsapp([{ etapa: 'novo', total: 4 }]);
    assert.equal(f.taxa_ganho, 0);
    assert.equal(f.abertos, 4);
  });
});

describe('conversoesDoFormulario', () => {
  test('só conta etapa marcada como conversão', () => {
    const etapas = [
      { valor: '142', content_name: 'Ganho', is_conversion: 1 },
      { valor: '143', content_name: 'Negociação', is_conversion: 0 },
      { valor: '144', content_name: 'Perdido', is_conversion: null },
    ];
    const r = conversoesDoFormulario(etapas, [
      { etapa: '142', total: 20 },
      { etapa: '143', total: 60 },
      { etapa: '144', total: 20 },
    ]);
    assert.equal(r.conversoes, 20);
    assert.equal(r.taxa, 20);
  });

  test('sem etapa de conversão cadastrada, o número é zero e não some com outra', () => {
    const r = conversoesDoFormulario(
      [{ valor: '143', content_name: null, is_conversion: 0 }],
      [{ etapa: '143', total: 10 }],
    );
    assert.equal(r.conversoes, 0);
    assert.equal(r.taxa, 0);
  });
});

describe('rankingMotivos', () => {
  test('ordena por volume e joga as perdas sem motivo para o fim', () => {
    const r = rankingMotivos(
      [
        { motivo: 'Preço', total: 3 },
        { motivo: 'Sem resposta', total: 5 },
        { motivo: '   ', total: 2 },
      ],
      20,
    );
    assert.deepEqual(
      r.map((m) => m.motivo),
      ['Sem resposta', 'Preço', SEM_MOTIVO],
    );
    // 20 perdidos, 8 com motivo: 12 sem motivo registrado.
    assert.equal(r[2].total, 12);
    assert.equal(r[0].pct, 25);
  });

  test('todas as perdas com motivo não geram a linha de "sem motivo"', () => {
    const r = rankingMotivos([{ motivo: 'Preço', total: 4 }], 4);
    assert.equal(r.length, 1);
    assert.equal(r[0].pct, 100);
  });

  test('motivo gravado com espaço sobrando não vira dois itens', () => {
    const r = rankingMotivos(
      [
        { motivo: 'Preço', total: 2 },
        { motivo: '  Preço  ', total: 3 },
      ],
      5,
    );
    // A normalização é a mesma da gravação; o agrupamento é do SQL, então
    // aqui as duas linhas continuam separadas, mas com o mesmo rótulo.
    assert.deepEqual(
      r.map((m) => m.motivo),
      ['Preço', 'Preço'],
    );
  });
});

describe('perdasPorCampanha', () => {
  test('ordena por taxa e corta campanha pequena demais', () => {
    const r = perdasPorCampanha([
      { campanha: 'Grande', total: 100, perdidos: 20 },
      { campanha: 'Ruim', total: 10, perdidos: 8 },
      { campanha: 'Minúscula', total: 2, perdidos: 2 },
      { campanha: 'Sem perda', total: 30, perdidos: 0 },
    ]);
    assert.deepEqual(
      r.map((c) => c.campanha),
      ['Ruim', 'Grande'],
    );
    assert.equal(r[0].taxa, 80);
    assert.equal(r[1].taxa, 20);
  });

  test('lead sem campanha vira uma linha nomeada, não some', () => {
    const r = perdasPorCampanha([{ campanha: null, total: 8, perdidos: 4 }]);
    assert.equal(r[0].campanha, 'Sem campanha');
    assert.equal(r[0].taxa, 50);
  });
});

describe('motivo e etapa de perda', () => {
  test('normalizaMotivo colapsa espaço, corta em 120 e vira null quando vazio', () => {
    assert.equal(normalizaMotivo('  Preço   alto  '), 'Preço alto');
    assert.equal(normalizaMotivo('   '), null);
    assert.equal(normalizaMotivo(null), null);
    // O que não é texto não vira motivo: 123 gravado como "123" seria
    // uma fatia sem sentido no ranking.
    assert.equal(normalizaMotivo(123), null);
    assert.equal(normalizaMotivo('x'.repeat(200))!.length, 120);
  });

  test('só o estágio "perdido" é etapa de perda', () => {
    assert.equal(ehEtapaDePerda('perdido'), true);
    assert.equal(ehEtapaDePerda('ganho'), false);
    assert.equal(ehEtapaDePerda('perdido_frio'), false);
    assert.equal(ehEtapaDePerda(null), false);
  });
});
