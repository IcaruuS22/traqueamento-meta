import type { Metadata } from 'next';
import { requireAuth } from '@/lib/auth/guard';
import { GUIAS } from '@/content/tutorial';
import { Card } from '@/components/dados';
import { PageHero } from '@/components/hero';

export const metadata: Metadata = { title: 'Ajuda — Trakeamento' };

/**
 * Tutorial de configuração — porte da aba "Tutorial" do painel.
 *
 * Duas diferenças deliberadas em relação ao painel antigo:
 *
 *  - os passos aparecem todos de uma vez, em lista numerada, em vez de um
 *    por vez com Anterior/Próximo. Quem segue o tutorial está com a Meta
 *    aberta em outra aba e volta aqui várias vezes; um passo por vez
 *    esconde o que vem depois e não sobrevive a Ctrl+F nem à impressão. O
 *    wizard passo a passo continua fazendo sentido no cadastro de cliente
 *    (Fase 3), que é um fluxo linear feito uma vez — e vai ler estes
 *    mesmos arquivos;
 *  - os espaços tracejados reservados para prints não foram portados: o
 *    painel antigo os anunciava como "adicione as imagens depois" e as
 *    imagens nunca foram adicionadas. Quando existirem, entram como
 *    campo no tipo `Guia`.
 */
export default async function PaginaTutorial() {
  // O middleware já barra quem não está logado; a checagem se repete aqui
  // pelo mesmo motivo do resto do app.
  await requireAuth();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHero
        titulo="Ajuda"
        descricao="Passo a passo para deixar um cliente pronto para receber leads e enviar eventos à Meta. Os guias são sequenciais: o 3 e o 4 usam o aplicativo criado no 1."
      />

      <nav aria-label="Guias" className="flex flex-wrap gap-2">
        {GUIAS.map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-field)]"
          >
            {g.numero}. {g.titulo}
          </a>
        ))}
      </nav>

      {GUIAS.map((g) => (
        <section key={g.id} id={g.id} className="scroll-mt-20">
          <Card>
            <h2 className="text-sm font-semibold">
              {g.numero}. {g.titulo}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{g.resumo}</p>

            {g.aviso ? (
              <p className="mt-3 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
                <strong>Lembrete importante:</strong> {g.aviso}
              </p>
            ) : null}

            <ol className="mt-4 space-y-3">
              {g.passos.map((passo, i) => (
                <li key={passo.slice(0, 40)} className="flex gap-3 text-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--bg-field)] text-xs tabular-nums text-[var(--text-secondary)]">
                    {i + 1}
                  </span>
                  <span className="min-w-0">{passo}</span>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      ))}
    </div>
  );
}
