import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guard';
import { listaAdAccounts } from '@/lib/db/cliente';
import { listaConvitesPendentes, listaUsuarios } from '@/lib/auth/usuarios';
import { ConviteForm } from './convite-form';
import { LinhaUsuario } from './linha-usuario';
import { PageHero } from '@/components/hero';

export const metadata: Metadata = { title: 'Usuários — Trakeamento' };
export const dynamic = 'force-dynamic';

export default async function PaginaUsuarios() {
  const admin = await requireAdmin();

  const [usuarios, contas, convites] = await Promise.all([
    listaUsuarios(),
    listaAdAccounts(),
    listaConvitesPendentes(),
  ]);

  const clientes = contas.map((c) => ({
    nome: c.client_db_name,
    rotulo: `${c.account_name} (${c.client_db_name})`,
  }));

  const pendentes = usuarios.filter((u) => u.status === 'pendente');

  return (
    <>
      <PageHero
        titulo="Usuários"
        descricao="Quem entra no painel, com qual papel e para quais clientes."
      />

      {pendentes.length > 0 ? (
        <section className="card mb-6 p-4">
          <h2 className="mb-1 text-sm font-semibold">
            {pendentes.length} solicitação{pendentes.length > 1 ? 'ões' : ''} aguardando liberação
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Contas criadas pela tela de solicitação não têm acesso a nada até serem liberadas e
            vinculadas a um cliente.
          </p>
        </section>
      ) : null}

      <section className="card mb-6 p-5">
        <h2 className="mb-4 text-base font-semibold">Convidar</h2>
        <ConviteForm clientes={clientes} />
      </section>

      <section className="card mb-6">
        <h2 className="border-b px-4 py-3 text-base font-semibold">
          Contas <span className="text-[var(--text-tertiary)]">({usuarios.length})</span>
        </h2>
        {usuarios.length === 0 ? (
          <p className="p-4 text-sm text-[var(--text-secondary)]">Nenhuma conta cadastrada.</p>
        ) : (
          usuarios.map((u) => (
            <LinhaUsuario
              key={u.id}
              usuario={{
                id: u.id,
                email: u.email,
                name: u.name,
                role: u.role,
                status: u.status,
                last_login_at: u.last_login_at,
                clientes: u.clientes,
              }}
              clientes={clientes}
              ehVoceMesmo={u.id === admin.id}
            />
          ))
        )}
      </section>

      <section className="card">
        <h2 className="border-b px-4 py-3 text-base font-semibold">
          Convites pendentes <span className="text-[var(--text-tertiary)]">({convites.length})</span>
        </h2>
        {convites.length === 0 ? (
          <p className="p-4 text-sm text-[var(--text-secondary)]">
            Nenhum convite aguardando cadastro.
          </p>
        ) : (
          <ul>
            {convites.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3 text-sm last:border-b-0"
              >
                <span className="flex-1 font-medium">{c.email}</span>
                <span className="text-xs text-[var(--text-tertiary)]">{c.role}</span>
                <span className="text-xs text-[var(--text-tertiary)]">
                  {(c.client_db_names ?? []).length} cliente(s)
                </span>
                <span className="text-xs text-[var(--text-tertiary)]">
                  expira em {new Date(c.expires_at).toLocaleDateString('pt-BR')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
