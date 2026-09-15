import { Suspense } from 'react';
import { clientesDoUsuario, requireAdminPagina } from '@/lib/auth/guard';
import { CascaPainel } from '@/components/casca-painel';
import { produtosParaMenu } from '@/lib/db/cliente';

export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const usuario = await requireAdminPagina();
  const [clientes, produtos] = await Promise.all([clientesDoUsuario(usuario), produtosParaMenu()]);

  return (
    <Suspense fallback={null}>
      <CascaPainel
        usuario={usuario}
        clientes={clientes.map((c) => ({
          client_db_name: c.client_db_name,
          account_name: c.account_name,
          produtos: produtos?.get(c.client_db_name)?.produtos ?? null,
        }))}
      >
        {children}
      </CascaPainel>
    </Suspense>
  );
}
