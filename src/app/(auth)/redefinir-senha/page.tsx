import Link from 'next/link';
import type { Metadata } from 'next';
import { FormularioRedefinir } from './formulario';
import { Alerta } from '@/components/form';

export const metadata: Metadata = { title: 'Definir nova senha | Trakeamento' };

export default async function PaginaRedefinirSenha({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <>
        <h1 className="mb-4 text-xl font-semibold">Link inválido</h1>
        <Alerta tipo="erro">
          Este endereço não contém um token de redefinição. Peça um novo link.
        </Alerta>
        <p className="mt-5 text-sm">
          <Link href="/recuperar-senha" className="text-[var(--text-secondary)] hover:underline">
            Pedir novo link
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Definir nova senha</h1>
      <p className="mb-5 text-sm text-[var(--text-secondary)]">
        Escolha uma senha com pelo menos 10 caracteres.
      </p>
      <FormularioRedefinir token={token} />
    </>
  );
}
