import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { paraNumero, precoDoNegocio } from '../scripts/backfill-crm-value';
import { valorDigitado } from '../src/lib/crm';

/**
 * Leitura do valor do negócio no Kommo.
 *
 * O mesmo par de regras vive no node "Resolve Valor do Negócio" do fluxo
 * do n8n: o preço chega ora como número cru, ora formatado em pt-BR, e
 * nem todo cliente usa o campo nativo "Venda".
 */

describe('valor do negócio vindo do Kommo', () => {
  test('paraNumero entende número cru, pt-BR e texto com moeda', () => {
    assert.equal(paraNumero(11210), 11210);
    assert.equal(paraNumero('11210'), 11210);
    // Sem vírgula o ponto é decimal; com vírgula, é separador de milhar.
    assert.equal(paraNumero('2500.50'), 2500.5);
    assert.equal(paraNumero('11.210,00'), 11210);
    assert.equal(paraNumero('R$ 11.210'), 11210);
  });

  test('paraNumero devolve 0 para o que não é valor', () => {
    assert.equal(paraNumero(''), 0);
    assert.equal(paraNumero(null), 0);
    assert.equal(paraNumero(undefined), 0);
    assert.equal(paraNumero('sem valor'), 0);
    // Negócio sem preço vem com 0, e 0 não é valor de venda.
    assert.equal(paraNumero(0), 0);
    assert.equal(paraNumero(-500), 0);
  });

  test('precoDoNegocio prefere o campo nativo e cai no personalizado', () => {
    assert.equal(precoDoNegocio({ id: 1, price: 11210 }), 11210);
    assert.equal(
      precoDoNegocio({
        id: 2,
        price: 0,
        custom_fields_values: [
          { field_name: 'Origem', values: [{ value: 'Anúncio' }] },
          { field_name: 'Valor do contrato', values: [{ value: '8.400,00' }] },
        ],
      }),
      8400,
    );
    assert.equal(precoDoNegocio({ id: 3, price: 0 }), 0);
    assert.equal(
      precoDoNegocio({ id: 4, custom_fields_values: [{ field_name: 'Origem', values: [] }] }),
      0,
    );
  });
});

describe('valor digitado no painel', () => {
  test('aceita o jeito brasileiro e o do teclado numérico', () => {
    assert.equal(valorDigitado('11210'), 11210);
    assert.equal(valorDigitado('11210.50'), 11210.5);
    assert.equal(valorDigitado('11.210,00'), 11210);
    assert.equal(valorDigitado('R$ 11.210,00'), 11210);
    assert.equal(valorDigitado(' 2500,5 '), 2500.5);
  });

  test('campo vazio zera o valor, e texto não vira número', () => {
    // Apagar o campo é como se corrige um valor digitado errado.
    assert.equal(valorDigitado(''), 0);
    assert.equal(valorDigitado('   '), 0);
    assert.equal(valorDigitado('abc'), null);
    assert.equal(valorDigitado('-500'), null);
  });
});
