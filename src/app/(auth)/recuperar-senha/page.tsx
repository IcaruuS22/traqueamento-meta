import Link from 'next/link';
import type { Metadata } from 'next';
import { FormularioRecuperar } from './formulario';

export const metadata: Metadata = { title: 'Recuperar senha — Trakeamento' };

export default function PaginaRecuperarSenha() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Recuperar senha</h1>
      <p className="mb-5 text-sm text-[var(--text-secondary)]">
        Informe seu e-mail e enviaremos um link para definir uma nova senha. O link vale por 1 hora.
      </p>

      <FormularioRecuperar />

      <p className="mt-5 text-sm">
        <Link href="/login" className="text-[var(--text-secondary)] hover:underline">
          Voltar para o login
        </Link>
      </p>
    </>
  );
}
