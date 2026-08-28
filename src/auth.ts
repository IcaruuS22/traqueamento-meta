import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { authConfig } from '@/auth.config';
import { autentica } from '@/lib/auth/usuarios';

const credenciaisSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'E-mail', type: 'email' },
        senha: { label: 'Senha', type: 'password' },
      },
      async authorize(credenciais) {
        const parsed = credenciaisSchema.safeParse(credenciais);
        if (!parsed.success) return null;

        const usuario = await autentica(parsed.data.email, parsed.data.senha);
        if (!usuario) return null;

        return {
          id: String(usuario.id),
          email: usuario.email,
          name: usuario.name,
          role: usuario.role,
        };
      },
    }),
  ],
});
