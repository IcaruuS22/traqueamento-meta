import type { Guia } from './tipos';

/** Texto copiado literalmente de `painel-admin.html` (GUIAS_TUTORIAL.guiaWhatsapp). */
export const guiaWhatsappCloud: Guia = {
  id: 'whatsapp-cloud',
  numero: 4,
  titulo: 'WhatsApp Cloud API e a aba "Conversas"',
  resumo:
    'Gera o Phone Number ID, o WABA ID e o Token de Acesso usados na aba "WhatsApp" do cadastro do cliente, além do webhook que alimenta a aba "Conversas".',
  passos: [
    'No mesmo app criado no Guia 1 (Meta for Developers), adicione o produto "WhatsApp" e vincule (ou crie) uma WhatsApp Business Account (WABA).',
    'Em WhatsApp → Introdução (ou Configuração da API), anote o Phone Number ID e o WhatsApp Business Account ID (WABA ID) — são os valores dos campos "Phone Number ID" e "WhatsApp Business Account ID (WABA)" na aba WhatsApp deste painel.',
    'Em Configurações da Empresa → Usuários do Sistema, gere um Token de Sistema (System User) permanente com acesso à WABA e à permissão whatsapp_business_messaging — diferente do token temporário de teste, ele não expira em 24h. Esse é o valor do campo "Token de Acesso".',
    'No produto WhatsApp → Configuração, cadastre a URL pública do webhook do workflow n8n "WhatsApp Cloud API - Webhook" e o Verify Token combinado com a equipe técnica, depois inscreva o campo "messages".',
    '(Opcional, recomendado para testes) No Gerenciador de Eventos, aba "Test Events", copie o Test Event Code e cole no campo "Código de Teste" — assim é possível testar o envio/recebimento sem contaminar métricas reais de conversão.',
    'Envie uma mensagem de teste para o número comercial do cliente a partir de um celular pessoal e confirme, na aba "Conversas" deste painel, que ela aparece na lista — isso valida que o webhook está funcionando de ponta a ponta.',
  ],
};
