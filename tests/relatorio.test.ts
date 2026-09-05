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
import { ROTULO_RECOMENDACAO, avaliaOrcamento, fraseOrcamento } from '../src/lib/orcamento';
import {
  montaOrcamentoPorCategoria,
  type CategoriaVerba,
  type GastoCategoria,
} from '../src/lib/orcamento-categorias';
import { fmtBRL } from '../src/lib/format';
import type { Metricas, Totais, Lead } from '../src/lib/db/metricas';
import type { OrcamentoDoMes } from '../src/lib/db/orcamento';

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
    motivos_de_perda: [],
    lacunas_de_esquema: [],
    ...extra,
  } as Metricas;
}

const CONTA = { account_name: 'Cliente Teste', ad_account_id: 'act_123' };

const MES = '2026-08';
const HOJE = '2026-08-15';

/**
 * Orçamento do mês como `buscaOrcamentoDoMes` devolveria.
 *
 * Montado pelos mesmos módulos puros que a tela usa, e não à mão: um
 * objeto escrito no teste passaria a existir só aqui e deixaria de
 * quebrar no dia em que a avaliação de ritmo mudasse.
 */
function orcamentoDoMes(
  investimento: number | null = 6000,
  gasto = 2400,
  categorias: CategoriaVerba[] = [],
  gastos: Map<number | null, GastoCategoria> = new Map(),
): OrcamentoDoMes {
  return {
    orcamento: avaliaOrcamento({
      investimento,
      gasto,
      gastoAteOntem: gasto,
      mes: MES,
      hoje: HOJE,
    }),
    categorias: montaOrcamentoPorCategoria({
      categorias,
      gastos,
      investimento,
      mes: MES,
      hoje: HOJE,
    }),
  };
}
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
    const dados = montaDadosRelatorio(m, periodo(), new Map(), CONTA, orcamentoDoMes(), AGORA);
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
    const dados = montaDadosRelatorio(metricas(), periodo(), new Map(), CONTA, orcamentoDoMes(), AGORA);
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
      orcamentoDoMes(),
      AGORA,
    );
    assert.ok(dados.kpis.every((k) => k.variacao === null));
  });

  test('KPI sem valor comparável não inventa variação', () => {
    const dados = montaDadosRelatorio(metricas(), periodo(), new Map(), CONTA, orcamentoDoMes(), AGORA);
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
      orcamentoDoMes(),
      AGORA,
    );
    assert.equal(dados.leads.length, MAX_LINHAS_TABELA);
    assert.equal(dados.totalLeadsListados, 40);
  });

  test('lead sem nome não vira linha em branco', () => {
    const dados = montaDadosRelatorio(metricas(), periodo(), new Map(), CONTA, orcamentoDoMes(), AGORA);
    assert.equal(dados.leads[1].nome, 'Sem nome');
  });

  test('cabeçalho traz cliente, conta, canal e período', () => {
    const dados = montaDadosRelatorio(metricas(), periodo('whatsapp'), new Map(), CONTA, orcamentoDoMes(), AGORA);
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
      orcamentoDoMes(),
      AGORA,
    );
    assert.deepEqual(dados.lacunas, ['whatsapp_conversations']);
  });
});

describe('montaDadosRelatorio · orçamento do mês', () => {
  test('leva gasto, investimento e a mesma recomendação da tela', () => {
    const dados = montaDadosRelatorio(
      metricas(),
      periodo(),
      new Map(),
      CONTA,
      orcamentoDoMes(6000, 2400),
      AGORA,
    );
    assert.equal(dados.orcamento.titulo, 'Orçamento de agosto de 2026');
    assert.equal(dados.orcamento.temInvestimento, true);
    assert.equal(dados.orcamento.gasto, fmtBRL(2400));
    assert.equal(dados.orcamento.investimento, fmtBRL(6000));
    assert.equal(dados.orcamento.situacao, ROTULO_RECOMENDACAO[dados.orcamento.recomendacao]);
    assert.equal(dados.orcamento.frase, fraseOrcamento(orcamentoDoMes(6000, 2400).orcamento));
  });

  test('sem investimento cadastrado, pede o cadastro em vez de mostrar teto zero', () => {
    const dados = montaDadosRelatorio(
      metricas(),
      periodo(),
      new Map(),
      CONTA,
      orcamentoDoMes(null, 900),
      AGORA,
    );
    assert.equal(dados.orcamento.temInvestimento, false);
    assert.equal(dados.orcamento.investimento, '—');
    assert.match(dados.orcamento.detalhe, /administração/);
  });

  test('mês em andamento mostra projeção e restante; a barra é uma fração', () => {
    const dados = montaDadosRelatorio(
      metricas(),
      periodo(),
      new Map(),
      CONTA,
      orcamentoDoMes(6000, 2400),
      AGORA,
    );
    assert.match(dados.orcamento.detalhe, /Projeção/);
    assert.match(dados.orcamento.detalhe, /Restam/);
    assert.ok(dados.orcamento.consumo > 0 && dados.orcamento.consumo < 1);
  });
});

describe('montaDadosRelatorio · verba por categoria', () => {
  const CATEGORIAS: CategoriaVerba[] = [
    { id: 1, nome: 'Captação', verba: 4000, ordem: 0 },
    { id: 2, nome: 'Remarketing', verba: null, ordem: 1 },
  ];
  const GASTOS = new Map<number | null, GastoCategoria>([
    [1, { total: 1800, ateOntem: 1800 }],
    [2, { total: 400, ateOntem: 400 }],
    [null, { total: 200, ateOntem: 200 }],
  ]);

  function comCategorias() {
    return montaDadosRelatorio(
      metricas(),
      periodo(),
      new Map(),
      CONTA,
      orcamentoDoMes(6000, 2400, CATEGORIAS, GASTOS),
      AGORA,
    ).verba;
  }

  test('uma linha por categoria, mais a das campanhas não classificadas', () => {
    const verba = comCategorias();
    assert.deepEqual(
      verba.linhas.map((l) => l.nome),
      ['Captação', 'Remarketing', 'Sem categoria'],
    );
    assert.equal(verba.linhas.at(-1)!.semCategoria, true);
  });

  test('categoria com verba tem teto e recomendação; sem verba tem a fatia do mês', () => {
    const [captacao, remarketing] = comCategorias().linhas;
    assert.equal(captacao.semVerba, false);
    assert.equal(captacao.referencia, `de ${fmtBRL(4000)}`);
    assert.ok(captacao.situacao.length > 0);

    assert.equal(remarketing.semVerba, true);
    assert.match(remarketing.referencia, /% do gasto do mês$/);
    // Sem teto não há consumo a desenhar: barra cheia diria "estourou"
    // sobre um limite que ninguém combinou.
    assert.equal(remarketing.consumo, 0);
    assert.equal(remarketing.situacao, '');
    assert.equal(remarketing.frase, 'Sem verba própria cadastrada.');
  });

  test('a linha sem categoria fala de classificação pendente, não de verba', () => {
    const sem = comCategorias().linhas.at(-1)!;
    assert.equal(sem.frase, 'Campanhas ainda não atribuídas a nenhuma categoria.');
  });

  test('avisa quando a soma das categorias não bate com o investimento', () => {
    const verba = comCategorias();
    // 4.000 distribuídos contra 6.000 combinados.
    assert.match(verba.aviso ?? '', /ainda não estão em nenhuma categoria/);
  });

  test('sem categoria nenhuma, o bloco explica onde criá-las', () => {
    const verba = montaDadosRelatorio(
      metricas(),
      periodo(),
      new Map(),
      CONTA,
      orcamentoDoMes(6000, 0),
      AGORA,
    ).verba;
    assert.equal(verba.linhas.length, 0);
    assert.match(verba.vazio, /Nenhuma categoria de verba cadastrada/);
  });
});

describe('montaDadosRelatorio · motivos de perda', () => {
  function comPerdas(linhas: { motivo: string | null; total: number }[]) {
    return montaDadosRelatorio(
      metricas({ motivos_de_perda: linhas }),
      periodo(),
      new Map(),
      CONTA,
      orcamentoDoMes(),
      AGORA,
    ).perdas;
  }

  test('junta a mesma grafia e ordena do maior para o menor', () => {
    const perdas = comPerdas([
      { motivo: 'preço', total: 4 },
      { motivo: 'Preço', total: 6 },
      { motivo: 'Sem retorno', total: 3 },
    ]);
    assert.deepEqual(
      perdas.linhas.map((l) => l.rotulo),
      ['Preço', 'Sem retorno'],
    );
    assert.equal(perdas.linhas[0].valor, 10);
    assert.equal(perdas.linhas[0].percentual, '76,9%');
  });

  test('perda sem motivo vira a última linha, marcada', () => {
    const perdas = comPerdas([
      { motivo: 'Preço', total: 2 },
      { motivo: null, total: 5 },
    ]);
    const ultima = perdas.linhas.at(-1)!;
    assert.equal(ultima.semMotivo, true);
    assert.match(perdas.nota ?? '', /ninguém registrou/);
  });

  test('sem perda no período não há resumo nem linhas', () => {
    const perdas = comPerdas([]);
    assert.equal(perdas.linhas.length, 0);
    assert.equal(perdas.resumo, null);
    assert.equal(perdas.nota, null);
  });

  test('o resumo conta leads e motivos distintos', () => {
    const perdas = comPerdas([
      { motivo: 'Preço', total: 2 },
      { motivo: 'Sem retorno', total: 1 },
    ]);
    assert.equal(perdas.resumo, '3 leads perdidos · 2 motivos distintos');
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
