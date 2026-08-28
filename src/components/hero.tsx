/**
 * Cabeçalho de tela, no formato do painel: título grande à esquerda com
 * uma linha de explicação em cinza, ações (período, botões) à direita.
 *
 * No painel isso era repetido em HTML dentro de cada aba; aqui virou um
 * componente porque cada aba é uma rota.
 */
export function PageHero({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  acoes?: React.ReactNode;
}) {
  return (
    <div className="page-hero">
      <div className="page-hero-top">
        <div>
          <h1 className="text-heading-page">{titulo}</h1>
          {descricao ? <p className="text-body-regular text-tertiary">{descricao}</p> : null}
        </div>
        {acoes ? <div className="page-hero-actions">{acoes}</div> : null}
      </div>
    </div>
  );
}
