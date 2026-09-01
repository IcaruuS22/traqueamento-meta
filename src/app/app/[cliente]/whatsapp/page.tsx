import type { Metadata } from 'next';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { buscaConfigWhatsapp } from '@/lib/db/whatsapp';
import { env } from '@/lib/env';
import { fmtDataHora } from '@/lib/format';
import { EscolhaConexao, type OpcaoConexao } from '@/components/escolha-conexao';
import { FormConexaoEvolution } from '@/components/form-conexao-evolution';
import { FormConexaoWhatsapp } from '@/components/form-conexao-whatsapp';
import { IconesNav } from '@/components/icones';
import { PageHero } from '@/components/hero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Conexão WhatsApp — Trakeamento' };

/**
 * Conexão do WhatsApp — porte de `GET /painel-api/whatsapp-config` e de
 * `POST /painel-api/whatsapp-salvar`, mais a conexão por Evolution API.
 *
 * As duas integrações aparecem como cartão, e o formulário de cada uma só
 * abre depois da escolha. Antes os dois vinham abertos na tela, um
 * embaixo do outro: o cliente usa uma só, e a fileira de campos da outra
 * não dizia nem que integração era aquela nem que ela não estava em uso.
 * A inativa continua visível de propósito — escondê-la deixaria o usuário
 * sem entender por que a outra parou de responder.
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

  const cloudConfigurada = Boolean(config.cloud_phone_number_id || config.token_cadastrado);

  const opcaoCloud: OpcaoConexao = {
    id: 'cloud',
    titulo: 'WhatsApp Cloud API (Meta)',
    descricao:
      'Conexão oficial da Meta: captura as conversas iniciadas por anúncio e envia o evento de Contato para a CAPI.',
    requisitos: [
      'Phone Number ID e token permanente do System User',
      'Dataset do pixel de mensagens, separado do pixel do site',
      'Responder só dentro da janela de 24 horas da Meta',
    ],
    estado: usaEvolution ? (cloudConfigurada ? 'configurada' : 'disponivel') : 'em-uso',
    icone: <IconesNav.whatsapp />,
    rotuloAcao: cloudConfigurada ? 'Editar dados' : 'Configurar',
    formulario: (
      <>
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
      </>
    ),
  };

  // Formulário só quando há onde gravar. Enquanto a migração não roda,
  // qualquer botão cairia na mesma coluna inexistente e voltaria erro —
  // o modal explica o que falta em vez de oferecer a ação.
  const opcaoEvolution: OpcaoConexao = {
    id: 'evolution',
    titulo: 'Evolution API',
    descricao:
      'Conexão por QR Code, no seu servidor: lê o WhatsApp do celular e responde pelo painel sem a janela de 24 horas.',
    requisitos: [
      'Servidor da Evolution acessível pela internet',
      'URL e chave da API (AUTHENTICATION_API_KEY)',
      'Celular em mãos para ler o QR Code',
    ],
    estado: !config.evolution_disponivel
      ? 'indisponivel'
      : usaEvolution
        ? 'em-uso'
        : config.evolution.criada
          ? 'configurada'
          : 'disponivel',
    icone: <IconesNav.qrcode />,
    rotuloAcao: !config.evolution_disponivel
      ? 'Ver o que falta'
      : config.evolution.criada
        ? 'Gerenciar conexão'
        : 'Conectar por QR Code',
    formulario: config.evolution_disponivel ? (
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
    ),
  };

  return (
    <>
      <PageHero
        titulo="Conexão do WhatsApp"
        descricao="Escolha por onde este cliente atende no WhatsApp. Vale uma integração por vez, e os dados de cada uma são pedidos depois da escolha."
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
        Conectar a Evolution passa o cliente para ela; “Remover conexão” devolve o cliente para a
        Cloud API sem apagar nada do que já foi cadastrado lá.
      </p>

      {/* Em uso primeiro: é a integração que está respondendo hoje. */}
      <EscolhaConexao
        opcoes={usaEvolution ? [opcaoEvolution, opcaoCloud] : [opcaoCloud, opcaoEvolution]}
      />
    </>
  );
}
