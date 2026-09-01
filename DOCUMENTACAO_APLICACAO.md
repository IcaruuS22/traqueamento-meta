# Documentação — Trakeamento Avançado Meta Ads + Kommo CRM (n8n + MySQL)

> Última atualização: 2026-08-18. Este documento descreve o estado atual completo do sistema: arquitetura, fluxo de dados, cada workflow n8n, o painel administrativo, e as duas features mais recentes (Tutorial em etapas e Análise por IA via Groq).

> **Nota de migração (2026-08-24):** este projeto está sendo transformado em um aplicativo Next.js hospedado na Vercel, mantendo no n8n apenas 4 workflows. Este documento continua sendo a referência de **como o sistema funciona hoje** — e é a fonte a consultar ao portar cada endpoint. Para a arquitetura alvo e o passo a passo da migração, ver [`ARQUITETURA_APP.md`](ARQUITETURA_APP.md) e [`PLANO_IMPLEMENTACAO.md`](PLANO_IMPLEMENTACAO.md).

---

## 1. Visão geral da arquitetura

O sistema conecta **formulários instantâneos da Meta (Facebook/Instagram Lead Ads)** a um **CRM Kommo**, registra tudo em **MySQL** (um banco por cliente + um banco central de controle), envia eventos de conversão de volta para a **Meta Conversions API (CAPI)**, e expõe um **painel administrativo web** para acompanhar tudo isso.

```
Lead preenche formulário na Meta
        │
        ▼
[Webhook Meta] ──► "01 - Recebe leads - Meta (CORRIGIDO)" (n8n, fora da pasta mySQL/) ──► busca dados do lead na Graph API,
        │                                                                                 cria contato+lead no Kommo CRM, grava em `customers`
        │
        ▼
Kommo CRM: vendedor move o lead pelo funil (estágios)
        │
        ▼
"Traq. Form Instantâneo - Meta ADS - MySQL" (n8n) ──► webhook do Kommo a cada mudança de estágio
        │                                              ├─ atualiza `customers.current_stage`
        │                                              └─ se o estágio novo está mapeado em `crm_meta_event_map`
        │                                                 com is_conversion/enviar=1, envia evento pra Meta CAPI
        │                                                 e grava em `meta_capi_events`
        ▼
Meta Ads otimiza campanhas com base nos eventos de conversão recebidos
```

Em paralelo:
- **"Meta Insights - Sincronização Sob Demanda"**: puxa métricas de campanha (gasto, impressões, cliques, etc.) da Marketing API da Meta e grava em `meta_campaigns` / `meta_adsets` / `meta_ads` / `insights_daily`, por cliente, sob demanda (botão "Atualizar" no painel — não é mais um cron periódico).
- **"Meta Insights - Importação Histórica (manual)"**: mesma coisa, mas para importar até 90 dias retroativos de uma vez (botão "Importar histórico" na aba Campanhas).
- **"Painel Administrativo - Dashboard Clientes"**: o backend (só webhooks REST) que alimenta `painel-admin.html` — métricas, kanban, campanhas, configuração de eventos, últimos eventos, e a nova aba de Análise por IA.
- **"Cria Cliente - Formulário"**: workflow disparado pelo formulário `novo-cliente-form.html` — cria o banco MySQL do cliente do zero (todas as tabelas), grava o registro em `ad_accounts` (banco central), e cadastra os webhooks/integração necessários.

---

## 2. Modelo de dados

### 2.1 Banco central: `trakeamento_controle`

Guarda o catálogo de clientes e configurações globais do painel. Schema completo em [`01_Banco_Central_Controle (Rode no SQL).sql`](01_Banco_Central_Controle%20%28Rode%20no%20SQL%29.sql).

- **`ad_accounts`** — um registro por cliente: `client_db_name` (aponta pro banco MySQL daquele cliente), `ad_account_id`/`crm_account_id`, categoria, status, e `last_sync_started_at` (timestamp usado como lock/cooldown de 60s da sincronização sob demanda — ver seção 5).
- **`painel_metric_prefs`** — quais métricas aparecem em "Métricas Gerais" ("Personalizar métricas"). Chave primária composta `(client_db_name, metric_key)`: `client_db_name=''` é a preferência **global** (vale pra todo cliente que não tem override); uma linha com `client_db_name=<banco do cliente>` é um **override específico daquele cliente** (usado hoje só pelas métricas opcionais Receita/ROAS, que nem todo cliente consegue calcular com confiança).

### 2.2 Banco por cliente (schema em [`02_Template_Banco_Por_Cliente.sql`](02_Template_Banco_Por_Cliente.sql), criado automaticamente pelo workflow "Cria Cliente - Formulário")

- **`customers`** — um lead por linha: dados de contato, `current_stage` (estágio atual no Kommo), `meta_campaign_id`/`meta_campaign_name` (atribuição de origem), `state` (UF resolvida por DDD do telefone, usada no envio à Meta CAPI), `created_at` (data de referência para CPL/CAC — ver nota sobre atribuição na seção 6).
- **`crm_meta_event_map`** — mapeia cada estágio do funil Kommo (`status_id`) para um evento da Meta CAPI (`event_name`) e marca `is_conversion` (1 = conta como conversão nas métricas do painel). Editável na aba "Configuração de Eventos".
- **`meta_capi_events`** — log de cada evento efetivamente enviado (ou tentado) para a Meta CAPI: `status` (SENT/ERROR/PENDING/DUPLICATE), `value`/`currency` (usados no cálculo de Receita/ROAS), `error_message`.
- **`meta_campaigns` / `meta_adsets` / `meta_ads`** — hierarquia de campanhas puxada da Marketing API.
- **`insights_daily`** — métricas diárias por conta/campanha/adset/ad (gasto, impressões, alcance, cliques, etc.), a fonte de dados de "Métricas Gerais" e "Campanhas".

**Importante:** qualquer mudança de schema que deva valer para todo cliente novo precisa entrar no node "Prepara Cadastro" de `Cria Cliente - Formulario.json` (é o que efetivamente cria as tabelas ao cadastrar um cliente). Mudanças só no banco central (`trakeamento_controle`) — como as dessa sessão — **não** entram lá.

### 2.3 Correção: `customers.created_at` agora vem do horário real do lead na Meta

Até esta sessão, o INSERT em `customers` (node "Salva lead no banco para trakeamento" em `01 - Recebe leads - Meta (CORRIGIDO).json`) não informava `created_at` — a coluna é `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, então ela recebia o horário em que o n8n *terminava de processar* o lead (depois de chamar a Graph API e criar contato+lead no Kommo), não o horário em que o lead de fato foi enviado na Meta. Isso podia divergir por segundos a minutos, distorcendo métricas de atribuição por dia.

A correção usa um valor que já estava sendo buscado e calculado, mas não usado: o node "Pega dados do Lead - Meta" já chama `GET /v25.0/{leadgen_id}?fields=...,created_time,...` na Graph API — esse `created_time` é o horário oficial de criação do lead segundo a própria Meta (mais confiável que o `time` do envelope do webhook, que é o horário de *disparo da notificação*, não da criação do lead). O node "InfoBase" já convertia esse valor pro fuso `America/Sao_Paulo` no campo `create_time`; a única mudança foi (a) trocar `.toISO()` por `.toFormat('yyyy-MM-dd HH:mm:ss')` (formato aceito diretamente pela coluna `TIMESTAMP` do MySQL, sem o sufixo de offset) e (b) incluir `created_at` na lista de colunas/valores do INSERT.

**Isso não tem script gerador — a mudança foi feita direto no `.json`, que precisa ser reimportado manualmente no n8n** (foi feito um backup do arquivo original antes: `01 - Recebe leads - Meta (CORRIGIDO).backup-20260819.json`, na raiz do projeto).

---

## 3. Os workflows n8n (pasta `mySQL/`)

Cada `build_*.js` é um script Node.js que **gera** o `.json` correspondente programaticamente (monta o grafo de nodes/conexões e escreve o arquivo). **Sempre que editar um desses `.js`, rode `node build_xxx.js` de novo e reimporte o `.json` resultante no n8n** — editar o `.json` gerado diretamente não é recomendado, ele será sobrescrito na próxima geração.

| Script gerador | Workflow gerado | O que faz |
|---|---|---|
| `build_workflow.js` | `Cria Cliente - Formulario.json` | Provisiona um cliente novo: cria o banco MySQL dele (todas as tabelas do template), grava em `ad_accounts`. Disparado pelo formulário `novo-cliente-form.html`. |
| `build_event_workflow.js` | `Traq. Form Instantâneo - Meta ADS - MySQL.json` | Recebe mudança de estágio do Kommo (webhook `POST /recebe-evento`), atualiza `customers.current_stage`, e se o novo estágio está mapeado em `crm_meta_event_map` com `is_conversion`/evento configurado, envia o evento pra Meta CAPI e grava em `meta_capi_events`. |
| `build_meta_insights_backfill_workflow.js` | `Meta Insights - Importação Histórica (manual).json` | Importa até 90 dias de insights de campanha de uma vez, sob demanda (um cliente por execução). |
| `build_meta_insights_sync_workflow.js` | `Meta Insights - Sincronização Sob Demanda.json` | Sincroniza os últimos 3 dias de insights de campanha, disparado pelo botão "Atualizar" do painel (substitui o antigo cron de 6h — ver seção 5). |
| `build_admin_panel_workflow.js` | `Painel Administrativo - Dashboard Clientes.json` | Todos os endpoints REST (`/painel-api/...`) que alimentam `painel-admin.html`, incluindo a nova aba de IA (seção 7). |
| **(manual, não gerado — fora da pasta `mySQL/`, na raiz do projeto)** | `01 - Recebe leads - Meta (CORRIGIDO).json` | **Este é o verdadeiro ponto de entrada do lead da Meta.** Recebe o `leadgen_id` (via sub-workflow, chamado por um workflow pai com o webhook público da Meta), busca os dados completos do lead na Graph API (`/v25.0/{leadgen_id}`, incluindo o `created_time` oficial do lead), cria o contato e o lead no Kommo CRM, e só então grava a linha em `customers` — já incluindo `created_at` = `created_time` da Graph API (corrigido nesta sessão, ver seção 2.3). Como não tem script gerador, qualquer alteração precisa ser feita direto no `.json` e reimportada manualmente no n8n. |

### 3.1 Padrão comum: validação de cliente

Praticamente todo webhook que mexe em dado de cliente específico começa validando o `client_db` recebido contra `trakeamento_controle.ad_accounts` **antes** de tocar em qualquer banco por cliente — evita injeção de nome de banco e erros de cliente inexistente. Isso é a função `addValidaClienteChain(...)` reutilizada em todos os `build_*.js`.

### 3.2 Padrão comum: filtro de período

Todos os endpoints que aceitam `range` (`hoje`/`ontem`/`7d`/`30d`/`ano`/`max`/`custom` + `date_from`/`date_to`) calculam os limites de data em **horário de São Paulo (UTC-3 fixo)**, convertendo pra epoch segundos, e montam a cláusula `WHERE` da query MySQL a partir disso. É a mesma lógica (copiada/adaptada) em todo lugar que tem filtro de data — inclusive no novo endpoint de IA (seção 7).

---

## 4. O painel administrativo (`painel-admin.html`)

Aplicação de página única (sem framework, JS puro), com abas por cliente:

| Aba | O que mostra |
|---|---|
| **Métricas Gerais** | KPIs de gasto/leads/CPL/conversões (+ Receita/ROAS opcionais), "Funil de vendas" (eventos por tipo), leads capturados por dia, tempo médio entre etapas, últimos leads. Indicadores "vs. período anterior" (seta verde/vermelha) em cada KPI. Botão "Personalizar métricas" controla o que aparece aqui (com override por cliente para Receita/ROAS). |
| **CRM · Kanban** | Leads agrupados por estágio atual, num quadro kanban. |
| **Campanhas** | Hierarquia Campanha → Conjunto de Anúncios → Anúncio, com métricas por nível. Botão "Importar histórico" dispara a importação de 90 dias. |
| **Configuração de Eventos** | Edita `crm_meta_event_map`: qual estágio do Kommo dispara qual evento Meta CAPI, e se conta como conversão. |
| **Últimos Eventos** | Lista paginada de `meta_capi_events` com filtro de status/busca/período, mais os 4 cards de resumo (Enviados/Erro/Pendentes/Taxa de Sucesso) e o gráfico "Eventos por status". |
| **Análise por IA** *(nova)* | Resumo em linguagem natural da performance da conta, gerado por IA. Detalhes na seção 7. |

O botão **"Atualizar"** nas abas Métricas Gerais e Campanhas dispara uma sincronização sob demanda com a Meta (seção 5) antes de recarregar os dados, com trava de duplo-clique.

O botão **"Ver tutorial de configuração"** (menu lateral) abre a aba Tutorial — ver seção 6.

---

## 5. Sincronização sob demanda (substituiu o cron de 6h)

Antes, um `Schedule Trigger` rodava a cada 6h e varria **todas** as contas ativas. Isso foi substituído por sincronização **sob demanda**, disparada pelo clique em "Atualizar":

1. Front-end chama `POST /painel-api/sync-meta-agora?client_db=...`.
2. O workflow tenta um `UPDATE` atômico em `ad_accounts.last_sync_started_at` — só "ganha o lock" se o valor atual for `NULL` ou tiver mais de **60 segundos**. Não existe "unlock" explícito: a própria janela de 60s reabre a condição sozinha.
3. Se conseguiu o lock: puxa os últimos 3 dias de insights da Marketing API e faz upsert em `insights_daily`.
4. Se **não** conseguiu (alguém sincronizou há menos de 60s): responde `429`, e o front-end trata isso como "ok, mostra os dados mais recentes do banco mesmo assim" (não é um erro pro usuário).

**Ação manual necessária no n8n:** o workflow antigo baseado em cron (se ainda estiver ativo/importado como "Meta Insights - Sincronização Periódica" ou nome similar) deve ser **desativado/removido** depois de importar `Meta Insights - Sincronização Sob Demanda.json`, senão os dois ficam rodando em paralelo.

---

## 6. Tutorial de configuração (reformulado nesta sessão)

**Problema anterior:** o tutorial mostrava os 3 guias completos (18 passos no total) de uma vez só, tanto na aba "Tutorial" do painel quanto no modal do formulário de novo cliente — extenso demais para acompanhar durante a configuração real.

**Solução:** os guias agora são navegados **um passo por vez**, com um contador ("Passo X de Y") e botões Anterior/Próximo. A informação em si (texto de cada passo, ordem dos 3 guias — App Meta, Pixel/CAPI, Webhook+Página) não mudou, só a forma de navegação.

- **`painel-admin.html`** (aba "Tutorial", página cheia): os 3 guias (App, Pixel, Webhook) aparecem um abaixo do outro, cada um com seu **próprio stepper independente** — dá pra avançar o guia 2 sem mexer no guia 1, por exemplo, útil porque na página cheia cabe ver os 3 títulos ao mesmo tempo.
- **`novo-cliente-form.html`** (modal `#tutorialOverlay`, espaço mais compacto): os 3 guias viram um **único wizard sequencial**, com pills clicáveis no topo para pular direto pra um guia (ex.: clicar na pill "Configurar o Pixel..." pula pro passo 1 do guia 2). Anterior/Próximo cruzam a fronteira entre guias nas pontas (ex.: "Próximo" no último passo do guia 1 leva ao passo 1 do guia 2).

Nenhuma mudança de backend foi necessária — é puramente front-end (a lista de passos já vinha de `GUIAS_TUTORIAL`, só a renderização mudou).

---

## 7. Análise por IA (Groq) — nova feature desta sessão

Nova aba "Análise por IA" no painel: o usuário digita uma pergunta opcional (ou deixa em branco pra uma análise geral), escolhe um período, clica "Analisar com IA", e recebe um resumo em texto gerado por um LLM a partir dos mesmos números já calculados em "Métricas Gerais" (gasto, leads, conversões, receita, funil de eventos) — a IA não vê dado bruto de lead nem informação pessoal, só os totais agregados do período.

### 7.1 Onde inserir a credencial da Groq (passo obrigatório, uma vez só)

A chave da API da Groq **nunca** fica salva no MySQL nem é exposta ao front-end — ela mora só no **cofre de credenciais do próprio n8n**, referenciada pelo workflow. Passo a passo:

1. No n8n, vá em **Credentials → Add Credential** e escolha o tipo **"Header Auth"**.
2. Preencha:
   - **Name**: `Groq API (configurar no n8n)` — precisa ser exatamente esse nome (ou você reatribui a credencial certa no node manualmente depois de importar).
   - **Header Name**: `Authorization`
   - **Header Value**: `Bearer SUA_CHAVE_AQUI` (pegue a chave em [console.groq.com](https://console.groq.com) → API Keys).
3. Abra o workflow **"Painel Administrativo - Dashboard Clientes"** já importado no n8n, encontre o node **"Chama Groq API"** (tem uma Sticky Note "IA Groq" do lado, com o mesmo passo a passo) e selecione a credencial que você acabou de criar no campo de autenticação do node.
4. Salve e ative o workflow. Pronto — a aba "Análise por IA" do painel já funciona.

Sem esse passo, o botão "Analisar com IA" retorna um erro explicando exatamente isso (o texto do erro já cita o nome do node e da Sticky Note). O aviso amarelo no topo da própria aba do painel também lembra disso.

### 7.2 Como funciona por dentro

Endpoint novo: `POST /painel-api/ia-analise?client_db=...&range=...&date_from=...&date_to=...` (período vai na query string, igual todo outro endpoint; a pergunta do usuário vai no corpo JSON: `{ "pergunta": "..." }`).

Cadeia de nodes (dentro de `Painel Administrativo - Dashboard Clientes.json`):

1. **Painel - IA** (webhook) → valida `client_db` (mesma cadeia `addValidaClienteChain` usada em todo endpoint).
2. **Monta Filtro Data IA** — mesmo cálculo de janela de data (fuso SP) usado em Métricas.
3. Cinco queries MySQL sequenciais: Total Gasto Meta, Total Leads, Total Conversões, Total Receita, Funil de Eventos — os mesmos números que já aparecem em "Métricas Gerais", recalculados no período escolhido.
4. **Monta Prompt IA** — monta um resumo textual desses números + a pergunta do usuário (se houver) num prompt para o modelo.
5. **Chama Groq API** (`httpRequest`, autenticação via credencial Header Auth) — chama a Chat Completions API da Groq.
6. Em caso de sucesso: **Monta Resposta IA** extrai o texto da resposta do modelo e devolve `{ analise: "..." }`.
7. Em caso de erro (chave não configurada, rate limit, etc.): **Resposta Erro IA** devolve `{ message: "..." }` com HTTP 502, com uma mensagem já explicando o que verificar.

### 7.3 Testando sem chave da Groq (mock)

`mock-serve.js` (servidor local de testes, ver seção 8) já simula esse endpoint — devolve um texto de exemplo plausível depois de um pequeno delay, sem chamar a Groq de verdade. Serve pra testar a interface (loading, resultado, erro) sem gastar créditos de API.

---

## 8. Testando localmente com `mock-serve.js`

`mock-serve.js` é um servidor Node.js standalone (sem dependências externas) que serve `painel-admin.html`/`novo-cliente-form.html` e simula **todos** os endpoints `/painel-api/...` com dados fake — não precisa de n8n nem MySQL rodando pra testar a interface.

```bash
node mock-serve.js
```

Abre em `http://localhost:8934` (lista de clientes fake) — `http://localhost:8934/painel` também funciona, e `http://localhost:8934/novo-cliente` abre o formulário de cadastro com o tutorial.

Use isso sempre que editar `painel-admin.html`/`novo-cliente-form.html` diretamente, ou depois de rodar um `build_*.js`, antes de reimportar no n8n de verdade — pega erro de JS/quebra visual sem precisar de credenciais reais.

---

## 9. Scripts SQL auxiliares (pasta `mySQL/`)

| Arquivo | Uso |
|---|---|
| `01_Banco_Central_Controle (Rode no SQL).sql` | Cria `trakeamento_controle` do zero (novas instalações) **e** documenta, em bloco comentado no fim, os `ALTER TABLE` necessários pra atualizar uma instalação já existente (as duas colunas novas: `ad_accounts.last_sync_started_at` e `painel_metric_prefs.client_db_name`). |
| `verificacao_migracao_01.sql` | **Somente leitura** — roda antes de decidir se precisa aplicar o migration acima. Se retornar as 2 colunas, já está aplicado. |
| `migration_painel_metric_prefs.sql` | Migration standalone equivalente à parte de `painel_metric_prefs` do arquivo acima (histórico; o arquivo `01_Banco_Central_Controle` já é a versão consolidada/atual). |
| `02_Template_Banco_Por_Cliente.sql` | Schema completo de um banco de cliente novo (referência — quem realmente cria é o node "Prepara Cadastro" do workflow "Cria Cliente - Formulario.json"). |
| `migracao_campanhas_hierarquia.sql` | Migration que adicionou as tabelas de hierarquia de campanhas (`meta_campaigns`/`meta_adsets`/`meta_ads`) a bancos de cliente já existentes (sessão anterior). |
| `verificacao_lead_conversao.sql` | **Somente leitura** — confirma se um lead específico (por ID) está corretamente mapeado como conversão, cruzando `customers.current_stage` com `crm_meta_event_map`. Útil pra depurar "marquei is_conversion mas não refletiu". |

**Regra importante do projeto:** nenhum desses scripts é executado automaticamente por mim (assistente) contra o banco de produção — todo `ALTER TABLE`/migration é entregue como arquivo `.sql` pra você mesmo rodar, depois de fazer backup (os próprios scripts trazem o `CREATE TABLE ... AS SELECT ...` de backup quando aplicável).

---

## 10. Onde estão os arquivos / o que foi atualizado nesta sessão

Todos os arquivos abaixo já foram **copiados para dentro da pasta `mySQL/` do projeto** (não é preciso baixar nada separadamente):

**Atualizados (continham versões mais antigas):**
- `painel-admin.html` — tutorial em etapas + aba "Análise por IA" completa.
- `novo-cliente-form.html` — tutorial em etapas (wizard com pills).
- `Painel Administrativo - Dashboard Clientes.json` — regenerado a partir do `build_admin_panel_workflow.js`, inclui a cadeia de nodes da IA.
- `build_admin_panel_workflow.js` — script gerador atualizado (é o que você roda de novo se quiser editar a lógica do painel no futuro).
- `mock-serve.js` — endpoint mock de IA adicionado.

**Novos (entregues nesta sessão, ainda não existiam na pasta do projeto):**
- `verificacao_migracao_01.sql`
- `verificacao_lead_conversao.sql`
- `Meta Insights - Sincronização Sob Demanda.json` + `build_meta_insights_sync_workflow.js`
- `Cria Cliente - Formulario.json`, `Meta Insights - Importação Histórica (manual).json`, `Traq. Form Instantâneo - Meta ADS - MySQL.json`, `build_event_workflow.js`, `build_meta_insights_backfill_workflow.js`, `build_workflow.js` (versões atuais consolidadas dos workflows já existentes)
- Este documento (`DOCUMENTACAO_APLICACAO.md`)

**Ação manual pendente sua:**
1. Rodar `verificacao_migracao_01.sql` no banco `trakeamento_controle` pra confirmar se o migration de colunas já foi aplicado (item 1 do seu pedido original).
2. Configurar a credencial da Groq no n8n (seção 7.1).
3. Reimportar os workflows atualizados no n8n e desativar o antigo workflow de sincronização por cron, se ainda estiver ativo (seção 5).

## 11. Correção de mapeamento + `created_at` (nova rodada de pedidos)

Ao investigar o pedido de fazer `customers.created_at` refletir o horário real do lead na Meta, encontrei um **erro no mapeamento da tabela da seção 3** desta documentação (já corrigido acima) e um **workflow que não fazia parte de nenhuma entrega anterior**:

- `build_workflow.js` na verdade gera `Cria Cliente - Formulario.json` (não `Traq. Form Instantâneo...` como estava escrito antes).
- `build_event_workflow.js` na verdade gera `Traq. Form Instantâneo - Meta ADS - MySQL.json` (o workflow de mudança de estágio do Kommo → Meta CAPI).
- **O workflow que de fato recebe o lead da Meta e grava em `customers` não tem script gerador nenhum** — é `01 - Recebe leads - Meta (CORRIGIDO).json`, na raiz do projeto (fora da pasta `mySQL/`). Ele nunca foi tocado nas sessões anteriores porque a documentação anterior apontava (incorretamente) pro `build_event_workflow.js`.

**O que foi corrigido nele nesta rodada** (detalhe técnico completo na seção 2.3): o INSERT em `customers` passou a gravar `created_at` = `created_time` oficial do lead retornado pela Graph API da Meta, em vez de deixar o banco preencher com o horário em que o n8n terminou de processar o webhook (que podia ficar minutos atrasado, já que antes do INSERT o workflow ainda chama a Graph API e cria contato+lead no Kommo). **Precisa reimportar `01 - Recebe leads - Meta (CORRIGIDO).json` no n8n pra essa correção valer** — fica um backup do arquivo anterior em `01 - Recebe leads - Meta (CORRIGIDO).backup-20260819.json`.

Também renomeei `Meta Insights - Sincronizacao Periodica.json` (o workflow antigo de cron, ainda presente na pasta) para `OBSOLETO - Meta Insights - Sincronizacao Periodica.json`, só pra deixar claro visualmente que ele foi substituído pelo "Sob Demanda" — se ele ainda estiver ativo no seu n8n, desative-o lá também (arquivo em disco não afeta o n8n).

**Resposta rápida sobre "7 dias somando com hoje" (seu item 6):** não há sobreposição. O range `'7d'` é uma janela única `[hoje-6, agora)` — os "últimos 7 dias" já incluem hoje, não é um total separado somado por cima. Um detalhe à parte que notei: o card "Leads capturados — últimos 7 dias" tem esse título fixo no HTML, mas os dados por trás dele na verdade respeitam o filtro de período selecionado (se você mudar o filtro pra "30 dias", o gráfico mostra 30 dias, não 7) — o título só não acompanha. Não mexi nisso ainda; avisa se quiser que eu ajuste o título pra ser dinâmico ou trave o gráfico em 7 dias fixos de verdade.

## 12. Período máximo dos filtros = data do primeiro lead do cliente

O filtro de datas (Métricas Gerais e Campanhas) e o backfill de histórico ("Importar histórico") agora respeitam o primeiro lead real de cada cliente, em vez de um limite fixo de 90 dias que não fazia sentido pra clientes com pouco tempo de casa:

- Novo endpoint **`GET painel-api/cliente-info`** ([build_admin_panel_workflow.js](build_admin_panel_workflow.js)): roda `SELECT DATE(MIN(created_at)) as primeiro_lead_em FROM customers` no banco do cliente selecionado. O front-end (`painel-admin.html`) chama esse endpoint ao trocar de cliente e usa a data retornada como `min` de todos os `<input type="date">` dos filtros — não dá mais pra selecionar uma data anterior ao primeiro lead.
- O **backfill de 90 dias** (`Meta Insights - Importação Histórica (manual).json`, gerado por [build_meta_insights_backfill_workflow.js](build_meta_insights_backfill_workflow.js)) ganhou o node **"Consulta Primeiro Lead (Backfill)"**, que faz a mesma consulta, e o node "Monta Range 90 Dias" agora calcula `since = max(hoje - 89 dias, primeiro_lead_em)` em vez de sempre `hoje - 89 dias`. Ou seja: cliente com 45 dias de histórico importa 45 dias, não 90 dias de janela vazia. **Precisa reimportar `Meta Insights - Importação Histórica (manual).json` no n8n.**

## 13. Coluna "Funil (eventos)" na aba Campanhas

Cada linha da tabela de Campanhas (e dos níveis Conjunto/Anúncio, ao expandir) agora mostra uma coluna **"Funil (eventos)"** com badges tipo `Lead 120` `ViewContent 80` `Purchase 12`, contando quantos eventos de cada tipo (`meta_capi_events.event_name`, só os com `status='SENT'`) pertencem a leads daquela campanha/conjunto/anúncio no período filtrado.

Implementado como um único `LEFT JOIN` de subquery agregada (`GROUP_CONCAT`) dentro de `buildHierarquiaQuery()` em [build_admin_panel_workflow.js](build_admin_panel_workflow.js) — como essa função já é compartilhada pelos 3 endpoints (`/campanhas`, `/campanhas/adsets`, `/campanhas/ads`), a coluna aparece automaticamente nos 3 níveis sem duplicar lógica. Sem novo node no fluxo n8n, sem novo endpoint.

## 14. Reorganização em pastas (nesta sessão)

A pasta do projeto (antes um monte de arquivos soltos, uns 25) foi separada em subpastas por funcionalidade, a seu pedido. Nenhum caminho relativo entre scripts/arquivos foi quebrado (todos usam `path.join(__dirname, ...)`, e cada `build_*.js` continua ao lado dos arquivos que ele lê/escreve):

| Pasta | Conteúdo |
|---|---|
| `Formulários Instantâneos/` | `Traq. Form Instantâneo - Meta ADS - MySQL.json`, `build_event_workflow.js`, `verificacao_lead_conversao.sql` |
| `Cadastro de Clientes/` | `Cria Cliente - Formulario.json`, `build_workflow.js`, `novo-cliente-form.html` (+ referência) |
| `WhatsApp/` | `WhatsApp Cloud API - Webhook.json`, `build_whatsapp_cloud_workflow.js`, `migracao_whatsapp_messages.sql`, `migration_whatsapp.sql` |
| `Painel Administrativo/` | `Painel Administrativo - Dashboard Clientes.json`, `build_admin_panel_workflow.js`, `painel-admin.html` (+ referência) |
| `Meta Insights/` | os 2 workflows de sincronização + backfill, seus `build_*.js`, `migracao_campanhas_hierarquia.sql` |
| `Banco de Dados/` | os 2 scripts de schema (central + template por cliente) + migrations/verificações do banco central |
| raiz (sem pasta) | `mock-serve.js` (serve HTML de duas pastas diferentes, fica melhor na raiz) e este documento |

**Todas as referências de caminho nas seções anteriores deste documento (ex.: `painel-admin.html`, `build_admin_panel_workflow.js`) valem — só acrescente o prefixo da pasta da tabela acima.** Não reescrevi cada menção individualmente para não inflar o documento.

---

## 15. WhatsApp Cloud API + aba "Conversas" (CRM) — nova feature desta sessão

Segunda origem de lead além do formulário instantâneo: contato iniciado pelo lead direto no WhatsApp (inclusive vindo de anúncio "Clique para o WhatsApp"). A aba **"Conversas"** do painel é o CRM dessas conversas — 3 colunas, no mesmo espírito do print de referência que você mandou (lista → thread em bolhas → dados do lead).

### 15.1 Banco de dados

- **Central (`trakeamento_controle`)** — [`WhatsApp/migration_whatsapp.sql`](WhatsApp/migration_whatsapp.sql): tabela `whatsapp_accounts` (1 conexão Cloud API por cliente: `cloud_phone_number_id`, `cloud_waba_id`, `cloud_access_token`) e a coluna `ad_accounts.meta_test_event_code` (código de teste do Gerenciador de Eventos — enquanto preenchido, os eventos de "Contato via WhatsApp" saem em modo de teste, não contam como conversão real).
- **Por cliente** — [`WhatsApp/migracao_whatsapp_messages.sql`](WhatsApp/migracao_whatsapp_messages.sql): `whatsapp_messages` (histórico de mensagens, `direction` inbound/outbound, `referral_ad_id`/`referral_ctwa_clid` quando a conversa veio de um anúncio), `whatsapp_conversations` (1 linha por lead: `status` — funil de 7 estágios desde a seção 22, era 3 valores nesta migration original —, `notes`, `tags`, `unread_count`, `last_inbound_at` — usado pra checar a janela de 24h da Meta antes de liberar envio livre) e a coluna `customers.whatsapp_contact_capi_sent_at` (guarda contra disparo duplicado do evento CAPI de contato). Já está incluído em [`Banco de Dados/02_Template_Banco_Por_Cliente.sql`](Banco%20de%20Dados/02_Template_Banco_Por_Cliente.sql), então **clientes novos já nascem com esse schema** — a migration acima só precisa rodar manualmente em clientes que já existiam antes desta sessão.

### 15.2 Workflow `WhatsApp Cloud API - Webhook.json` (gerado por `build_whatsapp_cloud_workflow.js`)

Recebe o webhook oficial da Meta Cloud API (mensagem inbound do lead): normaliza o telefone, casa com um `customer_id` existente (por telefone) ou cria um registro mínimo em `customers` se for a primeira vez, grava a mensagem em `whatsapp_messages`, e faz upsert em `whatsapp_conversations` (`unread_count = unread_count + 1`, atualiza `last_message_at`/`last_inbound_at`). Precisa ser **importado no n8n** e ter a URL pública + verify token cadastrados no App Dashboard da Meta (produto WhatsApp → Configuração → inscrever campo `messages`) — passo documentado no novo guia de tutorial (seção 18).

### 15.3 Endpoints novos (`build_admin_panel_workflow.js` / `Painel Administrativo - Dashboard Clientes.json`)

| Endpoint | Função |
|---|---|
| `GET /painel-api/whatsapp-conversas` | Lista conversas do cliente (nome, telefone, status, não-lidas, prévia da última mensagem), com filtro por status e busca. Alimenta a coluna esquerda. |
| `GET /painel-api/whatsapp-thread?customer_id=...` | Histórico completo da conversa + dados do lead + origem do anúncio (`ctwa_clid`/`ad_id`). Como efeito colateral, zera `unread_count` (abrir = marcar como lido). Alimenta a coluna central + o topo da coluna direita. |
| `POST /painel-api/whatsapp-enviar` | Envia mensagem de texto livre via Graph API da Meta. Antes de chamar a API, verifica `last_inbound_at`: fora da janela de 24h, recusa com mensagem explicando (esta versão não envia por template). |
| `POST /painel-api/whatsapp-lead-salvar` | Salva nome/email do lead + status/notas/tags da conversa (botão "Salvar" da coluna direita). |

### 15.4 Aba "Conversas" em `painel-admin.html`

Layout 3 colunas: lista de conversas (com busca e filtro por estágio — ver seção 22 para o funil de 7 estágios, que substituiu o filtro original de 3 valores) → thread em bolhas de chat (inbound à esquerda, outbound à direita, barra de composição desabilitada com aviso fora da janela de 24h) → painel do lead (Nome/Email editáveis, Status, Notas, Tags, Origem do Anúncio somente-leitura). Mensagens de mídia (imagem/áudio/vídeo/documento — o download do arquivo em si não foi implementado, fica fora do escopo) aparecem como bolha rotulada (ex. "📎 Imagem recebida").

**Atualização de tela:** lista recarrega a cada ~10s só enquanto a aba "Conversas" está ativa e a aba do navegador está em foco (pausa com `document.visibilityState`); thread aberta recarrega a cada ~5s só enquanto aquela conversa está selecionada. Zero processo novo, zero infraestrutura — ver decisão na seção 16.

### 15.5 Aviso de permissões necessárias (aba "WhatsApp")

No topo da aba "WhatsApp" (config), logo abaixo do título e antes do card "Configuração", um `.guide-reminder` (mesmo padrão visual do aviso de credencial da Groq na aba "Análise por IA") lembra as duas permissões da Meta exigidas para a aba Conversas funcionar de ponta a ponta:

- `whatsapp_business_messaging` — necessária pra enviar e receber mensagens.
- `whatsapp_business_management` — necessária pra gerenciar o número de telefone, o webhook e templates.
- Mais a inscrição do campo `messages` no webhook (App Dashboard → produto WhatsApp → Configuração) — sem isso o app não recebe mensagens novas mesmo com o token correto.

Texto completo idêntico ao já usado no guia "WhatsApp Cloud API e a aba Conversas" do Tutorial (seção 18) — o aviso na aba só resume e aponta de volta pro guia, sem duplicar o passo a passo.

---

## 16. Decisão de infraestrutura: Redis e RabbitMQ não são usados nesta feature

Você informou que tem VPS próprio com Redis e RabbitMQ disponíveis e pediu pra eu sinalizar se algum fosse necessário. **Nenhum dos dois é usado na feature de WhatsApp/Conversas — decisão registrada aqui:**

- **RabbitMQ** existe pra desacoplar produtor/consumidor em processamento assíncrono pesado com fila de trabalho pendente. O webhook da Meta é processado de forma síncrona pelo próprio n8n, mesmo padrão de todo o resto do projeto (leads de formulário, eventos de CRM, sincronização de insights) — não há cenário de fila aqui. Introduzir RabbitMQ seria complexidade nova sem ganho real.
- **Redis** ajudaria principalmente para (a) pub/sub de atualização em tempo real da tela de conversas, ou (b) cache de listagem. Isso exigiria um processo novo rodando 24/7 no VPS (WebSocket/SSE) e estado adicional pra manter e monitorar — infraestrutura permanente pra um ganho de poucos segundos de latência.
- **Alternativa adotada**: polling enxuto e consciente de contexto (seção 15.4) — lista a cada ~10s, thread a cada ~5s, só enquanto a tela relevante está aberta e em foco. Dá atualização quase em tempo real sem processo novo, sem fila, sem estado adicional no VPS.
- **Quando reconsiderar**: se o painel um dia tiver muitos atendentes simultâneos olhando "Conversas" ao mesmo tempo e o polling virar gargalo real de banco, Redis (pub/sub) é a opção natural nesse momento — não é o caso hoje.

---

## 17. Correção do texto da "Análise por IA" (Markdown renderizado)

O texto que a Groq devolve vem em Markdown (`**negrito**`, `### título`, `- item`), mas antes era jogado direto como texto puro (`.textContent`) — aparecia tudo cru na tela, com os símbolos visíveis. Agora `painel-admin.html` tem uma função `renderMarkdown()` (sem dependência externa, mesmo estilo "tudo vanilla" do resto do projeto) que escapa o HTML primeiro e depois converte títulos, negrito e listas para HTML de verdade antes de exibir. Nenhuma mudança no backend/n8n — é só front-end, não precisa reimportar nada por causa disso.

---

## 18. Tutorial: reconciliação de texto + novo guia "WhatsApp Cloud API"

Você notou que o tutorial do painel (`painel-admin.html`) e o do formulário de novo cliente (`novo-cliente-form.html`) tinham divergido — um foi atualizado, o outro não. Os dois arquivos usam mecanismos de exibição diferentes (o painel tem um stepper independente por guia numa página cheia; o formulário tem um wizard único num modal compacto) e unificar esse mecanismo de renderização não valia a pena reescrever agora. **Meio-termo aplicado**: cada arquivo manteve sua própria estrutura de exibição, mas o **texto de cada guia foi igualado nos dois lugares** — os 3 guias existentes (App Meta, Pixel/CAPI, Webhook) usam exatamente o mesmo conteúdo em ambos, e um **4º guia novo, "WhatsApp Cloud API e a aba Conversas"**, foi adicionado nos dois arquivos com o mesmo texto: criar app Business → produto WhatsApp → pegar Phone Number ID e WABA ID → gerar token permanente via System User → cadastrar URL do webhook + verify token no App Dashboard → inscrever campo `messages` → (opcional) Test Event Code pra testar sem gerar conversão real.

---

## 19. Correção: contagem de leads não batia entre Conjunto e seus Anúncios (aba Campanhas)

Você reportou (com print) um conjunto de anúncios mostrando 40 leads enquanto a soma dos anúncios dele batia 43 (41+2+0). Causa: `customers.meta_adset_id`/`meta_campaign_id` são gravados **uma vez**, no momento da captura do lead — se o anúncio for movido de conjunto/campanha depois na Meta Ads Manager, essas colunas ficam desatualizadas (`meta_ad_id`, por outro lado, nunca muda, então o nível "Anúncio" sempre está correto). Corrigido em `buildHierarquiaQuery()` ([`Painel Administrativo/build_admin_panel_workflow.js`](Painel%20Administrativo/build_admin_panel_workflow.js)): os níveis "Conjunto" e "Campanha" agora derivam o agrupamento **ao vivo**, via `JOIN meta_ads ON meta_ads.ad_id = customers.meta_ad_id`, em vez de confiar nas colunas de snapshot — a tabela `meta_ads` é mantida sincronizada com a estrutura atual da conta pela sincronização de Insights. Isso garante que a soma dos anúncios sempre bate com o total do conjunto/campanha. **Precisa reimportar `Painel Administrativo - Dashboard Clientes.json` no n8n.** Sem mudança de schema — não precisa rodar SQL nenhum por causa disso.

## 20. Período padrão dos filtros = "Últimos 7 dias"

Os 5 filtros de período do painel (Kanban, Campanhas, Leads Recentes, Análise por IA, Métricas Gerais) vinham com "Máximo" selecionado por padrão. Trocado para **"Últimos 7 dias"** em todos — vale só pra quem nunca mudou o filtro manualmente: a preferência já salva no navegador (`localStorage`, chave `painel_periodo_range`, compartilhada entre os 5 filtros) continua sendo respeitada e não é sobrescrita por esta mudança.

---

## 21. Métricas personalizadas na aba Campanhas: Receita, ROAS e ROI

Resposta ao pedido de métricas personalizadas (ROI, ROAS etc.) na aba Campanhas. Fórmula confirmada com você: **ROI = (Receita − Gasto) / Gasto**.

- **Backend**: `buildHierarquiaQuery()` ganhou mais um `LEFT JOIN` de subquery, somando `meta_capi_events.value` (eventos `status='SENT'`) dos leads de cada campanha/conjunto/anúncio, mas só quando o evento corresponde a um estágio marcado como conversão em `crm_meta_event_map.is_conversion=1` (mesma regra já usada em "Total Receita" da aba Métricas Gerais). O campo `receita` passa a vir pronto por linha nos 3 endpoints de hierarquia.
- **ROAS e ROI são calculados no front-end** (`fmtRoas`/`fmtRoi` em `painel-admin.html`), a partir de `spend` (já existente) e `receita` (novo) — evita duplicar a mesma conta em SQL nos 3 níveis.
- **Essas 3 colunas (Receita, ROAS, ROI) vêm desligadas por padrão** e são ativadas por cliente, no novo botão **"Personalizar colunas"** da aba Campanhas (dropdown independente do "Personalizar métricas" da aba Métricas Gerais). Reaproveita 100% o mecanismo já existente de `painel_metric_prefs`/`painel-api/metricas-prefs[-salvar]` — só foram adicionadas 3 entradas novas no catálogo do front-end (`campanhas_receita`, `campanhas_roas`, `campanhas_roi`), sem nenhuma mudança no backend desse endpoint. A visibilidade é aplicada via classe CSS na tabela (`#campanhasTable.hide-col-receita` etc.), então ligar/desligar uma coluna é instantâneo, sem recarregar a tabela.
- **Precisa reimportar `Painel Administrativo - Dashboard Clientes.json` no n8n** (já regenerado a partir de `build_admin_panel_workflow.js` com o join de receita).

---

## 22. Estágios ricos no funil de Conversas WhatsApp + evento Meta por estágio

Você perguntou como identificar eventos por mudança de estágio no CRM de Conversas WhatsApp, já que no Kommo isso é feito movendo o lead de etapa (`crm_meta_event_map`). A aba Conversas não tinha equivalente — só 3 valores de status (`aberta`/`aguardando`/`resolvida`) sem nenhum gancho de evento. Esta seção implementa os dois pedidos: um funil mais rico e o mesmo mecanismo de mapeamento estágio → evento Meta que o Kommo já tem.

### 22.1 Novo funil: 7 estágios fixos (⚠️ substituído — ver [seção 26](#26-estágios-dinâmicos-no-funil-de-conversas-whatsapp-crud-completo-igual-ao-formulário))

`novo` → `em_atendimento` → `aguardando` → `qualificado` → `proposta` → `ganho` / `perdido` (substituindo os 3 valores antigos). Diferente do funil do Kommo (pipelines/status dinâmicos, cadastrados pelo cliente), este era uma lista **fixa** — não dava para o admin criar/remover estágio, só ativar/configurar o evento de cada um.

> **Isso não é mais verdade.** A seção 26 documenta a evolução para CRUD completo — o admin agora cria, renomeia e exclui estágios livremente, igual ao Kommo. Os 7 nomes acima continuam existindo como semente inicial de cliente novo, mas deixaram de ser uma lista travada.

### 22.2 Banco de dados — tabela `whatsapp_event_map`

Equivalente ao `crm_meta_event_map` do Kommo, mas simplificado pra lista fixa (sem `pipeline_id`/`status_id`, chave única é o próprio `estagio`):

```sql
CREATE TABLE IF NOT EXISTS whatsapp_event_map (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  estagio VARCHAR(20) NOT NULL,
  meta_event VARCHAR(255),
  content_name VARCHAR(255),
  currency VARCHAR(3) DEFAULT 'BRL',
  value DECIMAL(10,2) DEFAULT 0.00,
  ativo BOOLEAN DEFAULT FALSE NOT NULL,
  is_conversion BOOLEAN DEFAULT FALSE NOT NULL,
  CONSTRAINT whatsapp_event_map_estagio_unique UNIQUE (estagio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- Já incluída em [`Banco de Dados/02_Template_Banco_Por_Cliente.sql`](Banco%20de%20Dados/02_Template_Banco_Por_Cliente.sql) e no cadastro automático de cliente novo (`Cadastro de Clientes/build_workflow.js`, nós "Cria Tabela whatsapp_event_map" + "Expande Estágios" + "Insere Mapeamento de Estágios") — **clientes novos já nascem com as 7 linhas pré-semeadas**, todas inativas e sem evento escolhido, exceto `ganho` que já nasce com `is_conversion=1` (ainda inativa — o admin escolhe o evento e ativa depois).
- Clientes que já existiam antes desta sessão precisam rodar [`WhatsApp/migracao_whatsapp_estagios.sql`](WhatsApp/migracao_whatsapp_estagios.sql) manualmente: migra os dados (`aberta→novo`, `resolvida→ganho`, `aguardando` sem mudança — decisão de mapeamento documentada no próprio arquivo, revisável manualmente depois), amplia a coluna `status`, cria a tabela e semeia as 7 linhas.
- **`is_conversion` não está ligado ao cálculo de CAC/funil ainda** (diferente do `crm_meta_event_map.is_conversion`, usado em ~6 lugares nas abas Métricas/Campanhas/IA) — fica guardado pra paridade e uso futuro, documentado tanto no SQL quanto na UI ("ainda não usado no cálculo de CAC").

### 22.3 Disparo de evento CAPI ao mudar de estágio (`build_admin_panel_workflow.js`)

O endpoint `POST /painel-api/whatsapp-lead-salvar` (botão "Salvar" da coluna direita da aba Conversas) ganhou um ramo paralelo que dispara CAPI quando o estágio muda:

1. Consulta o estágio anterior do lead antes de salvar.
2. Depois de salvar, busca em `whatsapp_event_map` se o **novo** estágio tem `ativo=1`.
3. Se o estágio realmente mudou **e** o mapeamento está ativo com um evento escolhido: hashea o telefone (SHA256), monta o payload e envia à Meta CAPI (`https://graph.facebook.com/v25.0/{dataset_id}/events`), usando as mesmas credenciais (`meta_pixel_dataset_id`/`meta_access_token`/`meta_test_event_code`) já configuradas em `ad_accounts` para os outros eventos do cliente.
4. Grava o resultado (sucesso ou erro) em `meta_capi_events`, com `lead_event_source='WhatsApp Conversas'`.

Esse ramo roda **em paralelo** ao salvamento principal — não bloqueia nem atrasa a resposta do botão "Salvar", é um efeito colateral "dispare e esqueça". `event_id` é gerado como `whatsapp_estagio_{customer_id}_{estagio}_{timestamp}` — **não é idempotente de longo prazo** (diferente do evento único de "Contato via WhatsApp"), porque um lead pode legitimamente reentrar no mesmo estágio várias vezes ao longo do relacionamento, e cada transição deve poder disparar de novo.

### 22.4 Novos endpoints de configuração

| Endpoint | Função |
|---|---|
| `GET /painel-api/whatsapp-eventos` | Lista as 7 linhas de `whatsapp_event_map`. |
| `POST /painel-api/whatsapp-eventos-salvar` | Upsert por `estagio` (chave única — sempre atualiza, nunca duplica). Valida que `ativo=1` exige `meta_event` preenchido (senão devolve erro "Escolha o Evento Meta antes de ativar o disparo para este estágio.") — evita deixar um estágio "ativo" mas sem fazer nada, o que confundiria o admin. |

### 22.5 Painel (`painel-admin.html`)

- Aba **Conversas**: filtros de status (8 botões: Todas + os 7 estágios), select "Status" no painel do lead com os 7 valores, botão de ação rápida renomeado de "Marcar como resolvida" para **"Marcar como Ganho"** (equivalente mais próximo do antigo "resolvida").
- Aba **Configuração de Eventos**: novo card "Mapeamento de Eventos (Conversas WhatsApp → Evento Meta)", logo abaixo do card já existente do Kommo — 7 linhas fixas (sem adicionar/remover, só editar Evento Meta/Nome do Conteúdo/Moeda/Valor/Ativo/Marcar como conversão), cada uma salva individualmente no `POST whatsapp-eventos-salvar`.

### 22.6 Mock (`mock-serve.js`)

Conversas fake agora sorteiam entre os 7 estágios novos; filtro por estágio usa o valor cru (sem mapa `abertas→aberta` etc., já que agora o valor do estágio é o mesmo enviado pelo front); novos handlers mock para `whatsapp-eventos`/`whatsapp-eventos-salvar` (estado em memória por cliente, mesma validação "ativo exige evento" do backend real) — testado no preview (porta 8935): filtros, botão "Marcar como Ganho", e salvamento do card de eventos (incluindo a mensagem de erro de validação) funcionando.

**Precisa reimportar no n8n**: `Cria Cliente - Formulario.json` (regenerado a partir de `build_workflow.js`) e `Painel Administrativo - Dashboard Clientes.json` (regenerado a partir de `build_admin_panel_workflow.js`). Clientes já existentes precisam rodar `migracao_whatsapp_estagios.sql` manualmente (rollout pendente, nada disso foi executado em produção ainda).

## 23. Correção: polling da aba Conversas sobrescrevendo os campos do lead

Você reportou dois sintomas do mesmo problema: (1) o painel de Conversas "atualizando sozinho toda hora" e (2) dados digitados em Notas/Tags sumindo sozinhos. Causa raiz em `painel-admin.html`: o polling da thread (a cada 5s, enquanto uma conversa está aberta) chamava `renderThread(data)` incondicionalmente a cada tick — essa função não só redesenha as bolhas de mensagem, como também **reescreve** os campos `leadNome`/`leadEmail`/`leadStatus`/`leadNotas`/`leadTags` com o que veio do banco, apagando qualquer coisa que o usuário estivesse digitando naquele momento, mesmo sem nenhuma mensagem nova ter chegado. O polling da lista (a cada 10s) tinha o mesmo problema de granularidade: re-renderizava a lista inteira mesmo sem nenhuma mudança real.

**Correção**: `renderThread` foi dividido em `renderThreadMessages(mensagens)` (só as bolhas) e o restante (campos do lead), e o polling agora:
- Calcula uma "assinatura" da conversa a cada tick (quantidade de mensagens + id/data da última) e só chama `renderThreadMessages` quando essa assinatura muda — ou seja, só quando chega mensagem nova de fato.
- **Nunca** chama a parte que reescreve os campos do lead durante o polling — esses campos só são preenchidos quando o usuário abre a conversa (clique na lista), nunca em background.
- A lista de conversas aplica a mesma lógica de assinatura (`customer_id:last_message_at:unread_count:status` de cada linha) e só re-renderiza quando algo realmente mudou, em vez de redesenhar tudo a cada 10s.

Verificado no preview (porta 8935): abri uma conversa, digitei em Notas e Tags, esperei 12s (mais que os dois ciclos de polling) e o texto digitado permaneceu intacto.

## 24. Correção: mensagens de WhatsApp duplicando no painel

Você reportou mensagens duplicadas na aba Conversas (ex.: dois "oi" recebidos com ~39s de diferença, sem equivalente no WhatsApp real). Causa: em `build_whatsapp_cloud_workflow.js`, o nó `WhatsApp Cloud - Recebe (POST)` só respondia `200 OK` pra Meta **depois** de todo o processamento (busca de cliente, insert em `whatsapp_messages`, upsert em `whatsapp_conversations` e, quando aplicável, disparo de evento CAPI com chamada HTTP à Meta). Esse caminho é longo o bastante pra estourar o timeout de webhook da Meta, que reenvia a mesma notificação — e cada reenvio era processado como mensagem nova. O intervalo do print bate com o padrão de retry da Meta.

**Primeira tentativa (revertida)**: cheguei a trocar o webhook de POST para `responseMode: "onReceived"` (resposta automática e imediata, sem nó explícito). O n8n **rejeitou essa configuração** com um erro de validação — `WorkflowConfigurationError: Unused Respond to Webhook node found in the workflow` — porque o modo `onReceived` não pode coexistir com nenhum nó "Respond to Webhook" explícito em lugar nenhum do workflow, mesmo em ramos que nunca seriam alcançados por aquele trigger. É um erro que bloqueia a execução, não um aviso.

**Correção final**: mantido `responseMode: "responseNode"` (o padrão, exigido pelo n8n) em `WhatsApp Cloud - Recebe (POST)`. Em vez de responder no fim do fluxo, foi adicionado um nó explícito **"Responde Recebido (ack imediato)"** logo depois da checagem de "ignorar" (antes de qualquer busca de cliente, insert ou chamada à Meta pro CAPI). Esse nó dispara a resposta HTTP `200` pra Meta imediatamente, e o restante do fluxo (busca de cliente, grava mensagem, upsert conversa, disparo de CAPI) continua rodando normalmente depois dele — o n8n permite continuar processando depois que a resposta já foi enviada, só não permite mais de um nó de resposta disparando na mesma execução. Por isso, todos os nós "Responde ..." que existiam mais adiante na cadeia (fim do fluxo sem CAPI, sucesso do CAPI, falha do CAPI, conta desconhecida) foram removidos — cada um virou um comentário no lugar, já que a resposta real agora sempre é a do ack imediato. O webhook de verificação (GET, handshake inicial da Meta) **não** foi alterado — ele precisa continuar devolvendo o `hub.challenge` exato no corpo da resposta, então mantém `responseMode: "responseNode"` com resposta no fim, como já era.

Isso reduz drasticamente a chance de retry, mas a proteção de fundo contra duplicata continua sendo o `UNIQUE (wa_message_id)` em `whatsapp_messages` (insert com `onError: continueErrorOutput` — se por algum motivo a Meta reenviar mesmo assim, o segundo insert falha silenciosamente em vez de criar linha duplicada). **Importante**: essa constraint só existe se `migracao_whatsapp_messages.sql` já rodou no banco daquele cliente específico — se o cliente de teste é anterior à criação dessa tabela, vale conferir/rodar a migração nele também.

**Precisa reimportar no n8n**: `WhatsApp Cloud API - Webhook.json` (regenerado a partir de `build_whatsapp_cloud_workflow.js`).

## 25. Separação do menu em "Formulários" e "WhatsApp" + exclusão de mapeamento de evento do WhatsApp

Antes, o menu lateral do cliente era uma lista única (Métricas, Kanban, Campanhas, Configuração de Eventos, Últimos Eventos, WhatsApp, Conversas, Análise por IA), e a aba **"Configuração de Eventos" misturava dois cards**: o mapeamento de eventos do funil do Kommo (formulário) e o mapeamento de eventos do funil de Conversas WhatsApp — os dois carregavam juntos (`loadEventos()` + `loadWhatsappEventos()`) e compartilhavam a mesma área de feedback (`eventosFeedback`), causando confusão sobre qual card pertencia a qual canal.

**Correção**: o menu lateral (`painel-admin.html`) agora tem dois grupos com `nav-section-label` próprios:
- **Formulários**: Métricas Gerais, CRM · Kanban, Campanhas, Configuração de Eventos (só o card do Kommo), Últimos Eventos, Análise por IA.
- **WhatsApp**: Conexão (antiga aba "WhatsApp", só renomeada — mesmo `data-tab="whatsapp"`), Configuração de Eventos (nova aba `data-tab="whatsapp-eventos"`, só o card das Conversas WhatsApp, com sua própria área de feedback `whatsappEventosFeedback`), Conversas.

A aba de eventos do Kommo (`tab-eventos`) e a nova aba de eventos do WhatsApp (`tab-whatsapp-eventos`) agora carregam e mostram feedback de forma independente — `switchTab` dispara `loadEventos()` só quando entra em `eventos`, e `loadWhatsappEventos()` só quando entra em `whatsapp-eventos`.

**Nova funcionalidade — excluir/editar mapeamento de evento do WhatsApp**: cada uma das 7 linhas de estágio (Novo, Em Atendimento, Aguardando, Qualificado, Proposta, Ganho, Perdido) já podia ser editada (botão "Salvar", que faz upsert). Agora também tem um botão **"Remover mapeamento"** (com confirmação) que limpa a configuração daquele estágio — evento Meta, nome do conteúdo, moeda e valor voltam a ficar vazios e "Ativo" é desmarcado. Isso não apaga a linha do estágio em si (os 7 estágios são fixos, pré-semeados por cliente em `whatsapp_event_map`, e não dá pra adicionar/remover estágio) — "remover" aqui significa voltar aquele estágio para o estado "sem evento configurado", igual a como ele nasce num cliente novo.

Novo endpoint no workflow do painel: `POST /painel-api/whatsapp-eventos-excluir` (`{ estagio }` no corpo) — faz um `UPDATE` que zera os campos daquele estágio, em vez de um `DELETE` de linha.

**Precisa reimportar no n8n**: `Painel Administrativo - Dashboard Clientes.json` (regenerado a partir de `build_admin_panel_workflow.js`, agora com o endpoint novo).

> **⚠️ Superado pela seção 26.** O parágrafo acima descreve o comportamento de uma versão anterior (`UPDATE` que zera os campos, chave por `estagio`, lista fixa de 7 linhas). O endpoint `whatsapp-eventos-excluir` hoje faz um `DELETE` de linha de verdade, por `id`, e o admin pode criar quantos estágios quiser — ver seção 26.

## 26. Estágios dinâmicos no funil de Conversas WhatsApp (CRUD completo, igual ao formulário)

Você pediu que a lógica de eventos do WhatsApp fosse **igual à do formulário (Kommo)**: o admin deve poder cadastrar, renomear e excluir estágios livremente, não ficar preso a uma lista fixa. As seções 22 e 25 acima descrevem a versão anterior (7 estágios fixos, "remover" era só um `UPDATE` zerando campos) — esta seção documenta a reescrita que corrige isso e substitui aquele comportamento.

### 26.1 O que mudou

- **Antes** (seção 22.1): `whatsapp_event_map` tinha `estagio` como chave única, 7 linhas pré-semeadas por cliente, sem criar/remover linha — só editar as 7 existentes.
- **Agora**: `estagio` deixou de ser chave única. A tabela usa `id BIGINT AUTO_INCREMENT` como chave, exatamente como `crm_meta_event_map` do Kommo já funciona. O admin adiciona uma linha nova a qualquer momento (botão "+ Novo Estágio"), digita o nome livremente, e pode excluir qualquer linha existente com um `DELETE` de verdade — mesma mecânica ponta-a-ponta do mapeamento de eventos do formulário.
- Isso também tornou obsoleta a frase "não é ligado ao cálculo de CAC ainda" da seção 22.2 quanto à estrutura da tabela em si (o campo `is_conversion` continua existindo e com o mesmo papel, isso não mudou) — o que mudou foi só a chave e o CRUD.

### 26.2 Banco de dados

`whatsapp_event_map.estagio` foi alargado de `VARCHAR(20)` para `VARCHAR(60)` (nomes de estágio livres, mais longos que os 7 nomes fixos originais). A constraint `UNIQUE (estagio)` **continua existindo** — ela não impede o CRUD por `id` (ver 26.3), e continua útil pra impedir dois estágios com o nome exatamente igual. `whatsapp_conversations.status` foi alargado junto (mesmo motivo: o valor gravado ali é o nome do estágio escolhido pelo admin, que agora pode ser qualquer string até 60 caracteres).

Migração (banco por cliente, roda uma vez em cada cliente que já existia antes desta mudança): [`WhatsApp/migracao_whatsapp_estagios_dinamicos.sql`](WhatsApp/migracao_whatsapp_estagios_dinamicos.sql). Não altera nem apaga nenhum dado existente — só alarga as duas colunas. Clientes novos já nascem com o schema no tamanho novo.

### 26.3 Endpoints (`build_admin_panel_workflow.js`)

| Endpoint | Função |
|---|---|
| `GET /painel-api/whatsapp-eventos` | Lista todas as linhas de `whatsapp_event_map` (`id, estagio, meta_event, content_name, currency, value, ativo, is_conversion`), quantas o cliente tiver cadastrado. |
| `POST /painel-api/whatsapp-eventos-salvar` | Se o corpo vier **com `id`** (linha já existente): `UPDATE whatsapp_event_map SET estagio=..., ... WHERE id = ...` — atualiza a linha por identidade, o que permite **renomear** o estágio (mudar o texto de `estagio`) sem criar linha duplicada. Se vier **sem `id`** (estágio novo): `INSERT ... ON DUPLICATE KEY UPDATE` (a cláusula `ON DUPLICATE KEY` aqui só é uma proteção contra duplo-clique/corrida na criação, não é o mecanismo principal de atualização). Mesma validação de antes (`ativo=1` exige `meta_event` preenchido) e valida que `estagio` (nome) não pode vir vazio. |
| `POST /painel-api/whatsapp-eventos-excluir` | `DELETE FROM whatsapp_event_map WHERE id = ...` — exclusão real de linha, não mais um `UPDATE` que zera campos. Requer `id` no corpo. |

> **Bug corrigido durante esta implementação**: a primeira versão do `whatsapp-eventos-salvar` ignorava o `id` enviado pelo front e fazia upsert só pelo nome do estágio (`estagio` como chave) — copiado direto do padrão do endpoint equivalente do Kommo (`eventos-salvar`), que usa `(pipeline_id, status_id)` como chave natural porque lá esses IDs nunca mudam. A diferença é que no WhatsApp o "nome do estágio" é texto livre e editável — então esse padrão quebrava justamente o caso de **renomear um estágio já existente**: em vez de atualizar a linha, criava uma linha nova com o novo nome (a antiga ficava órfã). Corrigido para o comportamento id-aware descrito acima, tanto no workflow real quanto no mock (`mock-serve.js`), e reverificado no preview antes de liberar para produção.

### 26.4 Painel (`painel-admin.html`)

Na aba **Configuração de Eventos (WhatsApp)**, cada linha de estágio agora se comporta exatamente como uma linha de evento do formulário:
- Botão **"+ Novo Estágio"** (`addWhatsappEventRow`) adiciona uma linha em branco na tela, sem chamar a API ainda — só ao clicar "Salvar" naquela linha é que ela é gravada (`whatsapp-eventos-salvar` sem `id`, o que dispara o `INSERT`).
- Linha que já existe no banco (tem `id`) mostra o botão **"Excluir"**, que chama `whatsapp-eventos-excluir` com aquele `id` (confirmação antes, via `confirm()`) e some da tela — a linha é apagada de verdade.
- Linha ainda não salva (sem `id`) mostra **"Remover"** em vez de "Excluir" — só tira a linha da tela (não chama a API, porque nunca chegou a existir no banco).
- O campo "Nome do Estágio" é um `<input type="text">` livre (não mais um rótulo fixo) — o admin digita qualquer nome.
- A aba **Conversas** (filtros de status, select de status no painel do lead) deixou de ter os 8 botões fixos (Todas + 7 estágios) descritos na seção 22.5 — agora monta esses filtros dinamicamente a partir de `whatsappEstagiosCache` (`refreshWhatsappEstagiosCache()`, que recarrega sempre que um estágio é salvo ou excluído em Configuração de Eventos), então a lista de filtros sempre reflete os estágios que o cliente realmente cadastrou.

### 26.5 Comportamento herdado, sem mudança

O disparo de evento CAPI ao mudar de estágio (seção 22.3, endpoint `whatsapp-lead-salvar`) continua funcionando igual: compara o estágio anterior com o novo, busca o mapeamento pelo nome do estágio (`estagio`) em `whatsapp_event_map` com `ativo=1`, e dispara CAPI se houver evento configurado — essa lógica não dependia da chave ser `estagio` ou `id`, então não precisou mudar.

**Precisa reimportar no n8n**: `Painel Administrativo - Dashboard Clientes.json` (regenerado a partir de `build_admin_panel_workflow.js`). **Clientes já existentes precisam rodar** `migracao_whatsapp_estagios_dinamicos.sql` manualmente (rollout pendente, nada disso foi executado em produção ainda — junto com as duas migrações WhatsApp anteriores que também seguem pendentes).

## 27. Paridade de abas Formulários/WhatsApp + pasta de Métricas Gerais

Você pediu que a aba WhatsApp tivesse o mesmo conjunto de abas que a de Formulários (Métricas, Últimos Eventos, Análise por IA — além da Configuração de Eventos, que a seção 25 já tinha separado), e uma pasta nova, geral, com métricas combinadas dos dois canais.

### 27.1 Menu lateral: 3 seções

O menu do cliente (`painel-admin.html`) passou a ter 3 grupos com `nav-section-label`:

- **Geral**: Métricas Gerais (`data-tab="metricas"`, combinando os dois canais) e Campanhas (`data-tab="campanhas"` — continua compartilhada/geral, sem versão por canal, já que o dado de campanha é sempre de anúncio Meta, independente de o lead ter convertido por formulário ou WhatsApp).
- **Formulários**: Métricas (`metricas-form`), CRM · Kanban (`kanban`), Configuração de Eventos (`eventos`), Últimos Eventos (`recentes-form`), Análise por IA (`ia-form`).
- **WhatsApp**: Conexão (`whatsapp`, aba já existente, só realocada), Métricas (`metricas-whatsapp`), Configuração de Eventos (`whatsapp-eventos`, já existente desde a seção 25), Conversas (`conversas`, aba já existente, só realocada), Últimos Eventos (`recentes-whatsapp`), Análise por IA (`ia-whatsapp`).

Não existe Kanban nem Campanhas específicos de WhatsApp: Kanban é a visão de pipeline do Kommo (não existe pipeline de Kommo para conversas de WhatsApp — a aba Conversas já cobre esse papel para o canal), e Campanhas é sempre geral pelo motivo acima.

### 27.2 Painel único reaproveitado por 3 destinos de menu, não 3 páginas separadas

Em vez de triplicar o HTML de Métricas/Últimos Eventos/Análise por IA (uma cópia para Geral, uma para Formulários, uma para WhatsApp), cada um desses 3 recursos continua sendo **um único painel HTML** (`tab-metricas`, `tab-recentes`, `tab-ia`), reaproveitado pelos 3 (ou 2, no caso de Últimos Eventos/IA, que não têm versão "Geral") itens de menu que apontam para ele. `switchTab(name)` resolve qual painel mostrar através de tabelas de lookup:

```js
var METRICAS_TAB_CHANNEL = { 'metricas': 'geral', 'metricas-form': 'form', 'metricas-whatsapp': 'whatsapp' };
var RECENTES_TAB_CHANNEL = { 'recentes-form': 'form', 'recentes-whatsapp': 'whatsapp' };
var IA_TAB_CHANNEL = { 'ia-form': 'form', 'ia-whatsapp': 'whatsapp' };
```

Clicar em qualquer um desses itens de menu ativa o mesmo painel (`tab-metricas`, `tab-recentes` ou `tab-ia`) e grava o canal escolhido numa variável (`currentMetricasChannel`/`currentRecentesChannel`/`currentIaChannel`), que é enviada como `&channel=...` na chamada à API correspondente (`/painel-api/metricas`, `/painel-api/eventos-recentes`, `/painel-api/ia-analise`). O backend desses 3 endpoints já sabia filtrar por canal (implementado numa sessão anterior) — o que faltava era só essa reutilização de painel + roteamento no front, que é o que esta seção documenta.

### 27.3 O que muda na aba Métricas por canal

Gasto, CPL, Impressões, Alcance, Frequência, Cliques, CTR, CPC, CPM e ROAS são métricas de investimento em anúncio — não são atribuíveis a "canal de conversão" (o mesmo anúncio pode gerar tanto um lead de formulário quanto uma conversa de WhatsApp). Por isso, quando `channel=whatsapp`, esses 10 cartões de KPI somem da grade (filtrados via uma lista `AD_SPEND_KEYS` verificada em `renderMetricas`) — na visão "Geral" e "Formulários" eles continuam aparecendo normalmente.

Dois cards do dashboard também são específicos do funil do Kommo e não fazem sentido para conversas de WhatsApp — "Tempo médio entre etapas" (mede transição entre `current_stage` do Kommo) e "Últimos leads" (tabela paginada de leads do Kommo, com paginação própria): ambos ficam ocultos (`classList.toggle('hidden', ...)`) e a renderização deles é pulada inteiramente quando `data.channel === 'whatsapp'`, para não gastar uma chamada de rede à toa nem corromper o estado de paginação da tabela de leads quando ela não está visível.

### 27.4 Decisões de escopo (registradas para não serem revisitadas sem necessidade)

- **Campanhas permanece geral**, sem versão por canal — já coberto acima (27.1).
- **Últimos Eventos e Análise por IA não existem em "Geral"**, só em Formulários e WhatsApp — não há uma visão combinada desses dois porque um evento recente ou uma pergunta de IA sempre faz mais sentido no contexto de um canal específico (a estrutura do dado — nome de evento do Kommo vs. nome de estágio do WhatsApp — já é diferente o bastante para não valer a pena forçar uma visão unificada).
- **Não existe Kanban nem Conversas duplicados por canal** — Kanban já é só do Kommo, Conversas já é só do WhatsApp; nenhum dos dois precisa de uma versão "geral".

### 27.5 Verificação

Testado no preview (porta 8935, `mock-serve.js` com suporte a `channel` adicionado em `/painel-api/metricas` e `/painel-api/ia-analise` para esta verificação): os 3 pares de abas (Métricas Geral/Formulários/WhatsApp, Últimos Eventos Formulários/WhatsApp, Análise por IA Formulários/WhatsApp) navegam corretamente, cada um carrega os dados do canal certo, os 10 KPIs de gasto de anúncio e os 2 cards específicos do Kommo somem só na visão WhatsApp, e a aba Campanhas continua igual (regressão checada, sem mudança de comportamento).

**Precisa reimportar no n8n**: nenhum workflow novo — o backend (`channel` nos 3 endpoints) já tinha sido implementado e regenerado numa sessão anterior; esta seção foi só a conclusão da parte de frontend. Se ainda não reimportou `Painel Administrativo - Dashboard Clientes.json` desde a seção 26, o mesmo arquivo já cobre as duas mudanças.

## 28. Classificação automática de estágio por IA nas Conversas WhatsApp

A aba "Análise por IA" (seção 17) já existia, mas era 100% manual: um botão que o admin clicava para pedir uma análise textual, sem nenhuma ação automática. Você pediu para ir além — usar IA para **classificar o estágio da conversa automaticamente**, em escala de call center (muitas conversas simultâneas, sem um humano revisando cada uma). Como uma classificação errada pode mudar o estágio de um lead sozinha e, se aquele estágio tiver evento Meta ativo (seção 22), disparar um evento de conversão errado para a Meta CAPI — poluindo a otimização dos anúncios — perguntei três coisas antes de implementar, já que qualquer uma delas mudava a arquitetura:

1. **O que fazer quando a IA classifica**: sugerir e esperar confirmação do admin, ou aplicar direto? Você escolheu **aplicar automaticamente** — inclusive disparando o CAPI sem confirmação humana, mesmo eu tendo recomendado o caminho mais seguro (só sugerir). Essa escolha é o que está implementado; fica registrado aqui o risco assumido.
2. **Quando a análise roda**: por um botão manual, ou sozinha em background? Você escolheu **automático com debounce** — roda sozinho, sem o admin precisar abrir nada.
3. **Provedor de IA**: só Groq, ou já implementar fallback para Cerebras se o limite diário da Groq estourar? Você escolheu **só Groq por agora** — o fallback fica para depois, se e quando o limite da Groq virar um problema real.

### 28.1 Banco de dados — 3 colunas novas em `whatsapp_conversations`

```sql
ai_last_analyzed_at    TIMESTAMP NULL DEFAULT NULL,
ai_last_classification VARCHAR(60) NULL DEFAULT NULL,
ai_last_reason         VARCHAR(500) NULL DEFAULT NULL,
```

- Já incluídas em [`Banco de Dados/02_Template_Banco_Por_Cliente.sql`](Banco%20de%20Dados/02_Template_Banco_Por_Cliente.sql) — clientes novos já nascem com elas.
- Clientes que já existiam antes desta sessão precisam rodar [`WhatsApp/migracao_whatsapp_ia_classificacao.sql`](WhatsApp/migracao_whatsapp_ia_classificacao.sql) manualmente (rollout pendente, igual às outras migrações de WhatsApp — nada disso foi executado em produção ainda).
- `ai_last_analyzed_at` é o campo que sustenta o debounce (ver 28.3). `ai_last_classification`/`ai_last_reason` existem só para auditoria — não são lidos por nenhuma lógica automática, são exibidos no painel (28.5) para o admin conferir depois o que a IA decidiu e por quê.
- Junto vai o índice `idx_whatsapp_conversations_ia_pendentes (last_inbound_at, ai_last_analyzed_at)`. A busca de pendentes (28.2, passo 4) roda **a cada minuto em todos os bancos de cliente**; sem índice ela é full table scan minuto a minuto em cada cliente. A comparação entre as duas colunas (`ai_last_analyzed_at < last_inbound_at`) não é indexável, mas a parte seletiva — o filtro de faixa em `last_inbound_at` — e o `ORDER BY last_inbound_at` são, então o índice entrega as linhas já na ordem certa, sem filesort.
- `ai_last_classification` fica **NULL** quando a resposta da IA não foi aproveitável (JSON quebrado, estágio inventado, erro definitivo da API). Isso é proposital: gravar ali o estágio antigo faria o painel exibir como "classificação da IA" um valor que a IA nunca escolheu. Nesses casos `ai_last_reason` explica o que houve.

### 28.2 Novo workflow: `WhatsApp IA - Classificacao Automatica.json`

Gerado por [`WhatsApp/build_whatsapp_ai_classification_workflow.js`](WhatsApp/build_whatsapp_ai_classification_workflow.js), é um workflow **novo e independente** dos outros — não um endpoint do painel. Estrutura, em ordem:

1. **Schedule Trigger, a cada 1 minuto.** Isso é uma exceção deliberada à decisão da seção 5/14 de abandonar cron em favor de gatilho sob demanda (documentada lá para a sincronização de Métricas do Meta Insights, que foi trocada de cron de 6h para botão). A diferença: staleness de métrica só importa quando alguém está olhando o dashboard; classificação de conversa precisa rodar **mesmo com o painel fechado**, porque é isso que torna a resposta automática — não é uma repetição do padrão rejeitado, é um caso genuinamente diferente.
2. **Contas ativas**: busca em `ad_accounts` os clientes `ACTIVE` que também têm `whatsapp_accounts` ativo (`JOIN`). Um item por cliente, sem loop.
3. **Estágios cadastrados de todos os clientes numa passada só**, em `whatsapp_event_map` (mesma tabela da seção 22/26 — sem whitelist fixa, a lista de nomes válidos é sempre a atual do cliente). Cada linha vem com uma coluna `client_db` literal, que é o que permite saber depois de qual cliente cada estágio veio (ver 28.4).
4. **Conversas pendentes de todos os clientes numa passada só**: `SELECT` em `whatsapp_conversations` com `WHERE last_inbound_at <= NOW() - INTERVAL 60 SECOND AND (ai_last_analyzed_at IS NULL OR ai_last_analyzed_at < last_inbound_at) ORDER BY last_inbound_at ASC LIMIT 25` por cliente, também carimbando `client_db`.
5. **Monta a fila final** (node de código): cruza conversas pendentes com os dados/credenciais do cliente e a lista de estágios dele, **intercala os clientes em round-robin** e corta num teto global de **25 análises por ciclo**. O teto existe para não estourar o rate limit da Groq (~30 req/min no plano gratuito) — sem ele, 10 clientes com fila cheia mandariam centenas de requisições no mesmo minuto e tomariam 429 em massa. O round-robin existe para que um cliente com fila grande não consuma o teto inteiro e deixe os outros parados. Nada da fila excedente se perde: só é marcada como analisada a conversa que realmente foi processada, então o resto volta no ciclo seguinte. Conversas de clientes **sem nenhum estágio cadastrado** são descartadas aqui sem serem marcadas — sem lista de nomes válidos a resposta seria rejeitada de qualquer forma, e não marcar faz elas voltarem sozinhas assim que o cliente cadastrar os estágios.
6. **Loop único** (`splitInBatches`, batchSize 1) sobre essa fila. Para cada conversa: busca as últimas 20 mensagens, monta um prompt (system + user) listando os estágios válidos do cliente e o histórico, chama a Groq (`openai/gpt-oss-120b`, `temperature: 0.2`, `max_tokens: 300`, `response_format: json_object`, mesma credencial Header Auth já usada na aba Análise por IA). O `response_format` força a API a devolver JSON válido em vez de texto solto, o que reduz o caso "não consegui interpretar". O prompt de sistema inclui uma linha explícita mandando ignorar qualquer instrução que apareça dentro das mensagens — o histórico é dado do lead, não instrução confiável.
7. **Valida a resposta**: só aceita o estágio sugerido se ele bater exatamente com um nome da lista de `whatsapp_event_map` daquele cliente — nunca aceita um nome inventado pela IA. O desfecho é um de três (ver 28.4): `aplicar`, `marcar` ou `pular`.
8. **Se o estágio mudou**: repete o mesmo sub-fluxo de disparo CAPI da seção 22.3 (`P.1`) — busca o mapeamento em `whatsapp_event_map`, confere `ativo=1`, hashea telefone, monta payload, envia à Meta CAPI, grava em `meta_capi_events`. Diferenças em relação ao manual: `lead_event_source = 'WhatsApp IA (automático)'` em vez de `'WhatsApp Conversas'`, para distinguir no log quem disparou cada evento (humano salvando manualmente vs. IA classificando sozinha); e o disparo também é condicionado a o cliente ter `meta_pixel_dataset_id` + `meta_access_token` preenchidos — sem eles o POST falharia de qualquer jeito e ainda gravaria um log de erro inútil.

Todo caminho que termina (não persistiu, estágio não mudou, sem evento CAPI, log gravado) volta para o `splitInBatches`, para a próxima conversa da fila.

**Sanitização do nome do banco**: como o nome do cliente entra tanto como identificador entre crases quanto como literal entre aspas simples (a coluna `client_db` dos passos 3 e 4), a limpeza aqui é mais restritiva que o `.replace(/`/g,'')` dos outros workflows — só `[A-Za-z0-9_]` passa.

### 28.3 Debounce sem infraestrutura nova

Em vez de fila, delay node, Redis ou qualquer estado externo, o debounce é só a comparação de timestamps do passo 4 acima: uma conversa só entra na lista de pendentes se (a) já passaram 60s+ desde a última mensagem do lead **e** (b) ainda não foi analisada desde essa mensagem. Como toda análise concluída marca `ai_last_analyzed_at = NOW()`, uma rajada de várias mensagens seguidas do lead gera **no máximo 1 chamada à Groq** (só depois que a conversa parar por 60s), nunca uma chamada por mensagem — e uma conversa já analisada nunca é reanalisada até chegar mensagem nova. Mesmo raciocínio "sem infraestrutura nova" já usado na decisão de Redis/RabbitMQ da seção 16.

Sem nenhuma conversa pendente — o caso comum a cada minuto — o custo do tick é só o `SELECT` indexado do passo 4: nenhuma chamada à Groq, nenhum node pendurado, o workflow simplesmente termina.

### 28.4 Por que não existe loop dentro de loop aqui (bug encontrado e corrigido)

A primeira versão deste workflow tinha dois `splitInBatches` aninhados: um por cliente, outro por conversa daquele cliente. **Isso não funciona no n8n** — e falha em silêncio, que é o pior tipo de falha. Um `splitInBatches` mantém contexto próprio de execução e não se reinicializa quando recebe um novo conjunto de itens: assim que ele termina as conversas do cliente #1, fica marcado como "concluído" e, do cliente #2 em diante, todo item cai direto na saída "done" sem ser processado. Na prática, **só o primeiro cliente seria classificado**, sem nenhum erro aparecendo no n8n. O único precedente de `splitInBatches` no projeto (`Meta Insights - Sincronizacao Periodica`, hoje obsoleto) tem um loop só, então não havia como esse padrão ter sido validado antes.

A correção não foi remendar com `reset` (frágil, depende de acertar a condição exata), e sim **eliminar o aninhamento**: as consultas por cliente rodam de uma vez só para todos os clientes. Isso é possível porque o node MySQL em modo `executeQuery` executa **uma vez para o conjunto de itens de entrada**, resolvendo as expressões item a item e juntando todas as linhas num resultado só — daí a coluna `client_db` literal em cada `SELECT` (passos 3 e 4), que é o que impede as linhas de clientes diferentes de se misturarem. Sobra **um único loop**, sobre a fila final de conversas, que ainda precisa ser loop porque a busca de histórico devolve N mensagens por conversa e elas não podem se misturar entre conversas.

Efeito colateral bom: acabou também o risco de loop travado com 0 resultados. No desenho anterior, um `SELECT` vazio no meio da cadeia deixava o loop pendurado, e a mitigação era `alwaysOutputData: true` + IF filtrando o placeholder. Agora, quando não há conversa pendente o node simplesmente devolve 0 itens e o workflow acaba ali — sem loop nenhum aguardando. O `alwaysOutputData` ficou só onde a cadeia **precisa** continuar apesar do resultado vazio (contas, estágios, histórico, mapeamento de evento), sempre com o placeholder sendo filtrado logo em seguida.

#### Falha transitória vs. definitiva

O tratamento de erro da chamada à Groq tem três desfechos, em vez de "marcou como analisada de qualquer jeito":

| Desfecho | Quando | O que grava |
|---|---|---|
| `aplicar` | Resposta válida, estágio bate com a lista do cliente | `ai_last_analyzed_at`, `ai_last_classification`, `ai_last_reason` — e `status`, se o estágio realmente mudou |
| `marcar` | Resposta inaproveitável (JSON quebrado, estágio inventado) ou erro **definitivo** da API (ex.: 401) | `ai_last_analyzed_at`, `ai_last_reason` explicando, `ai_last_classification = NULL` |
| `pular` | Falha **transitória**: HTTP 429 (rate limit), 408, 5xx, ou timeout sem status | **nada** — a conversa volta para a fila no ciclo seguinte |

A distinção importa porque, sem ela, um pico de 429 marcaria dezenas de conversas como "analisadas" sem nunca terem sido — e elas só voltariam a ser consideradas quando o lead mandasse mensagem nova, o que pode nunca acontecer. O teto global de 25 análises por ciclo (passo 5) é o que impede o `pular` de virar martelada contínua na Groq.

### 28.5 Painel (`painel-admin.html`)

Novo bloco somente-leitura "Classificação por IA" na coluna direita da aba Conversas, logo abaixo de "Origem do Anúncio": Última análise (hora relativa, `fmtRelativo`), Estágio sugerido e Motivo — os 3 campos novos de `whatsapp_conversations`, já incluídos no `SELECT` de `GET /painel-api/whatsapp-thread` (`build_admin_panel_workflow.js`). Não há nenhum controle de aprovação/rejeição nesse bloco — é só um espelho de auditoria do que a IA já aplicou sozinha, coerente com a decisão de "aplicar automaticamente" do início desta seção.

### 28.6 Verificação

- `node build_whatsapp_ai_classification_workflow.js` gera o JSON sem erro; um script de checagem estrutural à parte confirmou que todo `connect()` aponta para nomes de node que realmente existem, sem duplicatas de nome/id, sem node órfão, com todos os 27 nodes alcançáveis a partir do Schedule Trigger, com **exatamente um** `splitInBatches` (ver 28.4), com todo node IF tendo as duas saídas ligadas, todo node com `onError: continueErrorOutput` tendo a saída de erro ligada, e nenhum erro de sintaxe nos nodes de código. Não é uma execução real no n8n (não é possível neste ambiente), mas garante que o grafo gerado é internamente consistente.
- A lógica dos nodes de código foi exercitada fora do n8n com entradas simuladas: a montagem da fila (teto global respeitado, round-robin distribuindo entre clientes, cliente sem estágio e cliente desconhecido descartados) e a interpretação da resposta da IA (resposta válida com e sem mudança de estágio, resposta embrulhada em cerca markdown, estágio inventado, JSON quebrado, 429/503/timeout como transitórios, 401 como definitivo, e escape de aspas/`;`/`--` vindos do texto da IA). Também confirmado que um nome de banco malicioso (`` cli`a; DROP TABLE x-- ``) é reduzido a `cliaDROPTABLEx` antes de entrar no SQL.
- `node build_admin_panel_workflow.js` regerado com as 3 colunas novas no `SELECT` de `whatsapp-thread`.
- Testado no preview (porta 8935, mocks de `ai_last_analyzed_at`/`ai_last_classification`/`ai_last_reason` adicionados em `mock-serve.js`): abri a aba Conversas, selecionei uma conversa e confirmei visualmente o bloco "Classificação por IA" preenchido (Última análise, Estágio sugerido, Motivo), sem erros novos no console. O workflow de classificação em si **não é testável neste preview** — ele não tem webhook, só Schedule Trigger, então essa parte não pode ser exercitada pelo mock server.

**Precisa reimportar no n8n**: `WhatsApp IA - Classificacao Automatica.json` (novo) e `Painel Administrativo - Dashboard Clientes.json` (regenerado). Depois de importar o primeiro, **é preciso ativá-lo manualmente** (toggle no canto superior direito do n8n) — diferente dos outros workflows deste projeto, que são todos webhooks (ativos por padrão ao importar), este só faz algo enquanto estiver ativo, já que depende do Schedule Trigger disparando. Clientes já existentes também precisam rodar `WhatsApp/migracao_whatsapp_ia_classificacao.sql` manualmente (rollout pendente, mesma lista de migrações de WhatsApp ainda não executadas em produção).

> **Atenção — reimportação obrigatória mesmo para quem já importou.** O arquivo `WhatsApp IA - Classificacao Automatica.json` foi **regerado depois** da correção do loop aninhado descrita em 28.4. Uma cópia importada antes dessa correção classifica apenas o primeiro cliente e ignora todos os demais em silêncio. Apague o workflow antigo no n8n, importe o novo, reconfigure as duas credenciais (MySQL e Groq — os IDs no arquivo são placeholders) e ative. A migração SQL também ganhou o índice `idx_whatsapp_conversations_ia_pendentes`: se você já tinha rodado o arquivo antes, rode de novo só a parte do `ALTER TABLE ... ADD INDEX` (o `ADD COLUMN` vai falhar com "Duplicate column name", o que é esperado).

## 29. Correções na aba Conversas: aviso de 24h preso e "Carregando conversas..." eterno

Dois bugs reportados durante o uso real do painel, ambos em `painel-admin.html`.

### 29.1 "Carregando conversas..." nunca sumia

O indicador de carregamento ficava visível **em cima da lista já carregada**, para sempre.

Causa: na troca para a aba Conversas, a primeira carga era `refreshWhatsappEstagiosCache().then(loadConversasList)`. Passar a função direto para o `.then` faz o valor resolvido virar o **primeiro argumento** dela — e o primeiro argumento de `loadConversasList` é `isPoll`. Como `refreshWhatsappEstagiosCache()` resolve com o array de estágios, e array é sempre truthy (mesmo vazio), a primeira carga se comportava como se fosse polling: o ramo `if (!isPoll) ... classList.add('hidden')` nunca rodava, e o indicador ficava preso.

Correção em duas camadas:
1. `.then(function(){ loadConversasList(); })` — não repassa o valor resolvido. É a causa raiz.
2. `loadConversasList` agora esconde o indicador **incondicionalmente** ao receber resposta (sucesso ou erro), em vez de só quando `!isPoll`. Defesa em profundidade: qualquer chamada futura que passe um `isPoll` errado não deixa mais lixo preso na tela. O `!isPoll` continua governando só o que deve mesmo ser silencioso no polling — as mensagens de feedback de erro.

### 29.2 Aviso da janela de 24h só sumia recarregando a página

Quando o lead mandava mensagem nova, a janela de 24h da Meta reabria no banco, mas o painel continuava mostrando "Fora da janela de 24h" e com o campo de resposta bloqueado até um F5.

Causa: o cálculo da janela morava dentro de `renderThread()`, que só roda no carregamento completo da thread (`isPoll = false`). O polling de 5s chama `renderThreadMessages()`, que só redesenha as bolhas — a janela nunca era reavaliada.

Correção: o cálculo saiu para uma função própria, `atualizaJanela24h(cliente)`, chamada nos dois caminhos. No polling ela roda **antes** da checagem de assinatura de mensagens, e isso é proposital: o estado da janela muda por dois motivos independentes de "apareceu bolha nova na tela" — o lead responde (a janela **abre**) ou simplesmente passam 24h desde a última mensagem dele (a janela **fecha**, sem nenhuma mensagem nova ter chegado). Amarrar a atualização à chegada de mensagem cobriria só metade dos casos.

Aproveitando, `atualizaJanela24h` agora também seta `disabled` de verdade no textarea e no botão Enviar. Antes só era aplicada a classe `.disabled`, que é puramente visual (`opacity`/`pointer-events` no CSS) — um Enter no textarea ainda disparava o envio, que só seria barrado lá no backend.

### 29.3 Verificação

Testado no preview (porta 8935), sem recarregar a página entre os passos:
- Aba Conversas carregada: indicador escondido (`loading hidden`) com as 8 conversas do mock renderizadas.
- Conversa com `last_inbound_at` de 37h atrás: aviso visível, textarea e botão desabilitados.
- Simulando a chegada de mensagem nova (interceptando o fetch da thread para devolver `last_inbound_at = agora`), após o poll de 5s: aviso sumiu e os controles foram habilitados **sem recarregar**.
- Simulando o caminho inverso (`last_inbound_at` de 30h atrás): o aviso voltou e os controles foram desabilitados sozinhos.
- Console sem erros.

Detalhe do ambiente de teste: o navegador embutido reporta `document.hidden = true` mesmo com a aba em primeiro plano, e o polling (corretamente) pula quando a aba não está visível — foi preciso sobrescrever `document.hidden` para forçar o poll durante o teste. Isso é limitação do preview, não do código.

**Precisa reimportar no n8n**: nada. As duas correções são só de frontend (`painel-admin.html`), nenhum workflow foi alterado.

---

## 30. Ligar e desligar campanha, conjunto e anúncio pelo painel

Até aqui o app só **lia** da Meta (métricas, hierarquia de campanhas) e escrevia na Conversions API (evento de conversão). Esta é a primeira escrita na **conta de anúncio** do cliente: na aba Campanhas, o status de cada linha virou botão — clicar alterna entre ativo e pausado, nos três níveis (campanha, conjunto, anúncio).

### 30.1 Como funciona

- **`src/lib/meta-ads.ts`** (novo) — `alteraStatusEntidade(clientDb, id, status)` faz `POST https://graph.facebook.com/v25.0/{id}` com `status=ACTIVE|PAUSED`. A Graph API trata os três níveis pelo mesmo endpoint: o id já diz à Meta o que a entidade é, então o nível não entra na chamada.

  Ficou separado de `meta-capi.ts` de propósito — aquele fala com a Conversions API, este com a Marketing API. São escopos de token diferentes: um token que envia evento sem problema pode não ter `ads_management`.

  O `meta_access_token` vai no **corpo** do POST, não na query string como na CAPI: URL aparece em log de proxy e em relatório de erro, corpo de POST não.

- **`src/lib/acoes/campanhas.ts`** (novo) — Server Action `acaoAlterarStatus`. Valida a entrada com Zod (o id precisa casar com `^\d{1,25}$`, porque ele vai direto no caminho da URL da Graph API), chama a Meta, e **só depois** grava o status na tabela local. A ordem importa: gravar primeiro deixaria o painel mostrando "Pausada" para uma campanha que segue gastando.

- **`atualizaStatusLocal`** em `src/lib/db/campanhas.ts` — espelha em `meta_campaigns`/`meta_adsets`/`meta_ads` o status que a Meta aceitou. Sem isso a linha voltaria ao status antigo no primeiro `router.refresh()`, já que essas tabelas só são reescritas pela sincronização. A fonte da verdade continua sendo a Meta; a próxima sincronização sobrescreve de qualquer jeito.

- **`proximoStatus`** em `src/lib/campanhas.ts` — só `ACTIVE` e `PAUSED` se alternam. Arquivado e excluído a Meta não aceita reverter por um POST de status, e os status que ela mesma inventa (`IN_PROCESS`, `WITH_ISSUES`, `PENDING_REVIEW`) descrevem uma situação dela, não uma escolha do anunciante. Nesses casos o status continua sendo texto, sem botão — um botão que não faz nada é pior do que nenhum botão.

### 30.2 Decisões

- **Não é restrito a administrador.** A conta de anúncio é do cliente, e pausar tem volta pelo mesmo botão — diferente de excluir conversa, que é irreversível e por isso é só de admin. Quem clicou fica registrado na auditoria, na ação nova `meta_status_alterado`.
- **Confirmação antes de cada alteração** (`window.confirm`, mesmo padrão do "Importar histórico"), porque o clique mexe em entrega e gasto reais.
- **Erros de token viram texto legível**: código 190 vira "o token expirou ou foi revogado"; código 200 vira "o token não tem permissão de gerenciar anúncios (`ads_management`)". A mensagem crua da Meta não deixa claro que o problema é o cadastro do cliente, não o clique.
- **Mapa de status local no componente da tabela.** `router.refresh()` recarrega as campanhas do servidor, mas os conjuntos e anúncios abertos vivem em estado de cliente (`filhos`) e não são refeitos — sem o mapa, a linha filha voltaria ao status antigo logo depois de mudar.

### 30.3 Verificação

- `npx tsc --noEmit` limpo; `npm test` 115/115 (5 casos novos para `proximoStatus`).
- No preview: as duas campanhas do cliente renderizam o status como botão, com o `title` certo em cada sentido ("Pausar na Meta…" / "Ativar na Meta…"); expandir a campanha mostra os conjuntos, também com botão.
- **A ida à Meta não foi testada de ponta a ponta**: o único jeito seria pausar ou ativar uma campanha real de um cliente em produção.

**Precisa reimportar no n8n**: nada. A alteração é toda do app.

## 31. Evento de WhatsApp só para lead de anúncio, largura das telas de quadro e CRM separado por canal

Três mudanças do app na mesma sessão. A primeira muda o que chega na Meta; as outras duas são de tela.

### 31.1 Evento de etapa do WhatsApp só sai para lead que veio de anúncio

Antes: só o evento `Contact` (primeira mensagem) exigia atribuição — o webhook da Evolution já barrava a mensagem sem `referral_ctwa_clid`. O evento de **mudança de etapa** não exigia nada: um contato que chegou por indicação, por lista antiga ou pelo número no rodapé do site virava conversão na Conversions API assim que alguém o movia no funil. Efeito prático: o Gerenciador de Eventos contava conversão que anúncio nenhum produziu, e a comparação entre o que o anúncio entregou e o que a Meta registrou ficava inflada.

- **`src/lib/capi-politica.ts`** (novo) — `exigeAnuncioWhatsapp(nodeEnv, variavel)`, a decisão pura. Fica em módulo separado de `env.ts` porque `env.ts` começa com `import 'server-only'`, e o executor de testes (`tsx --test`) não consegue carregar esse módulo. Mesmo motivo de `lib/crm.ts` existir ao lado de `lib/db/crm.ts`.

  Sem a variável definida, o padrão é **por ambiente**: liga em produção, desliga em desenvolvimento — quem testa o funil manda mensagem do próprio celular, sem passar por anúncio, e um bloqueio aqui só atrapalharia. Só o texto literal `'true'` liga a regra, então erro de digitação deixa a regra desligada em vez de matar evento legítimo.

- **`META_CAPI_EXIGE_ANUNCIO`** (nova, opcional) — inverte o padrão nos dois sentidos, sem novo deploy: `true` liga também em desenvolvimento, `false` desliga em produção.

- **`leadVeioDeAnuncio`** em `src/lib/db/conversas.ts` — duas evidências valem: o carimbo de referral (`referral_ctwa_clid` ou `referral_ad_id`) em alguma mensagem de `whatsapp_messages`, **ou** os ids `meta_ad_id`/`meta_adset_id`/`meta_campaign_id` em `customers`. A segunda existe para não barrar o lead que entrou por anúncio de formulário e depois migrou para o WhatsApp: ele veio de campanha, só não veio pelo caminho do WhatsApp. Só a consulta de `whatsapp_messages` tem tolerância a lacuna de esquema; a de `customers` não, porque essa tabela existe em todo cliente.

- **A trava mora dentro de `enviaEventoEstagio`** (`src/lib/meta-capi.ts`), não em cada tela que muda etapa — mesmo raciocínio de `requireClientAccess` viver no guard: hoje são duas telas (o quadro do CRM e o painel do lead em Conversas), amanhã são três, e a barreira em um lugar só não tem como ser esquecida na terceira.

- **Evento barrado não vira linha em `meta_capi_events`**: nada foi enviado, e registrar ali daria a entender que foi. O motivo aparece na resposta da ação ("evento não enviado: lead não veio de anúncio") e na auditoria.

### 31.2 Telas de quadro e de tabela usam a janela toda

`.main-content` limita o painel a 1360px, o que é certo para texto corrido — linha longa demais cansa de ler. O quadro do CRM e a tabela de Campanhas não são texto corrido: são colunas de largura fixa (270px no quadro) e 19 colunas na tabela. O limite só empurrava coluna para a rolagem horizontal com tela vazia sobrando dos dois lados.

Modificador `.main-content--larga` em `globals.css`, aplicado pela casca conforme a rota (`TELAS_LARGAS` em `casca-painel.tsx`), ao lado de onde o rótulo da migalha já é decidido. Nada muda nas outras telas.

### 31.3 O CRM virou dois: um em Formulários, outro em WhatsApp

O quadro único juntava os dois funis lado a lado, e eles não se falam: a etapa do lead de formulário é espelho do Kommo e o card **não** arrasta; a do contato de WhatsApp é do painel e arrasta, e arrastar dispara o evento de conversão da etapa. No mesmo quadro, as duas regras ficavam misturadas sem nada dizendo qual valia em qual coluna — quem arrastava um card de formulário descobria a regra ao errar.

- **`/app/[cliente]/formularios/crm`** e **`/app/[cliente]/whatsapp/crm`** — cada uma com seu item no menu, dentro da seção do canal. O CRM saiu de "Geral".
- **`src/components/tela-crm.tsx`** (novo) — o corpo é um só, parametrizado pela origem; o que muda entre as duas telas é o texto e qual funil aparece. O modal do lead, o filtro de período e a busca são os mesmos.
- **`montaQuadro` passou a cortar coluna, não só card**: com um quadro por funil, deixar as colunas do outro funil de pé encheria a tela de coluna que nunca receberia nada — e traria junto a regra de arrastar do outro funil.
- **O seletor de origem saiu do filtro.** A rota já diz o funil; um seletor ali deixaria a tela "CRM — Formulários" mostrando contato de WhatsApp, contra o próprio rótulo.
- **Rotas antigas continuam de pé**: `/app/[cliente]/crm` redireciona conforme o `?origem=` que era o filtro (sem ele, vai para Formulários), e `/app/[cliente]/formularios/kanban` passou a apontar para `/formularios/crm`. Link antigo, favorito e histórico do navegador continuam funcionando. O link "abrir no CRM" da tela de Conversas passou a apontar direto para o quadro do WhatsApp.

### 31.4 Verificação

- `npx tsc --noEmit` limpo; `npm test` 123/123 (7 casos novos para `exigeAnuncioWhatsapp`, mais os do corte de coluna por funil).
- No preview: os dois quadros abrem com as colunas do seu próprio funil e nenhuma do outro, a migalha mostra "CRM (Formulários)" e "CRM (WhatsApp)", e os três redirecionamentos antigos caem no lugar certo preservando período, busca e `?lead=`.
- **O bloqueio do evento não foi testado contra a Meta de verdade** — em desenvolvimento ele nasce desligado de propósito. O que está coberto por teste é a decisão de ligar ou não; o efeito dela é uma linha só dentro de `enviaEventoEstagio`.

**Precisa reimportar no n8n**: nada. As três alterações são do app.

## 32. Card do CRM: plataforma no lugar do nome da campanha

O card mostrava o nome da campanha inteiro no rodapé ("2. ACRESCE ENERGIA - JULHO/26 [5 CTV] >500"). Em coluna de 270px isso vira duas ou três linhas de texto pequeno que ninguém lê no quadro — quem quer saber de campanha abre o lead, onde campanha, conjunto e anúncio já aparecem separados. O card ficou com o que se decide de relance: quem é, de onde veio e quando entrou.

- **Tag "Meta Ads"** (`PLATAFORMA_ANUNCIO` em `src/lib/crm.ts`, classe `.tag-meta` em `globals.css`, azul da marca `#0866ff` fixo nos dois temas) — aparece quando o contato tem identificador de anúncio, ao lado da tag do tipo ("Formulário" / "WhatsApp").
- **`de_anuncio` é calculado na própria consulta do quadro** (`leCartoes`, `src/lib/db/crm.ts`), com a mesma pergunta que `leadVeioDeAnuncio` faz para liberar evento de CAPI: ids de anúncio em `customers`, ou referral em `whatsapp_messages`. Em lote e não por lead — são até 3000 cards por quadro. Sem identificador nenhum, o card simplesmente não ganha a tag; inventar um rótulo "Direto" diria mais do que o dado sustenta.
- **A tag "etapa travada" saiu do card.** Ela repetia, card a card, o que a coluna já diz uma vez no cabeçalho ("Formulário · etapa vem do CRM") — e depois da separação do CRM o quadro inteiro de Formulários era coluna travada, ou seja, o aviso aparecia em todos os cards da tela.

Verificação: `npx tsc --noEmit` limpo, `npm test` 125/125, e no preview os cards de Formulários aparecem com "Meta Ads" + "Formulário" lado a lado, sem campanha e sem "etapa travada".

**Precisa reimportar no n8n**: nada.
