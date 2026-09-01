import assert from 'node:assert/strict';
import test from 'node:test';

import { nomeParaExibir, telefoneParaExibir } from '../src/lib/exibicao';

test('nome e sobrenome saem em maiúscula', () => {
  assert.equal(nomeParaExibir('Icaro', 'Costa'), 'ICARO COSTA');
  assert.equal(nomeParaExibir('joão', 'gonçalves'), 'JOÃO GONÇALVES');
  assert.equal(nomeParaExibir('Ana', null), 'ANA');
  assert.equal(nomeParaExibir(null, null), '');
  assert.equal(nomeParaExibir('  ', ' '), '');
});

test('telefone com nono dígito', () => {
  assert.equal(telefoneParaExibir('5511987654321'), '+55 (11) 98765-4321');
  assert.equal(telefoneParaExibir('11987654321'), '+55 (11) 98765-4321');
});

test('telefone sem o nono dígito', () => {
  assert.equal(telefoneParaExibir('551134567890'), '+55 (11) 3456-7890');
  assert.equal(telefoneParaExibir('1134567890'), '+55 (11) 3456-7890');
});

test('número que não encaixa volta como veio', () => {
  assert.equal(telefoneParaExibir('12345'), '12345');
  assert.equal(telefoneParaExibir('+1 415 555 0000'), '+1 415 555 0000');
  assert.equal(telefoneParaExibir(null), '');
  assert.equal(telefoneParaExibir(''), '');
});

test('separadores no valor de entrada não atrapalham', () => {
  assert.equal(telefoneParaExibir('+55 (11) 98765-4321'), '+55 (11) 98765-4321');
});
