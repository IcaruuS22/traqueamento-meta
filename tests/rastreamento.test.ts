import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  FONTES,
  ROTULO_FONTE,
  DESCRICAO_FONTE,
  CLASSE_FONTE,
  ehFonte,
  ehConfianca,
  metodoDeCaptura,
  linkAdsManager,
} from '../src/lib/rastreamento';

/**
 * Testes do vocabulário do rastreamento.
 *
 * A classificação em si roda no SQL e é coberta pelos testes de
 * integração; o que se garante aqui é o que a tela diz sobre ela — em
 * especial que a whitelist de fonte não deixe passar valor livre para o
 * filtro, e que o link do anúncio aponte para o nível certo do
 * Gerenciador quando falta o id mais específico.
 */

describe('whitelist de fonte', () => {
  test('aceita só as fontes conhecidas', () => {
    for (const f of FONTES) assert.equal(ehFonte(f), true);
    assert.equal(ehFonte('ctwa; DROP TABLE customers'), false);
    assert.equal(ehFonte(''), false);
    assert.equal(ehFonte(undefined), false);
    assert.equal(ehFonte(null), false);
  });

  test('toda fonte tem rótulo, descrição e classe', () => {
    for (const f of FONTES) {
      assert.ok(ROTULO_FONTE[f]);
      assert.ok(DESCRICAO_FONTE[f]);
      assert.ok(CLASSE_FONTE[f]);
    }
  });

  test('confiança tem a mesma proteção', () => {
    assert.equal(ehConfianca('alta'), true);
    assert.equal(ehConfianca('altíssima'), false);
  });
});

describe('metodoDeCaptura', () => {
  test('click-id da conversa vence os demais sinais', () => {
    const metodo = metodoDeCaptura({
      fonte: 'ctwa',
      ctwa_clid: 'ABC123',
      fbclid: 'fb.1.2',
      meta_lead_id: '99',
    });
    assert.match(metodo, /ctwa_clid/);
  });

  test('CTWA sem click-id diz que só há a referência do anúncio', () => {
    const metodo = metodoDeCaptura({ fonte: 'ctwa', ctwa_clid: null });
    assert.match(metodo, /sem click-id/);
  });

  test('Lead Ads separa o caso com e sem anúncio identificado', () => {
    assert.match(
      metodoDeCaptura({ fonte: 'meta_lead_ads', meta_lead_id: '1', ad_id: '2' }),
      /ad_id/,
    );
    assert.match(
      metodoDeCaptura({ fonte: 'meta_lead_ads', meta_lead_id: '1', ad_id: null }),
      /sem anúncio identificado/,
    );
  });

  test('sem nenhum identificador não inventa origem', () => {
    assert.equal(metodoDeCaptura({ fonte: 'outros' }), 'sem identificador de origem');
  });
});

describe('linkAdsManager', () => {
  test('leva ao nível mais específico disponível', () => {
    const ad = linkAdsManager({ adAccountId: 'act_123', adId: '10', campaignId: '30' });
    assert.match(ad!, /manage\/ads\?/);
    assert.match(ad!, /selected_ad_ids=10/);
    assert.match(ad!, /act=123/);

    const conjunto = linkAdsManager({ adsetId: '20', campaignId: '30' });
    assert.match(conjunto!, /manage\/adsets\?/);

    const campanha = linkAdsManager({ campaignId: '30' });
    assert.match(campanha!, /manage\/campaigns\?/);
  });

  test('sem nenhum id não há link', () => {
    assert.equal(linkAdsManager({ adAccountId: 'act_123' }), null);
  });
});
