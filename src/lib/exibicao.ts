/**
 * Formatação de nome e telefone para a tela.
 *
 * Só apresentação: o banco continua guardando o que o Meta, o CRM ou o
 * WhatsApp mandaram. O nome chega em caixa mista e às vezes só com a
 * primeira letra maiúscula, o telefone chega em dígitos com 55 na frente
 * (ver `normalizaTelefone`), e as duas coisas aparecem em oito telas
 * diferentes — daí as funções ficarem em um lugar só.
 */

/**
 * Nome e sobrenome como o painel mostra: tudo em maiúscula.
 *
 * Devolve string vazia quando não há nome, para quem chama decidir o que
 * colocar no lugar — cada tela tem uma alternativa diferente (e-mail,
 * telefone, "Sem nome").
 */
export function nomeParaExibir(
  primeiro: string | null | undefined,
  ultimo: string | null | undefined,
): string {
  return `${primeiro ?? ''} ${ultimo ?? ''}`.trim().toLocaleUpperCase('pt-BR');
}

/**
 * Telefone no formato +55 (99) 99999-9999, com oito ou nove dígitos
 * depois do DDD — celular antigo e fixo não têm o nono dígito, e forçar
 * um formato só deixaria o número deslocado.
 *
 * Número que não encaixa em nenhum dos dois tamanhos volta como veio: é
 * melhor mostrar o valor cru do que fingir um DDD que não está ali.
 */
export function telefoneParaExibir(bruto: unknown): string {
  const original = String(bruto ?? '').trim();
  const digitos = original.replace(/\D/g, '');
  if (!digitos) return original;
  // Número escrito com DDI de outro país fica como está: '+1 415 555 0000'
  // tem os mesmos onze dígitos de um celular brasileiro sem DDI, e só o
  // '+' na frente distingue os dois.
  if (original.startsWith('+') && !digitos.startsWith('55')) return original;

  const nacional =
    (digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')
      ? digitos.slice(2)
      : digitos.length === 10 || digitos.length === 11
        ? digitos
        : '';
  if (!nacional) return original;

  const ddd = nacional.slice(0, 2);
  const assinante = nacional.slice(2);
  const inicio = assinante.slice(0, assinante.length - 4);
  const fim = assinante.slice(-4);
  return `+55 (${ddd}) ${inicio}-${fim}`;
}
