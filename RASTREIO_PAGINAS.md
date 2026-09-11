# Rastreio de páginas de vendas

Funil do site de cada cliente — **visita → lead de formulário → checkout → compra** — no painel e na Conversions API da Meta, com a campanha de onde cada pessoa veio.

Funciona em qualquer página que aceite uma tag `<script>`: WordPress, Lovable, sites em Vercel, HTML próprio. Não depende de plugin nem de construtor de página.

---

## 1. Como as peças se ligam

```
Página do cliente
  └─ <script src="APP/t.js?k=CHAVE">          (tag única, pública)
       ├─ PageView / ViewContent ─────────┐
       ├─ Lead (formulário da página) ────┤──► POST APP/api/rastreio/coleta
       ├─ InitiateCheckout (clique) ──────┤      ├─ grava paginas_eventos
       └─ Purchase (página de obrigado) ──┘      ├─ Lead: entra em customers + Kommo
                                                 └─ Conversions API (mesmo event_id do pixel)
       └─ link do checkout ganha ?sck=VISITANTE&utm_*

Hotmart / Kiwify / outro checkout
  └─ webhook ──► POST APP/api/rastreio/compra/{plataforma}?k=CHAVE&token=SEGREDO
                   ├─ acha o visitante pelo sck/src/s1 e herda a origem da visita
                   ├─ grava Purchase (event_id site_purchase_<pedido>, idempotente)
                   └─ Conversions API
```

- **`site_key` (k)** é pública: aparece no código-fonte da página. O que impede o uso em outro site é a lista de domínios do cadastro.
- **`webhook_token`** é secreto: vai só na URL do webhook, cadastrada na plataforma de checkout. Aparece apenas na tela do admin, nunca na do cliente. Se vazar, troque em *Admin → Clientes → Páginas de vendas → Trocar token* e atualize a URL na plataforma.
- O visitante é um id aleatório de 32 caracteres hexadecimais guardado no cookie `_trk_vid` (domínio raiz, 395 dias) e no `localStorage`.

---

## 2. Ativação (uma vez)

1. Rodar `Banco de Dados/migracao_paginas_central.sql` no banco central (`trakeamento_controle`).
2. Rodar `Banco de Dados/migracao_paginas_cliente.sql` em **cada** banco de cliente que vai usar o rastreio.

As duas migrações só criam tabelas e índices (`IF NOT EXISTS`). Não alteram tabela existente. Enquanto não rodarem, o admin mostra um aviso e a tela do cliente diz "fale com o administrador"; nada quebra.

---

## 3. Cadastro do site (admin)

*Admin → Clientes → Páginas de vendas*:

| Campo | O que é |
|---|---|
| Nome | Só para o painel. |
| Domínios | Hosts autorizados, um por linha ou separados por vírgula. `exemplo.com` libera `www.exemplo.com` e `lp.exemplo.com`. Pode colar a URL inteira; o app limpa. |
| Enviar leads ao Kommo | Liga o mesmo fluxo dos leads de formulário instantâneo. |
| Funil / etapa do Kommo | Onde o lead entra. Vazio = etapa inicial do funil principal. Etapa sem funil é recusada. |
| Ativo | Desligado, a tag passa a devolver um script vazio e a coleta recusa os eventos. |

A tela mostra, por site, a tag pronta para colar e as URLs de webhook de cada plataforma.

---

## 4. Instalação da tag

Em todas as páginas do site — página de vendas, captura e obrigado:

```html
<script async src="https://APP/t.js?k=CHAVE"></script>
```

- **WordPress:** em *Aparência → Editor de temas → header.php*, antes de `</head>`, ou por um plugin de "inserir código no cabeçalho" (WPCode, Insert Headers and Footers). Elementor: *Elementor → Código personalizado → `<head>`*.
- **Lovable:** peça "adicione esta tag no `<head>` do `index.html`" e cole a tag.
- **Vercel / Next.js:** `<Script src="https://APP/t.js?k=CHAVE" strategy="afterInteractive" />` no layout raiz. Vite/React: no `index.html`.
- **HTML próprio:** antes de `</head>`.

Troca de rota em SPA (Next, React Router, Lovable) é detectada sozinha: cada rota nova gera um PageView.

### O site já tem o pixel da Meta instalado?

Por padrão a tag carrega o pixel do cliente no navegador e manda o mesmo `eventID` para a Conversions API, para a Meta deduplicar. Se o site **já tem** o pixel (plugin, GTM, código do construtor), desligue o da tag para não contar em dobro:

```html
<script async src="https://APP/t.js?k=CHAVE" data-pixel="0"></script>
```

Os eventos continuam indo pela Conversions API.

### Depuração

Adicione `data-debug` na tag, ou `?trk_debug=1` na URL da página, e veja o console do navegador (prefixo `[trk]`).

---

## 5. O que é capturado sem configurar nada

| Evento | Quando |
|---|---|
| PageView | Carga da página e cada troca de rota. |
| Lead | Envio de qualquer `<form>` com e-mail ou telefone (10+ dígitos). Os campos são reconhecidos por tipo, `name`, `id`, `autocomplete`, placeholder e rótulo. |
| InitiateCheckout | Clique em link para Hotmart, Kiwify, Eduzz, Perfect Pay, Monetizze, Ticto, Cakto, Yampi, Pagar.me e qualquer host externo começando com `checkout.` / `pay.` / `pagamento.` / `seguro.`. Outros checkouts: `data-trk-checkout` no link (seção 6). |

Não vira Lead: formulário com campo de senha (login, área de membros), formulário com campo-armadilha preenchido (`honeypot`, `_gotcha`, `hp_…`, `bot_field`) e formulário que não passou na validação do navegador. Campos de CPF, CNPJ, empresa e similares são ignorados e nunca saem da página.

Os links de checkout recebem o id do visitante no primeiro parâmetro livre entre `sck`, `src` e `s1`, e as UTMs da página. Um `sck` que o dono já usa ("instagram") é mantido.

---

## 6. Ajustes finos com atributos HTML

| Atributo | Onde | Efeito |
|---|---|---|
| `data-trk-campo="email"` | `<input>` | Força o tipo do campo. Valores: `email`, `telefone`, `nome`, `primeiro_nome`, `sobrenome`, `cidade`, `estado`, `cep`, `ignorar`. |
| `data-trk-ignore` | `<form>` | O formulário não gera Lead (busca, newsletter interna, etc.). |
| `data-trk-checkout` | `<a>` | Trata o link como checkout mesmo sendo de um host desconhecido. |
| `data-trk-valor="497"` | link de checkout | Valor mandado no InitiateCheckout. |
| `data-trk-moeda="BRL"` | link de checkout | Moeda (padrão BRL). |
| `data-trk-produto="Curso X"` | link de checkout | `content_name`. |

---

## 7. API em JavaScript

Para formulários que não usam `<form>` (componentes React que mandam por `fetch`, quizzes, chat) ou para marcar a compra na página de obrigado.

Se a chamada puder acontecer antes da tag carregar, cole antes da tag:

```html
<script>window.trk=window.trk||function(){(trk.q=trk.q||[]).push(arguments)};</script>
```

Comandos:

```js
trk('lead', { email: 'a@b.com', telefone: '11999998888', nome: 'Maria Silva' });
trk('checkout', { value: 497, currency: 'BRL', content_name: 'Curso X' });
trk('view_content', { content_name: 'Página de preços' });
trk('purchase', { order_id: 'PEDIDO123', value: 497, currency: 'BRL' });
trk('pageview');          // força um PageView (a detecção de rota já cobre SPAs)
trk('visitante');         // devolve o id do visitante
```

Valores aceitam número ou texto (`"1.297,90"` e `"1297.90"` dão o mesmo resultado).

### Compra pela página de obrigado

Use só quando o checkout não tiver webhook. Com `order_id`, recarregar a página não conta a venda de novo, e se o webhook da plataforma chegar depois com o mesmo número de pedido a Meta recebe um único Purchase (event_id `site_purchase_<pedido>`). **Sem `order_id` não há como deduplicar.**

Compra vinda do navegador pode ser forjada por quem abrir o console. Onde houver webhook, prefira o webhook.

---

## 8. Webhook de compra

URL, mostrada no admin por plataforma:

```
POST https://APP/api/rastreio/compra/{generico|hotmart|kiwify}?k=CHAVE&token=SEGREDO
```

O token também pode ir no cabeçalho `x-trk-token`.

### Hotmart

*Ferramentas → Webhook (API e notificações) → Cadastrar webhook*: cole a URL de `hotmart`, versão 2.0.0, eventos **Compra aprovada** e **Compra completa**. A Hotmart devolve o visitante em `origin.sck`.

### Kiwify

*Apps → Webhooks → Criar*: cole a URL de `kiwify`, evento **Compra aprovada**. O visitante volta em `TrackingParameters` (`sck`, `src` ou `s1`). O valor vem em centavos e é convertido.

### Genérico (qualquer outra plataforma, Zapier, Make, n8n)

JSON com, no mínimo, o pedido:

```json
{
  "order_id": "PEDIDO123",
  "status": "approved",
  "value": 497.00,
  "currency": "BRL",
  "email": "cliente@exemplo.com",
  "phone": "11999998888",
  "name": "Maria Silva",
  "product": "Curso X",
  "visitor_id": "id do visitante (sck/src do link)",
  "utm_source": "facebook",
  "utm_campaign": "campanha"
}
```

Sem `status` conta como venda aprovada (`approved`, `paid`, `completed` e afins também). Qualquer outro status — `pending`, `waiting_payment`, `refunded`, `chargeback` — recebe resposta 200 e é ignorado: nada é gravado e nada vai à Meta. Isso vale para as três plataformas; por isso basta cadastrar os eventos de compra aprovada.

Reembolso **não** desfaz o Purchase já enviado à Meta (a Conversions API não tem estorno); a receita do painel também não é descontada.

### Idempotência

A mesma compra reenviada pela plataforma (ou chegando pelo webhook e pela página de obrigado) grava um único evento: o `event_id` é `site_purchase_<pedido>` e é UNIQUE no banco.

---

## 9. Painel do cliente

*Painel → Páginas de vendas*: visitantes, leads, quem foi ao checkout, compras, receita e conversão; funil; tabelas por campanha (UTM da primeira visita) e por página; os 50 eventos mais recentes, com o status de envio à Meta. Com mais de um site, dá para filtrar por site. Nenhum token ou URL de webhook aparece nessa tela.

---

## 10. Limitações conhecidas

- **Lead duplicado na Meta:** o Lead da página já vai pela Conversions API. Se a etapa de entrada no Kommo estiver mapeada para `Lead` em `crm_meta_event_map`, a Meta recebe dois Leads da mesma pessoa. Deixe a etapa de entrada sem evento, ou use outro evento para ela.
- **Pixel em dobro:** site com pixel próprio precisa de `data-pixel="0"` (seção 4).
- **Safari (ITP):** cookie criado por JavaScript dura no máximo 7 dias no Safari. Quem volta depois disso é contado como visitante novo; a compra pelo webhook ainda casa se o link do checkout tiver sido decorado na visita da compra.
- **LGPD:** banner de consentimento e política de privacidade são responsabilidade do dono do site. Para respeitar o consentimento, carregue a tag só depois do aceite.
- **Adaptadores Hotmart e Kiwify** seguem a documentação pública das plataformas; valide com uma compra de teste (ou o botão de teste de webhook) antes de confiar nos números.
- **Kommo:** o lead é criado na hora da coleta. Se o Kommo estiver fora, o lead fica no banco e o erro vai para o log; não há nova tentativa automática.
