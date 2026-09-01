/**
 * Tratamento de números de telefone.
 *
 * A regra é a mesma que o fluxo do n8n já aplica em produção — em
 * `Formulários Instantâneos/build_event_workflow.js` (`normalizePhone`) e
 * em `WhatsApp/build_whatsapp_cloud_workflow.js`
 * (`normalizeWhatsappPhone`): tira tudo que não é dígito e coloca o 55 na
 * frente quando ele não veio. Repetir a regra aqui é de propósito. Se o
 * app normalizasse de outro jeito, o mesmo lead entraria com dois
 * formatos de telefone dependendo de a mensagem ter passado pelo n8n ou
 * pelo webhook deste app, e o CRM mostraria a pessoa duas vezes.
 *
 * Fica fora de `server-only` porque é só transformação de texto: roda no
 * teste e no componente sem precisar de banco.
 */

/** Comprimento da cauda usada para comparar dois números. */
const DIGITOS_DE_COMPARACAO = 10;

/**
 * Deixa o número no formato que vai para o banco: só dígitos, com 55.
 *
 * Devolve string vazia quando não sobra dígito nenhum — quem chama trata
 * isso como "não é telefone" em vez de gravar lixo.
 */
export function normalizaTelefone(bruto: unknown): string {
  const digitos = String(bruto ?? '').replace(/\D/g, '');
  if (!digitos) return '';
  return digitos.startsWith('55') ? digitos : `55${digitos}`;
}

/**
 * Chave de comparação entre dois números: os últimos 10 dígitos.
 *
 * É a mesma cauda que a consulta de `encontraOuCriaLead` usa
 * (`RIGHT(..., 10)`), e existe porque o número brasileiro aparece ora com
 * o nono dígito, ora sem, ora com DDI, ora sem. Os 10 finais são a parte
 * que sobrevive a todas essas variações: DDD + os 8 últimos dígitos.
 */
export function chaveTelefone(bruto: unknown): string {
  const digitos = String(bruto ?? '').replace(/\D/g, '');
  return digitos.slice(-DIGITOS_DE_COMPARACAO);
}

/**
 * Diz se dois números são da mesma pessoa, tolerando as variações de
 * formato. Número vazio nunca casa com nada, nem com outro vazio: sem
 * dígito não há como afirmar que são o mesmo.
 */
export function mesmoTelefone(a: unknown, b: unknown): boolean {
  const chaveA = chaveTelefone(a);
  const chaveB = chaveTelefone(b);
  if (chaveA.length < DIGITOS_DE_COMPARACAO || chaveB.length < DIGITOS_DE_COMPARACAO) {
    // Número curto demais para ter DDD: comparar a cauda daria falso
    // positivo entre pessoas diferentes. Exige igualdade inteira.
    return chaveA !== '' && chaveA === chaveB;
  }
  return chaveA === chaveB;
}
