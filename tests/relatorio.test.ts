import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  montaDadosRelatorio,
  nomeArquivoRelatorio,
  escalaBarras,
  MAX_LINHAS_TABELA,
} from '../src/lib/relatorio';
import { KPIS, kpisDoEscopo } from '../src/lib/kpis';
import { resolvePeriodo } from '../src/lib/periodo';
import type { Metricas, Totais, Lead } from '../src/lib/db/metricas';

/**
 * Teste da exportação em PDF de "Métricas Gerais".
 *
 * O que está coberto aqui é o que o documento desenha — não o desenho em
 * si. O risco real desta funcionalidade não é o PDF sair feio: é ele sair
 * com número diferente do da tela, com KPI que não pertence ao canal, ou
 * com um nome de arquivo que quebra o cabeçalho HTTP.
 */

const TOTAIS_ANTERIORES: Totais = {
  total_leads: 80,
  total_spend: 500,
  cpl: 6.25,
  total_conversoes: 8,
  taxa_conversao: 10,
  receita: 4000,
  roas: 8,
};

function lead(id: number, nome: string | null): Lead {
  return {
    id,
    first_name: nome,
    last_name: null,
    email: null,
    phone: '5511999990000',
    current_stage: 'novo',
    created_at: '2026-08-20 10:00:00',
    last_moved_at: null,
  };
}

function metricas(extra: Partial<Metricas> = {}): Metricas {
  return {
    total_leads: 100,
    total_spend: 1000,
    cpl: 10,
    total_conversoes: 25,
    taxa_conversao: 25,
    receita: 9000,
    roas: 9,
    impressions: 50_000,
    reach: 30_000,
    frequency: 1.6,
    clicks: 2000,
    ctr: 4,
    cpc: 0.5,
    cpm: 20,
    comparativo_anterior: TOTAIS_ANTERIORES,
    leads_por_dia: [{ dia: '2026-08-20', total: 4 }],
    eventos_por_nome: [
      { event_name: 'Lead', total: 100 },
      { event_name: 'Purchase', total: 25 },
    ],
    tempo_medio_entre_etapas: [
      { from_stage: 'novo', to_stage: 'qualificado', avg_ms: 3_600_000, count: 12 },
    ],
    ultimos_leads: [lead(1, 'Ana'), lead(2, null)],
    lacunas_de_esquema: [],
    ...extra,
  } as Metricas;
}

const CONTA = { account_name: 'Cliente Teste', ad_account_id: 'act_123' };
const AGORA = new Date('2026-08-31T18:45:00Z'); // 15:45 em São Paulo

function periodo(canal: 'geral' | 'form' | 'whatsapp' = 'geral') {
  return resolvePeriodo({ range: '7d', channel: canal });
}

describe('kpisDoEscopo', () => {
  test('esconde as métricas de anúncio no canal WhatsApp', () => {
    const ids = kpisDoEscopo('whatsapp', new Map()).map((k) => k.id);
    assert.ok(!ids.includes('total_spend'));
    assert.ok(!ids.includes('roas'));
    assert.ok(ids.includes('total_leads'));
  });

  test('KPI ausente do mapa conta como visível', () => {
    assert.equal(kpisDoEscopo('geral', new Map()).length, KPIS.length);
  });

  test('respeita o que o cliente escondeu', () => {
    const ids = kpisDoEscopo('geral', new Map([['cpl', false]])).map((k) => k.id);
    assert.ok(!ids.includes('cpl'));
    assert.equal(ids.length, KPIS.length - 1);
  });
});

describe('montaDadosRelatorio', () => {
  test('usa os mesmos rótulos e valores do catálogo da tela', () => {
    const m = metricas();
    const dados = montaDadosRelatorio(m, periodo(), new Map(), CONTA, AGORA);
    const doCatalogo = kpisDoEscopo('geral', new Map());

    assert.deepEqual(
      dados.kpis.map((k) => k.id),
      doCatalogo.map((k) => k.id),
    );
    for (const k of doCatalogo) {
      const linha = dados.kpis.find((l) => l.id === k.id)!;
      assert.equal(linha.valor, k.valor(m), `valor divergente em ${k.id}`);
      assert.equal(linha.rotulo, k.rotulo);
    }
  });

  test('calcula a variação contra o período anterior', () => {
    const dados = montaDadosRelatorio(metricas(), periodo(), new Map(), CONTA, AGORA);
    const leads = dados.kpis.find((k) => k.id === 'total_leads')!;
    assert.equal(leads.variacao, 25); // 100 contra 80

    const cpl = dados.kpis.find((k) => k.id === 'cpl')!;
    assert.equal(cpl.variacao, 60); // 10 contra 6,25
    assert.equal(cpl.melhorQuandoCai, true);
  });

  test('sem período anterior a variação é nula, não zero', () => {
    const dados = montaDadosRelatorio(
      metricas({ comparativo_anterior: null }),
      periodo(),
      new Map(),
      CONTA,
      AGORA,
    );
    assert.ok(dados.kpis.every((k) => k.variacao === null));
  });

  test('KPI sem valor comparável não inventa variação', () => {
    const dados = montaDadosRelatorio(metricas(), periodo(), new Map(), CONTA, AGORA);
    // Impressões vêm do Meta e não têm equivalente em `Totais`.
    assert.equal(dados.kpis.find((k) => k.id === 'impressions')!.variacao, null);
  });

  test('corta as tabelas no teto e informa o total real', () => {
    const muitos = Array.from({ length: 40 }, (_, i) => lead(i + 1, `Lead ${i + 1}`));
    const dados = montaDadosRelatorio(
      metricas({ ultimos_leads: muitos }),
      periodo(),
      new Map(),
      CONTA,
      AGORA,
    );
    assert.equal(dados.leads.length, MAX_LINHAS_TABELA);
    assert.equal(dados.totalLeadsListados, 40);
  });

  test('lead sem nome não vira linha em branco', () => {
    const dados = montaDadosRelatorio(metricas(), periodo(), new Map(), CONTA, AGORA);
    assert.equal(dados.leads[1].nome, 'Sem nome');
  });

  test('cabeçalho traz cliente, conta, canal e período', () => {
    const dados = montaDadosRelatorio(metricas(), periodo('whatsapp'), new Map(), CONTA, AGORA);
    assert.equal(dados.cliente, 'Cliente Teste');
    assert.equal(dados.adAccountId, 'act_123');
    assert.equal(dados.canal, 'WhatsApp');
    assert.equal(dados.periodo, 'Últimos 7 dias');
    assert.equal(dados.geradoEm, '31/08/2026 15:45');
  });

  test('repassa as lacunas de esquema para o aviso do PDF', () => {
    const dados = montaDadosRelatorio(
      metricas({ lacunas_de_esquema: ['whatsapp_conversations'] }),
      periodo(),
      new Map(),
      CONTA,
      AGORA,
    );
    assert.deepEqual(dados.lacunas, ['whatsapp_conversations']);
  });
});

describe('nomeArquivoRelatorio', () => {
  test('só ASCII, para não quebrar o Content-Disposition', () => {
    const nome = nomeArquivoRelatorio('cliente_anrg_energia_solar_33633175', 'form', AGORA);
    assert.match(nome, /^[A-Za-z0-9.\-]+$/);
    assert.equal(nome, 'metricas-cliente-anrg-energia-solar-33633175-form-20260831-1545.pdf');
  });

  test('remove acento em vez de deixar passar', () => {
    assert.ok(nomeArquivoRelatorio('Ação Solar', 'geral', AGORA).startsWith('metricas-acao-solar-'));
  });

  test('nome vazio ainda gera arquivo válido', () => {
    assert.ok(nomeArquivoRelatorio('___', 'geral', AGORA).startsWith('metricas-cliente-'));
  });
});

describe('escalaBarras', () => {
  test('a maior barra ocupa a altura toda', () => {
    assert.deepEqual(escalaBarras([0, 5, 10], 100), [1.5, 50, 100]);
  });

  test('dia sem lead vira fio visível, não some', () => {
    assert.deepEqual(escalaBarras([0, 0], 100), [1.5, 1.5]);
  });

  test('valor negativo não desenha barra invertida', () => {
    assert.deepEqual(escalaBarras([-3, 10], 100), [1.5, 100]);
  });
});
