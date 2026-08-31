import type { NextConfig } from 'next';

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
      './node_modules/pdfkit/js/standard-fonts/*',
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
