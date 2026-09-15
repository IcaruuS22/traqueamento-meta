import { redirect } from 'next/navigation';

/**
 * Endereço antigo da configuração dos sites. Ela mudou para dentro do
 * painel do cliente (Página de vendas › Configuração); o redirecionamento
 * mantém funcionando links salvos e mensagens antigas.
 */
export default async function PaginaSitesAdmin({ params }: { params: Promise<{ cliente: string }> }) {
  const { cliente } = await params;
  redirect(`/app/${encodeURIComponent(decodeURIComponent(cliente))}/paginas/config`);
}
