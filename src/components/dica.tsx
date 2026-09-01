/**
 * Bolinha de informação com texto que aparece ao passar o mouse.
 *
 * O `title` do navegador servia para isso e foi trocado: ele demora cerca
 * de um segundo para abrir, não aparece no toque e não dá nenhuma pista
 * visual de que existe explicação ali — quem não passou o mouse por acaso
 * nunca soube que o texto existia.
 *
 * O texto vai no `aria-label` do botão e o balão fica `aria-hidden`, senão
 * o leitor de tela anunciaria a mesma frase duas vezes. O botão não faz
 * nada ao ser clicado: ele é focável só para a dica abrir pelo teclado e
 * pelo toque.
 */
export function Dica({ texto }: { texto: string }) {
  return (
    <span className="dica">
      <button type="button" className="dica-botao" aria-label={texto}>
        i
      </button>
      <span className="dica-balao" aria-hidden="true">
        {texto}
      </span>
    </span>
  );
}
