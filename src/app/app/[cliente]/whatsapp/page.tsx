import type { Metadata } from 'next';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { buscaConfigWhatsapp } from '@/lib/db/whatsapp';
import { env } from '@/lib/env';
import { fmtDataHora } from '@/lib/format';
import { Card } from '@/components/dados';
import { FormConexaoEvolution } from '@/components/form-conexao-evolution';
import { FormConexaoWhatsapp } from '@/components/form-conexao-whatsapp';
import { PageHero } from '@/components/hero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Conexão WhatsApp — Trakeamento' };

/**
 * Conexão do WhatsApp — porte de `GET /painel-api/whatsapp-config` e de
 * `POST /painel-api/whatsapp-salvar`, mais a conexão por Evolution API.
 *
 * As duas conexões aparecem juntas de propósito: o cliente tem uma só, e
 * qual delas vale é a coluna `provider`. Esconder a inativa deixaria o
 * usuário sem entender por que a outra parou de responder. A conexão em
 * uso vem primeiro e leva o rótulo "em uso".
 *
 * Nenhum segredo chega a esta tela — nem o token da Cloud API, nem a chave
 * da Evolution, nem mascarados com os últimos dígitos. São credenciais de
 * terceiro guardadas em texto puro no banco (ver ARQUITETURA_APP.md, seção
 * 3.3), e a única informação que a tela dá sobre elas é se existem. Por
 * isso os campos nascem vazios e vazio significa "manter o que está lá".
 */

export default async function PaginaWhatsapp({
  params,
}: {
  params: Promise<{ cliente: string }>;
}) {
  const { cliente } = await params;
  // A checagem se repete aqui mesmo já existindo no layout: no Next,
  // layout e página são renderizados de forma independente.
  const { conta } = await requireClientAccessPagina(decodeURIComponent(cliente));

  const config = await buscaConfigWhatsapp(conta.client_db_name);
  const usaEvolution = config.provider === 'evolution';
  const urlWebhook = `${env.evolution.webhookBaseUrl}/api/webhooks/evolution`;

  const cardCloud = (
    <Card titulo={`WhatsApp Cloud API (Meta)${usaEvolution ? '' : ' — em uso'}`}>
      <FormConexaoWhatsapp
        cliente={conta.client_db_name}
        inicial={{
          cloud_phone_number_id: config.cloud_phone_number_id,
          cloud_waba_id: config.cloud_waba_id,
          meta_test_event_code: config.meta_test_event_code,
          token_cadastrado: config.token_cadastrado,
          capi: config.capi,
        }}
      />
      <p className="mt-4 text-body-small text-tertiary">
        {config.token_cadastrado
          ? 'Token de acesso: cadastrado. O valor nunca sai do servidor — nem para esta tela.'
          : 'Token de acesso: não cadastrado.'}
        {config.updated_at ? ` Última alteração em ${fmtDataHora(config.updated_at)}.` : ''}
      </p>
    </Card>
  );

  // Formulário só quando há onde gravar. Enquanto a migração não roda,
  // qualquer botão do card cairia na mesma coluna inexistente e voltaria
  // erro — o card explica o que falta em vez de oferecer a ação.
  const cardEvolution = (
    <Card titulo={`Evolution API${usaEvolution ? ' — em uso' : ''}`}>
      {config.evolution_disponivel ? (
        <FormConexaoEvolution
          cliente={conta.client_db_name}
          inicial={config.evolution}
          urlWebhook={urlWebhook}
        />
      ) : (
        <div className="space-y-3 text-body-small text-tertiary">
          <p>
            Conexão por QR Code indisponível neste banco: o catálogo ainda não tem as colunas da
            Evolution. Rode <code>migracao_whatsapp_evolution.sql</code> no banco{' '}
            <code>trakeamento_controle</code> e recarregue esta página.
          </p>
          <p>
            Nada do que já está configurado se perde com a migração — ela só acrescenta colunas a{' '}
            <code>whatsapp_accounts</code>.
          </p>
        </div>
      )}
    </Card>
  );

  return (
    <>
      <PageHero
        titulo="Conexão do WhatsApp"
        descricao={
          usaEvolution
            ? 'Este cliente atende pela Evolution API: as mensagens chegam pelo webhook e as respostas saem pelo painel, sem a janela de 24h da Meta.'
            : 'Conexão oficial da Meta (Cloud API) para capturar conversas de WhatsApp iniciadas por anúncios e disparar o evento de Contato para a Meta CAPI.'
        }
      />

      {config.lacunas_de_esquema.length ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O catálogo está atrás do template — falta:{' '}
          <strong>{config.lacunas_de_esquema.join(', ')}</strong>. Sem isso não dá para saber se
          este cliente tem WhatsApp conectado. Para a conexão por Evolution, rode{' '}
          <code>migracao_whatsapp_evolution.sql</code>.
        </p>
      ) : null}

      <p className="mb-4 text-body-small text-tertiary">
        {config.configurado
          ? `Conexão configurada por ${usaEvolution ? 'Evolution API' : 'Cloud API'}${
              config.status ? ` (status: ${config.status})` : ''
            }.`
          : 'Nenhuma conexão de WhatsApp configurada para este cliente ainda.'}{' '}
        Só uma das duas vale por vez. Conectar a Evolution passa o cliente para ela; “Remover
        conexão” devolve o cliente para a Cloud API sem apagar nada do que já foi cadastrado lá.
      </p>

      <div className="space-y-6">
        {usaEvolution ? cardEvolution : cardCloud}
        {usaEvolution ? cardCloud : cardEvolution}
      </div>
    </>
  );
}
