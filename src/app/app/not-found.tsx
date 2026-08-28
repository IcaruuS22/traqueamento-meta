import Link from 'next/link';

/**
 * Tela de "não encontrado" da área logada.
 *
 * É para cá que cai `requireClientAccessPagina` quando o cliente da URL
 * não existe OU existe e não é da pessoa — os dois casos de propósito
 * com a mesma resposta. O texto não confirma nem nega a existência do
 * cliente: trocar o nome na URL não pode virar uma forma de descobrir
 * quais clientes o sistema tem.
 */
export default function NaoEncontrado() {
  return (
    <div className="card mx-auto max-w-md p-6 text-center">
      <h1 className="mb-2 text-lg font-semibold">Página não disponível</h1>
      <p className="mb-5 text-sm text-[var(--text-secondary)]">
        Esta página não existe ou sua conta não tem acesso a ela. Se você deveria ter acesso a este
        cliente, peça a liberação a um administrador.
      </p>
      <Link
        href="/app"
        className="inline-block rounded-[var(--radius-control)] bg-[var(--bg-field)] px-4 py-2 text-sm font-medium"
      >
        Voltar para meus clientes
      </Link>
    </div>
  );
}
