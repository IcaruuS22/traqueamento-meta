import type { Metadata } from 'next';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { LacunasDeEsquema } from '@/lib/db/pool';
import { leCampanhasClassificaveis, leCategoriasVerba } from '@/lib/db/orcamento';
import { PageHero } from '@/components/hero';
import { GestaoVerba } from '@/components/gestao-verba';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Verba por categoria | Trakeamento' };

/**
 * Tela onde a verba é dividida em frentes e as campanhas são atribuídas a
 * elas.
 *
 * As duas metades do assunto ficam juntas de propósito: cadastrar
 * "Remarketing — R$ 1.200" e não dizer quais campanhas são de remarketing
 * deixa a categoria com verba e sem gasto, e o card da Visão geral passa a
 * mentir de um jeito difícil de perceber. Na mesma tela, a lista de
 * campanhas sem categoria fica à vista logo abaixo do formulário.
 *
 * O objetivo da Meta aparece em cada campanha e serve de filtro. Não é a
 * categoria — duas campanhas de "Cadastros" podem ser uma de captação e
 * outra de remarketing — mas é o que torna a classificação viável numa
 * conta com dezenas de campanhas: filtra por objetivo, marca todas,
 * atribui de uma vez, corrige as exceções depois.
 */
export default async function PaginaVerbaPorCategoria({
  params,
}: {
  params: Promise<{ cliente: string }>;
}) {
  const { cliente } = await params;
  const { usuario, conta, db } = await requireClientAccessPagina(decodeURIComponent(cliente));

  // As duas leituras compartilham o coletor: banco sem a migração das
  // categorias derruba as duas listas do mesmo jeito, e a tela avisa uma
  // vez só em vez de aparecer meio quebrada.
  const lacunas = new LacunasDeEsquema();
  const [categorias, campanhas] = await Promise.all([
    leCategoriasVerba(conta.client_db_name, lacunas),
    leCampanhasClassificaveis(db, conta.client_db_name, lacunas),
  ]);

  return (
    <>
      <PageHero
        titulo="Verba por categoria"
        descricao="Divida o investimento mensal entre as frentes de campanha e diga a qual frente cada campanha pertence."
      />

      {lacunas.lista().length ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O banco ainda não tem tudo o que esta tela usa. Falta:{' '}
          <strong>{lacunas.lista().join(', ')}</strong>. Rode{' '}
          <code>Banco de Dados/migracao_verba_por_categoria.sql</code> no banco central.
        </p>
      ) : null}

      <GestaoVerba
        cliente={conta.client_db_name}
        categorias={categorias}
        campanhas={campanhas}
        podeEditarVerba={usuario.papel === 'admin'}
      />
    </>
  );
}
