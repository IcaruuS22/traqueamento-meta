# Arquitetura do Aplicativo — Migração de n8n para Next.js + Vercel

> Documento de arquitetura. Descreve o sistema atual (n8n + MySQL + HTML estático), define o que vira aplicativo, o que permanece no n8n, e como as duas partes conversam.
>
> Documento irmão: [`PLANO_IMPLEMENTACAO.md`](PLANO_IMPLEMENTACAO.md) — o passo a passo de execução.
> Documentação do sistema atual (comportamento de cada workflow e do painel): [`DOCUMENTACAO_APLICACAO.md`](DOCUMENTACAO_APLICACAO.md).

---

## 1. Onde o sistema está hoje

O sistema atual é composto por três blocos:

**1. Workflows n8n (7 geradores + 1 workflow manual).** Cada `build_*.js` é um script Node.js que monta o grafo de nodes e escreve o `.json` correspondente. O n8n hospeda hoje não só a integração com a Meta e o Kommo, mas também **toda a camada REST do painel** — 27 webhooks REST que existem apenas para servir dados ao front-end.

**2. Painel administrativo (`painel-admin.html`).** Um arquivo único de 3.516 linhas, HTML + CSS + JavaScript puro, servido pelo próprio n8n através do webhook `GET /painel`. Tem 13 abas por cliente, organizadas em três seções (Geral, Formulários, WhatsApp), mais Tutorial e a tela de seleção de clientes.

**3. MySQL.** Um banco central (`trakeamento_controle`) com o catálogo de clientes e preferências globais, e um banco por cliente (`cliente_<slug>_<id>`) com 10 tabelas cada.

### 1.1 Inventário de endpoints n8n

| # | Método | Caminho | Workflow | Destino |
|---|---|---|---|---|
| 1 | GET | `/painel` | Painel Administrativo | **App** (vira a própria aplicação Next.js) |
| 2 | GET | `/painel-api/clientes` | Painel Administrativo | **App** |
| 3 | GET | `/painel-api/cliente-info` | Painel Administrativo | **App** |
| 4 | GET | `/painel-api/metricas` | Painel Administrativo | **App** |
| 5 | GET | `/painel-api/metricas-prefs` | Painel Administrativo | **App** |
| 6 | POST | `/painel-api/metricas-prefs-salvar` | Painel Administrativo | **App** |
| 7 | GET | `/painel-api/campanhas` | Painel Administrativo | **App** |
| 8 | GET | `/painel-api/campanhas/adsets` | Painel Administrativo | **App** |
| 9 | GET | `/painel-api/campanhas/ads` | Painel Administrativo | **App** |
| 10 | GET | `/painel-api/kanban` | Painel Administrativo | **App** |
| 11 | GET | `/painel-api/leads` | Painel Administrativo | **App** |
| 12 | GET | `/painel-api/eventos` | Painel Administrativo | **App** |
| 13 | POST | `/painel-api/eventos-salvar` | Painel Administrativo | **App** |
| 14 | POST | `/painel-api/eventos-excluir` | Painel Administrativo | **App** |
| 15 | GET | `/painel-api/eventos-recentes` | Painel Administrativo | **App** |
| 16 | POST | `/painel-api/ia-analise` | Painel Administrativo | **App** |
| 17 | GET | `/painel-api/whatsapp-config` | Painel Administrativo | **App** |
| 18 | POST | `/painel-api/whatsapp-salvar` | Painel Administrativo | **App** |
| 19 | GET | `/painel-api/whatsapp-eventos` | Painel Administrativo | **App** |
| 20 | POST | `/painel-api/whatsapp-eventos-salvar` | Painel Administrativo | **App** |
| 21 | POST | `/painel-api/whatsapp-eventos-excluir` | Painel Administrativo | **App** |
| 22 | GET | `/painel-api/whatsapp-conversas` | Painel Administrativo | **App** |
| 23 | GET | `/painel-api/whatsapp-thread` | Painel Administrativo | **App** |
| 24 | POST | `/painel-api/whatsapp-enviar` | Painel Administrativo | **App** |
| 25 | POST | `/painel-api/whatsapp-lead-salvar` | Painel Administrativo | **App** |
| 26 | POST | `/painel-api/sync-meta-agora` | Meta Insights — Sincronização Sob Demanda | **n8n** (app apenas dispara) |
| 27 | POST | `/painel-api/campanhas-importar-historico` | Meta Insights — Importação Histórica | **n8n** (app apenas dispara) |
| 28 | GET | `/novo-cliente` | Cria Cliente - Formulário | **App** |
| 29 | POST | `/novo-cliente-salvar` | Cria Cliente - Formulário | **App** |
| 30 | POST | `/recebe-evento` | Traq. Form Instantâneo (Kommo) | **n8n** (fase 1) → App (fase 5, opcional) |
| 31 | GET+POST | `/whatsapp-cloud-webhook` | WhatsApp Cloud API - Webhook | **n8n** (fase 1) → App (fase 5, opcional) |
| — | POST | `/api/webhooks/evolution` | — (não existe no n8n) | **App** — entrada da conexão por Evolution API |
| — | (sub-workflow) | recebimento de lead da Meta | `01 - Recebe leads - Meta (CORRIGIDO)` | **n8n — permanente, não tocar** |
| — | (schedule 1min) | classificação de conversas | WhatsApp IA - Classificação Automática | **n8n — permanente** |

Resumo: **25 dos 31 endpoints são camada de apresentação disfarçada de workflow.** Eles só leem/gravam MySQL e devolvem JSON. Nenhum deles precisa de n8n.

---

## 2. Critério de corte: o que fica no n8n

A regra usada para decidir foi: **fica no n8n o que o Vercel executa mal ou não executa.** Três características tornam um fluxo "n8n-only":

1. **Duração acima do limite de função serverless.** No Vercel, funções têm teto de execução (60s no plano Hobby; até 300s no Pro com Fluid Compute). Um backfill de 90 dias de insights faz dezenas de chamadas paginadas à Marketing API da Meta — não cabe.
2. **Execução agendada de alta frequência com estado de loop.** A classificação por IA roda a cada minuto, varre todos os bancos de cliente, e itera conversa a conversa respeitando o limite de ~30 requisições/minuto da Groq. Vercel Cron tem granularidade de 1 minuto apenas no plano Pro, e cada disparo seria uma função nova sem o controle de fila que o `splitInBatches` dá.
3. **Credenciais e integrações já configuradas e estáveis, cuja migração traz risco sem ganho.** O `01 - Recebe leads - Meta (CORRIGIDO)` é o ponto de entrada real dos leads. Ele contém credenciais, não tem script gerador, e está declarado fora de escopo de alteração.

### 2.1 Permanece no n8n (4 workflows)

| Workflow | Por quê |
|---|---|
| `01 - Recebe leads - Meta (CORRIGIDO)` | Ponto de entrada de leads da Meta. Contém credenciais. **Não deve ser tocado.** |
| `Meta Insights - Sincronização Sob Demanda` | Chamadas paginadas à Marketing API + upsert em `meta_insights_daily`. O app dispara e mostra o resultado, mas quem executa é o n8n. |
| `Meta Insights - Importação Histórica (manual)` | Até 90 dias de uma vez. Duração incompatível com serverless. |
| `WhatsApp IA - Classificação Automática` | Schedule de 1 minuto, loop com controle de taxa, varredura multi-banco. |

### 2.2 Vai para o app (tudo o mais)

- Os 25 endpoints de painel (leitura e escrita em MySQL).
- Toda a interface: as 13 abas, a tela de clientes, os tutoriais, o formulário de novo cliente.
- O provisionamento de cliente novo (criação do banco + tabelas + registro em `ad_accounts`).
- A chamada à Groq para a aba "Análise por IA" (é uma única requisição HTTP, cabe folgado em uma função serverless).
- **Novo:** autenticação, contas de usuário, papéis e permissão por cliente.

### 2.3 Fase 5 (opcional, depois de tudo estável): webhooks de entrada

`/recebe-evento` (Kommo) e `/whatsapp-cloud-webhook` (Meta) são webhooks curtos: recebem um POST, gravam no MySQL, eventualmente chamam a CAPI. Cabem perfeitamente em rotas do Next.js. Não migram na fase 1 porque **exigem reconfigurar a URL do webhook no Kommo e no App Dashboard da Meta**, e uma URL errada significa perder eventos silenciosamente. Migram depois, um de cada vez, com o n8n mantido ativo em paralelo até a confirmação.

---

## 3. Arquitetura alvo

```
                        ┌──────────────────────────────────────┐
   Navegador ──────────►│  Next.js App (Vercel)                │
   (usuário / ADM)      │                                      │
                        │  /login  /signup  /app  /admin       │  ← React Server Components
                        │  /api/*                              │  ← Route Handlers
                        └──────┬──────────────────┬────────────┘
                               │                  │
                    mysql2 (pool)          fetch autenticado
                               │                  │
                        ┌──────▼──────┐    ┌──────▼───────────────────────┐
                        │   MySQL     │    │  n8n (VPS)                   │
                        │   (VPS)     │◄───┤                              │
                        │             │    │  01 - Recebe leads (Meta)    │
                        │ trakeamento_│    │  Meta Insights - Sync        │
                        │  controle   │    │  Meta Insights - Backfill    │
                        │ cliente_*   │    │  WhatsApp IA - Classificação │
                        └─────────────┘    └───────┬──────────────────────┘
                                                   │
                                        Graph API / Marketing API / CAPI / Groq
```

O MySQL continua sendo a **única fonte de verdade compartilhada** entre app e n8n. Não há fila, não há barramento de eventos, não há sincronização de estado. Isso é deliberado: os dois lados escrevem nas mesmas tabelas e leem as mesmas tabelas, o que elimina qualquer necessidade de coordenação.

### 3.1 Stack escolhida

| Camada | Escolha | Por quê |
|---|---|---|
| Framework | **Next.js 15 (App Router) + React 19 + TypeScript** | Padrão de fato no Vercel. Server Components deixam a maioria das telas buscar dados sem endpoint intermediário. |
| UI | **Tailwind CSS v4 + shadcn/ui** | O painel atual já usa tokens de cor CSS e um design system informal; shadcn dá componentes acessíveis sem virar dependência pesada (o código fica no repositório). |
| Gráficos | **Recharts** | Substitui os gráficos feitos à mão em `<canvas>`/SVG do painel atual. |
| Banco | **mysql2** + **Drizzle ORM** | Drizzle para o banco central (schema fixo, tipado). `mysql2` cru para os bancos por cliente, cujo nome é dinâmico — Drizzle não modela bem "o mesmo schema em N bancos". |
| Autenticação | **Auth.js v5 (NextAuth)**, provider Credentials + Google opcional | Sem custo por usuário, sem serviço externo, sessão em JWT assinado (não precisa de tabela de sessão), e papéis customizados (`admin`/`cliente`) direto no token. |
| Validação | **Zod** | Toda entrada de rota validada antes de tocar no banco. |
| Estado no cliente | **TanStack Query** | Substitui os `setInterval` manuais das abas Conversas/Últimos Eventos, com pausa automática quando a aba perde foco. |
| Deploy | **Vercel** + **GitHub** | Conforme pedido. |

### 3.2 A decisão mais delicada: MySQL no VPS + serverless

Funções serverless são efêmeras e podem escalar para dezenas de instâncias simultâneas. Cada instância abrindo seu próprio pool contra o MySQL do VPS pode estourar o `max_connections` do servidor. Isso é o risco técnico número 1 desta migração.

**Decisão para a fase 1: manter o MySQL onde está**, com três mitigações:

1. **Ativar Fluid Compute no Vercel.** Instâncias passam a ser reaproveitadas entre requisições, então o pool sobrevive entre chamadas em vez de ser recriado a cada uma.
2. **Pool pequeno e global por instância**, guardado em `globalThis` para sobreviver ao hot-reload em desenvolvimento e ao reaproveitamento de instância em produção:
   ```ts
   // lib/db/pool.ts — connectionLimit baixo de propósito
   const pool = mysql.createPool({ connectionLimit: 3, idleTimeout: 30_000, maxIdle: 1, ... });
   ```
3. **Elevar `max_connections` no MySQL do VPS** e monitorar `Threads_connected`.

**Se isso apertar** (sintoma: erros `ER_CON_COUNT_ERROR` ou `ETIMEDOUT` no Vercel), o próximo passo já está definido: subir **ProxySQL** no VPS na frente do MySQL, com multiplexação de conexões. O app aponta para o ProxySQL e nada mais muda. Só depois disso, se ainda houver problema, se considera migrar o banco para um provedor serverless — o que é caro em esforço porque os bancos por cliente são criados dinamicamente pelo fluxo de cadastro.

### 3.3 Segredos e credenciais

Hoje `meta_access_token`, `kommo_access_token` e o token do WhatsApp Cloud ficam **em texto puro** nas colunas de `ad_accounts` e `whatsapp_accounts`. Isso funciona porque só o n8n lê essas tabelas. Com um app web multiusuário, um bug de autorização passa a expor tokens de terceiros.

**Decisão:** manter o formato atual na fase 1 (o n8n precisa continuar lendo essas colunas do mesmo jeito), mas:
- Nenhuma rota da API pode devolver essas colunas ao cliente. Elas ficam explicitamente fora de todo `SELECT` de leitura do app; o painel mostra apenas um indicador "configurado / não configurado" e os últimos 4 caracteres.
- Toda escrita de token é registrada em `app_audit_log`.
- Fase 6 (fora do escopo inicial): cifrar em repouso com AES-256-GCM e uma chave em variável de ambiente, adicionando ao n8n um Code node que decifra. Fica documentado como dívida técnica consciente.

---

## 4. Autenticação, papéis e multi-tenant

Hoje o painel inteiro é protegido por **um único usuário Basic Auth** configurado no n8n. Qualquer pessoa com essa senha vê todos os clientes. O app substitui isso.

### 4.1 Papéis

| Papel | Quem | Pode |
|---|---|---|
| `admin` | Você | Tudo: ver e editar todos os clientes, cadastrar cliente novo, criar/convidar/desativar usuários, ver o log de auditoria, disparar sincronizações. |
| `cliente` | O contratante de cada conta | Ver **apenas** os clientes aos quais foi vinculado. Dentro deles: ver métricas, campanhas, kanban, eventos, conversas; responder no WhatsApp; rodar análise por IA. |

Um usuário `cliente` pode estar vinculado a mais de um `client_db_name` (agências com várias contas). Um usuário sem nenhum vínculo entra e vê uma tela de "sua conta ainda não tem clientes vinculados".

### 4.2 O que muda no banco central

Quatro tabelas novas em `trakeamento_controle` (DDL completo em [`Banco de Dados/03_App_Auth_Usuarios.sql`](Banco%20de%20Dados/03_App_Auth_Usuarios.sql)):

- **`app_users`** — `id`, `email` (único), `password_hash` (bcrypt, custo 12), `name`, `role` (`admin`|`cliente`), `status` (`ativo`|`pendente`|`bloqueado`), `email_verified_at`, `last_login_at`, `created_at`.
- **`app_user_clients`** — vínculo N:N entre usuário e `client_db_name`. Chave primária composta `(user_id, client_db_name)`. **Esta tabela é o coração do isolamento multi-tenant.**
- **`app_invites`** — convites emitidos pelo ADM: token de uso único com validade, e-mail destinatário, papel e clientes pré-vinculados.
- **`app_audit_log`** — quem fez o quê, quando, em qual cliente. Registra login, alteração de credenciais, envio de mensagem no WhatsApp, alteração de mapeamento de eventos, exclusão de eventos, e cadastro de cliente.

### 4.3 Cadastro: convite, não auto-serviço

O pedido foi "tela de login/cadastro para usuários e ADM". A tela de cadastro existe, mas **um cadastro aberto não faz sentido aqui**: qualquer pessoa criaria conta e cairia numa tela vazia, e você teria uma lista de contas fantasma para limpar. O modelo:

- **`/signup`** aceita cadastro apenas com **token de convite válido** (`/signup?convite=<token>`). O convite já carrega o papel e os clientes vinculados. Ao concluir, a conta nasce `ativo`, já com acesso.
- **`/signup` sem token** mostra um formulário de solicitação de acesso, que cria uma conta `pendente` sem vínculo nenhum e notifica o ADM. Você aprova e vincula pela tela `/admin/usuarios`. Isso atende ao pedido de "tela de cadastro" sem abrir a porta.
- **O primeiro ADM** é criado por um script de seed (`npm run seed:admin`), lendo e-mail e senha de variáveis de ambiente. Depois de rodar uma vez, essa rota não existe mais na aplicação.

### 4.4 O ponto de segurança que não pode falhar

Todo endpoint que recebe `client_db` **precisa** verificar, além do que o sistema atual já faz (existência do cliente em `ad_accounts`), que **o usuário da sessão tem vínculo com aquele `client_db_name`**. Sem isso, trocar o parâmetro na URL dá acesso aos dados de outro cliente.

Isso é centralizado numa única função, e nenhuma rota acessa banco de cliente sem passar por ela:

```ts
// lib/auth/guard.ts
export async function requireClientAccess(clientDb: string) {
  const session = await auth();
  if (!session?.user) throw new HttpError(401, 'Não autenticado');

  // 1. o cliente existe e está ativo? (mesma checagem que addValidaClienteChain faz hoje)
  const conta = await getAdAccountByDbName(clientDb);
  if (!conta) throw new HttpError(404, 'Cliente não encontrado');

  // 2. admin passa direto; cliente precisa de vínculo explícito
  if (session.user.role !== 'admin') {
    const vinculado = await hasClientLink(session.user.id, clientDb);
    if (!vinculado) throw new HttpError(403, 'Sem acesso a este cliente');
  }
  return { session, conta };
}
```

O nome do banco continua sendo **sanitizado** antes de entrar em qualquer identificador SQL (mesmo `replace(/[^A-Za-z0-9_]/g, '')` já usado nos workflows), e o `SELECT` de `ad_accounts` continua sendo a fonte da verdade sobre quais bancos existem — o valor vindo do usuário nunca é usado diretamente.

---

## 5. Mapa de migração: tela por tela

| Tela atual (`painel-admin.html`) | Rota no app | Endpoints consumidos | Observação |
|---|---|---|---|
| Seleção de clientes | `/app` | `clientes` | Passa a listar só os clientes do usuário. |
| Tutorial | `/app/tutorial` | — | Conteúdo estático; vira MDX, versionável. |
| Métricas Gerais | `/app/[cliente]` | `metricas`, `metricas-prefs`, `cliente-info` | Server Component: busca no servidor, sem loading no cliente. |
| Campanhas | `/app/[cliente]/campanhas` | `campanhas`, `campanhas/adsets`, `campanhas/ads`, `campanhas-importar-historico` | Botão "Importar histórico" chama o n8n. |
| Formulários · Métricas | `/app/[cliente]/formularios` | `metricas` (escopo formulário) | |
| Formulários · CRM Kanban | `/app/[cliente]/formularios/kanban` | `kanban`, `leads` | |
| Formulários · Config. de Eventos | `/app/[cliente]/formularios/eventos` | `eventos`, `eventos-salvar`, `eventos-excluir` | |
| Formulários · Últimos Eventos | `/app/[cliente]/formularios/recentes` | `eventos-recentes` | |
| Formulários · Análise por IA | `/app/[cliente]/formularios/ia` | `ia-analise` | Chamada à Groq direto da rota. |
| WhatsApp · Conexão | `/app/[cliente]/whatsapp` | `whatsapp-config`, `whatsapp-salvar` | Tokens nunca voltam ao navegador. Mostra também o card da Evolution API (QR Code) — ver 5.2. |
| WhatsApp · Métricas | `/app/[cliente]/whatsapp/metricas` | `metricas` (escopo whatsapp) | |
| WhatsApp · Config. de Eventos | `/app/[cliente]/whatsapp/eventos` | `whatsapp-eventos`, `whatsapp-eventos-salvar`, `whatsapp-eventos-excluir` | |
| WhatsApp · Conversas | `/app/[cliente]/whatsapp/conversas` | `whatsapp-conversas`, `whatsapp-thread`, `whatsapp-enviar`, `whatsapp-lead-salvar` | A tela mais complexa. Ver 5.1. |
| WhatsApp · Últimos Eventos | `/app/[cliente]/whatsapp/recentes` | `eventos-recentes` (escopo whatsapp) | |
| WhatsApp · Análise por IA | `/app/[cliente]/whatsapp/ia` | `ia-analise` (escopo whatsapp) | |
| `novo-cliente-form.html` | `/admin/clientes/novo` | `novo-cliente-salvar` | Passa a exigir papel `admin`. |
| — (novo) | `/admin/usuarios` | novos | Gestão de usuários, convites, vínculos. |
| — (novo) | `/admin/auditoria` | novos | Leitura de `app_audit_log`. |
| — (novo) | `/login`, `/signup`, `/recuperar-senha` | Auth.js | |

### 5.1 A aba Conversas merece atenção especial

É a única tela do painel com estado vivo: lista com polling de 10s, thread com polling de 5s, aviso de janela de 24h que precisa aparecer e sumir sozinho, e composição de mensagem que precisa ser bloqueada de verdade (não só visualmente) fora da janela. Os dois bugs corrigidos recentemente (seção 29 de `DOCUMENTACAO_APLICACAO.md`) foram exatamente nessa lógica.

No app isso fica **estruturalmente mais simples**, porque o TanStack Query já resolve nativamente o que hoje é feito à mão:

| Problema atual | Solução no app |
|---|---|
| `setInterval` manual, pausado por `document.visibilityState` | `refetchInterval` + `refetchIntervalInBackground: false` (padrão) |
| "Carregando conversas..." que não some (bug do `.then(fn)` recebendo o valor resolvido como argumento) | `isLoading` derivado da query; não existe estado manual para vazar |
| Aviso de 24h calculado só no `renderThread()`, então não atualizava no polling | Componente derivado de `data.cliente.last_inbound_at`; re-renderiza em toda atualização por construção |
| Assinatura manual de mensagens para evitar re-render | Igualdade estrutural do TanStack Query |

**Regra de portabilidade:** a lógica de negócio de cada endpoint (as queries SQL, o cálculo de faixa de datas em horário de São Paulo, a checagem da janela de 24h antes de chamar a Graph API) é **copiada literalmente** dos Code nodes atuais para funções TypeScript. O que muda é o invólucro, não a regra. Isso mantém o comportamento idêntico e torna a comparação lado a lado possível durante a validação.

### 5.2 Conexão por Evolution API (não vem do painel antigo)

Segunda forma de conectar o WhatsApp, ao lado da Cloud API: a Evolution roda no servidor
do próprio cliente e conecta por QR Code. A escolha é por cliente, na coluna
`whatsapp_accounts.provider`, e as duas conexões escrevem nas mesmas tabelas de mensagem
— a tela Conversas não sabe por onde a mensagem entrou.

O que isso acrescenta à arquitetura: `POST /api/webhooks/evolution` é a primeira rota de
escrita **sem sessão** do app. Ela não pode passar por `lib/auth/guard.ts` porque quem
chama é um servidor. No lugar do guard, um token aleatório por cliente na query
(comparado em tempo constante) e o banco escolhido pelo catálogo, nunca pelo corpo da
requisição. Detalhamento em `PLANO_IMPLEMENTACAO.md`, seção "Conexão WhatsApp por
Evolution API".

---

## 6. Como o app conversa com o n8n

Dois endpoints do n8n permanecem sendo chamados pelo app: `sync-meta-agora` e `campanhas-importar-historico`. Hoje o navegador os chama diretamente, com Basic Auth. Isso não pode continuar: a credencial ficaria no front-end.

**No app, o navegador nunca fala com o n8n.** O fluxo passa a ser:

```
Navegador → POST /api/clientes/[cliente]/sync   (sessão do app, cookie)
              ↓ valida sessão + vínculo com o cliente
              ↓ registra em app_audit_log
          → POST https://n8n.seudominio/webhook/painel-api/sync-meta-agora
              (header Authorization com N8N_WEBHOOK_TOKEN, variável de ambiente do servidor)
```

A trava de 60 segundos (`ad_accounts.last_sync_started_at`) continua sendo do n8n. O app apenas repassa o `429` como "dados já estão atualizados", igual hoje.

**No n8n:** trocar o Basic Auth de usuário único por autenticação por header token nesses dois webhooks, com o valor guardado como credencial do n8n. E, importante, **remover o webhook `GET /painel`** depois que o app estiver no ar, senão o painel antigo continua acessível com a senha antiga, contornando toda a autenticação nova.

---

## 7. Estrutura do repositório

```
.
├── app/
│   ├── (auth)/                        # login, signup, recuperar-senha
│   ├── (dashboard)/
│   │   ├── app/page.tsx               # seleção de clientes
│   │   ├── app/[cliente]/…            # as 13 abas
│   │   └── admin/…                    # usuários, auditoria, novo cliente
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── clientes/…
│       └── webhooks/                  # (fase 5) kommo, whatsapp
├── components/                        # ui/ (shadcn), charts/, conversas/, …
├── lib/
│   ├── auth/                          # config Auth.js, guard.ts, senhas
│   ├── db/                            # pool, central.ts (Drizzle), cliente.ts (dinâmico)
│   ├── meta/                          # CAPI, Graph API, hash de telefone
│   ├── groq/                          # prompts e chamada
│   └── periodo.ts                     # faixas de data em São Paulo (portado dos Code nodes)
├── drizzle/                           # schema + migrações do banco central
├── scripts/seed-admin.ts
├── n8n/                               # os 4 build_*.js que permanecem + .json gerados
├── sql/                               # 01_central, 02_template, 03_app_auth, migrações
└── docs/                              # ARQUITETURA_APP.md, PLANO_IMPLEMENTACAO.md, DOCUMENTACAO_APLICACAO.md
```

Os `build_*.js` e `.json` dos workflows que morrem (painel, cadastro de cliente) saem do repositório do app — ficam preservados na pasta `mySQL - Copia` original como referência histórica.

---

## 8. Riscos conhecidos

| Risco | Impacto | Mitigação |
|---|---|---|
| Esgotamento de conexões MySQL sob concorrência serverless | App fora do ar | Fluid Compute + pool de 3 + `max_connections` elevado; ProxySQL como próximo passo (seção 3.2) |
| Falha de autorização expondo dados entre clientes | Grave | `requireClientAccess` única, obrigatória; teste automatizado que percorre todas as rotas garantindo 403 para cliente sem vínculo |
| Tokens da Meta em texto puro no banco | Grave se combinado com o risco acima | Nunca retornados pela API; auditoria de escrita; cifra em repouso na fase 6 |
| Divergência de comportamento entre painel antigo e novo | Perda de confiança nos números | Rodar os dois em paralelo e comparar as métricas de cada aba, cliente a cliente, antes de desligar o antigo (fase 4) |
| Migração dos webhooks quebrar a entrada de leads | Perda de leads, silenciosa | Fase 5 separada, um webhook por vez, n8n mantido ativo em paralelo, comparação de contagem por 7 dias |
| Painel antigo continuar acessível pela senha antiga | Contorna toda a autenticação nova | Remover o webhook `GET /painel` do n8n como último passo da fase 4 |
| `01 - Recebe leads` ser afetado indiretamente | Perda do ponto de entrada | Nenhuma fase toca nesse workflow nem no schema de `customers` de forma incompatível |
