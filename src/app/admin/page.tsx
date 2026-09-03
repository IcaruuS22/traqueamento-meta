import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guard';
import { PageHero } from '@/components/hero';
import { Icones, IconesNav } from '@/components/icones';

export const metadata: Metadata = { title: 'Administração | Trakeamento' };

/**
 * Página de administração.
 *
 * As duas telas de administrador ocupavam uma seção própria do menu
 * lateral, ao lado das seções do cliente aberto. São tarefas de outra
 * natureza — não olham métricas de ninguém — e ficavam disputando espaço
 * com a navegação que se usa o dia inteiro. Aqui elas viram uma página
 * só, e o menu guarda uma entrada em vez de três linhas.
 */

const ATALHOS = [
  {
    href: '/admin/usuarios',
    titulo: 'Usuários',
    descricao: 'Quem entra no painel, com qual papel e para quais clientes.',
    icone: IconesNav.usuarios,
  },
  {
    href: '/admin/clientes',
    titulo: 'Clientes',
    descricao: 'O que existe no catálogo, para qual banco aponta e a exclusão de cliente.',
    icone: IconesNav.clientes,
  },
  {
    href: '/admin/clientes/novo',
    titulo: 'Novo cliente',
    descricao:
      'Cria o banco isolado do cliente e registra a conta no catálogo central.',
    icone: IconesNav.novoCliente,
  },
];

export default async function PaginaAdmin() {
  await requireAdmin();

  return (
    <>
      <PageHero
        titulo="Administração"
        descricao="Cadastro de usuários e de clientes novos. As configurações de evento e a conexão do WhatsApp ficam nas telas de cada cliente."
      />

      <div className="panel-grid">
        {ATALHOS.map((a) => {
          const Icone = a.icone;
          return (
            <Link key={a.href} href={a.href} className="card admin-shortcut">
              <span className="admin-shortcut-icon">
                <Icone />
              </span>
              <span className="admin-shortcut-title">{a.titulo}</span>
              <span className="admin-shortcut-desc">{a.descricao}</span>
              <span className="admin-shortcut-abrir">
                Abrir
                <Icones.chevronRight />
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
