import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { montaRankingPerdas, type LinhaMotivoPerda } from '../src/lib/perdas';

/**
 * Testes do ranking de motivos de perda.
 *
 * O que se testa aqui é a junção: o campo é texto livre, os dois funis
 * chegam na mesma lista e o banco devolve uma linha por grafia. Errar
 * isso não quebra a tela — só desenha barras menores do que a realidade,
 * que é o tipo de erro que ninguém percebe olhando.
 */

const linha = (motivo: string | null, total: number): LinhaMotivoPerda => ({ motivo, total });

describe('montaRankingPerdas', () => {
  test('junta grafias diferentes do mesmo motivo', () => {
    const r = montaRankingPerdas([linha('Preço', 3), linha('preço', 40), linha(' PREÇO ', 2)]);
    assert.equal(r.itens.length, 1);
    assert.equal(r.itens[0].valor, 45);
    assert.equal(r.motivos_distintos, 1);
  });

  test('a grafia exibida é a do motivo mais frequente', () => {
    const r = montaRankingPerdas([linha('preço', 40), linha('Preço', 3)]);
    assert.equal(r.itens[0].rotulo, 'preço');
  });

  test('soma os dois funis quando o motivo é o mesmo', () => {
    // Uma linha veio de `customers.lost_reason`, a outra de
    // `whatsapp_conversations.lost_reason`; para o cliente é um motivo só.
    const r = montaRankingPerdas([linha('Sem resposta', 5), linha('sem resposta', 7)]);
    assert.equal(r.itens.length, 1);
    assert.equal(r.itens[0].valor, 12);
  });

  test('motivo vazio, em branco ou nulo vira "sem motivo registrado"', () => {
    const r = montaRankingPerdas([linha(null, 4), linha('', 3), linha('   ', 2), linha('Preço', 1)]);
    assert.equal(r.sem_motivo, 9);
    const ultimo = r.itens[r.itens.length - 1];
    assert.equal(ultimo.sem_motivo, true);
    assert.equal(ultimo.valor, 9);
  });

  test('ordena do maior para o menor', () => {
    const r = montaRankingPerdas([linha('A', 2), linha('B', 9), linha('C', 5)]);
    assert.deepEqual(
      r.itens.map((i) => i.rotulo),
      ['B', 'C', 'A'],
    );
  });

  test('empate é desempatado pelo rótulo, para a ordem não variar', () => {
    const r = montaRankingPerdas([linha('Zebra', 4), linha('Abacate', 4)]);
    assert.deepEqual(
      r.itens.map((i) => i.rotulo),
      ['Abacate', 'Zebra'],
    );
  });

  test('o percentual é sobre o total de perdas, inclusive as sem motivo', () => {
    const r = montaRankingPerdas([linha('Preço', 25), linha(null, 75)]);
    assert.equal(r.total, 100);
    assert.equal(r.itens[0].percentual, 25);
    assert.equal(r.itens[1].percentual, 75);
  });

  test('o que passa do limite vira uma linha "Outros"', () => {
    const linhas = ['a', 'b', 'c', 'd', 'e'].map((m, i) => linha(m, 10 - i));
    const r = montaRankingPerdas(linhas, 3);
    assert.equal(r.itens.length, 4);
    assert.equal(r.itens[3].rotulo, 'Outros (2 motivos)');
    assert.equal(r.itens[3].valor, 6 + 7);
    // O recorte é só da exibição: a contagem de motivos distintos
    // continua sendo a de verdade.
    assert.equal(r.motivos_distintos, 5);
  });

  test('"sem motivo" não é empurrado para dentro de "Outros"', () => {
    const linhas = [linha('a', 9), linha('b', 8), linha('c', 7), linha(null, 1)];
    const r = montaRankingPerdas(linhas, 2);
    const ultimo = r.itens[r.itens.length - 1];
    assert.equal(ultimo.sem_motivo, true);
    assert.equal(r.itens.filter((i) => i.rotulo.startsWith('Outros')).length, 1);
  });

  test('período sem perda nenhuma devolve total zero', () => {
    const r = montaRankingPerdas([]);
    assert.equal(r.total, 0);
    assert.deepEqual(r.itens, []);
  });

  test('linha com contagem zero não vira barra', () => {
    const r = montaRankingPerdas([linha('Preço', 0), linha('Sem resposta', 2)]);
    assert.equal(r.itens.length, 1);
    assert.equal(r.total, 2);
  });
});
