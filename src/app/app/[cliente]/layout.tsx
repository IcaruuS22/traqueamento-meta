import Link from 'next/link';
import { requireClientAccessPagina } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Moldura de todas as telas de um cliente.
 *
 * `requireClientAccess` roda aqui e vale para toda a subárvore: nenhuma
 * página abaixo deste layout consegue ser renderizada para quem não tem
 * vínculo com o cliente. Cada página repete a chamada mesmo assim —
 * layouts e páginas são renderizados de forma independente no Next, e
 * confiar no layout como única barreira já foi fonte de vazamento em
 * outros projetos.
 *
 * O menu do cliente e o nome da conta ficam na casca do app (menu lateral
 * e barra superior), como no painel; aqui sobra só o aviso de status.
 */
export default async function LayoutCliente({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ cliente: string }>;
}) {
  const { cliente } = await params;
  const { usuario, conta } = await requireClientAccessPagina(decodeURIComponent(cliente));

  return (
    <>
      {/* O catálogo grava 'ACTIVE' em maiúsculo; comparar sem normalizar
          fazia todo cliente saudável exibir o aviso de desatualizado. */}
      {conta.status && !['active', 'ativo'].includes(conta.status.trim().toLowerCase()) ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Este cliente está com status <strong>{conta.status}</strong> no catálogo — os dados podem
          estar desatualizados.{' '}
          {usuario.papel === 'admin' ? (
            <Link href="/admin/usuarios" className="underline">
              Ver contas
            </Link>
          ) : null}
        </p>
      ) : null}

      {children}
    </>
  );
}
