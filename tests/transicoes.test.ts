import test from 'node:test';
import assert from 'node:assert/strict';
import { ordemDasEtapas, transicoesDoFunil, type MarcoDeEtapa } from '../src/lib/transicoes';

const H = 3_600_000;

function marco(customer_id: number, stage_name: string, event_name: string, ms: number): MarcoDeEtapa {
  return { customer_id, stage_name, event_name, ms };
}

test('ordena etapas pela posição do evento Meta, não pela ordem de chegada', () => {
  const marcos = [
    marco(1, 'Contrato Assinado', 'Purchase', 100),
    marco(1, 'Lead Gerado', 'Lead', 200),
    marco(1, 'Reunião Marcada', 'Schedule', 300),
  ];
  assert.deepEqual(ordemDasEtapas(marcos), ['Lead Gerado', 'Reunião Marcada', 'Contrato Assinado']);
});

test('etapas com o mesmo evento empatam pela primeira ocorrência', () => {
  const marcos = [
    marco(1, 'Simulação Enviada', 'Lead', 5_000),
    marco(1, 'Lead Gerado', 'Lead', 1_000),
    marco(1, 'Compra', 'Purchase', 9_000),
  ];
  assert.deepEqual(ordemDasEtapas(marcos), ['Lead Gerado', 'Simulação Enviada', 'Compra']);
});

test('mede só pares vizinhos do funil e devolve na ordem do funil', () => {
  const marcos = [
    marco(1, 'Lead Gerado', 'Lead', 0),
    marco(1, 'Reunião Marcada', 'Schedule', 2 * H),
    marco(1, 'Contrato Assinado', 'Purchase', 6 * H),
    marco(2, 'Lead Gerado', 'Lead', 0),
    marco(2, 'Reunião Marcada', 'Schedule', 4 * H),
    marco(2, 'Contrato Assinado', 'Purchase', 10 * H),
  ];
  assert.deepEqual(transicoesDoFunil(marcos), [
    { from_stage: 'Lead Gerado', to_stage: 'Reunião Marcada', avg_ms: 3 * H, count: 2 },
    { from_stage: 'Reunião Marcada', to_stage: 'Contrato Assinado', avg_ms: 5 * H, count: 2 },
  ]);
});

test('lead que pulou etapa não entra na média dos passos que não percorreu', () => {
  const marcos = [
    marco(1, 'Lead Gerado', 'Lead', 0),
    marco(1, 'Reunião Marcada', 'Schedule', 1 * H),
    marco(1, 'Contrato Assinado', 'Purchase', 3 * H),
    // lead 2 foi direto de Lead Gerado para Contrato Assinado
    marco(2, 'Lead Gerado', 'Lead', 0),
    marco(2, 'Contrato Assinado', 'Purchase', 100 * H),
  ];
  const saida = transicoesDoFunil(marcos);
  assert.deepEqual(saida, [
    { from_stage: 'Lead Gerado', to_stage: 'Reunião Marcada', avg_ms: 1 * H, count: 1 },
    { from_stage: 'Reunião Marcada', to_stage: 'Contrato Assinado', avg_ms: 2 * H, count: 1 },
  ]);
  assert.ok(!saida.some((t) => t.from_stage === 'Lead Gerado' && t.to_stage === 'Contrato Assinado'));
});

test('usa a primeira ocorrência quando o lead repete a etapa', () => {
  const marcos = [
    marco(1, 'Lead Gerado', 'Lead', 10 * H),
    marco(1, 'Lead Gerado', 'Lead', 2 * H),
    marco(1, 'Compra', 'Purchase', 12 * H),
  ];
  assert.deepEqual(transicoesDoFunil(marcos), [
    { from_stage: 'Lead Gerado', to_stage: 'Compra', avg_ms: 10 * H, count: 1 },
  ]);
});

test('descarta trecho com tempo negativo', () => {
  const marcos = [
    marco(1, 'Lead Gerado', 'Lead', 5 * H),
    marco(1, 'Compra', 'Purchase', 1 * H),
  ];
  assert.deepEqual(transicoesDoFunil(marcos), []);
});

test('etapa com evento fora do catálogo vai para o fim', () => {
  const marcos = [
    marco(1, 'Etapa Custom', 'EventoDesconhecido', 0),
    marco(1, 'Lead Gerado', 'Lead', 1 * H),
    marco(1, 'Compra', 'Purchase', 2 * H),
  ];
  assert.deepEqual(ordemDasEtapas(marcos), ['Lead Gerado', 'Compra', 'Etapa Custom']);
});

test('sem marcos, sem transições', () => {
  assert.deepEqual(transicoesDoFunil([]), []);
  assert.deepEqual(ordemDasEtapas([]), []);
});
