'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * Escolha da integração antes do formulário.
 *
 * A tela mostrava os dois formulários abertos, um embaixo do outro: uma
 * parede de campos de duas integrações que não se usam juntas, e nada
 * dizendo qual delas era para preencher. Agora vêm primeiro os cartões
 * das integrações — o que cada uma é, o que ela exige e em que estado
 * está — e os campos só aparecem depois da escolha, em cima da tela.
 *
 * O formulário chega pronto de fora, montado no servidor. Este
 * componente não sabe o que tem dentro dele: só decide quando mostrar.
 */

export type EstadoConexao = 'em-uso' | 'configurada' | 'disponivel' | 'indisponivel';

export type OpcaoConexao = {
  id: string;
  titulo: string;
  /** Uma linha sobre o que a integração faz. */
  descricao: string;
  /** O que o usuário precisa ter em mãos para preencher. */
  requisitos: string[];
  estado: EstadoConexao;
  /** Ícone do cartão, montado por quem chama. */
  icone: React.ReactNode;
  /** Texto do botão do cartão. */
  rotuloAcao: string;
  /** Conteúdo do modal: o formulário da integração. */
  formulario: React.ReactNode;
};

const ROTULO_ESTADO: Record<EstadoConexao, string> = {
  'em-uso': 'Em uso',
  configurada: 'Configurada',
  disponivel: 'Não configurada',
  indisponivel: 'Indisponível',
};

const CLASSE_ESTADO: Record<EstadoConexao, string> = {
  'em-uso': 'conexao-selo-ativo',
  configurada: 'conexao-selo-pronto',
  disponivel: 'conexao-selo-neutro',
  indisponivel: 'conexao-selo-alerta',
};

export function EscolhaConexao({ opcoes }: { opcoes: OpcaoConexao[] }) {
  const [aberta, setAberta] = useState<string | null>(null);
  const tituloId = useId();
  // Fechar o modal devolve o foco ao cartão de onde ele saiu; sem isso o
  // foco volta para o começo da página, e quem navega por teclado
  // recomeça o percurso a cada vez que abre e fecha.
  const origemFoco = useRef<HTMLElement | null>(null);

  const escolhida = opcoes.find((o) => o.id === aberta) ?? null;

  useEffect(() => {
    if (!escolhida) return;
    const fechaComEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberta(null);
    };
    document.addEventListener('keydown', fechaComEsc);
    return () => document.removeEventListener('keydown', fechaComEsc);
  }, [escolhida]);

  useEffect(() => {
    if (escolhida) return;
    origemFoco.current?.focus();
    origemFoco.current = null;
  }, [escolhida]);

  return (
    <>
      <div className="conexao-grade">
        {opcoes.map((o) => (
          <article key={o.id} className={`conexao-cartao${o.estado === 'em-uso' ? ' conexao-cartao-ativo' : ''}`}>
            <div className="conexao-cabeca">
              <span className="conexao-icone" aria-hidden="true">
                {o.icone}
              </span>
              <div className="min-w-0">
                <h3 className="conexao-titulo">{o.titulo}</h3>
                <span className={`conexao-selo ${CLASSE_ESTADO[o.estado]}`}>
                  {ROTULO_ESTADO[o.estado]}
                </span>
              </div>
            </div>

            <p className="conexao-descricao">{o.descricao}</p>

            {o.requisitos.length ? (
              <ul className="conexao-requisitos">
                {o.requisitos.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}

            <div className="conexao-rodape">
              <button
                type="button"
                className={o.estado === 'disponivel' ? 'btn btn-primary' : 'btn btn-secondary'}
                onClick={(e) => {
                  origemFoco.current = e.currentTarget;
                  setAberta(o.id);
                }}
              >
                {o.rotuloAcao}
              </button>
            </div>
          </article>
        ))}
      </div>

      {escolhida ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAberta(null);
          }}
        >
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby={tituloId}>
            <header className="modal-head">
              <div className="min-w-0">
                <h3 id={tituloId} className="truncate text-[15px] font-semibold">
                  {escolhida.titulo}
                </h3>
                <p className="truncate text-body-small text-tertiary">{escolhida.descricao}</p>
              </div>
              <button
                type="button"
                onClick={() => setAberta(null)}
                aria-label="Fechar"
                className="rounded-[var(--radius-control)] px-2 py-1 text-lg leading-none text-[var(--text-secondary)] hover:bg-[var(--bg-field)]"
              >
                ×
              </button>
            </header>
            <div className="modal-body">{escolhida.formulario}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
