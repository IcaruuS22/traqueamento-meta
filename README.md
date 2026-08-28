# Trakeamento Meta Ads + Kommo + WhatsApp

Plataforma que conecta formulários instantâneos da Meta (Facebook/Instagram Lead Ads) e conversas do WhatsApp (Cloud API oficial ou Evolution API, por QR Code) a um CRM Kommo, registra tudo em MySQL, devolve eventos de conversão para a Meta Conversions API, e expõe um painel com métricas, campanhas, kanban e atendimento.

Este repositório está em **migração**: o sistema nasceu inteiramente em n8n e está sendo transformado em um aplicativo Next.js hospedado na Vercel, mantendo no n8n apenas os fluxos que dependem de execução longa ou agendada.

---

## Documentação

| Documento | Para quê |
|---|---|
| [`ARQUITETURA_APP.md`](ARQUITETURA_APP.md) | Arquitetura alvo: o que vira app, o que fica no n8n, stack, autenticação, multi-tenant, riscos. **Comece por aqui.** |
| [`PLANO_IMPLEMENTACAO.md`](PLANO_IMPLEMENTACAO.md) | As 7 fases de execução, com critério de conclusão de cada uma e a lista de ações manuais. |
| [`DOCUMENTACAO_APLICACAO.md`](DOCUMENTACAO_APLICACAO.md) | Como o sistema atual funciona hoje, workflow por workflow e aba por aba. É a referência ao portar cada endpoint. |

## Banco de dados

| Script | Onde rodar |
|---|---|
| [`Banco de Dados/00_Banco_Central_Do_Zero (instalacao limpa).sql`](Banco%20de%20Dados/00_Banco_Central_Do_Zero%20%28instalacao%20limpa%29.sql) | **Instalação do zero.** Cria `trakeamento_controle` já com tudo que as migrações acrescentaram depois (`meta_test_event_code`, `last_sync_started_at`, `whatsapp_accounts` com `provider` e colunas `evolution_*`, `painel_metric_prefs`). Em banco novo, substitui o `01` e as migrações do central. **Não rode em banco existente.** |
| [`Banco de Dados/01_Banco_Central_Controle (Rode no SQL).sql`](Banco%20de%20Dados/01_Banco_Central_Controle%20%28Rode%20no%20SQL%29.sql) | Versão original do central. Só para bancos que já foram criados com ele — em ambiente novo use o `00` acima |
| [`Banco de Dados/02_Template_Banco_Por_Cliente.sql`](Banco%20de%20Dados/02_Template_Banco_Por_Cliente.sql) | Template aplicado a cada banco `cliente_*` novo. **O app lê este arquivo** em `/admin/clientes/novo`: editar aqui muda o esquema de todo cliente criado dali em diante |
| [`Banco de Dados/03_App_Auth_Usuarios.sql`](Banco%20de%20Dados/03_App_Auth_Usuarios.sql) | Uma vez, no `trakeamento_controle` — usuários, papéis, convites, auditoria |
| `WhatsApp/migracao_*.sql`, `Meta Insights/migracao_*.sql` | Em cada banco `cliente_*` já existente |
| [`WhatsApp/migracao_whatsapp_evolution.sql`](WhatsApp/migracao_whatsapp_evolution.sql) | Uma vez, no `trakeamento_controle` — habilita a conexão por Evolution API (coluna `provider` + colunas `evolution_*`). Já rodado em produção. |
| [`WhatsApp/migracao_whatsapp_midia.sql`](WhatsApp/migracao_whatsapp_midia.sql) | Em **cada** banco `cliente_*` — guarda imagem, áudio, vídeo e documento das conversas (`whatsapp_media` + colunas `media_*`). Sem ela a conversa continua aparecendo, só que o anexo fica como rótulo. Rodada nos dois clientes de produção em 28/08/2026. |

## Estado atual da migração

- [x] Fase 0 — Fundação
- [x] Fase 1 — Autenticação e usuários
- [x] Fase 2 — Telas de leitura (conferida contra o painel antigo nos 2 clientes reais que existem — ver `PLANO_IMPLEMENTACAO.md`)
- [ ] Fase 3 — Escrita, tempo real e cadastro (itens 1 a 7 de 8 prontos: Configuração de Eventos, preferências de métricas, Conexão WhatsApp, Conversas, Análise por IA, disparo do n8n e cadastro de cliente novo; falta só a autenticação dos webhooks no n8n)
- [ ] Fase 4 — Validação e corte
- [ ] Fase 5 — Webhooks de entrada (opcional)
- [ ] Fase 6 — Cifra de tokens em repouso
- [x] Conexão WhatsApp por Evolution API (fora das fases)
- [ ] Mídia das conversas (código pronto e migração rodada nos dois clientes; falta ver um arquivo real chegar, o que depende do painel publicado)

> As caixas acima são marcadas quando o **critério de conclusão** da fase (descrito no plano) é demonstrado — não quando o código é escrito.

## Workflows que permanecem no n8n

1. `01 - Recebe leads - Meta (CORRIGIDO)` — ponto de entrada dos leads. **Não alterar.**
2. `Meta Insights - Sincronização Sob Demanda`
3. `Meta Insights - Importação Histórica (manual)`
4. `WhatsApp IA - Classificação Automática`

Cada `build_*.js` **gera** o `.json` correspondente. Ao alterar um deles, rode `node build_xxx.js` e reimporte o `.json` no n8n — editar o `.json` direto é perdido na próxima geração.

## Desenvolvimento

```bash
npm install
cp .env.example .env.local
npm run dev
```

Variáveis de ambiente: ver [`.env.example`](.env.example).

### Primeira execução, na ordem

1. Preencha `MYSQL_HOST`, `MYSQL_USER` e `MYSQL_PASSWORD` no `.env.local` (o `AUTH_SECRET` já vem gerado).
2. Rode `Banco de Dados/03_App_Auth_Usuarios.sql` no MySQL — cria as tabelas de usuários, convites e auditoria.
3. `npm run db:check` — confirma conexão, lista o que falta e mostra os clientes do catálogo.
4. Preencha `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` e rode `npm run seed:admin`. Depois **apague os dois valores** do `.env.local`.
5. `npm run dev` e entre em `http://localhost:3000/login`.

Sem `SMTP_*` configurado, convites e links de redefinição não são enviados — o link aparece
no log do servidor e, no caso do convite, na própria tela `/admin/usuarios`.

## Publicar na Vercel

O painel roda na Vercel; o MySQL e a Evolution API ficam na VPS. Essa
divisão tem uma consequência que não aparece em desenvolvimento: **a
Evolution só entrega as mensagens em um endereço que ela alcance pela
internet.** Enquanto o webhook da instância apontar para `localhost`, o
WhatsApp conecta, o QR funciona, o número aparece como conectado — e
nenhuma mensagem chega ao painel, porque `localhost`, visto da VPS, é a
própria VPS.

Na ordem:

1. **Libere o MySQL para a Vercel.** As funções da Vercel saem por IPs que
   mudam, então uma regra de firewall por IP fixo não serve. As saídas
   são: IP dedicado da Vercel, um túnel, ou abrir a porta do MySQL com
   TLS (`MYSQL_SSL=true`) e usuário próprio do app. Confira antes de
   publicar — sem isso todas as telas sobem com erro de conexão.
2. **Cadastre as variáveis** de `.env.example` em Production e Preview.
   Duas mudam de valor em relação ao `.env.local`:
   - `AUTH_URL` — o endereço público do painel;
   - `EVOLUTION_WEBHOOK_BASE_URL` — o mesmo endereço público. Sem esta
     variável o app usa o `AUTH_URL`, o que costuma estar certo; defina-a
     explicitamente quando a Evolution alcançar o painel por outro nome.
   Não copie `SEED_ADMIN_*` para lá: é uso único, local.
3. **Reaponte o webhook de cada cliente já conectado.** Em
   *WhatsApp → Conexão*, botão **"Atualizar webhook"**. Ele reescreve a
   URL na instância mantendo instância e token — não é preciso ler o QR
   Code de novo. A tela avisa em vermelho quando o endereço configurado
   ainda é local.
4. **Rode `WhatsApp/migracao_whatsapp_midia.sql`** em cada banco
   `cliente_*`, para que imagem, áudio, vídeo e documento sejam guardados
   e exibidos. Já rodada nos dois clientes que existem hoje; vale para
   qualquer banco de cliente criado antes de 28/08/2026.
5. **Confirme com uma mensagem real**: mande uma do celular do lead e
   veja aparecer na tela de Conversas em até 10 segundos. Se não
   aparecer, o log da instância na Evolution mostra a tentativa de
   entrega e a resposta do painel.

### Testes

```bash
npm test
```

Testes de unidade (`tests/*.test.ts`): lógica pura, sem banco e sem rede. Rodam em qualquer máquina.

```bash
npm run test:integracao
```

Testes de integração (`tests/integracao/*.test.ts`): autorização entre clientes e carga do pool.
Precisam do **servidor no ar** e do MySQL alcançável, e criam um usuário de teste em
`trakeamento_controle.app_users` (removido no fim, inclusive quando um caso falha). Sem servidor
ou sem banco, os casos são pulados em vez de falharem. Aponte para outro alvo com
`TESTE_BASE_URL=http://localhost:3001 npm run test:integracao` — útil para exercitar o build de
produção (`npm run build && npm start`), onde a verificação de vazamento no payload RSC roda de
verdade.
