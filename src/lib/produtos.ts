/**
 * Produtos que um cliente contrata: o que ele usa do app.
 *
 * A lista mora em `ad_accounts.produtos`, como texto separado por vírgula
 * ("landing_page,whatsapp"). NULL quer dizer "não definido": cliente
 * cadastrado antes da escolha de produtos existir. Para esses, a lista é
 * deduzida do que já está cadastrado (`derivaProdutos`), e a tela diz que
 * é dedução.
 *
 * Arquivo sem dependência de servidor: o formulário do navegador usa os
 * mesmos rótulos e a mesma ordem.
 */

export const PRODUTOS = ['landing_page', 'formularios', 'whatsapp'] as const;

export type Produto = (typeof PRODUTOS)[number];

export const ROTULO_PRODUTO: Record<Produto, string> = {
  landing_page: 'Página de vendas',
  formularios: 'Formulários Instantâneos',
  whatsapp: 'WhatsApp',
};

export const DESCRICAO_PRODUTO: Record<Produto, string> = {
  landing_page:
    'Rastreio de página de vendas: visita, formulário, checkout e compra, com envio à Conversions API.',
  formularios:
    'Leads dos Formulários Instantâneos da Meta, com o funil do Kommo devolvendo as conversões.',
  whatsapp:
    'Conversas iniciadas por anúncio, com o evento de contato enviado à Meta.',
};

/** O que o cadastro pede de cada produto, para mostrar antes da escolha. */
export const PEDE_PRODUTO: Record<Produto, string[]> = {
  landing_page: ['Nome do site', 'Domínios da página'],
  formularios: ['ID da conta no Kommo', 'Token de acesso do Kommo', 'Subdomínio do Kommo'],
  whatsapp: ['Cloud API: Phone Number ID e token', 'ou Evolution API: QR Code depois do cadastro'],
};

export function ehProduto(valor: unknown): valor is Produto {
  return typeof valor === 'string' && (PRODUTOS as readonly string[]).includes(valor);
}

/** Tira repetidos e desconhecidos e devolve na ordem canônica. */
export function normalizaProdutos(valores: Iterable<unknown>): Produto[] {
  const vistos = new Set<string>();
  for (const v of valores) {
    const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (ehProduto(t)) vistos.add(t);
  }
  return PRODUTOS.filter((p) => vistos.has(p));
}

/** Lê a coluna. `null` = não definido (coluna NULL ou vazia). */
export function leProdutos(texto: string | null | undefined): Produto[] | null {
  const lista = normalizaProdutos(String(texto ?? '').split(','));
  return lista.length ? lista : null;
}

export function serializaProdutos(lista: Iterable<unknown>): string {
  return normalizaProdutos(lista).join(',');
}

/**
 * Deduz os produtos de um cliente antigo pelo que já foi cadastrado:
 * conta ou token do Kommo indicam Formulários, uma conexão de WhatsApp
 * indica WhatsApp e um site rastreado indica Página de vendas.
 */
export function derivaProdutos(sinais: {
  temCrm: boolean;
  temWhatsapp: boolean;
  temSites: boolean;
}): Produto[] {
  return normalizaProdutos([
    sinais.temSites ? 'landing_page' : null,
    sinais.temCrm ? 'formularios' : null,
    sinais.temWhatsapp ? 'whatsapp' : null,
  ]);
}

/** Produtos que ainda podem ser adicionados ao cliente. */
export function produtosQueFaltam(atuais: readonly Produto[]): Produto[] {
  return PRODUTOS.filter((p) => !atuais.includes(p));
}
