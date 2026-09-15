import { Suspense } from 'react';
import { clientesDoUsuario, requireAuthPagina } from '@/lib/auth/guard';
import { CascaPainel } from '@/components/casca-painel';
import { produtosParaMenu } from '@/lib/db/cliente';

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  // O middleware já barra quem não está logado, mas a checagem se repete
  // aqui de propósito: middleware protege navegação, guard protege dados.
  const usuario = await requireAuthPagina();
  const [clientes, produtos] = await Promise.all([clientesDoUsuario(usuario), produtosParaMenu()]);

  return (
    // A casca lê `useSearchParams` (período, canal, busca); sem o Suspense
    // o build estático da rota quebraria.
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
