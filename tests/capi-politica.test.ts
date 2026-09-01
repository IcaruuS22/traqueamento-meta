import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideEnvioCapiWhatsapp,
  exigeAnuncioWhatsapp,
  normalizaModoCapi,
} from '@/lib/capi-politica';

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

/**
 * O destino dos eventos de WhatsApp.
 *
 * O que se garante aqui é que não existe queda para o dataset dos
 * formulários: sem dataset de mensagens o evento não sai, em modo
 * nenhum. Era essa queda que fazia conversa virar conversão no pixel do
 * site.
 */
describe('decideEnvioCapiWhatsapp', () => {
  const base = { dataset_id: '111', test_event_code: 'TEST123' } as const;

  it('desligado não envia', () => {
    const d = decideEnvioCapiWhatsapp({ ...base, modo: 'desligado' });
    assert.equal(d.envia, false);
  });

  it('sem dataset de mensagens não envia, mesmo em produção', () => {
    const d = decideEnvioCapiWhatsapp({ modo: 'producao', dataset_id: null, test_event_code: null });
    assert.equal(d.envia, false);
    assert.match(d.envia === false ? d.motivo : '', /dataset de mensagens/);
  });

  it('teste sem código não envia — sairia valendo', () => {
    const d = decideEnvioCapiWhatsapp({ ...base, modo: 'teste', test_event_code: null });
    assert.equal(d.envia, false);
  });

  it('teste envia com o código', () => {
    const d = decideEnvioCapiWhatsapp({ ...base, modo: 'teste' });
    assert.equal(d.envia, true);
    assert.equal(d.envia === true ? d.test_event_code : null, 'TEST123');
  });

  it('produção envia sem código de teste, mesmo havendo um cadastrado', () => {
    const d = decideEnvioCapiWhatsapp({ ...base, modo: 'producao' });
    assert.equal(d.envia, true);
    assert.equal(d.envia === true ? d.test_event_code : 'x', null);
  });
});

describe('normalizaModoCapi', () => {
  it('valor desconhecido, vazio ou nulo cai em teste, nunca em produção', () => {
    assert.equal(normalizaModoCapi('produção'), 'teste');
    assert.equal(normalizaModoCapi(''), 'teste');
    assert.equal(normalizaModoCapi(null), 'teste');
    assert.equal(normalizaModoCapi(undefined), 'teste');
  });

  it('os três modos válidos passam intactos', () => {
    assert.equal(normalizaModoCapi('desligado'), 'desligado');
    assert.equal(normalizaModoCapi('teste'), 'teste');
    assert.equal(normalizaModoCapi('producao'), 'producao');
  });
});
