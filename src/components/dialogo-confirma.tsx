'use client';

import { useEffect, useRef } from 'react';

/**
 * Confirmação do painel, no lugar do `window.confirm`.
 *
 * O diálogo do navegador aparece colado no topo da janela, com o domínio
 * ("traqueamento-meta.vercel.app diz") antes da pergunta e botões que não
 * seguem o tema — em ação que gasta dinheiro na conta do cliente, a
 * pergunta precisa estar no centro do olhar e parecer parte do painel.
 *
 * Reaproveita `.modal-overlay` e `.modal-card` do modal de rastreio, que
 * já centralizam e já viram meia-tela no celular.
 *
 * Fecha no Esc e no clique fora, e ambos contam como cancelar: quem
 * hesita não confirma. O foco vai para o botão de confirmar ao abrir, e
 * volta para quem abriu ao fechar.
 */
export function DialogoConfirma({
  aberto,
  titulo,
  texto,
  rotuloConfirma = 'Confirmar',
  rotuloCancela = 'Cancelar',
  perigo = false,
  onConfirma,
  onCancela,
}: {
  aberto: boolean;
  titulo: string;
  texto: string;
  rotuloConfirma?: string;
  rotuloCancela?: string;
  /** Deixa o botão de confirmar em vermelho: pausa, exclusão, perda. */
  perigo?: boolean;
  onConfirma: () => void;
  onCancela: () => void;
}) {
  const confirmaRef = useRef<HTMLButtonElement>(null);
  const anterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberto) return;
    anterior.current = document.activeElement as HTMLElement | null;
    confirmaRef.current?.focus();

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancela();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      anterior.current?.focus?.();
    };
  }, [aberto, onCancela]);

  if (!aberto) return null;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancela();
      }}
    >
      <div
        className="modal-card dialogo-confirma"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialogo-confirma-titulo"
        aria-describedby="dialogo-confirma-texto"
      >
        <div className="dialogo-confirma-corpo">
          <h3 id="dialogo-confirma-titulo" className="dialogo-confirma-titulo">
            {titulo}
          </h3>
          <p id="dialogo-confirma-texto" className="dialogo-confirma-texto">
            {texto}
          </p>
        </div>
        <div className="dialogo-confirma-acoes">
          <button type="button" className="btn dialogo-confirma-cancela" onClick={onCancela}>
            {rotuloCancela}
          </button>
          <button
            ref={confirmaRef}
            type="button"
            className={`btn ${perigo ? 'dialogo-confirma-perigo' : 'dialogo-confirma-confirma'}`}
            onClick={onConfirma}
          >
            {rotuloConfirma}
          </button>
        </div>
      </div>
    </div>
  );
}
