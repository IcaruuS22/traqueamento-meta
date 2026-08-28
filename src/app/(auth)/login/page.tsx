import Link from 'next/link';
import type { Metadata } from 'next';
import { FormularioLogin } from './formulario';
import { Alerta } from '@/components/form';

export const metadata: Metadata = { title: 'Entrar — Trakeamento' };

/**
 * Reduz o valor a um caminho interno, ou descarta.
 * Aceita tanto `/app/x` quanto uma URL absoluta do próprio site — que é o
 * formato que o Auth.js coloca em `callbackUrl`.
 */
function caminhoInterno(valor: string | undefined): string | undefined {
  if (!valor) return undefined;
  if (valor.startsWith('/') && !valor.startsWith('//')) return valor;
  try {
    const url = new URL(valor);
    return url.pathname + url.search;
  } catch {
    return undefined;
  }
}

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; callbackUrl?: string; redefinida?: string }>;
}) {
  const params = await searchParams;

  // `callbackUrl` é o nome que o middleware do Auth.js usa ao barrar uma
  // rota; `next` é o nosso. Os dois vêm da URL, então só caminho interno
  // é aceito — senão o login vira um redirecionador para fora do domínio.
  const destino = caminhoInterno(params.next) ?? caminhoInterno(params.callbackUrl);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Entrar</h1>
      <p className="mb-5 text-sm text-[var(--text-secondary)]">
        Acesse o painel com sua conta.
      </p>

      {params.redefinida ? (
        <div className="mb-4">
          <Alerta tipo="sucesso">Senha alterada. Entre com a nova senha.</Alerta>
        </div>
      ) : null}

      <FormularioLogin destino={destino} />

      <div className="mt-5 space-y-1.5 text-sm">
        <p>
          <Link href="/recuperar-senha" className="text-[var(--text-secondary)] hover:underline">
            Esqueci minha senha
          </Link>
        </p>
        <p className="text-[var(--text-tertiary)]">
          Não tem acesso?{' '}
          <Link href="/signup" className="text-[var(--text-primary)] hover:underline">
            Solicitar
          </Link>
        </p>
      </div>
    </>
  );
}
