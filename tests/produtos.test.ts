import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  derivaProdutos,
  leProdutos,
  normalizaProdutos,
  produtosQueFaltam,
  serializaProdutos,
} from '../src/lib/produtos';
import { leDadosDosProdutos, soOSubdominio } from '../src/lib/produtos-form';

/**
 * Produtos do cliente: a lista gravada em `ad_accounts.produtos` e os
 * campos que cada produto exige no cadastro. Um erro aqui passaria calado:
 * cliente salvo sem o produto escolhido, ou site criado sem domínio.
 */

function form(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

const TOKEN = 'x'.repeat(40);

test('normaliza: tira repetido e desconhecido, devolve na ordem canônica', () => {
  assert.deepEqual(
    normalizaProdutos(['whatsapp', 'LANDING_PAGE', 'whatsapp', 'site', '', null]),
    ['landing_page', 'whatsapp'],
  );
});

test('coluna NULL ou vazia é "não definido"', () => {
  assert.equal(leProdutos(null), null);
  assert.equal(leProdutos(''), null);
  assert.equal(leProdutos(' , lixo'), null);
  assert.deepEqual(leProdutos('whatsapp, formularios'), ['formularios', 'whatsapp']);
});

test('serializa e lê de volta sem perder nada', () => {
  const texto = serializaProdutos(['whatsapp', 'landing_page', 'formularios']);
  assert.equal(texto, 'landing_page,formularios,whatsapp');
  assert.deepEqual(leProdutos(texto), ['landing_page', 'formularios', 'whatsapp']);
});

test('deduz os produtos de cliente antigo pelo que está cadastrado', () => {
  assert.deepEqual(derivaProdutos({ temCrm: true, temWhatsapp: false, temSites: false }), ['formularios']);
  assert.deepEqual(derivaProdutos({ temCrm: false, temWhatsapp: true, temSites: true }), [
    'landing_page',
    'whatsapp',
  ]);
  assert.deepEqual(derivaProdutos({ temCrm: false, temWhatsapp: false, temSites: false }), []);
});

test('lista o que ainda dá para adicionar', () => {
  assert.deepEqual(produtosQueFaltam(['whatsapp']), ['landing_page', 'formularios']);
  assert.deepEqual(produtosQueFaltam(['landing_page', 'formularios', 'whatsapp']), []);
});

test('subdomínio do Kommo aceita a URL colada', () => {
  assert.equal(soOSubdominio('https://MinhaEmpresa.kommo.com/leads'), 'minhaempresa');
});

test('ignora campos de produto não escolhido', () => {
  const r = leDadosDosProdutos(form({ crm_account_id: '123' }), []);
  assert.deepEqual(r, { dados: {} });
});

test('Formulários exige conta e token do Kommo', () => {
  const semToken = leDadosDosProdutos(form({ crm_account_id: '123' }), ['formularios']);
  assert.ok('erro' in semToken && /token do Kommo/.test(semToken.erro));

  const ok = leDadosDosProdutos(
    form({ crm_account_id: '123', kommo_access_token: TOKEN, kommo_subdomain: 'https://acme.kommo.com' }),
    ['formularios'],
  );
  assert.ok('dados' in ok);
  assert.deepEqual(ok.dados.formularios, {
    crm_account_id: '123',
    kommo_access_token: TOKEN,
    kommo_subdomain: 'acme',
  });
});

test('Landing page exige domínio válido e etapa só com funil', () => {
  const semDominio = leDadosDosProdutos(form({ site_nome: 'LP' }), ['landing_page']);
  assert.ok('erro' in semDominio && /ao menos um domínio/.test(semDominio.erro));

  const invalido = leDadosDosProdutos(form({ site_nome: 'LP', site_dominios: 'não é domínio' }), [
    'landing_page',
  ]);
  assert.ok('erro' in invalido && /domínio inválido/.test(invalido.erro));

  const etapaSozinha = leDadosDosProdutos(
    form({ site_nome: 'LP', site_dominios: 'acme.com', site_kommo_status_id: '55' }),
    ['landing_page'],
  );
  assert.ok('erro' in etapaSozinha && /junto com o funil/.test(etapaSozinha.erro));

  const ok = leDadosDosProdutos(
    form({ site_nome: 'LP', site_dominios: 'https://www.acme.com/, lp.acme.com', site_envia_kommo: 'on' }),
    ['landing_page'],
  );
  assert.ok('dados' in ok);
  assert.deepEqual(ok.dados.landing_page, {
    nome: 'LP',
    dominios: ['acme.com', 'lp.acme.com'],
    kommo_pipeline_id: null,
    kommo_status_id: null,
    envia_kommo: true,
  });
});

test('WhatsApp pela Cloud API exige número e token; Evolution fica para depois', () => {
  const semNumero = leDadosDosProdutos(form({ whatsapp_via: 'cloud', cloud_access_token: TOKEN }), [
    'whatsapp',
  ]);
  assert.ok('erro' in semNumero && /phone_number_id/.test(semNumero.erro));

  const ok = leDadosDosProdutos(
    form({ whatsapp_via: 'cloud', cloud_phone_number_id: '1098', cloud_access_token: TOKEN }),
    ['whatsapp'],
  );
  assert.ok('dados' in ok);
  assert.deepEqual(ok.dados.whatsapp, {
    via: 'cloud',
    cloud_phone_number_id: '1098',
    cloud_waba_id: null,
    cloud_access_token: TOKEN,
  });

  const evolution = leDadosDosProdutos(form({ whatsapp_via: 'evolution' }), ['whatsapp']);
  assert.deepEqual(evolution, { dados: { whatsapp: { via: 'evolution' } } });
});
