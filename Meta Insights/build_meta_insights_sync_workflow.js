const fs = require('fs');
const path = require('path');

const CRED = { id: "MYSQL_CRED_PLACEHOLDER", name: "MySQL Trakeamento (configurar no n8n)" };

// =======================================================
// Node graph builder (mesmo padrão dos outros workflows —
// cada builder duplica seus próprios helpers em vez de
// importar de um módulo compartilhado)
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
  const params = { path: opts.pathStr, responseMode: "responseNode", options: {} };
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
  if (opts.executeOnce) node.executeOnce = true;
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

function ifNotEmptyNode(opts) {
  return addNode({
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
        conditions: [{
          id: "cond-" + nid('c'),
          leftValue: opts.leftValue,
          rightValue: "",
          operator: { type: "string", operation: "notEquals" }
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

// IF numérico simples (usado só para checar affectedRows > 0 do lock
// de sincronização) — não reaproveita ifNotEmptyNode porque o
// operador/tipo de comparação é diferente (number/gt em vez de
// string/notEquals).
function ifNumberGtNode(opts) {
  return addNode({
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
        conditions: [{
          id: "cond-" + nid('c'),
          leftValue: opts.leftValue,
          rightValue: opts.rightValue,
          operator: { type: "number", operation: "gt" }
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

function respondNode(opts) {
  const params = { respondWith: opts.respondWith || "json", options: {} };
  if (opts.responseCode) params.options.responseCode = opts.responseCode;
  params.responseBody = opts.body || "={{ $json }}";
  return addNode({
    parameters: params,
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: opts.position,
    id: nid('respond'),
    name: opts.name
  });
}

// Mesma barreira de isolamento entre clientes usada em todo endpoint
// que recebe client_db via query string. Aqui a própria linha de
// ad_accounts retornada já traz ad_account_id/meta_access_token, então
// não é preciso nenhuma consulta adicional para achar a conta.
function addValidaClienteChain(opts) {
  const validaNode = mysqlNode({
    name: "Valida Cliente (" + opts.label + ")",
    position: opts.position,
    alwaysOutputData: true,
    query: "=SELECT * FROM `trakeamento_controle`.`ad_accounts` WHERE client_db_name = {{ JSON.stringify(($json.query && $json.query.client_db) || '') }} LIMIT 1"
  });
  connect(opts.from, validaNode.name);

  const ifNode = ifNotEmptyNode({
    name: "Cliente Valido? (" + opts.label + ")",
    position: [opts.position[0] + 176, opts.position[1]],
    leftValue: "={{ $json.client_db_name || '' }}"
  });
  connect(validaNode.name, ifNode.name);

  const erroCode = codeNode({
    name: "Erro Cliente Nao Encontrado (" + opts.label + ")",
    position: [opts.position[0] + 352, opts.position[1] + 160],
    code: "return [{ json: { message: 'Cliente não encontrado ou inválido.' } }];\n"
  });
  connect(ifNode.name, erroCode.name, { outIndex: 1 });

  const respond404 = respondNode({
    name: "Responde 404 (" + opts.label + ")",
    position: [opts.position[0] + 528, opts.position[1] + 160],
    respondWith: "json",
    responseCode: 404,
    body: "={{ $json }}"
  });
  connect(erroCode.name, respond404.name);

  return { validaNodeName: validaNode.name, ifNodeName: ifNode.name };
}

// Chamada padrão à Graph API: access_token como query param, versão
// fixa v25.0, paginação nativa do node. NOTA: a estrutura exata de
// `options.pagination` pode variar entre versões do n8n — confira a
// aba "Pagination" do node após importar; não validado contra uma
// instância real neste ambiente.
function httpMetaNode(opts) {
  const qp = (opts.queryParams || []).slice();
  qp.push({ name: "access_token", value: "={{ $('Monta Range').first().json.meta_access_token }}" });
  return addNode({
    parameters: {
      method: "GET",
      url: opts.url,
      sendQuery: true,
      queryParameters: { parameters: qp },
      options: {
        pagination: {
          pagination: {
            paginationMode: "responseContainsNextURL",
            nextURL: "={{ $response.body.paging.next }}",
            paginationCompleteWhen: "other",
            completeExpression: "={{ !$response.body.paging || !$response.body.paging.next }}",
            limitPagesFetched: true,
            maxRequests: 50
          }
        }
      }
    },
    id: nid('http'),
    name: opts.name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: opts.position,
    retryOnFail: true,
    onError: "continueErrorOutput"
  });
}

// Achata as páginas retornadas pela paginação (uma "data": [...] por
// página/item) em uma única lista de linhas, preservando o contexto
// da conta (client_db_name, ids etc.) vindo de "Monta Range".
function achataCode(fieldName) {
  return "const pages = $input.all().map(function(i){ return i.json; });\n" +
    "const rows = [];\n" +
    "pages.forEach(function(p){ if (p && Array.isArray(p.data)) rows.push.apply(rows, p.data); });\n" +
    "const ctx = $('Monta Range').first().json;\n" +
    "return [{ json: Object.assign({}, ctx, { " + fieldName + ": rows }) }];\n";
}

// =======================================================
// A) Webhook POST painel-api/sync-meta-agora — sincronização sob
// demanda (substitui o antigo Schedule Trigger de 6h + varredura de
// todas as contas ACTIVE). Front-end chama isso no clique em
// "Atualizar" (Métricas Gerais e Campanhas); uma única conta por vez,
// a do client_db recebido, com o mesmo lock/cooldown de 60s usado
// para evitar cliques duplicados/execuções concorrentes.
// =======================================================
const webhookSync = webhookNode({
  method: "POST",
  pathStr: "painel-api/sync-meta-agora",
  name: "Painel - Sync Meta Agora",
  position: [-720, 480]
});
const chainSync = addValidaClienteChain({ label: "Sync", from: webhookSync.name, position: [-480, 480] });

// Lock: verifica primeiro (SELECT) se a marcação anterior já tem mais
// de 60s ou nunca existiu. NÃO usar affectedRows do UPDATE aqui — em
// algumas versões/config do node MySQL do n8n a saída de um UPDATE via
// "Execute Query" vem só como {"success": true}, sem affectedRows, o
// que faria a condição de baixo NUNCA ser verdadeira e o sync real
// (Monta Range em diante) nunca rodar (todo clique cairia no 429
// "sincronização em andamento" e o painel ficaria sempre desatualizado
// / divergente do Ads Manager). Usando o valor de uma coluna normal de
// SELECT evita depender do formato de retorno do driver.
const mysqlVerificaLock = mysqlNode({
  name: "Verifica Lock",
  position: [-240, 480],
  alwaysOutputData: true,
  query: "=SELECT (last_sync_started_at IS NULL OR last_sync_started_at < NOW() - INTERVAL 60 SECOND) AS lock_livre FROM `trakeamento_controle`.`ad_accounts` WHERE client_db_name = {{ JSON.stringify($('Valida Cliente (Sync)').first().json.client_db_name) }}"
});
connect(chainSync.ifNodeName, mysqlVerificaLock.name, { outIndex: 0 });

const ifLockObtido = ifNumberGtNode({
  name: "Lock Obtido?",
  position: [-16, 480],
  leftValue: "={{ $json.lock_livre }}",
  rightValue: 0
});
connect(mysqlVerificaLock.name, ifLockObtido.name);

const codeSyncEmAndamento = codeNode({
  name: "Resposta Sync Em Andamento",
  position: [208, 680],
  code: "return [{ json: { message: 'Sincronização já em andamento, aguarde alguns instantes.' } }];\n"
});
connect(ifLockObtido.name, codeSyncEmAndamento.name, { outIndex: 1 });
const respondSync429 = respondNode({ name: "Responde Sync 429", position: [432, 680], responseCode: 429 });
connect(codeSyncEmAndamento.name, respondSync429.name);

// Só marca o lock (UPDATE incondicional) depois de confirmar, via
// SELECT acima, que ele está livre — mesma janela de 60s de antes, só
// que sem depender de affectedRows. Existe uma janela mínima de corrida
// entre o SELECT e este UPDATE (dois cliques no mesmíssimo instante),
// aceitável aqui porque isso é só debounce de clique manual, não um
// lock distribuído de verdade.
const mysqlMarcaLock = mysqlNode({
  name: "Marca Lock",
  position: [-16, 320],
  query: "=UPDATE `trakeamento_controle`.`ad_accounts` SET last_sync_started_at = NOW() WHERE client_db_name = {{ JSON.stringify($('Valida Cliente (Sync)').first().json.client_db_name) }}"
});
connect(ifLockObtido.name, mysqlMarcaLock.name, { outIndex: 0 });

// --- corpo do sync (só roda com o lock obtido) ---
const codeMontaRange = codeNode({
  name: "Monta Range",
  position: [0, 480],
  code: "const acc = $('Valida Cliente (Sync)').first().json;\n" +
    "const DAY_MS = 86400000;\n" +
    "const SP_OFFSET_MS = 3 * 60 * 60 * 1000; // Sao Paulo = UTC-3\n" +
    "// since/until vao pra Graph API como datas 'soltas' (sem hora), que a\n" +
    "// Meta interpreta como dias no fuso da propria conta de anuncios (SP).\n" +
    "// Usar toISOString() puro aqui pegaria o dia em UTC, que so diverge do\n" +
    "// dia em SP das ~21h as ~24h (SP), mas quando diverge o sync escreve o\n" +
    "// insight de 'amanha' UTC como se fosse 'hoje', e o filtro 'hoje' do\n" +
    "// painel (que compara meta_insights_daily.date por string em SP) para\n" +
    "// de bater com a linha certa.\n" +
    "const nowUtcMs = Date.now();\n" +
    "const spTodayStartWallMs = Math.floor((nowUtcMs - SP_OFFSET_MS) / DAY_MS) * DAY_MS;\n" +
    "function fmt(daysAgo) { return new Date(spTodayStartWallMs - daysAgo * DAY_MS).toISOString().slice(0, 10); }\n" +
    "const since = fmt(2); // janela de 3 dias (hoje + 2 anteriores)\n" +
    "const until = fmt(0);\n" +
    "return [{ json: Object.assign({}, acc, { since: since, until: until, meta_api_version: 'v25.0' }) }];\n"
});
connect(mysqlMarcaLock.name, codeMontaRange.name);

// --- estrutura: campanhas / conjuntos / anúncios ---
const httpCampanhas = httpMetaNode({
  name: "Busca Campanhas Meta",
  position: [240, 480],
  url: "=https://graph.facebook.com/{{ $json.meta_api_version }}/act_{{ $json.ad_account_id }}/campaigns",
  queryParams: [
    { name: "fields", value: "id,name,status,objective,daily_budget,lifetime_budget" },
    { name: "limit", value: "200" }
  ]
});
connect(codeMontaRange.name, httpCampanhas.name);
const codeAchataCampanhas = codeNode({ name: "Achata Campanhas", position: [480, 480], code: achataCode('campaigns') });
connect(httpCampanhas.name, codeAchataCampanhas.name, { outIndex: 0 });

const httpAdsets = httpMetaNode({
  name: "Busca Conjuntos Meta",
  position: [720, 480],
  url: "=https://graph.facebook.com/{{ $('Monta Range').first().json.meta_api_version }}/act_{{ $('Monta Range').first().json.ad_account_id }}/adsets",
  queryParams: [
    { name: "fields", value: "id,name,status,campaign_id,daily_budget,lifetime_budget" },
    { name: "limit", value: "200" }
  ]
});
connect(codeAchataCampanhas.name, httpAdsets.name);
const codeAchataAdsets = codeNode({ name: "Achata Conjuntos", position: [960, 480], code: achataCode('adsets') });
connect(httpAdsets.name, codeAchataAdsets.name, { outIndex: 0 });

const httpAds = httpMetaNode({
  name: "Busca Anuncios Meta",
  position: [1200, 480],
  url: "=https://graph.facebook.com/{{ $('Monta Range').first().json.meta_api_version }}/act_{{ $('Monta Range').first().json.ad_account_id }}/ads",
  queryParams: [
    { name: "fields", value: "id,name,status,adset_id,campaign_id" },
    { name: "limit", value: "200" }
  ]
});
connect(codeAchataAdsets.name, httpAds.name);
const codeAchataAds = codeNode({ name: "Achata Anuncios", position: [1440, 480], code: achataCode('ads') });
connect(httpAds.name, codeAchataAds.name, { outIndex: 0 });

// --- métricas diárias, uma chamada por nível (não dá pra derivar um
// nível somando outro, por causa da não-aditividade de alcance/frequência) ---
const INSIGHTS_FIELDS = "date_start,spend,impressions,reach,frequency,clicks,unique_clicks,cpc,cpm,ctr";
function timeRangeParam() {
  return { name: "time_range", value: "={{ JSON.stringify({ since: $('Monta Range').first().json.since, until: $('Monta Range').first().json.until }) }}" };
}

const httpInsightsCampanha = httpMetaNode({
  name: "Busca Insights Campanha",
  position: [1680, 480],
  url: "=https://graph.facebook.com/{{ $('Monta Range').first().json.meta_api_version }}/act_{{ $('Monta Range').first().json.ad_account_id }}/insights",
  queryParams: [
    { name: "level", value: "campaign" },
    { name: "time_increment", value: "1" },
    { name: "fields", value: "campaign_id," + INSIGHTS_FIELDS },
    { name: "limit", value: "200" },
    timeRangeParam()
  ]
});
connect(codeAchataAds.name, httpInsightsCampanha.name);
const codeAchataInsightsCampanha = codeNode({ name: "Achata Insights Campanha", position: [1920, 480], code: achataCode('rowsCampanha') });
connect(httpInsightsCampanha.name, codeAchataInsightsCampanha.name, { outIndex: 0 });

const httpInsightsAdset = httpMetaNode({
  name: "Busca Insights Conjunto",
  position: [2160, 480],
  url: "=https://graph.facebook.com/{{ $('Monta Range').first().json.meta_api_version }}/act_{{ $('Monta Range').first().json.ad_account_id }}/insights",
  queryParams: [
    { name: "level", value: "adset" },
    { name: "time_increment", value: "1" },
    { name: "fields", value: "adset_id,campaign_id," + INSIGHTS_FIELDS },
    { name: "limit", value: "200" },
    timeRangeParam()
  ]
});
connect(codeAchataInsightsCampanha.name, httpInsightsAdset.name);
const codeAchataInsightsAdset = codeNode({ name: "Achata Insights Conjunto", position: [2400, 480], code: achataCode('rowsAdset') });
connect(httpInsightsAdset.name, codeAchataInsightsAdset.name, { outIndex: 0 });

const httpInsightsAd = httpMetaNode({
  name: "Busca Insights Anuncio",
  position: [2640, 480],
  url: "=https://graph.facebook.com/{{ $('Monta Range').first().json.meta_api_version }}/act_{{ $('Monta Range').first().json.ad_account_id }}/insights",
  queryParams: [
    { name: "level", value: "ad" },
    { name: "time_increment", value: "1" },
    { name: "fields", value: "ad_id,adset_id,campaign_id," + INSIGHTS_FIELDS },
    { name: "limit", value: "200" },
    timeRangeParam()
  ]
});
connect(codeAchataInsightsAdset.name, httpInsightsAd.name);
const codeAchataInsightsAd = codeNode({ name: "Achata Insights Anuncio", position: [2880, 480], code: achataCode('rowsAd') });
connect(httpInsightsAd.name, codeAchataInsightsAd.name, { outIndex: 0 });

// =======================================================
// C) Monta os UPSERTs (1 item de saída por INSERT a executar,
// mesmo padrão de "1 SQL por item" usado em eventos-salvar)
// =======================================================
const MONTA_UPSERTS_CODE = `function sqlVal(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return JSON.stringify(String(v));
}
function sqlNum(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function sqlIdent(v) {
  return '\`' + String(v).replace(/\`/g, '') + '\`';
}

const ctx = $('Monta Range').first().json;
const db = sqlIdent(ctx.client_db_name);
const campaigns = ($('Achata Campanhas').first().json.campaigns) || [];
const adsets = ($('Achata Conjuntos').first().json.adsets) || [];
const ads = ($('Achata Anuncios').first().json.ads) || [];
const insCampanha = ($('Achata Insights Campanha').first().json.rowsCampanha) || [];
const insAdset = ($('Achata Insights Conjunto').first().json.rowsAdset) || [];
const insAd = ($('Achata Insights Anuncio').first().json.rowsAd) || [];

const out = [];

campaigns.forEach(function (c) {
  out.push(
    'INSERT INTO ' + db + '.\`meta_campaigns\` (campaign_id, campaign_name, status, objective, daily_budget, lifetime_budget) VALUES (' +
    [sqlVal(c.id), sqlVal(c.name), sqlVal(c.status), sqlVal(c.objective), sqlNum(c.daily_budget) / 100 || 'NULL', sqlNum(c.lifetime_budget) / 100 || 'NULL'].join(', ') +
    ') ON DUPLICATE KEY UPDATE campaign_name = ' + sqlVal(c.name) + ', status = ' + sqlVal(c.status) + ', objective = ' + sqlVal(c.objective) +
    ', daily_budget = ' + (sqlNum(c.daily_budget) / 100 || 'NULL') + ', lifetime_budget = ' + (sqlNum(c.lifetime_budget) / 100 || 'NULL') + ';'
  );
});

adsets.forEach(function (a) {
  out.push(
    'INSERT INTO ' + db + '.\`meta_adsets\` (adset_id, campaign_id, adset_name, status, daily_budget, lifetime_budget) VALUES (' +
    [sqlVal(a.id), sqlVal(a.campaign_id), sqlVal(a.name), sqlVal(a.status), sqlNum(a.daily_budget) / 100 || 'NULL', sqlNum(a.lifetime_budget) / 100 || 'NULL'].join(', ') +
    ') ON DUPLICATE KEY UPDATE campaign_id = ' + sqlVal(a.campaign_id) + ', adset_name = ' + sqlVal(a.name) + ', status = ' + sqlVal(a.status) +
    ', daily_budget = ' + (sqlNum(a.daily_budget) / 100 || 'NULL') + ', lifetime_budget = ' + (sqlNum(a.lifetime_budget) / 100 || 'NULL') + ';'
  );
});

ads.forEach(function (ad) {
  out.push(
    'INSERT INTO ' + db + '.\`meta_ads\` (ad_id, adset_id, campaign_id, ad_name, status) VALUES (' +
    [sqlVal(ad.id), sqlVal(ad.adset_id), sqlVal(ad.campaign_id), sqlVal(ad.name), sqlVal(ad.status)].join(', ') +
    ') ON DUPLICATE KEY UPDATE adset_id = ' + sqlVal(ad.adset_id) + ', campaign_id = ' + sqlVal(ad.campaign_id) + ', ad_name = ' + sqlVal(ad.name) + ', status = ' + sqlVal(ad.status) + ';'
  );
});

function insightUpsert(level, row, entityId, campaignId, adsetId, adId) {
  const spend = sqlNum(row.spend);
  const impressions = sqlNum(row.impressions);
  const reach = sqlNum(row.reach);
  const frequency = sqlNum(row.frequency);
  const clicks = sqlNum(row.clicks);
  const uniqueClicks = sqlNum(row.unique_clicks);
  const cpc = sqlNum(row.cpc);
  const cpm = sqlNum(row.cpm);
  const ctr = sqlNum(row.ctr);
  const raw = sqlVal(JSON.stringify(row));
  return 'INSERT INTO ' + db + '.\`meta_insights_daily\` ' +
    '(entity_level, entity_id, campaign_id, adset_id, ad_id, \`date\`, spend, impressions, reach, frequency, clicks, unique_clicks, cpc, cpm, ctr, raw_insights) VALUES (' +
    [sqlVal(level), sqlVal(entityId), sqlVal(campaignId), sqlVal(adsetId), sqlVal(adId), sqlVal(row.date_start), spend, impressions, reach, frequency, clicks, uniqueClicks, cpc, cpm, ctr, raw].join(', ') +
    ') ON DUPLICATE KEY UPDATE spend = ' + spend + ', impressions = ' + impressions + ', reach = ' + reach + ', frequency = ' + frequency +
    ', clicks = ' + clicks + ', unique_clicks = ' + uniqueClicks + ', cpc = ' + cpc + ', cpm = ' + cpm + ', ctr = ' + ctr + ', raw_insights = ' + raw + ';';
}

insCampanha.forEach(function (r) { out.push(insightUpsert('campaign', r, r.campaign_id, r.campaign_id, null, null)); });
insAdset.forEach(function (r) { out.push(insightUpsert('adset', r, r.adset_id, r.campaign_id, r.adset_id, null)); });
insAd.forEach(function (r) { out.push(insightUpsert('ad', r, r.ad_id, r.campaign_id, r.adset_id, r.ad_id)); });

if (out.length === 0) {
  return [{ json: { sql: null, skip: true, totalRegistros: 0 } }];
}
return out.map(function (sql) { return { json: { sql: sql, totalRegistros: out.length } }; });
`;
const codeMontaUpserts = codeNode({ name: "Monta Upserts Insights", position: [3120, 480], code: MONTA_UPSERTS_CODE });
connect(codeAchataInsightsAd.name, codeMontaUpserts.name);

const mysqlExecutaUpsert = mysqlNode({
  name: "Executa Upsert Insights",
  position: [3360, 480],
  onError: "continueErrorOutput",
  query: "={{ $json.sql }}"
});
connect(codeMontaUpserts.name, mysqlExecutaUpsert.name);

const codeRespostaSync = codeNode({
  name: "Resposta Sync",
  position: [3600, 480],
  code: "const total = $input.all().length;\n" +
    "return [{ json: { message: 'Sincronização concluída.', totalRegistros: total } }];\n"
});
connect(mysqlExecutaUpsert.name, codeRespostaSync.name, { outIndex: 0 });
const respondSync = respondNode({ name: "Responde Sync", position: [3840, 480] });
connect(codeRespostaSync.name, respondSync.name);

// =======================================================
// Workflow output
// =======================================================
const workflow = {
  name: "Meta Insights - Sincronizacao Sob Demanda",
  nodes: nodes,
  connections: connections,
  active: false,
  settings: { executionOrder: "v1", binaryMode: "separate", availableInMCP: false },
  meta: { instanceId: "manual-build" },
  id: "MetaInsightsSincronizacaoSobDemanda",
  tags: []
};

const outPath = path.join(__dirname, 'Meta Insights - Sincronizacao Sob Demanda.json');
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2), 'utf8');
console.log('OK -> ' + outPath);
console.log('Nodes:', nodes.length);
