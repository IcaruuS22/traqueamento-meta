import test from 'node:test';
import assert from 'node:assert/strict';
import { chaveTelefone, mesmoTelefone, normalizaTelefone } from '../src/lib/telefone';
import { telefoneDoJid } from '../src/lib/evolution-payload';

test('normaliza igual ao fluxo do n8n: só dígitos, com 55 na frente', () => {
  assert.equal(normalizaTelefone('+55 (33) 99179-3333'), '5533991793333');
  assert.equal(normalizaTelefone('33991793333'), '5533991793333');
  assert.equal(normalizaTelefone('5533991793333'), '5533991793333');
  assert.equal(normalizaTelefone(''), '');
  assert.equal(normalizaTelefone(null), '');
  assert.equal(normalizaTelefone('sem número'), '');
});

test('a chave de comparação são os 10 últimos dígitos', () => {
  assert.equal(chaveTelefone('5533991793333'), '3991793333');
  assert.equal(chaveTelefone('553391793333'), '3391793333');
});

test('o mesmo número casa com e sem DDI', () => {
  assert.ok(mesmoTelefone('553391793333', '3391793333'));
  assert.ok(mesmoTelefone('+55 33 9179-3333', '553391793333'));
});

test('números de pessoas diferentes não casam, e vazio não casa com nada', () => {
  assert.ok(!mesmoTelefone('553391793333', '553384311539'));
  assert.ok(!mesmoTelefone('', ''));
  assert.ok(!mesmoTelefone('553391793333', ''));
});

test('número curto exige igualdade inteira — a cauda daria falso positivo', () => {
  assert.ok(mesmoTelefone('91793333', '91793333'));
  assert.ok(!mesmoTelefone('91793333', '1793333'));
});

test('o telefone do JID sai normalizado, e grupo/status viram nulo', () => {
  assert.equal(telefoneDoJid('553391793333@s.whatsapp.net'), '553391793333');
  assert.equal(telefoneDoJid('553391793333:12@s.whatsapp.net'), '553391793333');
  assert.equal(telefoneDoJid('3391793333@s.whatsapp.net'), '553391793333');
  assert.equal(telefoneDoJid('120363@g.us'), null);
  assert.equal(telefoneDoJid('status@broadcast'), null);
});
