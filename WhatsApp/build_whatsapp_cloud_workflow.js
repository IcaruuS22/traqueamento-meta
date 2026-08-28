const fs = require('fs');
const path = require('path');

const CRED = { id: "MYSQL_CRED_PLACEHOLDER", name: "MySQL Trakeamento (configurar no n8n)" };

// Valor único por App Meta (não por cliente) — precisa ser o MESMO valor
// cadastrado no campo "Verify Token" do webhook, no App Dashboard da Meta
// (WhatsApp > Configuration). Troque antes de publicar.
const CLOUD_API_VERIFY_TOKEN = "TROCAR_ANTES_DE_PUBLICAR_whatsapp_verify_token";

// =======================================================
// Node graph builder (mesmo padrão de fábricas de
// build_admin_panel_workflow.js)
// =======================================================
const nodes = [];
const connections = {};
let uid = 0;
function nid(prefix) { uid++; return prefix + '-' + uid; }

function addNode(n) { nodes.push(n); return n; }
function connect(from, to, opts) {
  opts = opts || {};
  const outIndex = opts.outIndex || 0;
  connections[from] = connections[from] || { main: [] };
  while (connections[from].main.length <= outIndex) connections[from].main.push([]);
  connections[from].main[outIndex].push({ node: to, type: 'main', index: 0 });
}

function webhookNode(opts) {
  const params = {
    path: opts.pathStr,
    responseMode: opts.responseMode || "responseNode",
    options: {}
  };
  if (opts.method && opts.method !== "GET") params.httpMethod = opts.method;
  return addNode({
    parameters: params,
    type: "n8n-nodes-base.webhook",
    typeVersion: 2.1,
    position: opts.position,
    id: nid('webhook'),
    name: opts.name,
    webhookId: nid('whid')
  });
}

function mysqlNode(opts) {
  const params = { operation: "executeQuery", query: opts.query, options: {} };
  const node = {
    parameters: params,
    type: "n8n-nodes-base.mySql",
    typeVersion: 2.4,
    position: opts.position,
    id: nid('mysql'),
    name: opts.name,
    retryOnFail: true,
    credentials: { mySql: { id: CRED.id, name: CRED.name } }
  };
  if (opts.alwaysOutputData) node.alwaysOutputData = true;
  if (opts.onError) node.onError = opts.onError;
  return addNode(node);
}

function codeNode(opts) {
  return addNode({
    parameters: { jsCode: opts.code },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: opts.position,
    id: nid('code'),
    name: opts.name
  });
}

function cryptoNode(opts) {
  return addNode({
    parameters: { type: "SHA256", value: opts.value, dataPropertyName: opts.dataPropertyName },
    type: "n8n-nodes-base.crypto",
    typeVersion: 1,
    position: opts.position,
    id: nid('crypto'),
    name: opts.name
  });
}

function httpNode(opts) {
  const node = {
    parameters: {
      method: opts.method || "POST",
      url: opts.url,
      sendQuery: true,
      queryParameters: { parameters: opts.query || [] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: opts.jsonBody,
      options: {}
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: opts.position,
    id: nid('http'),
    name: opts.name,
    retryOnFail: true
  };
  if (opts.onError) node.onError = opts.onError;
  return addNode(node);
}

// Condição genérica (mesma estrutura do "Duplicado?" em build_event_workflow.js)
function ifCondNode(opts) {
  return addNode({
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
        conditions: [{
          id: "cond-" + nid('c'),
          leftValue: opts.leftValue,
          rightValue: opts.rightValue !== undefined ? opts.rightValue : "",
          operator: opts.operator || { type: "string", operation: "equals" }
        }],
        combinator: "and"
      },
      options: {}
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position: opts.position,
    id: nid('if'),
    name: opts.name
  });
}
function ifEqualsNode(opts) {
  return ifCondNode({
    name: opts.name,
    position: opts.position,
    leftValue: opts.leftValue,
    rightValue: opts.rightValue,
    operator: { type: "string", operation: "equals" }
  });
}
function ifNotEmptyNode(opts) {
  return ifCondNode({
    name: opts.name,
    position: opts.position,
    leftValue: opts.leftValue,
    rightValue: "",
    operator: { type: "string", operation: "notEquals" }
  });
}

function respondNode(opts) {
  const params = { respondWith: opts.respondWith || "json", options: {} };
  if (opts.responseCode) params.options.responseCode = opts.responseCode;
  if (opts.respondWith === "text") {
    params.responseBody = opts.body;
    if (opts.headers) params.options.responseHeaders = { entries: opts.headers };
  } else {
    params.responseBody = opts.body || "={{ $json }}";
  }
  return addNode({
    parameters: params,
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: opts.position,
    id: nid('respond'),
    name: opts.name
  });
}

// =======================================================
// Sticky note geral
// =======================================================
addNode({
  parameters: {
    content: "## WhatsApp Cloud API (oficial da Meta) — Webhook + CAPI multi-tenant\n\n" +
      "Recebe mensagens de WhatsApp via Cloud API (uma conexão por cliente, cadastrada na aba WhatsApp do painel -> tabela central `whatsapp_accounts`). " +
      "Resolve o cliente por `phone_number_id`, encontra ou cria o customer por telefone (últimos 10-11 dígitos, contorna as variações de formato já existentes em `customers.phone`), " +
      "grava a mensagem em `whatsapp_messages` e, se a conversa nasceu de um anúncio \"Clique para WhatsApp\" (`referral.ctwa_clid`) e ainda não foi enviado, dispara um evento `Contact` para a Meta CAPI (`action_source: business_messaging`) — em modo de teste enquanto `ad_accounts.meta_test_event_code` estiver preenchido.\n\n" +
      "ANTES DE PUBLICAR: troque a constante CLOUD_API_VERIFY_TOKEN no topo deste script pelo mesmo valor cadastrado no App Dashboard da Meta (WhatsApp > Configuration > Webhook > Verify Token), e configure a credencial MySQL no node genérico.",
    height: 420,
    width: 1100,
    color: 4
  },
  type: "n8n-nodes-base.stickyNote",
  position: [-520, -220],
  typeVersion: 1,
  id: "sticky-whatsapp",
  name: "Sticky Note WhatsApp"
});

// =======================================================
// A) GET /whatsapp-cloud-webhook — handshake de verificação da Meta
// =======================================================
const webhookVerify = webhookNode({ method: "GET", pathStr: "whatsapp-cloud-webhook", name: "WhatsApp Cloud - Verificacao (GET)", position: [-480, 40] });

const ifVerifyToken = ifEqualsNode({
  name: "Verify Token Confere?",
  position: [-240, 40],
  leftValue: "={{ $json.query && $json.query['hub.verify_token'] }}",
  rightValue: CLOUD_API_VERIFY_TOKEN
});
connect(webhookVerify.name, ifVerifyToken.name);

const respondChallenge = respondNode({
  name: "Responde Challenge",
  position: [0, -40],
  respondWith: "text",
  body: "={{ $json.query['hub.challenge'] }}",
  headers: [{ name: "Content-Type", value: "text/plain; charset=utf-8" }]
});
connect(ifVerifyToken.name, respondChallenge.name, { outIndex: 0 });

const respondVerifyFalhou = respondNode({
  name: "Responde Verificacao Falhou",
  position: [0, 120],
  respondWith: "text",
  responseCode: 403,
  body: "Verify token inválido.",
  headers: [{ name: "Content-Type", value: "text/plain; charset=utf-8" }]
});
connect(ifVerifyToken.name, respondVerifyFalhou.name, { outIndex: 1 });

// =======================================================
// B) POST /whatsapp-cloud-webhook — recebe mensagens/status
// =======================================================
const webhookMsg = webhookNode({ method: "POST", pathStr: "whatsapp-cloud-webhook", name: "WhatsApp Cloud - Recebe (POST)", position: [-480, 320] });

const EXTRAI_METADADOS_CODE = `// Extrai os campos relevantes do payload de webhook da Cloud API.
// A Meta manda tanto mensagens reais (value.messages) quanto callbacks
// de entrega/leitura (value.statuses) no MESMO webhook -- os callbacks
// de status precisam ser ignorados sem erro (sinalizado por ignorar_flag).
const body = $json.body || {};
const entry = (body.entry && body.entry[0]) || {};
const change = (entry.changes && entry.changes[0]) || {};
const value = change.value || {};

function normalizeWhatsappPhone(raw) {
  const digits = String(raw || '').replace(/\\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') ? digits : '55' + digits;
}

if (!value.messages || !value.messages[0]) {
  return [{ json: { ignorar_flag: '1' } }];
}

const message = value.messages[0];
const contact = (value.contacts && value.contacts[0]) || {};
const referral = message.referral || {};

return [{
  json: {
    ignorar_flag: '0',
    phone_number_id: (value.metadata && value.metadata.phone_number_id) || '',
    wa_message_id: message.id,
    telefone_normalizado: normalizeWhatsappPhone(message.from),
    tipo_mensagem: message.type,
    texto_mensagem: (message.text && message.text.body) || '',
    timestamp_unix: Number(message.timestamp) || Math.floor(Date.now() / 1000),
    nome_perfil: (contact.profile && contact.profile.name) || null,
    referral_ad_id: referral.source_id || null,
    referral_ctwa_clid: referral.ctwa_clid || null,
    referral_source_url: referral.source_url || null,
    raw: value
  }
}];
`;
const codeExtrai = codeNode({ name: "Extrai Metadados Cloud API", position: [-240, 320], code: EXTRAI_METADADOS_CODE });
connect(webhookMsg.name, codeExtrai.name);

const ifIgnorar = ifEqualsNode({
  name: "Deve Ignorar? (status/sem mensagem)",
  position: [-16, 320],
  leftValue: "={{ $json.ignorar_flag }}",
  rightValue: "1"
});
connect(codeExtrai.name, ifIgnorar.name);

const respondIgnorado = respondNode({ name: "Responde Ignorado", position: [208, 240], body: "={{ { message: 'ok (status/sem mensagem, ignorado)' } }}" });
connect(ifIgnorar.name, respondIgnorado.name, { outIndex: 0 });

// Responde 200 pra Meta AQUI, antes de qualquer consulta ao banco ou
// chamada à CAPI -- ainda dentro do modo "Respond to Webhook" (n8n não
// deixa combinar "onReceived" com nós de resposta explícitos mais
// abaixo, dá erro de configuração). Todo o processamento (achar conta,
// achar/criar customer, gravar mensagem, disparar CAPI) continua
// normalmente depois deste nó, em background -- só que agora sem
// nenhum outro "Responde ..." nos ramos seguintes, porque só se pode
// responder uma vez por execução. Isso evita estourar o timeout de
// webhook da Meta (que causava reenvio da mesma notificação e,
// processada de novo, mensagem duplicada no painel).
const respondRecebido = respondNode({ name: "Responde Recebido (ack imediato)", position: [208, 400], body: "={{ { message: 'ok (recebido, processando)' } }}" });
connect(ifIgnorar.name, respondRecebido.name, { outIndex: 1 });

// Resolve o cliente dono desse número de WhatsApp (equivalente ao
// "Busca Conta CRM" de build_event_workflow.js, só que a chave de
// roteamento aqui é phone_number_id em vez de crm_account_id).
const mysqlBuscaConta = mysqlNode({
  name: "Busca Conta WhatsApp",
  position: [432, 400],
  alwaysOutputData: true,
  query: "=SELECT wa.*, aa.client_db_name, aa.ad_account_id, aa.meta_pixel_dataset_id, aa.meta_access_token, aa.meta_test_event_code FROM `trakeamento_controle`.`whatsapp_accounts` wa JOIN `trakeamento_controle`.`ad_accounts` aa ON aa.client_db_name = wa.client_db_name WHERE wa.cloud_phone_number_id = {{ JSON.stringify($json.phone_number_id) }} AND wa.status = 'ACTIVE' LIMIT 1"
});
connect(respondRecebido.name, mysqlBuscaConta.name);

const codeDecideProcessamento = codeNode({
  name: "Decide Processamento",
  position: [432, 400],
  code: "const contaEncontrada = !!$json.client_db_name;\nreturn [{ json: Object.assign({}, $json, { processar_flag: contaEncontrada ? '1' : '0' }) }];\n"
});
connect(mysqlBuscaConta.name, codeDecideProcessamento.name);

const ifDeveProcessar = ifEqualsNode({
  name: "Conta Encontrada?",
  position: [656, 400],
  leftValue: "={{ $json.processar_flag }}",
  rightValue: "1"
});
connect(codeDecideProcessamento.name, ifDeveProcessar.name);

// Sem nó de resposta aqui -- a Meta já recebeu o ack em "Responde
// Recebido (ack imediato)" lá em cima. Conta desconhecida (número não
// cadastrado em whatsapp_accounts) simplesmente não gera nenhuma
// gravação; o ramo termina aqui mesmo.

// =======================================================
// C) Encontra ou cria o customer pelo telefone
// =======================================================
const mysqlBuscaCustomer = mysqlNode({
  name: "Busca Customer por Telefone",
  position: [880, 320],
  alwaysOutputData: true,
  query: "=SELECT * FROM `{{ $json.client_db_name.replace(/`/g,'') }}`.`customers` WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = RIGHT({{ JSON.stringify($('Extrai Metadados Cloud API').item.json.telefone_normalizado) }}, 10) ORDER BY id DESC LIMIT 1"
});
connect(ifDeveProcessar.name, mysqlBuscaCustomer.name, { outIndex: 0 });

const ifCustomerEncontrado = ifNotEmptyNode({
  name: "Customer Encontrado?",
  position: [1104, 320],
  leftValue: "={{ String($json.id || '') }}"
});
connect(mysqlBuscaCustomer.name, ifCustomerEncontrado.name);

const codeCustomerExistente = codeNode({
  name: "Normaliza Customer Existente",
  position: [1328, 240],
  code: "return [{ json: { customer_id: $json.id, whatsapp_contact_capi_sent_at: $json.whatsapp_contact_capi_sent_at || null } }];\n"
});
connect(ifCustomerEncontrado.name, codeCustomerExistente.name, { outIndex: 0 });

const mysqlCriaCustomer = mysqlNode({
  name: "Cria Customer via WhatsApp",
  position: [1328, 420],
  query: "=INSERT INTO `{{ $('Decide Processamento').item.json.client_db_name.replace(/`/g,'') }}`.`customers` (ad_account_id, first_name, phone, meta_ad_id, current_stage) VALUES ({{ JSON.stringify($('Decide Processamento').item.json.ad_account_id || null) }}, {{ JSON.stringify($('Extrai Metadados Cloud API').item.json.nome_perfil || null) }}, {{ JSON.stringify($('Extrai Metadados Cloud API').item.json.telefone_normalizado) }}, {{ JSON.stringify($('Extrai Metadados Cloud API').item.json.referral_ad_id || null) }}, 'whatsapp_contact')"
});
connect(ifCustomerEncontrado.name, mysqlCriaCustomer.name, { outIndex: 1 });

const codeCustomerNovo = codeNode({
  name: "Normaliza Customer Novo",
  position: [1552, 420],
  code: "return [{ json: { customer_id: $json.insertId, whatsapp_contact_capi_sent_at: null } }];\n"
});
connect(mysqlCriaCustomer.name, codeCustomerNovo.name);

// =======================================================
// D) Grava a mensagem (idempotente por wa_message_id, igual ao
// padrão de meta_capi_events.event_id)
// =======================================================
const MONTA_INSERT_MENSAGEM_CODE = `function sqlVal(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return JSON.stringify(String(v));
}
function sqlIdent(v) {
  return '\`' + String(v).replace(/\`/g, '') + '\`';
}

const dbName = $('Decide Processamento').item.json.client_db_name;
const msg = $('Extrai Metadados Cloud API').item.json;
const customerId = $json.customer_id;

const sql =
  'INSERT INTO ' + sqlIdent(dbName) + '.\`whatsapp_messages\` ' +
  '(customer_id, direction, wa_message_id, phone, message_type, message_text, message_timestamp_unix, referral_ad_id, referral_ctwa_clid, raw_payload) VALUES (' +
  [
    customerId ? Number(customerId) : 'NULL',
    "'inbound'",
    sqlVal(msg.wa_message_id),
    sqlVal(msg.telefone_normalizado),
    sqlVal(msg.tipo_mensagem),
    sqlVal(msg.texto_mensagem),
    Number(msg.timestamp_unix) || 0,
    sqlVal(msg.referral_ad_id),
    sqlVal(msg.referral_ctwa_clid),
    sqlVal(JSON.stringify(msg.raw))
  ].join(', ') + ');';

return [{
  json: {
    sql: sql,
    customer_id: customerId,
    whatsapp_contact_capi_sent_at: $json.whatsapp_contact_capi_sent_at,
    referral_ctwa_clid: msg.referral_ctwa_clid,
    client_db_name: dbName
  }
}];
`;
const codeMontaInsertMensagem = codeNode({ name: "Monta Insert Mensagem", position: [1776, 320], code: MONTA_INSERT_MENSAGEM_CODE });
connect(codeCustomerExistente.name, codeMontaInsertMensagem.name);
connect(codeCustomerNovo.name, codeMontaInsertMensagem.name);

const mysqlInsereMensagem = mysqlNode({
  name: "Insere Mensagem",
  position: [2000, 320],
  onError: "continueErrorOutput",
  query: "={{ $json.sql }}"
});
connect(codeMontaInsertMensagem.name, mysqlInsereMensagem.name);

// Mantém a aba "Conversas" do painel (CRM) em dia: soma 1 na contagem
// de não-lidas e atualiza o "último recebido" (last_inbound_at), que
// sustenta a checagem da janela de 24h antes de liberar o envio de
// resposta livre pelo painel. Roda mesmo se "Insere Mensagem" cair no
// branch de duplicado (reentrega de webhook não deveria reincrementar
// não-lidas, mas o INSERT original já é idempotente por wa_message_id —
// se essa mensagem específica já existia, o duplicado aqui é o mesmo
// evento reentregue, então o pequeno risco de contar 1x a mais numa
// reentrega rara é aceitável frente à simplicidade de sempre atualizar).
const MONTA_UPSERT_CONVERSA_CODE = `function sqlIdent(v) {
  return '\`' + String(v).replace(/\`/g, '') + '\`';
}
const dbName = $('Monta Insert Mensagem').item.json.client_db_name;
const customerId = $('Monta Insert Mensagem').item.json.customer_id;
const sql = customerId
  ? 'INSERT INTO ' + sqlIdent(dbName) + '.\`whatsapp_conversations\` (customer_id, unread_count, last_message_at, last_inbound_at) VALUES (' + Number(customerId) + ', 1, NOW(), NOW()) ON DUPLICATE KEY UPDATE unread_count = unread_count + 1, last_message_at = NOW(), last_inbound_at = NOW();'
  : '';
return [{ json: { sql: sql } }];
`;
const codeMontaUpsertConversa = codeNode({ name: "Monta Upsert Conversa WhatsApp", position: [2000, 480], code: MONTA_UPSERT_CONVERSA_CODE });
connect(mysqlInsereMensagem.name, codeMontaUpsertConversa.name, { outIndex: 0 });
connect(mysqlInsereMensagem.name, codeMontaUpsertConversa.name, { outIndex: 1 });

const mysqlUpsertConversa = mysqlNode({
  name: "Upsert Conversa WhatsApp",
  position: [2112, 480],
  onError: "continueErrorOutput",
  query: "={{ $json.sql }}"
});
connect(codeMontaUpsertConversa.name, mysqlUpsertConversa.name);

// =======================================================
// E) Decide se dispara o evento CAPI de Contato (só na primeira
// mensagem de uma conversa originada de anúncio "Clique p/ WhatsApp",
// guardado por customers.whatsapp_contact_capi_sent_at)
// =======================================================
const DECIDE_CAPI_CODE = `const ctwaClid = $('Monta Insert Mensagem').item.json.referral_ctwa_clid || '';
const jaEnviado = !!$('Monta Insert Mensagem').item.json.whatsapp_contact_capi_sent_at;
const customerId = $('Monta Insert Mensagem').item.json.customer_id;
const deveDisparar = (ctwaClid && !jaEnviado && customerId) ? '1' : '0';
return [{ json: { deve_disparar_flag: deveDisparar, customer_id: customerId } }];
`;
const codeDecideCapi = codeNode({ name: "Decide Disparo CAPI", position: [2224, 320], code: DECIDE_CAPI_CODE });
connect(mysqlUpsertConversa.name, codeDecideCapi.name, { outIndex: 0 });
connect(mysqlUpsertConversa.name, codeDecideCapi.name, { outIndex: 1 });

const ifDeveDispararCapi = ifEqualsNode({
  name: "Deve Disparar CAPI?",
  position: [2448, 320],
  leftValue: "={{ $json.deve_disparar_flag }}",
  rightValue: "1"
});
connect(codeDecideCapi.name, ifDeveDispararCapi.name);

// Sem nó de resposta aqui -- ack já foi dado no início. Mensagem sem
// disparo de CAPI (não veio de "Clique p/ WhatsApp") simplesmente
// termina depois de gravada.

// =======================================================
// F) Dispara o evento "Contact" para a Meta CAPI
// (action_source: business_messaging — schema de Business Messaging,
// distinto do action_source: system_generated usado nos leads de
// Instant Form. Validar o formato exato na Test Events tool da Meta
// durante os primeiros testes, por isso o disparo entra sempre com
// test_event_code enquanto ad_accounts.meta_test_event_code existir.)
// =======================================================
const cryptoTelefoneWhatsapp = cryptoNode({
  name: "Crypto Telefone WhatsApp",
  position: [2672, 240],
  value: "={{ $('Extrai Metadados Cloud API').item.json.telefone_normalizado }}",
  dataPropertyName: "crypto_ph"
});
connect(ifDeveDispararCapi.name, cryptoTelefoneWhatsapp.name, { outIndex: 0 });

const MONTA_PAYLOAD_CAPI_CODE = `const info = $('Decide Processamento').item.json;
const msg = $('Extrai Metadados Cloud API').item.json;
const phHash = $('Crypto Telefone WhatsApp').item.json.crypto_ph;

const payload = {
  data: [
    {
      event_name: 'Contact',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      event_id: 'whatsapp_contact_' + msg.wa_message_id,
      user_data: {
        ph: [phHash],
        ctwa_clid: msg.referral_ctwa_clid
      }
    }
  ]
};

if (msg.referral_ad_id) {
  payload.data[0].attribution_data = {
    ad_id: String(msg.referral_ad_id),
    attribution_share: 1
  };
}

if (info.meta_test_event_code) {
  payload.test_event_code = info.meta_test_event_code;
}

return [{ json: payload }];
`;
const codeMontaPayloadCapi = codeNode({ name: "Monta Payload CAPI WhatsApp", position: [2896, 240], code: MONTA_PAYLOAD_CAPI_CODE });
connect(cryptoTelefoneWhatsapp.name, codeMontaPayloadCapi.name);

const httpEnviaCapi = httpNode({
  name: "Envia Evento CAPI WhatsApp",
  position: [3120, 240],
  url: "=https://graph.facebook.com/v25.0/{{ $('Decide Processamento').item.json.meta_pixel_dataset_id }}/events",
  query: [{ name: "access_token", value: "={{ $('Decide Processamento').item.json.meta_access_token }}" }],
  jsonBody: "={{ JSON.stringify($json) }}",
  onError: "continueErrorOutput"
});
connect(codeMontaPayloadCapi.name, httpEnviaCapi.name);

const MONTA_LOG_CAPI_SUCESSO_CODE = `function sqlVal(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return JSON.stringify(String(v));
}
function sqlIdent(v) {
  return '\`' + String(v).replace(/\`/g, '') + '\`';
}

const dbName = $('Decide Processamento').item.json.client_db_name;
const customerId = $('Decide Disparo CAPI').item.json.customer_id;
const payload = $('Monta Payload CAPI WhatsApp').item.json;
const eventId = payload.data[0].event_id;

const sqlEvento =
  'INSERT INTO ' + sqlIdent(dbName) + '.\`meta_capi_events\` ' +
  '(customer_id, event_name, event_id, event_time_unix, action_source, lead_event_source, user_data_hashed, meta_payload_sent, meta_response, status) VALUES (' +
  [
    customerId ? Number(customerId) : 'NULL',
    sqlVal(payload.data[0].event_name),
    sqlVal(eventId),
    Number(payload.data[0].event_time) || 0,
    sqlVal(payload.data[0].action_source),
    "'whatsapp_ctwa'",
    sqlVal(JSON.stringify(payload.data[0].user_data)),
    sqlVal(JSON.stringify(payload)),
    sqlVal(JSON.stringify($json)),
    "'SENT'"
  ].join(', ') + ') ON DUPLICATE KEY UPDATE meta_response = ' + sqlVal(JSON.stringify($json)) + ", status = 'SENT';";

const sqlCustomer = customerId
  ? 'UPDATE ' + sqlIdent(dbName) + '.\`customers\` SET whatsapp_contact_capi_sent_at = NOW() WHERE id = ' + Number(customerId) + ';'
  : '';
const sqlMensagem =
  'UPDATE ' + sqlIdent(dbName) + '.\`whatsapp_messages\` SET capi_event_id = ' + sqlVal(eventId) +
  ' WHERE wa_message_id = ' + sqlVal($('Extrai Metadados Cloud API').item.json.wa_message_id) + ';';

return [{ json: { sql_evento: sqlEvento, sql_customer: sqlCustomer, sql_mensagem: sqlMensagem } }];
`;
const codeLogCapiSucesso = codeNode({ name: "Monta Log CAPI (sucesso)", position: [3344, 160], code: MONTA_LOG_CAPI_SUCESSO_CODE });
connect(httpEnviaCapi.name, codeLogCapiSucesso.name, { outIndex: 0 });

const mysqlLogEvento = mysqlNode({ name: "Grava Log Evento CAPI", position: [3568, 160], onError: "continueErrorOutput", query: "={{ $json.sql_evento }}" });
connect(codeLogCapiSucesso.name, mysqlLogEvento.name);
const mysqlMarcaCustomer = mysqlNode({ name: "Marca Customer (CAPI enviado)", position: [3792, 160], onError: "continueErrorOutput", query: "={{ $('Monta Log CAPI (sucesso)').item.json.sql_customer }}" });
connect(mysqlLogEvento.name, mysqlMarcaCustomer.name);
const mysqlMarcaMensagem = mysqlNode({ name: "Marca Mensagem (capi_event_id)", position: [4016, 160], onError: "continueErrorOutput", query: "={{ $('Monta Log CAPI (sucesso)').item.json.sql_mensagem }}" });
connect(mysqlMarcaCustomer.name, mysqlMarcaMensagem.name);
// Sem nó de resposta aqui -- ack já foi dado no início do workflow.

const MONTA_LOG_CAPI_ERRO_CODE = `function sqlVal(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return JSON.stringify(String(v));
}
function sqlIdent(v) {
  return '\`' + String(v).replace(/\`/g, '') + '\`';
}

const dbName = $('Decide Processamento').item.json.client_db_name;
const customerId = $('Decide Disparo CAPI').item.json.customer_id;
const payload = $('Monta Payload CAPI WhatsApp').item.json;
const eventId = payload.data[0].event_id;

const sql =
  'INSERT INTO ' + sqlIdent(dbName) + '.\`meta_capi_events\` ' +
  '(customer_id, event_name, event_id, event_time_unix, action_source, lead_event_source, user_data_hashed, meta_payload_sent, meta_response, status, error_message) VALUES (' +
  [
    customerId ? Number(customerId) : 'NULL',
    sqlVal(payload.data[0].event_name),
    sqlVal(eventId),
    Number(payload.data[0].event_time) || 0,
    sqlVal(payload.data[0].action_source),
    "'whatsapp_ctwa'",
    sqlVal(JSON.stringify(payload.data[0].user_data)),
    sqlVal(JSON.stringify(payload)),
    sqlVal(JSON.stringify($json)),
    "'ERROR'",
    sqlVal(($json.error && $json.error.message) || JSON.stringify($json))
  ].join(', ') + ') ON DUPLICATE KEY UPDATE meta_response = ' + sqlVal(JSON.stringify($json)) + ", status = 'ERROR';";

return [{ json: { sql: sql } }];
`;
const codeLogCapiErro = codeNode({ name: "Monta Log CAPI (erro)", position: [3344, 320], code: MONTA_LOG_CAPI_ERRO_CODE });
connect(httpEnviaCapi.name, codeLogCapiErro.name, { outIndex: 1 });
const mysqlLogEventoErro = mysqlNode({ name: "Grava Log Evento CAPI (erro)", position: [3568, 320], onError: "continueErrorOutput", query: "={{ $json.sql }}" });
connect(codeLogCapiErro.name, mysqlLogEventoErro.name);
// Sem nó de resposta aqui -- ack já foi dado no início. Falha no disparo
// do CAPI é só logada em meta_capi_events, não precisa responder de novo.

// =======================================================
// Workflow output
// =======================================================
const workflow = {
  name: "WhatsApp Cloud API - Webhook",
  nodes: nodes,
  connections: connections,
  active: false,
  settings: { executionOrder: "v1", binaryMode: "separate", availableInMCP: false },
  meta: { instanceId: "manual-build" },
  id: "WhatsappCloudApiWebhook",
  tags: []
};

const outPath = path.join(__dirname, 'WhatsApp Cloud API - Webhook.json');
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2), 'utf8');
console.log('OK -> ' + outPath);
console.log('Nodes:', nodes.length);
