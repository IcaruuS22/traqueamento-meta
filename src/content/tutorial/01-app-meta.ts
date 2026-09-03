import type { Guia } from './tipos';

/** Texto copiado literalmente de `painel-admin.html` (GUIAS_TUTORIAL.guiaApp). */
export const guiaAppMeta: Guia = {
  id: 'app-meta',
  numero: 1,
  titulo: 'Criar o Aplicativo na Meta e configurar permissões',
  resumo:
    'Feito uma vez no Meta for Developers / Business Manager. É o app que dá acesso à Marketing API (Insights de campanhas) e à Conversions API.',
  passos: [
    'Acesse developers.facebook.com e crie um novo app do tipo "Empresa" (Business), vinculado ao Business Manager da agência.',
    'No painel do app, adicione os produtos "Marketing API" (para puxar Insights de campanhas) e "Conversions API" (para enviar eventos de conversão).',
    'Em Configurações → Básico, anote o App ID e o App Secret do aplicativo. Não são usados no cadastro do cliente, mas ficam guardados para qualquer configuração futura.',
    'Em Revisão do Aplicativo, solicite as permissões: ads_read (leitura de campanhas/insights), ads_management (se a agência também for gerenciar campanhas por aqui), business_management e leads_retrieval (necessária para o webhook de formulários instantâneos).',
    'Em Configurações da Empresa → Contas → Aplicativos, vincule este app ao Business Manager que administra a conta de anúncios do cliente.',
    'Gere um Token de Sistema (System User Token) de longa duração vinculado ao Business Manager, com acesso à conta de anúncios do cliente. Diferente do token de usuário comum, ele não expira em poucas horas.',
  ],
};
