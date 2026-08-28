/**
 * Guias de configuração — fonte única do texto.
 *
 * Hoje o mesmo tutorial existe duas vezes no projeto antigo, escrito de
 * formas diferentes: `painel-admin.html` (objeto por guia, com stepper) e
 * `novo-cliente-form.html` (array único, wizard em modal). Os dois já
 * divergiram porque só um foi atualizado. Aqui o texto mora num arquivo
 * por guia e as duas telas consomem os mesmos objetos — divergir passa a
 * exigir editar o mesmo arquivo duas vezes, o que ninguém faz sem querer.
 *
 * Por que TypeScript e não MDX, como previa o plano: os dois consumidores
 * precisam dos PASSOS como itens separados (o painel numera e o cadastro
 * de cliente navega um por vez, com Anterior/Próximo). MDX entrega um
 * bloco de prosa por arquivo; recuperar a estrutura de passos de dentro
 * dele exigiria componentes só para marcar fronteira. Um array de strings
 * já é exatamente o formato que as duas telas usam, sem dependência nova
 * (`@next/mdx` + `@mdx-js/loader` + `@mdx-js/react`) e sem perder nada:
 * o conteúdo é texto corrido, não tem código nem tabela.
 *
 * Este módulo não é `server-only` de propósito: é conteúdo estático, e a
 * tela de cadastro de cliente (Fase 3) vai precisar dele no cliente.
 */

export type Guia = {
  /** Slug estável — vira âncora na página do tutorial. */
  id: string;
  /** Posição na sequência. Os guias se referenciam por número no texto. */
  numero: number;
  titulo: string;
  resumo: string;
  /** Aviso em destaque, quando pular o guia quebra o fluxo em silêncio. */
  aviso?: string;
  passos: string[];
};
