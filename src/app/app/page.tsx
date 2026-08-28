import Link from 'next/link';
import type { Metadata } from 'next';
import { clientesDoUsuario, requireAuth } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Clientes — Trakeamento' };

// Lista sempre viva: o catálogo muda quando um cliente é criado.
export const dynamic = 'force-dynamic';

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const usuario = await requireAuth();
  const todos = await clientesDoUsuario(usuario);

  // `q` vem da busca da barra superior — mesma filtragem do painel: nome,
  // Ad Account ou CRM Account.
  const bruto = (await searchParams).q;
  const termo = (Array.isArray(bruto) ? bruto[0] : (bruto ?? '')).trim().toLowerCase();
  const clientes = termo
    ? todos.filter(
        (c) =>
          (c.account_name ?? '').toLowerCase().includes(termo) ||
          String(c.ad_account_id ?? '')
            .toLowerCase()
            .includes(termo) ||
          String(c.crm_account_id ?? '')
            .toLowerCase()
            .includes(termo),
      )
    : todos;

  return (
    <>
      <div className="page-hero">
        <div className="page-hero-top">
          <div>
            <h1 className="text-heading-page">Selecione um Cliente</h1>
            <p className="text-body-regular text-tertiary">
              Cada cliente tem seus dados totalmente isolados. Selecione um para abrir o dashboard.
            </p>
          </div>
          {usuario.papel === 'admin' ? (
            <div className="page-hero-actions">
              <Link href="/admin/clientes/novo" className="btn btn-primary">
                + Novo Cliente
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      {clientes.length === 0 ? (
        <p className="empty-msg">
          {termo
            ? 'Nenhum cliente encontrado para esta busca.'
            : usuario.papel === 'admin'
              ? 'Nenhum cliente cadastrado ainda.'
              : 'Sua conta ainda não está vinculada a nenhum cliente. Peça a liberação a um administrador.'}
        </p>
      ) : (
        <div className="client-grid">
          {clientes.map((cliente) => (
            <Link
              key={cliente.client_db_name}
              href={`/app/${encodeURIComponent(cliente.client_db_name)}/visao-geral`}
              className="client-card"
            >
              <p className="name">{cliente.account_name}</p>
              <p className="meta">Ad Account: {cliente.ad_account_id}</p>
              <p className="meta">CRM Account: {cliente.crm_account_id}</p>
              {cliente.content_category ? <p className="meta">{cliente.content_category}</p> : null}
              <span
                className={`status-badge ${cliente.status === 'ACTIVE' ? 'active' : 'inactive'}`}
              >
                {cliente.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
