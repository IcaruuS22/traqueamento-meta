import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LinhaHierarquia } from '@/lib/db/campanhas';
import { proximoStatus, rotuloStatus, somaCampanhas, tomStatus } from '@/lib/campanhas';

function linha(over: Partial<LinhaHierarquia> = {}): LinhaHierarquia {
  return {
    id: '1',
    nome: 'Campanha',
    status: 'ACTIVE',
    orcamento: null,
    spend: 0,
    impressions: 0,
    reach: 0,
    frequency: 0,
    clicks: 0,
    unique_clicks: 0,
    ctr: 0,
    cpc: 0,
    cpm: 0,
    total_leads: 0,
    total_conversoes: 0,
    cpl: null,
    cac: null,
    receita: 0,
    funil_eventos: [],
    ...over,
  };
}

describe('status da hierarquia', () => {
  it('concorda com o nível: campanha é feminino, conjunto e anúncio masculino', () => {
    assert.equal(rotuloStatus('ACTIVE', 'campaign'), 'Ativa');
    assert.equal(rotuloStatus('ACTIVE', 'adset'), 'Ativo');
    assert.equal(rotuloStatus('PAUSED', 'ad'), 'Pausado');
  });

  it('mostra status desconhecido cru, sem inventar tradução', () => {
    assert.equal(rotuloStatus('WITH_ISSUES', 'campaign'), 'with issues');
    assert.equal(rotuloStatus(null, 'campaign'), '-');
    assert.equal(rotuloStatus('   ', 'campaign'), '-');
  });

  it('separa o tom em ativo, pausado e o resto', () => {
    assert.equal(tomStatus('ACTIVE'), 'ativo');
    assert.equal(tomStatus('PAUSED'), 'pausado');
    assert.equal(tomStatus('ARCHIVED'), 'pausado');
    assert.equal(tomStatus(null), 'pausado');
    assert.equal(tomStatus('IN_PROCESS'), 'atencao');
  });
});

describe('totais da tabela de campanhas', () => {
  it('soma os absolutos e recalcula as médias sobre o total', () => {
    const t = somaCampanhas([
      linha({ spend: 300, impressions: 10_000, clicks: 100, total_leads: 30, total_conversoes: 3 }),
      linha({ spend: 100, impressions: 10_000, clicks: 300, total_leads: 10, total_conversoes: 1 }),
    ]);

    assert.equal(t.campanhas, 2);
    assert.equal(t.spend, 400);
    assert.equal(t.clicks, 400);
    assert.equal(t.total_leads, 40);
    // 400 cliques em 20.000 impressões = 2%, e não a média de 1% com 3%.
    assert.equal(t.ctr, 2);
    assert.equal(t.cpc, 1);
    assert.equal(t.cpm, 20);
    assert.equal(t.cpl, 10);
    assert.equal(t.cac, 100);
  });

  it('devolve null em CPL e CAC sem lead nem conversão, e zero nas médias sem base', () => {
    const t = somaCampanhas([linha({ spend: 50 })]);
    assert.equal(t.cpl, null);
    assert.equal(t.cac, null);
    assert.equal(t.ctr, 0);
    assert.equal(t.cpc, 0);
    assert.equal(t.cpm, 0);
  });

  it('agrupa o funil por evento, do maior para o menor', () => {
    const t = somaCampanhas([
      linha({
        funil_eventos: [
          { event_name: 'Lead', total: 10 },
          { event_name: 'Purchase', total: 1 },
        ],
      }),
      linha({ funil_eventos: [{ event_name: 'Purchase', total: 4 }] }),
    ]);

    assert.deepEqual(t.funil_eventos, [
      { event_name: 'Lead', total: 10 },
      { event_name: 'Purchase', total: 5 },
    ]);
  });

  it('lista vazia não vira NaN', () => {
    const t = somaCampanhas([]);
    assert.equal(t.campanhas, 0);
    assert.equal(t.spend, 0);
    assert.equal(t.ctr, 0);
    assert.deepEqual(t.funil_eventos, []);
  });
});

describe('proximoStatus', () => {
  it('alterna entre ativo e pausado', () => {
    assert.equal(proximoStatus('ACTIVE'), 'PAUSED');
    assert.equal(proximoStatus('PAUSED'), 'ACTIVE');
    assert.equal(proximoStatus('active'), 'PAUSED');
  });

  it('recusa o que a Meta não deixa alternar por status', () => {
    assert.equal(proximoStatus('ARCHIVED'), null);
    assert.equal(proximoStatus('DELETED'), null);
    assert.equal(proximoStatus('IN_PROCESS'), null);
    assert.equal(proximoStatus(null), null);
    assert.equal(proximoStatus(''), null);
  });
});
