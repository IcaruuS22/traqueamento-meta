import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  confirmacaoDeExclusaoBate,
  ehBancoProtegido,
  geraNomeBanco,
  separaStatements,
} from '../src/lib/nomes-banco';

/**
 * O template SQL é a única fonte do esquema por cliente. Se ele parar de
 * ser divisível em comandos executáveis — ou o marcador do nome do banco
 * escapar de algum lugar — a criação de cliente só quebraria em produção,
 * com um banco pela metade. Estes testes rodam contra o arquivo real.
 */

const TEMPLATE = readFileSync(
  path.join(process.cwd(), 'Banco de Dados', '02_Template_Banco_Por_Cliente.sql'),
  'utf8',
);

test('divide o template real em comandos, sem sobra de comentário nem de marcador', () => {
  const comandos = separaStatements(TEMPLATE, 'cliente_teste_1');

  assert.ok(comandos.length > 15, `poucos comandos: ${comandos.length}`);
  assert.ok(!comandos.some((c) => c.includes('{{DB_NAME}}')), 'marcador sobrou');
  assert.ok(!comandos.some((c) => c.includes('--')), 'comentário sobrou');
  assert.ok(!comandos.some((c) => c.trim() === ''), 'comando vazio');
  assert.ok(comandos[0].startsWith('CREATE DATABASE IF NOT EXISTS `cliente_teste_1`'));
});

test('cria todas as tabelas do template', () => {
  const comandos = separaStatements(TEMPLATE, 'cliente_teste_1');
  const criadas = comandos
    .map((c) => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(c)?.[1])
    .filter(Boolean);

  for (const tabela of [
    'customers',
    'crm_meta_event_map',
    'meta_capi_events',
    'meta_campaigns',
    'meta_adsets',
    'meta_ads',
    'meta_insights_daily',
    'whatsapp_messages',
    'whatsapp_conversations',
    'whatsapp_event_map',
  ]) {
    assert.ok(criadas.includes(tabela), `faltou CREATE TABLE de ${tabela}`);
  }
});

test('nome de banco malicioso é sanitizado, não injetado', () => {
  const comandos = separaStatements(TEMPLATE, '`; DROP DATABASE alvo; --');

  // Sobra só o miolo alfanumérico do nome; nenhum comando extra nasce da
  // pontuação, e o `;` do meio não vira separador de comando.
  assert.ok(comandos[0].includes('`DROPDATABASEalvo`'));
  assert.ok(!comandos.some((c) => /DROP\s+DATABASE/i.test(c)));
});

test('nome vazio é recusado antes de virar SQL', () => {
  assert.throws(() => separaStatements(TEMPLATE, '---'), /inválido/);
});

test('gera o mesmo nome de banco que o workflow antigo', () => {
  assert.equal(
    geraNomeBanco('ANRG Energia Solar', '33633175'),
    'cliente_anrg_energia_solar_33633175',
  );
  // Acento e pontuação viram separador; o sufixo usa os 10 últimos
  // caracteres alfanuméricos do ID do CRM.
  assert.equal(geraNomeBanco('Café & Cia.', 'abc-123456789012'), 'cliente_cafe_cia_3456789012');
});

test('sem CRM, o nome ainda começa por letra e não fica com sufixo vazio', () => {
  const nome = geraNomeBanco('123 Reformas', null);
  assert.match(nome, /^[a-z_][a-z0-9_]*$/);
  assert.ok(nome.startsWith('cliente_123_reformas_'));
  assert.ok(nome.length > 'cliente_123_reformas_'.length);
});


/**
 * Estas duas funções são as barreiras da exclusão de cliente, que apaga
 * o banco inteiro sem lixeira nem desfazer. Testar aqui é barato; testar
 * em produção não existe.
 */

test('nenhum banco de controle ou do MySQL pode ser apagado como cliente', () => {
  for (const nome of [
    'trakeamento_controle',
    'TRAKEAMENTO_CONTROLE',
    'mysql',
    'information_schema',
    'performance_schema',
    'sys',
  ]) {
    assert.equal(ehBancoProtegido(nome), true, nome);
  }

  assert.equal(ehBancoProtegido('cliente_acresce_imoveis_33994099'), false);
  // A sanitização vem antes da lista: disfarçar o nome com crase cai na
  // mesma recusa. Já o espaço não vira `_` (a sanitização remove o que
  // não é [A-Za-z0-9_]), então `trakeamento controle` passa como outro
  // nome — que não existe no servidor.
  assert.equal(ehBancoProtegido('`trakeamento_controle`'), true);
});

test('confirmação de exclusão aceita nome do cliente ou do banco, e recusa o resto', () => {
  const alvos = ['Acresce Imóveis', 'cliente_acresce_imoveis_33994099'];

  assert.equal(confirmacaoDeExclusaoBate('Acresce Imóveis', alvos), true);
  assert.equal(confirmacaoDeExclusaoBate('  acresce   imóveis ', alvos), true);
  assert.equal(confirmacaoDeExclusaoBate('cliente_acresce_imoveis_33994099', alvos), true);

  assert.equal(confirmacaoDeExclusaoBate('Acresce', alvos), false);
  assert.equal(confirmacaoDeExclusaoBate('Acresce Imoveis', alvos), false);
  assert.equal(confirmacaoDeExclusaoBate('', alvos), false);
  assert.equal(confirmacaoDeExclusaoBate('   ', alvos), false);
});
