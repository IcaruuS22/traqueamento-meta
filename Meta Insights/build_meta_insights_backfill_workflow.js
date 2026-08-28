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
  qp.push({ name: "access_token", value: "={{ $('Monta Range 90 Dias').first().json.meta_access_token }}" });
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

function achataCode(fieldName) {
  return "const pages = $input.all().map(function(i){ return i.json; });\n" +
    "const rows = [];\n" +
    "pages.forEach(function(p){ if (p && Array.isArray(p.data)) rows.push.apply(rows, p.data); });\n" +
    "const ctx = $('Monta Range 90 Dias').first().json;\n" +
    "return [{ json: Object.assign({}, ctx, { " + fieldName + ": rows }) }];\n";
}

// =======================================================
// A) Webhook POST painel-api/campanhas-importar-historico
// Backfill manual de 90 dias, uma conta por vez (a do client_db
// recebido) — mesma lógica de build_meta_insights_sync_workflow.js,
// só que sem Split In Batches (uma única conta) e com janela de 90
// dias em vez de 3.
// =======================================================
const webhookImportar = webhookNode({
  method: "POST",
  pathStr: "painel-api/campanhas-importar-historico",
  name: "Painel - Importar Historico Campanhas",
  position: [-720, 480]
});
const chainImportar = addValidaClienteChain({ label: "Importar Historico", from: webhookImportar.name, position: [-480, 480] });

// Não faz sentido oferecer um backfill de 90 dias fixos quando o
// cliente tem menos histórico que isso: o limite mínimo do range
// (`since`) é o maior valor entre "90 dias atrás" e a data do
// primeiro lead já registrado para esse cliente.
const mysqlPrimeiroLeadBackfill = mysqlNode({
  name: "Consulta Primeiro Lead (Backfill)",
  position: [-240, 480],
  alwaysOutputData: true,
  query: "=SELECT DATE(MIN(created_at)) as primeiro_lead_em FROM `{{ $json.client_db_name.replace(/`/g,'') }}`.`customers`"
});
connect(chainImportar.ifNodeName, mysqlPrimeiroLeadBackfill.name, { outIndex: 0 });

const codeMontaRange = codeNode({
  name: "Monta Range 90 Dias",
  position: [0, 480],
  code: "const ctx = $('" + chainImportar.ifNodeName + "').first().json;\n" +
    "const primeiro = $json.primeiro_lead_em;\n" +
    "const DAY_MS = 86400000;\n" +
    "const now = new Date();\n" +
    "const until = new Date(now.getTime());\n" +
    "const maxWindowSince = new Date(now.getTime() - 89 * DAY_MS); // limite maximo: 90 dias (hoje + 89 anteriores)\n" +
    "let since = maxWindowSince;\n" +
    "if (primeiro) {\n" +
    "  const primeiroLeadDate = new Date(String(primeiro).slice(0, 10) + 'T00:00:00Z');\n" +
    "  if (primeiroLeadDate.getTime() > since.getTime()) since = primeiroLeadDate; // cliente mais novo que 90 dias: nao volta antes do primeiro lead\n" +
    "}\n" +
    "function fmt(d) { return d.toISOString().slice(0, 10); }\n" +
    "return [{ json: Object.assign({}, ctx, { since: fmt(since), until: fmt(until), meta_api_version: 'v25.0' }) }];\n"
});
connect(mysqlPrimeiroLeadBackfill.name, codeMontaRange.name);

// --- estrutura: campanhas / conjuntos / anúncios ---
const httpCampanhas = httpMetaNode({
  name: "Busca Campanhas Meta (Backfill)",
  position: [240, 480],
  url: "=https://graph.facebook.com/{{ $('Monta Range 90 Dias').first().json.meta_api_version }}/act_{{ $('Monta Range 90 Dias').first().json.ad_account_id }}/campaigns",
  queryParams: [
    { name: "fields", value: "id,name,status,objective,daily_budget,lifetime_budget" },
    { name: "limit", value: "200" }
  ]
});
connect(codeMontaRange.name, httpCampanhas.name);
const codeAchataCampanhas = codeNode({ name: "Achata Campanhas (Backfill)", position: [480, 480], code: achataCode('campaigns') });
connect(httpCampanhas.name, codeAchataCampanhas.name, { outIndex: 0 });

const httpAdsets = httpMetaNode({
  name: "Busca Conjuntos Meta (Backfill)",
  position: [720, 480],
  url: "=https://graph.facebook.com/{{ $('Monta Range 90 Dias').first().json.meta_api_version }}/act_{{ $('Monta Range 90 Dias').first().json.ad_account_id }}/adsets",
  queryParams: [
    { name: "fields", value: "id,name,status,campaign_id,daily_budget,lifetime_budget" },
    { name: "limit", value: "200" }
  ]
});
connect(codeAchataCampanhas.name, httpAdsets.name);
const codeAchataAdsets = codeNode({ name: "Achata Conjuntos (Backfill)", position: [960, 480], code: achataCode('adsets') });
connect(httpAdsets.name, codeAchataAdsets.name, { outIndex: 0 });

const httpAds = httpMetaNode({
  name: "Busca Anuncios Meta (Backfill)",
  position: [1200, 480],
  url: "=https://graph.facebook.com/{{ $('Monta Range 90 Dias').first().json.meta_api_version }}/act_{{ $('Monta Range 90 Dias').first().json.ad_account_id }}/ads",
  queryParams: [
    { name: "fields", value: "id,name,status,adset_id,campaign_id" },
    { name: "limit", value: "200" }
  ]
});
connect(codeAchataAdsets.name, httpAds.name);
const codeAchataAds = codeNode({ name: "Achata Anuncios (Backfill)", position: [1440, 480], code: achataCode('ads') });
connect(httpAds.name, codeAchataAds.name, { outIndex: 0 });

// --- métricas diárias, uma chamada por nível ---
const INSIGHTS_FIELDS = "date_start,spend,impressions,reach,frequency,clicks,unique_clicks,cpc,cpm,ctr";
function timeRangeParam() {
  return { name: "time_range", value: "={{ JSON.stringify({ since: $('Monta Range 90 Dias').first().json.since, until: $('Monta Range 90 Dias').first().json.until }) }}" };
}

const httpInsightsCampanha = httpMetaNode({
  name: "Busca Insights Campanha (Backfill)",
  position: [1680, 480],
  url: "=https://graph.facebook.com/{{ $('Monta Range 90 Dias').first().json.meta_api_version }}/act_{{ $('Monta Range 90 Dias').first().json.ad_account_id }}/insights",
  queryParams: [
    { name: "level", value: "campaign" },
    { name: "time_increment", value: "1" },
    { name: "fields", value: "campaign_id," + INSIGHTS_FIELDS },
    { name: "limit", value: "200" },
    timeRangeParam()
  ]
});
connect(codeAchataAds.name, httpInsightsCampanha.name);
const codeAchataInsightsCampanha = codeNode({ name: "Achata Insights Campanha (Backfill)", position: [1920, 480], code: achataCode('rowsCampanha') });
connect(httpInsightsCampanha.name, codeAchataInsightsCampanha.name, { outIndex: 0 });

const httpInsightsAdset = httpMetaNode({
  name: "Busca Insights Conjunto (Backfill)",
  position: [2160, 480],
  url: "=https://graph.facebook.com/{{ $('Monta Range 90 Dias').first().json.meta_api_version }}/act_{{ $('Monta Range 90 Dias').first().json.ad_account_id }}/insights",
  queryParams: [
    { name: "level", value: "adset" },
    { name: "time_increment", value: "1" },
    { name: "fields", value: "adset_id,campaign_id," + INSIGHTS_FIELDS },
    { name: "limit", value: "200" },
    timeRangeParam()
  ]
});
connect(codeAchataInsightsCampanha.name, httpInsightsAdset.name);
const codeAchataInsightsAdset = codeNode({ name: "Achata Insights Conjunto (Backfill)", position: [2400, 480], code: achataCode('rowsAdset') });
connect(httpInsightsAdset.name, codeAchataInsightsAdset.name, { outIndex: 0 });

const httpInsightsAd = httpMetaNode({
  name: "Busca Insights Anuncio (Backfill)",
  position: [2640, 480],
  url: "=https://graph.facebook.com/{{ $('Monta Range 90 Dias').first().json.meta_api_version }}/act_{{ $('Monta Range 90 Dias').first().json.ad_account_id }}/insights",
  queryParams: [
    { name: "level", value: "ad" },
    { name: "time_increment", value: "1" },
    { name: "fields", value: "ad_id,adset_id,campaign_id," + INSIGHTS_FIELDS },
    { name: "limit", value: "200" },
    timeRangeParam()
  ]
});
connect(codeAchataInsightsAdset.name, httpInsightsAd.name);
const codeAchataInsightsAd = codeNode({ name: "Achata Insights Anuncio (Backfill)", position: [2880, 480], code: achataCode('rowsAd') });
connect(httpInsightsAd.name, codeAchataInsightsAd.name, { outIndex: 0 });

// =======================================================
// B) Monta e executa os UPSERTs (mesma lógica exata do workflow de
// sincronização periódica — só muda o nome do node de contexto)
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

const ctx = $('Monta Range 90 Dias').first().json;
const db = sqlIdent(ctx.client_db_name);
const campaigns = ($('Achata Campanhas (Backfill)').first().json.campaigns) || [];
const adsets = ($('Achata Conjuntos (Backfill)').first().json.adsets) || [];
const ads = ($('Achata Anuncios (Backfill)').first().json.ads) || [];
const insCampanha = ($('Achata Insights Campanha (Backfill)').first().json.rowsCampanha) || [];
const insAdset = ($('Achata Insights Conjunto (Backfill)').first().json.rowsAdset) || [];
const insAd = ($('Achata Insights Anuncio (Backfill)').first().json.rowsAd) || [];

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
const codeMontaUpserts = codeNode({ name: "Monta Upserts Insights (Backfill)", position: [3120, 480], code: MONTA_UPSERTS_CODE });
connect(codeAchataInsightsAd.name, codeMontaUpserts.name);

const mysqlExecutaUpsert = mysqlNode({
  name: "Executa Upsert Insights (Backfill)",
  position: [3360, 480],
  onError: "continueErrorOutput",
  query: "={{ $json.sql }}"
});
connect(codeMontaUpserts.name, mysqlExecutaUpsert.name);

const codeRespostaImportar = codeNode({
  name: "Resposta Importacao Historico",
  position: [3600, 480],
  code: "const total = $input.all().length;\n" +
    "return [{ json: { message: 'Importação de histórico concluída: ' + total + ' registro(s) processado(s) (últimos 90 dias).' } }];\n"
});
connect(mysqlExecutaUpsert.name, codeRespostaImportar.name, { outIndex: 0 });
const respondImportar = respondNode({ name: "Responde Importacao Historico", position: [3840, 480] });
connect(codeRespostaImportar.name, respondImportar.name);

// =======================================================
// Workflow output
// =======================================================
const workflow = {
  name: "Meta Insights - Importacao Historica (manual)",
  nodes: nodes,
  connections: connections,
  active: false,
  settings: { executionOrder: "v1", binaryMode: "separate", availableInMCP: false },
  meta: { instanceId: "manual-build" },
  id: "MetaInsightsImportacaoHistorica",
  tags: []
};

const outPath = path.join(__dirname, 'Meta Insights - Importacao Historica (manual).json');
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2), 'utf8');
console.log('OK -> ' + outPath);
console.log('Nodes:', nodes.length);
