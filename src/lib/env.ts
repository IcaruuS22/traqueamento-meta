import 'server-only';

/**
 * Leitura centralizada das variáveis de ambiente.
 *
 * Sem validação com Zod no topo do módulo de propósito: a Vercel executa
 * o build sem as variáveis de runtime disponíveis, e um `throw` durante a
 * importação quebraria o build inteiro. Cada variável é validada no ponto
 * de uso, por quem realmente depende dela.
 */

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(
      `Variável de ambiente ausente: ${nome}. Confira o .env.example e as configurações do projeto na Vercel.`,
    );
  }
  return valor;
}

function opcional(nome: string, padrao = ''): string {
  return process.env[nome] ?? padrao;
}

export const env = {
  mysql: {
    get host() {
      return obrigatoria('MYSQL_HOST');
    },
    get port() {
      return Number(opcional('MYSQL_PORT', '3306'));
    },
    get user() {
      return obrigatoria('MYSQL_USER');
    },
    get password() {
      return obrigatoria('MYSQL_PASSWORD');
    },
    get database() {
      return opcional('MYSQL_DATABASE', 'trakeamento_controle');
    },
    get ssl() {
      return opcional('MYSQL_SSL', 'false') === 'true';
    },
    // Conexões concorrentes por processo. Default 10 serve o deploy atual
    // (um único `next start`, um pool para o app inteiro). Em Vercel
    // serverless, onde cada instância abre o próprio pool, baixe pelo env
    // para não pressionar o `max_connections` do MySQL.
    get poolLimit() {
      return Number(opcional('MYSQL_POOL_LIMIT', '10'));
    },
  },

  n8n: {
    get baseUrl() {
      return obrigatoria('N8N_WEBHOOK_BASE_URL').replace(/\/+$/, '');
    },
    get token() {
      return obrigatoria('N8N_WEBHOOK_TOKEN');
    },
    get configurado() {
      return Boolean(process.env.N8N_WEBHOOK_BASE_URL && process.env.N8N_WEBHOOK_TOKEN);
    },
  },

  groq: {
    get apiKey() {
      return obrigatoria('GROQ_API_KEY');
    },
    get model() {
      // Mesmo modelo que o node "Analise IA" do painel antigo usa. Trocar
      // aqui muda o resultado da análise, então o padrão acompanha o que
      // já roda em produção; `GROQ_MODEL` continua sobrescrevendo.
      return opcional('GROQ_MODEL', 'openai/gpt-oss-120b');
    },
    get configurado() {
      return Boolean(process.env.GROQ_API_KEY);
    },
  },

  evolution: {
    /**
     * Endereço público do painel, do ponto de vista do servidor da
     * Evolution — é o que entra na URL do webhook cadastrada na
     * instância.
     *
     * Tem variável própria em vez de reaproveitar `appUrl` porque as
     * duas respondem perguntas diferentes: `AUTH_URL` é para onde o
     * NAVEGADOR do usuário volta depois do login, e aqui é para onde a
     * Evolution manda requisição servidor-a-servidor. Quando o painel
     * roda atrás de proxy, ou a Evolution alcança o app por um endereço
     * interno, os dois valores não coincidem. Sem a variável, o padrão
     * continua sendo `appUrl`.
     */
    get webhookBaseUrl() {
      const bruto = process.env.EVOLUTION_WEBHOOK_BASE_URL ?? env.appUrl;
      return bruto.replace(/\/+$/, '');
    },
  },

  meta: {
    get graphVersion() {
      // Default alinhado com o que os workflows n8n usam hoje (v25.0).
      // O .env.local / a Vercel vencem este valor.
      return opcional('META_GRAPH_API_VERSION', 'v25.0');
    },
  },

  smtp: {
    get configurado() {
      return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
    },
    get host() {
      return obrigatoria('SMTP_HOST');
    },
    get port() {
      return Number(opcional('SMTP_PORT', '587'));
    },
    get user() {
      return obrigatoria('SMTP_USER');
    },
    get password() {
      return obrigatoria('SMTP_PASSWORD');
    },
    get from() {
      return opcional('SMTP_FROM', process.env.SMTP_USER ?? '');
    },
  },

  get appUrl() {
    return (
      process.env.AUTH_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
    );
  },
};
