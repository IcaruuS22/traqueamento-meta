import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guard';
import { contaVinculosPorCliente, listaAdAccounts } from '@/lib/db/cliente';
import { leInvestimentosMensais } from '@/lib/db/orcamento';
import { PageHero } from '@/components/hero';
import { ExcluirCliente } from './excluir-cliente';
import { InvestimentoMensal } from './investimento-mensal';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Clientes | Trakeamento' };

/**
 * Lista de clientes do administrador.
 *
 * Diferente de `/app`, que é o seletor de quem vai olhar métricas: aqui
 * o assunto é o cadastro em si — o que existe no catálogo, para qual
 * banco aponta, quantos usuários enxergam, e a exclusão.
 */
export default async function PaginaClientesAdmin() {
  await requireAdmin();

  const [clientes, vinculos, investimentos] = await Promise.all([
    listaAdAccounts(),
    contaVinculosPorCliente(),
    leInvestimentosMensais(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHero
        titulo="Clientes"
        descricao="Todo cliente cadastrado no catálogo central, com o banco isolado para onde aponta."
        acoes={
          <Link href="/admin/clientes/novo" className="btn btn-primary">
            + Novo Cliente
          </Link>
        }
      />

      {clientes.length === 0 ? (
        <p className="empty-msg">Nenhum cliente cadastrado ainda.</p>
      ) : (
        clientes.map((cliente) => {
          const usuarios = vinculos[cliente.client_db_name] ?? 0;
          return (
            <div key={cliente.client_db_name} className="card space-y-3 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-medium">{cliente.account_name}</h2>
                <span
                  className={`status-badge ${cliente.status === 'ACTIVE' ? 'active' : 'inactive'}`}
                >
                  {cliente.status}
                </span>
              </div>

              <dl className="grid gap-x-6 gap-y-1 text-xs text-[var(--text-tertiary)] sm:grid-cols-2">
                <div>
                  Ad Account: <span className="text-[var(--text-secondary)]">{cliente.ad_account_id}</span>
                </div>
                <div>
                  CRM Account:{' '}
                  <span className="text-[var(--text-secondary)]">{cliente.crm_account_id ?? '-'}</span>
                </div>
                <div>
                  Banco: <code>{cliente.client_db_name}</code>
                </div>
                <div>
                  Usuários vinculados:{' '}
                  <span className="text-[var(--text-secondary)]">{usuarios}</span>
                </div>
              </dl>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/app/${encodeURIComponent(cliente.client_db_name)}/visao-geral`}
                  className="btn-ghost px-2 py-1 text-xs"
                >
                  Abrir painel
                </Link>
              </div>

              <InvestimentoMensal
                banco={cliente.client_db_name}
                investimento={investimentos.get(cliente.client_db_name) ?? null}
              />

              <ExcluirCliente nome={cliente.account_name} banco={cliente.client_db_name} />
            </div>
          );
        })
      )}
    </div>
  );
}
