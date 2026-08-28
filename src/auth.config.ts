import type { NextAuthConfig } from 'next-auth';

/**
 * Configuração do Auth.js compartilhada entre o middleware e o servidor.
 *
 * Este arquivo precisa rodar no runtime Edge (é ele que o middleware
 * importa), então NÃO pode importar `mysql2`, `bcryptjs` nem qualquer
 * coisa que dependa de APIs de Node. O provider de credenciais, que
 * precisa dos dois, vive em `src/auth.ts`.
 */
export const authConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
  },

  session: {
    // JWT em vez de sessão no banco: cada validação de sessão viraria uma
    // consulta ao MySQL do VPS, e o número de conexões é justamente o
    // recurso mais escasso desta arquitetura (ver ARQUITETURA_APP.md,
    // seção 3.2). O custo é que revogar acesso não é instantâneo — o
    // token vale até expirar. Por isso a janela é curta.
    strategy: 'jwt',
    maxAge: 60 * 60 * 8, // 8 horas
  },

  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.userId = Number(user.id);
        token.role = (user as { role?: 'admin' | 'cliente' }).role ?? 'cliente';
        token.name = user.name;
        token.email = user.email;
      }
      // Permite atualizar o nome exibido sem obrigar novo login.
      if (trigger === 'update' && session?.name) {
        token.name = session.name as string;
      }
      return token;
    },

    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.userId ?? '');
        session.user.role = (token.role as 'admin' | 'cliente') ?? 'cliente';
      }
      return session;
    },

    authorized({ auth, request }) {
      const logado = Boolean(auth?.user);
      const ehAdmin = auth?.user?.role === 'admin';
      const { pathname } = request.nextUrl;

      // `/admin` exige papel de administrador, não só sessão. A checagem
      // acontece aqui e de novo em cada rota da API: o middleware protege
      // a navegação, mas quem protege os dados é o guard do servidor.
      if (pathname.startsWith('/admin')) return logado && ehAdmin;
      if (pathname.startsWith('/app')) return logado;
      return true;
    },
  },

  providers: [], // preenchido em src/auth.ts
} satisfies NextAuthConfig;
