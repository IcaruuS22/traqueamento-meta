import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * A visão geral do cliente mora em `/app/[cliente]/visao-geral`, não direto
 * na raiz do segmento `[cliente]`.
 *
 * O motivo é um sintoma observado no App Router do Next: com a visão geral
 * na URL exata do segmento dinâmico, a PRIMEIRA troca de período depois do
 * carregamento (navegação que muda só a query string) se perdia — a URL não
 * mudava e o seletor voltava sozinho. As abas com segmento de caminho
 * próprio (`/campanhas`, `/formularios/...`) nunca mostraram isso. Dar à
 * visão geral o seu próprio segmento (`/visao-geral`) alinha o comportamento
 * com o das outras abas. Grupos de rota `(...)` não serviriam: não criam
 * segmento de URL, e é a URL que distingue uma aba da outra para o roteador.
 *
 * A raiz `/app/[cliente]` vira só um ponto de entrada que redireciona,
 * preservando o período compartilhado por link antigo.
 */
export default async function PaginaClienteRaiz({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;

  const qs = new URLSearchParams();
  for (const [chave, valor] of Object.entries(busca)) {
    if (valor === undefined) continue;
    qs.set(chave, Array.isArray(valor) ? (valor[0] ?? '') : valor);
  }
  const query = qs.toString();
  redirect(`/app/${cliente}/visao-geral${query ? `?${query}` : ''}`);
}
