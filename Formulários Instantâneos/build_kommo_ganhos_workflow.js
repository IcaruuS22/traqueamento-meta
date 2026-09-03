const fs = require('fs');
const path = require('path');

const MYSQL_CRED = { id: "MYSQL_CRED_PLACEHOLDER", name: "MySQL Trakeamento (configurar no n8n)" };

// Quantos ids de negócio cabem em uma consulta ao Kommo. A API aceita
// filter[id][] repetido; 50 mantém a URL curta e já é o suficiente para
// o ciclo inteiro da maioria dos clientes caber em poucas chamadas.
const IDS_POR_LOTE = 50;
// Teto de lotes por ciclo, somando TODOS os clientes. O que sobrar volta
// no próximo ciclo: só sai da fila o lead que já foi verificado.
const MAX_LOTES_POR_CICLO = 20;
// Teto de leads pendentes lidos por cliente em cada ciclo.
const MAX_LEADS_POR_CLIENTE = 500;

// =======================================================
// Node graph builder (mesmo padrão de fábricas dos outros workflows —
// cada builder duplica seus próprios helpers em vez de importar de um
// módulo compartilhado).
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

function mysqlNode(opts) {
  const node = {
    parameters: { operation: "executeQuery", query: opts.query, options: {} },
    type: "n8n-nodes-base.mySql",
    typeVersion: 2.4,
    position: opts.position,
    id: nid('mysql'),
    name: opts.name,
    retryOnFail: true,
    credentials: { mySql: { id: MYSQL_CRED.id, name: MYSQL_CRED.name } }
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

function ifStringEqualsNode(opts) {
  return addNode({
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
        conditions: [{
          id: "cond-" + nid('c'),
          leftValue: opts.leftValue,
          rightValue: opts.rightValue,
          operator: { type: "string", operation: "equals" }
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

// Sanitiza o nome do banco tanto pro identificador entre crases quanto
// pro literal de string da coluna client_db. Nada além de [A-Za-z0-9_].
const SANITIZA_DB = "replace(/[^A-Za-z0-9_]/g, '')";

// =======================================================
// Sticky note com o passo a passo de configuração
// =======================================================
addNode({
  parameters: {
    content: "## Kommo - Sincroniza Ganhos\n\n**O que este workflow faz:** de 15 em 15 minutos, pega os leads de formulário que já existem no banco de cada cliente, pergunta ao Kommo em que etapa cada negócio está e, para os que estão numa etapa marcada como **conversão** na aba Eventos, atualiza a etapa no painel e grava o valor do negócio informado pelo Kommo.\n\n**O Kommo nunca é alterado.** Só há `GET /api/v4/leads` aqui: nenhum negócio é criado, movido ou editado no CRM. A escrita acontece só no seu banco, em `customers`.\n\n**Ele também NÃO envia evento nenhum para a Meta.** Quem envia Purchase é o fluxo de eventos, no momento em que o webhook do Kommo chega. Este workflow existe para corrigir o painel quando aquele webhook se perdeu — e um webhook perdido continua sendo um evento não enviado, que este fluxo não recupera.\n\n**Configuração necessária (uma única vez):**\n1. Marque a caixa **Conta como conversão** na etapa de ganho de cada cliente, na aba **Eventos** do painel.\n2. Preencha o **subdomínio do Kommo** de cada cliente em **/admin/clientes** — sem ele o cliente é pulado, porque um workflow por agenda não recebe o webhook de onde o subdomínio costuma vir.\n3. Rode a migração `Banco de Dados/migracao_kommo_subdominio.sql` no banco central.\n4. Depois de importar, **ATIVE este workflow** — sem isso o Schedule Trigger nunca dispara.\n\n**Fila:** entra lead com `crm_lead_id` preenchido que ainda não está numa etapa de conversão. O lead sai da fila no momento em que ganha, porque a própria etapa dele passa a ser de conversão; quem não ganhou volta a ser consultado no ciclo seguinte.\n\n**Um lead que já estava perdido e depois ganhou** tem a etapa corrigida aqui, mas `lost_at` e `lost_reason` ficam como estavam — o quadro mostra a coluna certa, e o modal ainda mostra o motivo da perda antiga. Limpar isso exigiria escrever colunas que nem todo banco de cliente tem.\n\n**Por que não existe loop dentro de loop:** as consultas por cliente rodam de uma vez só para todos, cada linha carregando a coluna `client_db` para não se perder de qual cliente veio. Há UM loop, sobre os lotes de ids. Loop aninhado no n8n não reinicia o contador do loop interno: ele ficaria concluído depois do primeiro cliente e todos os demais seriam pulados em silêncio.",
    height: 700,
    width: 580,
    color: 4
  },
  type: "n8n-nodes-base.stickyNote",
  position: [-1180, -200],
  typeVersion: 1,
  id: "sticky-kommo-ganhos",
  name: "Sticky Note Kommo Ganhos"
});

// =======================================================
// A) Gatilho: de 15 em 15 minutos. Nada aqui é urgente — o caminho
// normal do ganho é o webhook, que chega em segundos; este fluxo é a
// rede de segurança para quando aquele webhook se perde.
// =======================================================
const scheduleTrigger = addNode({
  parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 15 }] } },
  id: nid('schedule'),
  name: "A Cada 15 Minutos",
  type: "n8n-nodes-base.scheduleTrigger",
  typeVersion: 1.2,
  position: [-1180, 560]
});

// Só clientes que dá para consultar: com token E com subdomínio. Quem
// não tem subdomínio gravado é pulado aqui mesmo, sem erro.
const mysqlContas = mysqlNode({
  name: "Busca Contas Kommo",
  position: [-960, 560],
  alwaysOutputData: true,
  query: "=SELECT a.* FROM `trakeamento_controle`.`ad_accounts` a WHERE a.status = 'ACTIVE' AND COALESCE(a.kommo_access_token, '') <> '' AND COALESCE(a.kommo_subdomain, '') <> ''"
});
connect(scheduleTrigger.name, mysqlContas.name);

// alwaysOutputData acima faz o node emitir um item vazio quando não há
// conta nenhuma; este filtro descarta esse placeholder. Sobrando zero,
// devolve [] e a cadeia termina aqui, sem loop pendurado.
const codeFiltraContas = codeNode({
  name: "Filtra Contas Validas",
  position: [-740, 560],
  code: "return $input.all().filter(function(i){ return i.json && i.json.client_db_name; });\n"
});
connect(mysqlContas.name, codeFiltraContas.name);

// =======================================================
// B) Etapas de ganho de CADA cliente, numa passada só. São as marcadas
// como "Conta como conversão" na aba Eventos — a mesma marcação que faz
// o painel contar o lead como convertido nas métricas, então o ganho
// aqui e o ganho no relatório são sempre a mesma coisa.
//
// `ativo = 1` porque etapa desativada não descreve mais o funil do
// cliente; e é o mesmo filtro que o fluxo de eventos usa.
// =======================================================
const mysqlEtapasGanho = mysqlNode({
  name: "Busca Etapas de Ganho",
  position: [-520, 560],
  alwaysOutputData: true,
  onError: "continueRegularOutput",
  // `tem_crm_value` vem junto porque `customers.crm_value` depende de uma
  // migração que nem todo cliente rodou. Sem essa checagem, o UPDATE
  // inteiro falharia no banco sem a coluna e o ganho não seria gravado —
  // o valor é o extra, a etapa é o que não pode se perder.
  query: "=SELECT '{{ $json.client_db_name." + SANITIZA_DB + " }}' AS client_db, status_id,"
    + " (SELECT COUNT(*) FROM information_schema.COLUMNS c"
    + " WHERE c.TABLE_SCHEMA = '{{ $json.client_db_name." + SANITIZA_DB + " }}'"
    + " AND c.TABLE_NAME = 'customers' AND c.COLUMN_NAME = 'crm_value') AS tem_crm_value"
    + " FROM `{{ $json.client_db_name." + SANITIZA_DB + " }}`.`crm_meta_event_map` WHERE is_conversion = 1 AND ativo = 1 AND COALESCE(status_id, '') <> ''"
});
connect(codeFiltraContas.name, mysqlEtapasGanho.name);

// O node acima devolve etapas (não clientes), então a cadeia precisa
// voltar à forma "um item por cliente" antes da próxima query.
const codeReemiteContas = codeNode({
  name: "Reemite Contas",
  position: [-300, 560],
  code: "return $('Filtra Contas Validas').all();\n"
});
connect(mysqlEtapasGanho.name, codeReemiteContas.name);

// =======================================================
// C) Leads a verificar, de todos os clientes numa passada só.
//
// A fila é o próprio `current_stage`: quem já está numa etapa de
// conversão não é perguntado de novo, e é assim que o lead sai da fila
// sem precisar de coluna nova nenhuma. O COALESCE é o que garante isso
// para lead sem etapa: em SQL, `NULL NOT IN (...)` não é verdadeiro, e
// sem ele o lead recém-criado — justamente o que mais interessa — nunca
// entraria na fila.
// =======================================================
const mysqlLeads = mysqlNode({
  name: "Busca Leads a Verificar",
  position: [-80, 560],
  onError: "continueRegularOutput",
  query: "=SELECT '{{ $json.client_db_name." + SANITIZA_DB + " }}' AS client_db, id AS customer_id, crm_lead_id"
    + " FROM `{{ $json.client_db_name." + SANITIZA_DB + " }}`.`customers`"
    + " WHERE COALESCE(crm_lead_id, '') <> ''"
    + " AND COALESCE(current_stage, '') NOT IN ("
    + "SELECT status_id FROM `{{ $json.client_db_name." + SANITIZA_DB + " }}`.`crm_meta_event_map`"
    + " WHERE is_conversion = 1 AND ativo = 1 AND COALESCE(status_id, '') <> '')"
    + " ORDER BY id DESC LIMIT " + MAX_LEADS_POR_CLIENTE
});
connect(codeReemiteContas.name, mysqlLeads.name);

// =======================================================
// D) Monta os lotes: agrupa os leads por cliente, corta em lotes de
// IDS_POR_LOTE ids, intercala os clientes (round-robin) e aplica o teto
// global. Sem o round-robin, um cliente com fila grande consumiria o
// teto inteiro e os outros ficariam parados enquanto isso durasse.
// =======================================================
const MONTA_LOTES_CODE = `const IDS_POR_LOTE = ${IDS_POR_LOTE};
const MAX_LOTES = ${MAX_LOTES_POR_CICLO};

const contas = $('Filtra Contas Validas').all().map(function(i){ return i.json; });
const etapasRaw = $('Busca Etapas de Ganho').all().map(function(i){ return i.json; });
const leads = $input.all().map(function(i){ return i.json; })
  .filter(function(l){ return l && l.client_db && l.customer_id && l.crm_lead_id; });

const contaPorDb = {};
contas.forEach(function(c){ contaPorDb[c.client_db_name] = c; });

const etapasPorDb = {};
const temValorPorDb = {};
etapasRaw.forEach(function(e){
  if (!e || !e.client_db || e.status_id === null || e.status_id === undefined) return;
  if (!etapasPorDb[e.client_db]) etapasPorDb[e.client_db] = [];
  etapasPorDb[e.client_db].push(String(e.status_id));
  temValorPorDb[e.client_db] = Number(e.tem_crm_value) > 0;
});

// Cliente sem etapa de conversão marcada não tem ganho para reconhecer:
// fica de fora sem que nada seja gravado, e volta sozinho no ciclo
// seguinte à marcação na aba Eventos.
const porCliente = {};
leads.forEach(function(l){
  const conta = contaPorDb[l.client_db];
  const etapas = etapasPorDb[l.client_db] || [];
  if (!conta || etapas.length === 0) return;
  if (!porCliente[l.client_db]) porCliente[l.client_db] = [];
  porCliente[l.client_db].push(l);
});

// Um lote = uma chamada ao Kommo.
const lotesPorCliente = {};
Object.keys(porCliente).forEach(function(db){
  const conta = contaPorDb[db];
  const lista = porCliente[db];
  const lotes = [];
  for (let i = 0; i < lista.length; i += IDS_POR_LOTE) {
    const pedaco = lista.slice(i, i + IDS_POR_LOTE);
    const filtro = pedaco.map(function(l){
      return 'filter[id][]=' + encodeURIComponent(String(l.crm_lead_id));
    }).join('&');
    lotes.push({
      client_db: db,
      subdominio: String(conta.kommo_subdomain || ''),
      kommo_access_token: String(conta.kommo_access_token || ''),
      etapas_ganho: etapasPorDb[db] || [],
      tem_crm_value: temValorPorDb[db] === true,
      // O id do negócio no Kommo é o que volta na resposta; o mapa é o
      // que liga cada um de volta ao customer_id certo deste banco.
      mapa: pedaco.map(function(l){
        return { crm_lead_id: String(l.crm_lead_id), customer_id: Number(l.customer_id) };
      }),
      url: 'https://' + String(conta.kommo_subdomain || '') +
        '.kommo.com/api/v4/leads?limit=250&' + filtro
    });
  }
  lotesPorCliente[db] = lotes;
});

// Round-robin entre clientes até bater o teto global.
const dbs = Object.keys(lotesPorCliente);
const fila = [];
let idx = 0;
while (fila.length < MAX_LOTES) {
  let adicionou = false;
  for (let d = 0; d < dbs.length && fila.length < MAX_LOTES; d++) {
    const lotes = lotesPorCliente[dbs[d]];
    if (idx < lotes.length) { fila.push(lotes[idx]); adicionou = true; }
  }
  if (!adicionou) break;
  idx++;
}

return fila.map(function(f){ return { json: f }; });
`;
const codeMontaLotes = codeNode({ name: "Monta Lotes Kommo", position: [140, 560], code: MONTA_LOTES_CODE });
connect(mysqlLeads.name, codeMontaLotes.name);

// =======================================================
// E) Loop ÚNICO sobre os lotes. Precisa ser loop porque a resposta do
// Kommo traz N negócios por lote, e a interpretação de um lote não pode
// se misturar com a de outro.
// =======================================================
const loopLotes = addNode({
  parameters: { batchSize: 1, options: {} },
  type: "n8n-nodes-base.splitInBatches",
  typeVersion: 3,
  position: [360, 560],
  id: nid('splitinbatches'),
  name: "Para Cada Lote"
});
connect(codeMontaLotes.name, loopLotes.name);

const codeCicloConcluido = codeNode({
  name: "Ciclo Concluido",
  position: [580, 340],
  code: "return [{ json: { message: 'Ciclo de sincronização de ganhos concluído.', lotes_processados: $input.all().length } }];\n"
});
connect(loopLotes.name, codeCicloConcluido.name, { outIndex: 0 });

// =======================================================
// F) Consulta ao Kommo. Só GET: o negócio no CRM não é tocado. Erro
// aqui não grava nada — o lote inteiro volta na próxima rodada, porque
// nenhum lead sai da fila sem ter sido verificado.
// =======================================================
const httpKommo = addNode({
  parameters: {
    url: "={{ $json.url }}",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "Authorization", value: "={{ 'Bearer ' + $json.kommo_access_token }}" }
      ]
    },
    // O Kommo responde com Content-Type application/hal+json, que o n8n
    // não reconhece como JSON: sem isto a resposta chega como string
    // crua em `data` e nenhum negócio é lido.
    options: { timeout: 15000, response: { response: { responseFormat: "json" } } }
  },
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [580, 560],
  id: nid('http'),
  name: "Busca Negocios no Kommo",
  retryOnFail: true,
  onError: "continueErrorOutput"
});
connect(loopLotes.name, httpKommo.name, { outIndex: 1 });

// =======================================================
// G) Interpreta a resposta e monta um UPDATE por lead ganho.
//
// O que conta como ganho é o `status_id` do negócio estar entre as
// etapas de conversão do cliente. O `price` do Kommo vem junto e
// atualiza `crm_value`, que é o valor que o painel mostra no card — mas
// só quando é maior que zero: negócio sem preço preenchido não pode
// apagar um valor que já estava lá.
//
// 204 (nenhum negócio encontrado) e erro de rede caem no mesmo lugar:
// nenhum item de atualização, e o lote volta na próxima rodada.
// =======================================================
const INTERPRETA_CODE = `function sqlVal(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return JSON.stringify(String(v));
}

const lote = $('Para Cada Lote').first().json;
const db = String(lote.client_db).replace(/[^A-Za-z0-9_]/g, '');
const etapas = (lote.etapas_ganho || []).map(String);
// A resposta pode chegar já como objeto ou como texto cru (o Kommo manda
// application/hal+json, e nem toda versão do n8n desembrulha isso
// sozinha). Aceita as duas formas em vez de devolver "nada" em silêncio.
let resposta = $json || {};
if (typeof resposta.data === 'string') {
  try { resposta = JSON.parse(resposta.data); } catch (e) { resposta = { error: 'resposta ilegivel' }; }
}
if (typeof resposta === 'string') {
  try { resposta = JSON.parse(resposta); } catch (e) { resposta = { error: 'resposta ilegivel' }; }
}
if (resposta && typeof resposta.data === 'string') {
  try { resposta = JSON.parse(resposta.data); } catch (e) { resposta = { error: 'resposta ilegivel' }; }
}

const nada = [{ json: { acao: 'nada', client_db: db } }];
if (!resposta || resposta.error) return nada;

const negocios = (resposta._embedded && resposta._embedded.leads) || [];
if (!negocios.length) return nada;

const customerPorLead = {};
(lote.mapa || []).forEach(function(m){ customerPorLead[String(m.crm_lead_id)] = m.customer_id; });

const saida = [];
negocios.forEach(function(neg){
  const status = String(neg.status_id === null || neg.status_id === undefined ? '' : neg.status_id);
  if (etapas.indexOf(status) === -1) return;

  const customerId = customerPorLead[String(neg.id)];
  if (!customerId) return;

  const preco = Number(neg.price);
  const valor = Number.isFinite(preco) && preco > 0 ? String(preco) : 'NULL';
  const campoValor = lote.tem_crm_value
    ? ', crm_value = COALESCE(' + valor + ', crm_value)'
    : '';

  // Só UPDATE em customers: o evento Purchase é do fluxo de eventos, que
  // dispara pelo webhook. Este workflow corrige o painel e nada mais —
  // não fala com a CAPI nem escreve no Kommo em lugar nenhum.
  const sql = 'UPDATE \\\`' + db + '\\\`.\\\`customers\\\` SET current_stage = ' + sqlVal(status) +
    campoValor + ' WHERE id = ' + Number(customerId) + ';';

  saida.push({ json: {
    acao: 'atualiza',
    sql: sql,
    client_db: db,
    customer_id: customerId,
    crm_lead_id: neg.id,
    status_id: status,
    valor: valor
  } });
});

return saida.length ? saida : nada;
`;
const codeInterpreta = codeNode({ name: "Interpreta Ganhos", position: [800, 560], code: INTERPRETA_CODE });
connect(httpKommo.name, codeInterpreta.name, { outIndex: 0 });
connect(httpKommo.name, codeInterpreta.name, { outIndex: 1 });

const ifTemGanho = ifStringEqualsNode({
  name: "Tem Ganho?",
  position: [1020, 560],
  leftValue: "={{ $json.acao }}",
  rightValue: "atualiza"
});
connect(codeInterpreta.name, ifTemGanho.name);

// Nada a atualizar neste lote -> volta direto pro loop.
connect(ifTemGanho.name, loopLotes.name, { outIndex: 1 });

const mysqlAtualiza = mysqlNode({
  name: "Marca Lead Como Ganho",
  position: [1240, 560],
  onError: "continueErrorOutput",
  query: "={{ $json.sql }}"
});
connect(ifTemGanho.name, mysqlAtualiza.name, { outIndex: 0 });
// Sucesso e erro voltam pro loop: um banco de cliente com problema não
// pode travar o ciclo dos outros.
connect(mysqlAtualiza.name, loopLotes.name, { outIndex: 0 });
connect(mysqlAtualiza.name, loopLotes.name, { outIndex: 1 });

// =======================================================
// Workflow output
// =======================================================
const workflow = {
  name: "Kommo - Sincroniza Ganhos",
  nodes: nodes,
  connections: connections,
  active: false,
  settings: { executionOrder: "v1", binaryMode: "separate", availableInMCP: false },
  meta: { instanceId: "manual-build" },
  id: "KommoSincronizaGanhos",
  tags: []
};

const outPath = path.join(__dirname, 'Kommo - Sincroniza Ganhos.json');
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2), 'utf8');
console.log('OK -> ' + outPath);
console.log('Nodes:', nodes.length);
