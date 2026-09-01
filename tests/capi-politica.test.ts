import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exigeAnuncioWhatsapp } from '@/lib/capi-politica';

/**
 * A trava que impede evento de etapa de lead que não veio de anúncio.
 *
 * O que se garante aqui é o padrão por ambiente — ligada em produção,
 * desligada em desenvolvimento — e que a variável vence os dois. Um
 * `!== 'false'` no lugar do `=== 'true'` passaria despercebido e
 * deixaria a trava ligada em desenvolvimento para sempre.
 */
describe('exigeAnuncioWhatsapp', () => {
  it('liga sozinha em produção', () => {
    assert.equal(exigeAnuncioWhatsapp('production', undefined), true);
  });

  it('fica desligada em desenvolvimento', () => {
    assert.equal(exigeAnuncioWhatsapp('development', undefined), false);
  });

  it('fica desligada quando não há ambiente definido', () => {
    assert.equal(exigeAnuncioWhatsapp(undefined, undefined), false);
  });

  it('a variável liga em desenvolvimento', () => {
    assert.equal(exigeAnuncioWhatsapp('development', 'true'), true);
  });

  it('a variável desliga em produção', () => {
    assert.equal(exigeAnuncioWhatsapp('production', 'false'), false);
  });

  it('variável vazia não conta como definida', () => {
    assert.equal(exigeAnuncioWhatsapp('production', ''), true);
  });

  it('valor inesperado desliga, em vez de ligar por engano', () => {
    assert.equal(exigeAnuncioWhatsapp('production', 'sim'), false);
  });
});
