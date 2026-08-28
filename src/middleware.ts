import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

/**
 * Middleware de autenticação.
 *
 * Usa apenas `auth.config.ts` (sem providers), porque o middleware roda
 * no runtime Edge, onde `mysql2` e `bcryptjs` não existem. O callback
 * `authorized` do config decide o que é permitido.
 *
 * Isto protege a NAVEGAÇÃO. Quem protege os DADOS é `lib/auth/guard.ts`,
 * chamado dentro de cada rota — um middleware sozinho não basta: rotas
 * de API precisam checar também o vínculo com o cliente específico.
 */
export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

export const config = {
  matcher: [
    /*
     * Todas as rotas, exceto:
     * - /api/auth  (o próprio fluxo do Auth.js)
     * - /api/health (prova de vida, precisa responder sem sessão)
     * - arquivos estáticos e imagens do Next
     */
    '/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)',
  ],
};
