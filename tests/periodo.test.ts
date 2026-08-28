import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePeriodo,
  dataParaEpochSec,
  epochSecParaData,
  condicaoTimestamp,
  condicaoData,
  condicaoCanal,
  montaWhere,
  montaAnd,
  preencheDias,
  rotuloPeriodo,
} from '../src/lib/periodo';

/**
 * Teste do cálculo de período.
 *
 * Esta lógica aparecia copiada em 6 endpoints do n8n e é a mais fácil de
 * errar do sistema: um deslocamento de 3h faz leads das 21h–23h59 caírem
 * no dia errado e as contagens do painel divergirem do CRM e da Meta.
 *
 * A âncora de todos os testes de fronteira é: meia-noite em São Paulo
 * (UTC-3) é sempre 03:00 UTC, ou seja, `epoch % 86400 === 10800`.
 */

const DIA = 86_400;
const MEIA_NOITE_SP_EM_UTC = 3 * 60 * 60; // 10800

describe('resolvePeriodo — normalização da entrada', () => {
  test('range desconhecido cai no padrão', () => {
    assert.equal(resolvePeriodo({ range: 'semana-que-vem' }).range, '7d');
    assert.equal(resolvePeriodo({ range: 'semana-que-vem' }, '30d').range, '30d');
  });

  test('range ausente ou nulo cai no padrão', () => {
    assert.equal(resolvePeriodo({}).range, '7d');
    assert.equal(resolvePeriodo({ range: null }).range, '7d');
  });

  test('range é aceito sem diferenciar maiúsculas', () => {
    assert.equal(resolvePeriodo({ range: 'HOJE' }).range, 'hoje');
  });

  test('custom sem as duas datas cai no padrão — nunca vira query sem filtro', () => {
    assert.equal(resolvePeriodo({ range: 'custom' }).range, '7d');
    assert.equal(resolvePeriodo({ range: 'custom', date_from: '2026-01-01' }).range, '7d');
    assert.equal(resolvePeriodo({ range: 'custom', date_to: '2026-01-31' }).range, '7d');
  });

  test('custom com data em formato inválido cai no padrão', () => {
    const p = resolvePeriodo({ range: 'custom', date_from: '01/02/2026', date_to: '2026-02-05' });
    assert.equal(p.range, '7d');
  });

  test('custom com datas invertidas troca de lugar em vez de gerar janela vazia', () => {
    const p = resolvePeriodo({ range: 'custom', date_from: '2026-03-10', date_to: '2026-03-01' });
    assert.equal(p.range, 'custom');
    assert.equal(p.customFrom, '2026-03-01');
    assert.equal(p.customTo, '2026-03-10');
    assert.ok(p.inicioSec! < p.fimSec!);
  });

  test('canal desconhecido ou ausente vira geral', () => {
    assert.equal(resolvePeriodo({}).canal, 'geral');
    assert.equal(resolvePeriodo({ channel: 'telegram' }).canal, 'geral');
    assert.equal(resolvePeriodo({ channel: 'WHATSAPP' }).canal, 'whatsapp');
    assert.equal(resolvePeriodo({ channel: 'form' }).canal, 'form');
  });
});

describe('resolvePeriodo — fronteiras de dia em São Paulo', () => {
  test('hoje começa na meia-noite de SP e dura exatamente 24h', () => {
    const p = resolvePeriodo({ range: 'hoje' });
    assert.equal(p.inicioSec! % DIA, MEIA_NOITE_SP_EM_UTC);
    assert.equal(p.fimSec! - p.inicioSec!, DIA);
  });

  test('ontem é a janela de hoje deslocada exatamente um dia', () => {
    const hoje = resolvePeriodo({ range: 'hoje' });
    const ontem = resolvePeriodo({ range: 'ontem' });
    assert.equal(hoje.inicioSec! - ontem.inicioSec!, DIA);
    assert.equal(ontem.fimSec, hoje.inicioSec);
  });

  test('a fronteira do dia não é meia-noite UTC', () => {
    // Guarda contra a regressão original: se alguém trocar o cálculo por
    // UTC puro, este resto vira 0 e leads de 21h-23h59 mudam de dia.
    const p = resolvePeriodo({ range: 'hoje' });
    assert.notEqual(p.inicioSec! % DIA, 0);
  });

  test('7d começa 6 dias antes da meia-noite de hoje e termina agora', () => {
    const agora = Math.floor(Date.now() / 1000);
    const hoje = resolvePeriodo({ range: 'hoje' });
    const p = resolvePeriodo({ range: '7d' });
    assert.equal(hoje.inicioSec! - p.inicioSec!, 6 * DIA);
    assert.ok(Math.abs(p.fimSec! - agora) <= 2, 'fim de 7d deve ser ~agora');
  });

  test('30d começa 29 dias antes da meia-noite de hoje', () => {
    const hoje = resolvePeriodo({ range: 'hoje' });
    const p = resolvePeriodo({ range: '30d' });
    assert.equal(hoje.inicioSec! - p.inicioSec!, 29 * DIA);
  });

  test('ano começa em 1º de janeiro, meia-noite de SP', () => {
    const p = resolvePeriodo({ range: 'ano' });
    assert.equal(p.inicioSec! % DIA, MEIA_NOITE_SP_EM_UTC);
    assert.equal(epochSecParaData(p.inicioSec!).slice(5), '01-01');
  });

  test('custom inclui o dia final inteiro (fim exclusivo no dia seguinte)', () => {
    const p = resolvePeriodo({ range: 'custom', date_from: '2026-02-01', date_to: '2026-02-28' });
    assert.equal(p.inicioSec, dataParaEpochSec('2026-02-01'));
    assert.equal(p.fimSec, dataParaEpochSec('2026-02-28') + DIA);
    assert.equal(p.fimSec! - p.inicioSec!, 28 * DIA);
  });

  test('max não tem limites nem período anterior', () => {
    const p = resolvePeriodo({ range: 'max' });
    assert.equal(p.inicioSec, null);
    assert.equal(p.fimSec, null);
    assert.equal(p.anteriorInicioSec, null);
    assert.equal(p.anteriorFimSec, null);
  });
});

describe('resolvePeriodo — período anterior', () => {
  test('é a mesma janela deslocada pela própria duração, e contígua', () => {
    for (const range of ['hoje', 'ontem', '7d', '30d', 'ano'] as const) {
      const p = resolvePeriodo({ range });
      const duracao = p.fimSec! - p.inicioSec!;
      assert.equal(p.anteriorFimSec, p.inicioSec, `${range}: anterior deve encostar no atual`);
      assert.equal(
        p.anteriorFimSec! - p.anteriorInicioSec!,
        duracao,
        `${range}: anterior deve ter a mesma duração`,
      );
    }
  });

  test('custom de fevereiro compara com os 28 dias imediatamente anteriores', () => {
    const p = resolvePeriodo({ range: 'custom', date_from: '2026-02-01', date_to: '2026-02-28' });
    assert.equal(epochSecParaData(p.anteriorInicioSec!), '2026-01-04');
    assert.equal(epochSecParaData(p.anteriorFimSec! - 1), '2026-01-31');
  });
});

describe('conversão de datas', () => {
  test('dataParaEpochSec devolve a meia-noite de SP daquele dia civil', () => {
    // 2026-01-01 00:00 em SP = 2026-01-01T03:00:00Z
    assert.equal(dataParaEpochSec('2026-01-01'), Date.UTC(2026, 0, 1, 3, 0, 0) / 1000);
  });

  test('epochSecParaData é o inverso de dataParaEpochSec', () => {
    for (const d of ['2025-12-31', '2026-01-01', '2026-02-28', '2026-06-15']) {
      assert.equal(epochSecParaData(dataParaEpochSec(d)), d);
    }
  });

  test('23h59 de SP ainda pertence ao mesmo dia civil', () => {
    // O caso que motivou todo este módulo.
    const quase = dataParaEpochSec('2026-05-10') + DIA - 60;
    assert.equal(epochSecParaData(quase), '2026-05-10');
  });
});

describe('condicaoTimestamp', () => {
  test('sem início não gera condição alguma', () => {
    assert.deepEqual(condicaoTimestamp('created_at', null, null), { sql: '', params: [] });
  });

  test('com início e fim usa UNIX_TIMESTAMP e parâmetros posicionais', () => {
    const c = condicaoTimestamp('c.created_at', 100, 200);
    assert.equal(c.sql, 'UNIX_TIMESTAMP(c.created_at) >= ? AND UNIX_TIMESTAMP(c.created_at) < ?');
    assert.deepEqual(c.params, [100, 200]);
  });

  test('sem fim gera só o limite inferior', () => {
    const c = condicaoTimestamp('created_at', 100, null);
    assert.equal(c.sql, 'UNIX_TIMESTAMP(created_at) >= ?');
    assert.deepEqual(c.params, [100]);
  });
});

describe('condicaoData', () => {
  test('compara strings de data, sem UNIX_TIMESTAMP', () => {
    const c = condicaoData('date', dataParaEpochSec('2026-02-01'), dataParaEpochSec('2026-03-01'));
    assert.ok(!c.sql.includes('UNIX_TIMESTAMP'), 'DATE não pode passar por UNIX_TIMESTAMP');
    assert.equal(c.sql, 'date >= ? AND date <= ?');
  });

  test('o fim exclusivo em epoch vira o último dia inclusivo em data civil', () => {
    const c = condicaoData('date', dataParaEpochSec('2026-02-01'), dataParaEpochSec('2026-03-01'));
    assert.deepEqual(c.params, ['2026-02-01', '2026-02-28']);
  });

  test('sem início não gera condição alguma', () => {
    assert.deepEqual(condicaoData('date', null, null), { sql: '', params: [] });
  });
});

describe('condicaoCanal', () => {
  const tabela = '`cliente_x`.`whatsapp_conversations`';

  test('geral não filtra nada', () => {
    assert.equal(condicaoCanal('geral', 'c', tabela), '');
  });

  test('whatsapp exige conversa; form exige ausência de conversa', () => {
    const wpp = condicaoCanal('whatsapp', 'c', tabela);
    const form = condicaoCanal('form', 'c', tabela);
    assert.ok(wpp.startsWith('EXISTS'));
    assert.ok(form.startsWith('NOT EXISTS'));
    assert.equal(form, `NOT ${wpp}`, 'form é exatamente a negação de whatsapp');
    assert.ok(wpp.includes('wcx.customer_id = c.id'));
  });

  test('sem alias usa a coluna id nua', () => {
    assert.ok(condicaoCanal('whatsapp', '', tabela).includes('wcx.customer_id = id'));
  });
});

describe('montaWhere e montaAnd', () => {
  test('descartam condições vazias, nulas ou só com espaço', () => {
    assert.equal(montaWhere(['a = 1', '', null, undefined, '   ', 'b = 2']), 'WHERE a = 1 AND b = 2');
    assert.equal(montaAnd(['a = 1', '', null]), 'AND a = 1');
  });

  test('sem nenhuma condição devolvem string vazia', () => {
    assert.equal(montaWhere([]), '');
    assert.equal(montaWhere(['', null]), '');
    assert.equal(montaAnd([]), '');
  });
});

describe('preencheDias', () => {
  const inicio = dataParaEpochSec('2026-03-01');
  const fim = dataParaEpochSec('2026-03-05') + DIA; // fim exclusivo

  test('cobre todos os dias do período, inclusive o último', () => {
    const s = preencheDias([{ dia: '2026-03-03', total: 4 }], inicio, fim);
    assert.deepEqual(
      s.map((p) => p.dia),
      ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'],
    );
  });

  test('preserva os valores existentes e zera o resto', () => {
    const s = preencheDias(
      [
        { dia: '2026-03-01', total: 2 },
        { dia: '2026-03-05', total: 7 },
      ],
      inicio,
      fim,
    );
    assert.deepEqual(
      s.map((p) => p.total),
      [2, 0, 0, 0, 7],
    );
  });

  test('sem limites (max) usa o intervalo da própria série', () => {
    const s = preencheDias(
      [
        { dia: '2026-03-01', total: 1 },
        { dia: '2026-03-03', total: 1 },
      ],
      null,
      null,
    );
    assert.equal(s.length, 3);
    assert.deepEqual(
      s.map((p) => p.total),
      [1, 0, 1],
    );
  });

  test('série vazia sem limites continua vazia', () => {
    assert.deepEqual(preencheDias([], null, null), []);
  });

  test('período absurdamente longo é truncado em vez de gerar milhares de colunas', () => {
    const s = preencheDias([], dataParaEpochSec('1970-01-01'), dataParaEpochSec('2026-01-01'));
    assert.equal(s.length, 800);
  });
});

describe('rotuloPeriodo', () => {
  test('todo range tem rótulo não vazio', () => {
    for (const range of ['hoje', 'ontem', '7d', '30d', 'ano', 'max'] as const) {
      assert.ok(rotuloPeriodo(resolvePeriodo({ range })).length > 0);
    }
  });

  test('custom mostra as duas datas', () => {
    const p = resolvePeriodo({ range: 'custom', date_from: '2026-02-01', date_to: '2026-02-28' });
    assert.equal(rotuloPeriodo(p), '2026-02-01 a 2026-02-28');
  });
});
