import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ehEtapaDeGanho, ehEtapaDePerda, normalizaMotivo } from '../src/lib/funil';
import { faixaDoEstagio } from '../src/lib/whatsapp-conversas';

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

  // O cliente cadastra o estágio com a inicial maiúscula ("Perdido") e a
  // classificação por IA grava assim também. O MySQL compara sem
  // diferenciar caixa, então a listagem sempre acertou; antes daqui o
  // JavaScript discordava e a conversa fechada ficava em "Em aberto".
  // A etapa do funil de formulários é espelho do CRM do cliente, então o
  // selo "Ganho" depende de reconhecer o nome escrito lá: "Contrato
  // assinado" é o que os clientes usam hoje.
  test('etapa de ganho reconhece os nomes de fechamento', () => {
    assert.equal(ehEtapaDeGanho('ganho'), true);
    assert.equal(ehEtapaDeGanho('Contrato assinado'), true);
    assert.equal(ehEtapaDeGanho('  CONTRATO  ASSINADO '), true);
    assert.equal(ehEtapaDeGanho('contrato_assinado'), true);
    assert.equal(ehEtapaDeGanho('Venda realizada'), true);
    assert.equal(ehEtapaDeGanho('Em negociação'), false);
    assert.equal(ehEtapaDeGanho('perdido'), false);
    assert.equal(ehEtapaDeGanho(null), false);
  });

  test('caixa e espaço do estágio não mudam a decisão', () => {
    assert.equal(ehEtapaDePerda('Perdido'), true);
    assert.equal(ehEtapaDePerda('  PERDIDO '), true);
    assert.equal(faixaDoEstagio('Ganho'), 'ganho');
    assert.equal(faixaDoEstagio('Perdido'), 'perdido');
    assert.equal(faixaDoEstagio('Lead'), 'aberto');
    assert.equal(faixaDoEstagio(null), 'aberto');
  });
});
