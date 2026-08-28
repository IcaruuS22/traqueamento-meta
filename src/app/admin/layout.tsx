import { Suspense } from 'react';
import { clientesDoUsuario, requireAdmin } from '@/lib/auth/guard';
import { CascaPainel } from '@/components/casca-painel';

export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const usuario = await requireAdmin();
  const clientes = await clientesDoUsuario(usuario);

  return (
    <Suspense fallback={null}>
      <CascaPainel
        usuario={usuario}
        clientes={clientes.map((c) => ({
          client_db_name: c.client_db_name,
          account_name: c.account_name,
        }))}
      >
        {children}
      </CascaPainel>
    </Suspense>
  );
}
