import type { Metadata } from 'next';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { listaMapeamentosWhatsapp } from '@/lib/db/mapeamentos';
import { ConfigEventosWhatsapp } from '@/components/config-eventos';
import { PageHero } from '@/components/hero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Estágios do WhatsApp | Trakeamento' };

/**
 * Estágios do funil de Conversas — porte de
 * `GET /painel-api/whatsapp-eventos` e das duas ações de escrita.
 *
 * Diferente do funil do formulário, os estágios daqui não vêm de lugar
 * nenhum: quem cadastra é o próprio cliente. As sete linhas sugeridas
 * nascem na criação do cliente e podem ser renomeadas, excluídas ou
 * ampliadas à vontade — o nome do estágio é o mesmo valor gravado em
 * `whatsapp_conversations.status`.
 */
export default async function PaginaEstagiosWhatsapp({
  params,
}: {
  params: Promise<{ cliente: string }>;
}) {
  const { cliente } = await params;
  // A checagem se repete aqui mesmo já existindo no layout: no Next,
  // layout e página são renderizados de forma independente.
  const { conta, db } = await requireClientAccessPagina(decodeURIComponent(cliente));

  const { itens, lacunas_de_esquema } = await listaMapeamentosWhatsapp(db);

  return (
    <>
      <PageHero
        titulo="Configuração de Eventos (WhatsApp)"
        descricao="Mapeie cada estágio do funil de Conversas WhatsApp para um evento enviado à Meta CAPI."
      />

      {lacunas_de_esquema.length ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O banco deste cliente está atrás do template. Falta:{' '}
          <strong>{lacunas_de_esquema.join(', ')}</strong>. Enquanto isso, salvar aqui vai falhar.
        </p>
      ) : null}

      <ConfigEventosWhatsapp cliente={conta.client_db_name} itens={itens} />
    </>
  );
}
