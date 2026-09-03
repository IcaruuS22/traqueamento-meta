import type { Guia } from './tipos';

/** Texto copiado literalmente de `painel-admin.html` (GUIAS_TUTORIAL.guiaWebhook). */
export const guiaWebhookLeadgen: Guia = {
  id: 'webhook-leadgen',
  numero: 3,
  titulo: 'Webhook da Meta, Token Permanente e Cadastro de Página',
  resumo:
    'Liga a Página do Facebook ao fluxo que recebe os leads. É o passo que faz o formulário instantâneo preenchido virar linha no banco.',
  aviso:
    'Só cadastrar o cliente no painel não é suficiente. Sem o webhook configurado e a página inscrita no evento "leadgen", os formulários instantâneos preenchidos na Meta nunca chegam até a nossa base de dados.',
  passos: [
    'No Business Manager, em Configurações da Empresa → Contas → Páginas, confirme que a agência tem acesso de administrador à Página do Facebook vinculada aos anúncios de formulário instantâneo do cliente.',
    'No aplicativo criado no Guia 1, adicione o produto "Webhooks".',
    'Configure o webhook para o objeto "Page", campo "leadgen", apontando para a URL pública do workflow n8n que recebe leads (o mesmo endpoint usado pelo workflow "01 - Recebe leads - Meta").',
    'Gere/confirme um Token de Acesso Permanente de Página (Page Access Token de longa duração, vinculado ao System User do Guia 1). É ele que o n8n usa para buscar os dados completos do lead a partir do leadgen_id recebido no webhook.',
    'Inscreva a Página especificamente no evento "leadgen" (Page Subscriptions dentro do app). Sem essa inscrição específica, o webhook não dispara mesmo já configurado.',
    'Envie um lead de teste (a Meta oferece a opção "Testar formulário" no Gerenciador de Formulários de Leads) e confirme no histórico de execuções do n8n que o webhook disparou e o lead chegou até a nossa base de dados.',
  ],
};
