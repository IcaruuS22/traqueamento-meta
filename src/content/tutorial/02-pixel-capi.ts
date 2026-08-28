import type { Guia } from './tipos';

/** Texto copiado literalmente de `painel-admin.html` (GUIAS_TUTORIAL.guiaPixel). */
export const guiaPixelCapi: Guia = {
  id: 'pixel-capi',
  numero: 2,
  titulo: 'Configurar o Pixel do Facebook para a API de Conversões (CAPI)',
  resumo:
    'Gera o Pixel/Dataset ID e o Access Token usados nos campos "Meta Pixel / Dataset ID (CAPI)" e "Meta Access Token (CAPI)" no cadastro do cliente.',
  passos: [
    'No Gerenciador de Eventos (Events Manager) da Meta, crie uma fonte de dados do tipo "Conjunto de dados" / Pixel (ou reutilize um já existente do cliente) e anote o Pixel ID / Dataset ID.',
    'Se o cliente já tiver site com o Pixel instalado no navegador, não é necessário reinstalar — este projeto envia os eventos por CAPI (servidor), então o pixel de navegador é opcional/complementar.',
    'Em Configurações → Conversions API, gere um Token de Acesso permanente para este pixel/dataset. Esse é o valor que vai no campo "Meta Access Token (CAPI)" do cadastro do cliente.',
    'Copie o Pixel/Dataset ID e o Access Token gerados para os campos "Meta Pixel / Dataset ID (CAPI)" e "Meta Access Token (CAPI)" no formulário de cadastro deste cliente no painel.',
    'Recomendado: use a aba "Test Events" do Gerenciador de Eventos para conferir, em tempo real, que os eventos enviados pela automação estão chegando corretamente antes de validar a configuração como concluída.',
    'Se o cliente também usa o Pixel no navegador (client-side) além da CAPI, verifique a deduplicação de eventos — a automação já gera e envia um event_id próprio por evento, usado nos dois lados para evitar contagem duplicada.',
  ],
};
