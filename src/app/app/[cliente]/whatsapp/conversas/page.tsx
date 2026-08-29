import type { Metadata } from 'next';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { listaConversas } from '@/lib/db/conversas';
import { buscaConfigWhatsapp } from '@/lib/db/whatsapp';
import { listaMapeamentosWhatsapp } from '@/lib/db/mapeamentos';
import { TelaConversas } from '@/components/tela-conversas';
import { FAIXA_PADRAO } from '@/lib/whatsapp-conversas';
import { PageHero } from '@/components/hero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Conversas — Trakeamento' };

/**
 * Conversas do WhatsApp — porte da aba "Conversas" do painel antigo.
 *
 * A primeira lista vem renderizada daqui para a tela já abrir com
 * conteúdo; a partir daí quem atualiza é o componente, por `/api/conversas`.
 *
 * Os estágios do seletor saem de `whatsapp_event_map`, a mesma tabela da
 * tela "Estágios e eventos" — não de uma lista fixa no código.
 */
export default async function PaginaConversas({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;

  // `?lead=` abre a tela já com a conversa daquele contato — é o link
  // que o card do CRM usa. Valor inválido é ignorado, não repassado.
  const leadBruto = Array.isArray(busca.lead) ? busca.lead[0] : busca.lead;
  const leadInicial = Number.parseInt(String(leadBruto ?? ''), 10);
  const { usuario, conta, db } = await requireClientAccessPagina(decodeURIComponent(cliente));

  const [conversas, mapeamentos, config] = await Promise.all([
    // Mesma faixa em que a tela abre: sem isto a primeira lista viria
    // completa e as conversas fechadas sumiriam na primeira atualização.
    listaConversas(db, { faixa: FAIXA_PADRAO }),
    listaMapeamentosWhatsapp(db),
    buscaConfigWhatsapp(conta.client_db_name),
  ]);

  const lacunas = [
    ...new Set([...conversas.lacunas_de_esquema, ...mapeamentos.lacunas_de_esquema]),
  ];

  return (
    <>
      <PageHero
        titulo="Conversas"
        descricao={
          config.provider === 'evolution'
            ? 'Histórico de conversas de WhatsApp. Responda direto por aqui — pela Evolution API não há janela de 24h, porque a restrição é da Cloud API da Meta.'
            : 'Histórico de conversas de WhatsApp iniciadas por anúncio. Responda direto por aqui — dentro da janela de 24h após a última mensagem do lead, conforme a regra da Meta para mensagens livres.'
        }
      />

      {lacunas.length ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O banco deste cliente está atrás do template — falta:{' '}
          <strong>{lacunas.join(', ')}</strong>. As conversas só aparecem depois da migração.
        </p>
      ) : null}

      <TelaConversas
        cliente={conta.client_db_name}
        estagios={mapeamentos.itens.map((m) => m.estagio)}
        iniciaisConversas={conversas.itens}
        leadInicial={Number.isSafeInteger(leadInicial) && leadInicial > 0 ? leadInicial : null}
        provider={config.provider}
        podeExcluir={usuario.papel === 'admin'}
      />
    </>
  );
}
