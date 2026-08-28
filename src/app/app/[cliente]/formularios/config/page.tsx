import type { Metadata } from 'next';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { listaMapeamentosForm } from '@/lib/db/mapeamentos';
import { ConfigEventosForm } from '@/components/config-eventos';
import { PageHero } from '@/components/hero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Configuração de eventos — Trakeamento' };

/**
 * Configuração de eventos do Formulário Instantâneo — porte de
 * `GET /painel-api/eventos` e das duas ações de escrita.
 *
 * Esta tela é o que liga o funil do Kommo à Meta: sem uma linha aqui, o
 * lead muda de estágio e nada é enviado. Por isso ela não tem seletor de
 * período — não é relatório, é configuração.
 */
export default async function PaginaConfigEventos({
  params,
}: {
  params: Promise<{ cliente: string }>;
}) {
  const { cliente } = await params;
  // A checagem se repete aqui mesmo já existindo no layout: no Next,
  // layout e página são renderizados de forma independente.
  const { conta, db } = await requireClientAccessPagina(decodeURIComponent(cliente));

  const { itens, lacunas_de_esquema } = await listaMapeamentosForm(db);

  return (
    <>
      <PageHero
        titulo="Configuração de Eventos"
        descricao="Mapeie cada etapa do funil do Kommo para um evento enviado à Meta CAPI."
      />

      {lacunas_de_esquema.length ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O banco deste cliente está atrás do template — falta:{' '}
          <strong>{lacunas_de_esquema.join(', ')}</strong>. Enquanto isso, salvar aqui vai falhar.
        </p>
      ) : null}

      <ConfigEventosForm cliente={conta.client_db_name} itens={itens} />
    </>
  );
}
