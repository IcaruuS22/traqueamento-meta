import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montaLeadDaMeta, separaNome, soDigitos } from '../src/lib/lead-formulario';

/**
 * O que se testa aqui é a tradução do `field_data` da Meta para as
 * colunas de `customers` — a parte que erra em silêncio. A ida à Graph
 * API não é testada: seria testar o `fetch`.
 */

test('lê os campos padrão do formulário', () => {
  const lead = montaLeadDaMeta('1398009702228225', {
    id: '1398009702228225',
    created_time: '2026-08-05T08:56:17-0300',
    ad_id: '120253755814610368',
    form_id: '2104340726812036',
    field_data: [
      { name: 'full_name', values: ['Café Messias'] },
      { name: 'email', values: ['CafeMessiasOficial@gmail.com'] },
      { name: 'phone_number', values: ['+33988395919'] },
    ],
  });

  assert.equal(lead.meta_lead_id, '1398009702228225');
  assert.equal(lead.first_name, 'Café');
  assert.equal(lead.last_name, 'Messias');
  assert.equal(lead.email, 'cafemessiasoficial@gmail.com');
  assert.equal(lead.phone, '33988395919');
  assert.equal(lead.meta_ad_id, '120253755814610368');
  assert.equal(lead.meta_form_id, '2104340726812036');
});

test('first_name/last_name explícitos ganham do full_name', () => {
  const lead = montaLeadDaMeta('1', {
    field_data: [
      { name: 'full_name', values: ['Ignorado Completamente'] },
      { name: 'first_name', values: ['Camila'] },
      { name: 'last_name', values: ['Guerra'] },
    ],
  });
  assert.equal(lead.first_name, 'Camila');
  assert.equal(lead.last_name, 'Guerra');
});

test('campo personalizado do cliente não vira coluna', () => {
  const lead = montaLeadDaMeta('1', {
    field_data: [
      { name: 'qual_o_tipo_de_instalação_você_possui?', values: ['instalação_comercial'] },
      { name: 'full_name', values: ['Maria'] },
    ],
  });
  assert.equal(lead.first_name, 'Maria');
  assert.equal(lead.last_name, null);
  assert.equal(lead.city, null);
});

test('resposta sem field_data não quebra', () => {
  const lead = montaLeadDaMeta('999', {});
  assert.equal(lead.meta_lead_id, '999');
  assert.equal(lead.first_name, null);
  assert.equal(lead.phone, null);
  assert.equal(lead.created_time, null);
});

test('telefone guarda só dígitos, como o resto da base', () => {
  assert.equal(soDigitos('+55 (34) 99606-4076'), '5534996064076');
  assert.equal(soDigitos(''), null);
  assert.equal(soDigitos(null), null);
});

test('nome de uma palavra fica sem sobrenome', () => {
  assert.deepEqual(separaNome('Maria'), { first: 'Maria', last: null });
  assert.deepEqual(separaNome('  Ana  Paula  Souza '), { first: 'Ana', last: 'Paula Souza' });
});
