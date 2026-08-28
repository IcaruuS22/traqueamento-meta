import Link from 'next/link';
import type { Metadata } from 'next';
import { consultaConvite } from '@/lib/auth/actions';
import { FormularioConvite, FormularioSolicitacao } from './formulario';
import { Alerta } from '@/components/form';

export const metadata: Metadata = { title: 'Criar conta — Trakeamento' };

/**
 * Duas telas no mesmo endereço:
 *
 *  - com `?convite=<token>` válido: cria a conta já ATIVA, com os clientes
 *    que o convite carrega;
 *  - sem convite (ou com convite inválido): registra uma SOLICITAÇÃO —
 *    conta `pendente`, sem vínculo, que só entra depois que um
 *    administrador liberar.
 */
export default async function PaginaCadastro({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string }>;
}) {
  const { convite: token } = await searchParams;
  const convite = token ? await consultaConvite(token) : null;

  if (token && !convite) {
    return (
      <>
        <h1 className="mb-4 text-xl font-semibold">Convite inválido</h1>
        <Alerta tipo="erro">
          Este convite não existe, já foi utilizado ou expirou. Peça um novo ao administrador.
        </Alerta>
        <p className="mt-5 text-sm">
          <Link href="/login" className="text-[var(--text-secondary)] hover:underline">
            Voltar para o login
          </Link>
        </p>
      </>
    );
  }

  if (convite && token) {
    return (
      <>
        <h1 className="mb-1 text-xl font-semibold">Criar sua conta</h1>
        <p className="mb-5 text-sm text-[var(--text-secondary)]">
          Convite para <strong className="text-[var(--text-primary)]">{convite.email}</strong>
          {convite.clientes.length > 0 ? (
            <>
              {' '}
              · acesso a {convite.clientes.length}{' '}
              {convite.clientes.length === 1 ? 'cliente' : 'clientes'}
            </>
          ) : null}
        </p>
        <FormularioConvite token={token} email={convite.email} />
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Solicitar acesso</h1>
      <p className="mb-5 text-sm text-[var(--text-secondary)]">
        Sua conta é criada bloqueada e precisa ser liberada por um administrador antes do primeiro
        acesso.
      </p>
      <FormularioSolicitacao />
      <p className="mt-5 text-sm">
        <Link href="/login" className="text-[var(--text-secondary)] hover:underline">
          Já tenho conta
        </Link>
      </p>
    </>
  );
}
