import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ehEtapaDePerda, normalizaMotivo } from '../src/lib/funil';

/**
 * Testes do motivo de perda — o texto que o time digita ao fechar uma
 * conversa como perdida, e o que decide que a conversa é uma perda.
 */

describe('motivo e etapa de perda', () => {
  test('normalizaMotivo colapsa espaço, corta em 120 e vira null quando vazio', () => {
    assert.equal(normalizaMotivo('  Preço   alto  '), 'Preço alto');
    assert.equal(normalizaMotivo('   '), null);
    assert.equal(normalizaMotivo(null), null);
    // O que não é texto não vira motivo: 123 gravado como "123" seria
    // uma fatia sem sentido no relatório.
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
