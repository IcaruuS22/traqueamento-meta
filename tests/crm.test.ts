import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAVE_SEM_ETAPA,
  chaveColuna,
  ehContatoDeWhatsapp,
  ehOrigem,
  etapaDoFunilForm,
  montaQuadro,
  nomeDoCartao,
  type LinhaCartao,
} from '../src/lib/crm';

/**
 * Testes do quadro do CRM.
 *
 * A consulta é coberta pelos testes de integração; o que se garante aqui
 * é a regra que decide o que aparece na tela — de qual funil é cada
 * lead, em qual coluna ele cai e, principalmente, qual coluna aceita
 * card. Errar isso deixaria um lead de formulário arrastável, e mover a
 * etapa dele por aqui contaria conversão que não houve.
 */

function linha(parcial: Partial<LinhaCartao> & { id: number }): LinhaCartao {
  return {
    first_name: 'Ana',
    last_name: 'Silva',
    email: null,
    phone: null,
    created_at: '2026-08-01 10:00:00',
    current_stage: null,
    meta_lead_id: null,
    status_conversa: null,
    tags: null,
    unread_count: null,
    last_message_at: null,
    tem_conversa: 0,
    campanha: null,
    ...parcial,
  };
}

const ETAPAS_FORM = [
  { status_id: '142', content_name: 'Ganho' },
  { status_id: '143', content_name: null },
];
const ETAPAS_WPP = [
  { estagio: 'atendimento', content_name: 'Em atendimento' },
  { estagio: 'ganho', content_name: null },
];

describe('colunas', () => {
  test('cada funil traz as suas, e só as de WhatsApp aceitam card', () => {
    const { colunas, tem_etapas } = montaQuadro(ETAPAS_FORM, ETAPAS_WPP, [], null);
    assert.equal(tem_etapas, true);

    const form = colunas.filter((c) => c.origem === 'form');
    const wpp = colunas.filter((c) => c.origem === 'whatsapp');
    assert.equal(form.length, 2);
    assert.equal(wpp.length, 2);
    assert.ok(form.every((c) => c.aceita_solta === false));
    assert.ok(wpp.every((c) => c.aceita_solta === true));

    // Etapa sem nome cadastrado não some: cai para o valor cru.
    assert.equal(colunas.find((c) => c.chave === 'form:143')!.rotulo, '143');
  });

  test('a última é sempre "Sem etapa", e nunca aceita card', () => {
    const { colunas } = montaQuadro(ETAPAS_FORM, ETAPAS_WPP, [], null);
    const ultima = colunas[colunas.length - 1];
    assert.equal(ultima.chave, CHAVE_SEM_ETAPA);
    assert.equal(ultima.origem, null);
    assert.equal(ultima.aceita_solta, false);
  });

  test('sem nenhuma etapa cadastrada, tem_etapas é falso', () => {
    const { colunas, tem_etapas } = montaQuadro([], [], [], null);
    assert.equal(tem_etapas, false);
    assert.deepEqual(
      colunas.map((c) => c.chave),
      [CHAVE_SEM_ETAPA],
    );
  });

  test('etapa que aparece no lead mas não está cadastrada vira coluna extra travada', () => {
    const { colunas, cartoes } = montaQuadro(
      ETAPAS_FORM,
      ETAPAS_WPP,
      [linha({ id: 1, tem_conversa: 1, status_conversa: 'reuniao_marcada' })],
      null,
    );
    const extra = colunas.find((c) => c.valor === 'reuniao_marcada');
    assert.ok(extra, 'coluna extra não foi criada');
    assert.equal(extra!.origem, null);
    assert.equal(extra!.aceita_solta, false);
    // A coluna extra entra antes de "Sem etapa".
    assert.equal(colunas[colunas.length - 1].chave, CHAVE_SEM_ETAPA);
    assert.equal(cartoes[0].chave_coluna, extra!.chave);
    assert.equal(cartoes[0].etapa_rotulo, extra!.rotulo);
  });
});

describe('origem do card', () => {
  test('lead com meta_lead_id é de formulário mesmo tendo conversa', () => {
    const { cartoes } = montaQuadro(
      ETAPAS_FORM,
      ETAPAS_WPP,
      [linha({ id: 1, meta_lead_id: '99', tem_conversa: 1, current_stage: '142' })],
      null,
    );
    assert.equal(cartoes[0].origem, 'form');
    assert.equal(cartoes[0].tem_conversa, true);
    assert.equal(cartoes[0].chave_coluna, chaveColuna('form', '142'));
  });

  test('contato só de conversa é de WhatsApp e usa a etapa da conversa', () => {
    const { cartoes } = montaQuadro(
      ETAPAS_FORM,
      ETAPAS_WPP,
      [
        linha({
          id: 2,
          tem_conversa: 1,
          status_conversa: 'atendimento',
          // A ingestão marca o current_stage com o sentinela; o quadro
          // não pode confundir isso com etapa do Kommo.
          current_stage: 'whatsapp_contact',
        }),
      ],
      null,
    );
    assert.equal(cartoes[0].origem, 'whatsapp');
    assert.equal(cartoes[0].chave_coluna, chaveColuna('whatsapp', 'atendimento'));
    assert.equal(cartoes[0].etapa_rotulo, 'Em atendimento');
  });

  test('contato recém-criado pela ingestão já é de WhatsApp, sem linha de conversa ainda', () => {
    // A ingestão cria o `customers` com o marcador em `current_stage` e
    // só depois a primeira mensagem cria a conversa. Nesse intervalo o
    // contato não pode aparecer como lead de formulário — nem o marcador
    // pode virar coluna do funil do Kommo.
    const { cartoes, colunas } = montaQuadro(
      ETAPAS_FORM,
      ETAPAS_WPP,
      [linha({ id: 9, current_stage: 'whatsapp_contact', tem_conversa: 0 })],
      null,
    );
    assert.equal(cartoes[0].origem, 'whatsapp');
    assert.equal(cartoes[0].chave_coluna, CHAVE_SEM_ETAPA);
    assert.ok(!colunas.some((c) => c.valor === 'whatsapp_contact'));
  });

  test('o marcador nunca vira etapa do funil de formulário', () => {
    assert.equal(etapaDoFunilForm('whatsapp_contact'), null);
    assert.equal(etapaDoFunilForm('  '), null);
    assert.equal(etapaDoFunilForm('142'), '142');
    // Lead de formulário é sempre de formulário, mesmo com conversa.
    assert.equal(ehContatoDeWhatsapp('99', 'whatsapp_contact', true), false);
  });

  test('lead sem etapa nenhuma cai na coluna "Sem etapa"', () => {
    const { cartoes } = montaQuadro(ETAPAS_FORM, ETAPAS_WPP, [linha({ id: 3 })], null);
    assert.equal(cartoes[0].chave_coluna, CHAVE_SEM_ETAPA);
    assert.equal(cartoes[0].etapa, null);
    assert.equal(cartoes[0].etapa_rotulo, null);
  });

  test('não-lidas e conversa chegam normalizados, mesmo vindo como string do driver', () => {
    const { cartoes } = montaQuadro(
      ETAPAS_FORM,
      ETAPAS_WPP,
      [linha({ id: 4, tem_conversa: '1', unread_count: '3', status_conversa: 'ganho' })],
      null,
    );
    assert.equal(cartoes[0].tem_conversa, true);
    assert.equal(cartoes[0].mensagens_nao_lidas, 3);
  });
});

describe('funil da tela', () => {
  test('deixa passar só o funil pedido', () => {
    const linhas = [
      linha({ id: 1, meta_lead_id: '99', current_stage: '142' }),
      linha({ id: 2, tem_conversa: 1, status_conversa: 'ganho' }),
    ];
    assert.deepEqual(
      montaQuadro(ETAPAS_FORM, ETAPAS_WPP, linhas, 'whatsapp').cartoes.map((c) => c.id),
      [2],
    );
    assert.deepEqual(
      montaQuadro(ETAPAS_FORM, ETAPAS_WPP, linhas, 'form').cartoes.map((c) => c.id),
      [1],
    );
    assert.equal(montaQuadro(ETAPAS_FORM, ETAPAS_WPP, linhas, null).total, 2);
  });

  test('as colunas do outro funil ficam de fora', () => {
    // São duas telas, uma por funil. Coluna do outro funil nunca vai
    // receber card aqui, e ainda traria a regra de arrastar dele junto.
    const wpp = montaQuadro(ETAPAS_FORM, ETAPAS_WPP, [], 'whatsapp').colunas;
    assert.equal(wpp.some((c) => c.origem === 'form'), false);
    assert.equal(wpp.filter((c) => c.origem === 'whatsapp').length, 2);
    assert.equal(wpp.every((c) => c.origem !== 'whatsapp' || c.aceita_solta), true);

    const form = montaQuadro(ETAPAS_FORM, ETAPAS_WPP, [], 'form').colunas;
    assert.equal(form.some((c) => c.origem === 'whatsapp'), false);
    assert.equal(form.filter((c) => c.origem === 'form').length, 2);
    assert.equal(form.every((c) => !c.aceita_solta), true);
  });

  test('sem etapa cadastrada no funil da tela, o quadro se diz vazio', () => {
    // Cliente que só cadastrou o funil do Kommo abre a tela do WhatsApp:
    // o aviso tem de falar de `whatsapp_event_map`, não mostrar as
    // colunas do outro funil como se estivesse tudo certo.
    const { tem_etapas } = montaQuadro(ETAPAS_FORM, [], [], 'whatsapp');
    assert.equal(tem_etapas, false);
  });

  test('origem fora da whitelist não é aceita como filtro', () => {
    assert.equal(ehOrigem('form'), true);
    assert.equal(ehOrigem('whatsapp'), true);
    assert.equal(ehOrigem("form' OR 1=1"), false);
    assert.equal(ehOrigem(null), false);
  });
});

describe('nomeDoCartao', () => {
  test('cai para e-mail e depois telefone antes de desistir', () => {
    assert.equal(
      nomeDoCartao({ first_name: 'Ana', last_name: 'Silva', email: 'a@b.c', phone: '11' }),
      'Ana Silva',
    );
    assert.equal(
      nomeDoCartao({ first_name: null, last_name: null, email: 'a@b.c', phone: '11' }),
      'a@b.c',
    );
    assert.equal(
      nomeDoCartao({ first_name: null, last_name: null, email: '', phone: '5511999' }),
      '5511999',
    );
    assert.equal(
      nomeDoCartao({ first_name: null, last_name: null, email: null, phone: null }),
      'Contato sem nome',
    );
  });
});
