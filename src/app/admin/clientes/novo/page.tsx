import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guard';
import { ClienteForm } from './cliente-form';
import { PageHero } from '@/components/hero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Novo cliente — Trakeamento' };

/**
 * Cadastro de cliente novo, exclusivo de administrador.
 *
 * Substitui `novo-cliente-form.html`, que era uma página solta chamando
 * um webhook do n8n sem autenticação nenhuma — quem tivesse a URL
 * cadastrava cliente. O `requireAdmin()` do layout de /admin, mais o
 * `requireAdmin()` dentro da própria Server Action, fecham isso.
 */
export default async function PaginaNovoCliente() {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHero
        titulo="Novo cliente"
        descricao="Cria o banco isolado do cliente e registra a conta no catálogo central. Os mapeamentos de evento e a conexão do WhatsApp são configurados depois, nas telas do próprio cliente."
      />

      <div className="card p-5">
        <ClienteForm />
      </div>

      <p className="text-sm text-[var(--text-tertiary)]">
        Não sabe onde achar o token ou o ID do pixel? Veja o{' '}
        <Link href="/app/tutorial" className="underline">
          tutorial de credenciais
        </Link>
        .
      </p>
    </div>
  );
}
