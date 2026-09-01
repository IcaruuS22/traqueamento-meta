import assert from 'node:assert/strict';
import test from 'node:test';

import { fmtEspera, rotuloPrimeiraResposta } from '../src/lib/whatsapp-conversas';

test('espera legível em cada escala', () => {
  assert.equal(fmtEspera(0), '0 s');
  assert.equal(fmtEspera(45), '45 s');
  assert.equal(fmtEspera(12 * 60), '12 min');
  assert.equal(fmtEspera(3 * 3600), '3 h');
  assert.equal(fmtEspera(24 * 3600), '1 dia');
  assert.equal(fmtEspera(72 * 3600), '3 dias');
  assert.equal(fmtEspera(-10), '0 s');
});

test('conversa já respondida mostra o tempo da primeira resposta', () => {
  assert.equal(
    rotuloPrimeiraResposta({
      primeiro_contato: 1_700_000_000,
      primeira_resposta: 1_700_000_240,
      segundos_ate_resposta: 240,
      segundos_esperando: null,
    }),
    '1ª resposta em 4 min',
  );
});

test('conversa sem resposta mostra a espera acumulada', () => {
  assert.equal(
    rotuloPrimeiraResposta({
      primeiro_contato: 1_700_000_000,
      primeira_resposta: null,
      segundos_ate_resposta: null,
      segundos_esperando: 7200,
    }),
    'sem resposta há 2 h',
  );
});

test('sem primeiro contato não há o que mostrar', () => {
  assert.equal(rotuloPrimeiraResposta(null), null);
  assert.equal(
    rotuloPrimeiraResposta({
      primeiro_contato: null,
      primeira_resposta: null,
      segundos_ate_resposta: null,
      segundos_esperando: null,
    }),
    null,
  );
});
