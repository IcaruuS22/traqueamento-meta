import type { NextConfig } from 'next';

/**
 * Content-Security-Policy.
 *
 * O que cada diretiva resolve:
 *
 *  - `default-src 'self'`: nada carrega de fora do domínio a menos que
 *    esteja liberado abaixo. É o que impede um script injetado de
 *    mandar dados para um servidor de terceiro.
 *  - `frame-ancestors 'none'`: versão moderna do X-Frame-Options (que
 *    fica ali como reserva para navegador antigo). Ninguém embute este
 *    painel num iframe — sem isso, clickjacking em cima dos botões que
 *    ligam e desligam campanha na Meta.
 *  - `base-uri 'none'` e `form-action 'self'`: fecham dois desvios
 *    clássicos que o `default-src` não cobre — injetar um `<base>` para
 *    reapontar todos os caminhos relativos, e apontar o `action` de um
 *    formulário (inclusive o de login) para fora.
 *  - `object-src 'none'`: `<object>`/`<embed>` não têm uso aqui e são
 *    caminho de execução de conteúdo.
 *  - `img-src` com `data:` e `blob:`: o QR Code da Evolution chega como
 *    `data:image/png;base64,...`, o CSS tem ícones SVG embutidos, e a
 *    exportação de PDF monta a URL do arquivo com `createObjectURL`.
 *  - `font-src`/`style-src` com o Google Fonts: a Inter vem de lá
 *    (`app/layout.tsx`).
 *  - `connect-src 'self'`: o navegador só fala com a própria origem —
 *    não há nenhuma chamada de cliente para API externa neste painel.
 *
 * Sobre o `'unsafe-inline'` em `script-src`. Ele está aqui porque o
 * próprio Next injeta scripts inline em toda página (o payload do React
 * Server Components, `self.__next_f.push(...)`), e o conteúdo muda a
 * cada resposta — não dá para autorizar por hash. A saída correta é
 * nonce por requisição, e ela exige gerar o nonce no middleware e lê-lo
 * no layout raiz com `headers()`, o que tira a aplicação inteira da
 * renderização estática. Enquanto isso não for feito, o valor desta
 * política não é barrar XSS em script inline: é barrar tudo o que vem
 * DEPOIS — o script injetado não consegue carregar um segundo arquivo
 * de fora, não consegue mandar os dados para outro servidor, não
 * consegue redirecionar o formulário de login. Vale registrar isso sem
 * enfeite: com `'unsafe-inline'`, um XSS ainda executa.
 *
 * `'unsafe-eval'` só em desenvolvimento: é exigência do react-refresh
 * (hot reload). Em produção não vai.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  // mysql2 usa APIs de Node que o bundler não deve tentar empacotar.
  serverExternalPackages: ['mysql2', 'bcryptjs', 'nodemailer'],

  // O DDL do banco de cliente é lido em runtime de `Banco de Dados/`, e o
  // rastreio automático do Next só enxerga `import` — um `readFile` com
  // caminho montado em variável passa despercebido e o arquivo ficaria
  // fora do bundle na Vercel. A criação de cliente falharia só em produção.
  //
  // O mesmo vale para as fontes padrão do PDF: o `pdfkit` (dentro do
  // `@react-pdf/renderer`) carrega `standard-fonts/Helvetica` por import
  // dinâmico, com o nome montado em runtime. O rastreio não enxerga, e a
  // rota do relatório quebrava só na Vercel com MODULE_NOT_FOUND.
  outputFileTracingIncludes: {
    '/admin/clientes/novo': ['./Banco de Dados/02_Template_Banco_Por_Cliente.sql'],
    '/api/relatorio/metricas': [
      './node_modules/pdfkit/js/standard-fonts/**/*',
      './node_modules/pdfkit/js/data/*',
    ],
  },

  eslint: {
    // Só as pastas do app. As pastas legadas (build_*.js do n8n,
    // painel-admin.html) não passam pelo lint do Next.
    dirs: ['src'],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: CSP },
          {
            // Só faz efeito sobre HTTPS; em http:// o navegador ignora.
            // Dois anos com subdomínios é o valor que o preload da
            // Chrome exige — não estamos na lista, mas não há motivo
            // para configurar menos. Depois de enviado, o navegador
            // recusa http:// neste domínio pelo prazo inteiro: só ligue
            // quando o certificado estiver estável, porque voltar atrás
            // exige esperar o cabeçalho expirar em cada visitante.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          {
            // O painel não usa nada disto. Desligar explicitamente
            // impede que um script injetado (ou um iframe de terceiro,
            // se um dia houver) peça a câmera do usuário em nome do
            // domínio.
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), interest-cohort=()',
          },
        ],
      },
      {
        // Nenhuma resposta de API deve ser cacheada por CDN: todas
        // dependem da sessão e do cliente selecionado.
        //
        // A exceção é `/api/conversas/midia`, que devolve o arquivo de
        // uma mensagem e define o próprio `Cache-Control: private` — sem
        // a exclusão, as duas regras se somariam e o navegador receberia
        // dois valores de Cache-Control para a mesma resposta. A mídia é
        // imutável (o arquivo de uma mensagem não muda), e deixar o
        // navegador guardá-la evita rebaixar a mesma imagem a cada volta
        // para a conversa.
        source: '/api/:path((?!conversas/midia).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
