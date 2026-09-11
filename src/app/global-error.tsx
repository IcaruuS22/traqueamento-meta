'use client';

import { useEffect } from 'react';

/**
 * Último recurso: erro no PRÓPRIO layout raiz.
 *
 * `app/error.tsx` fica dentro do layout raiz, então não consegue
 * renderizar quando é o layout que quebra. Este arquivo substitui o
 * documento inteiro — por isso repete `<html>` e `<body>`, que aqui não
 * são duplicação, são obrigação da API.
 *
 * Nada de Tailwind, variável de tema ou fonte carregada: se chegou até
 * aqui, o que falhou pode ter sido justamente o que carrega essas
 * coisas. Estilo em linha para a tela funcionar sozinha.
 */
export default function ErroGlobal({
  // O Next passa a prop pelo nome `error`; o apelido mantém o corpo do
  // componente no português do resto do arquivo sem quebrar o contrato.
  error: erro,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', erro);
  }, [erro]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f1115',
          color: '#e6e8ee',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>O painel não conseguiu carregar</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: '#9aa1b1', margin: '0 0 20px' }}>
            A falha foi registrada. Recarregue a página — se continuar, informe o código ao suporte.
          </p>
          {erro.digest && (
            <p style={{ fontSize: 12, fontFamily: 'monospace', color: '#9aa1b1', margin: '0 0 20px' }}>
              código: {erro.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              border: 0,
              borderRadius: 8,
              padding: '10px 18px',
              fontSize: 14,
              cursor: 'pointer',
              background: '#1c2029',
              color: '#e6e8ee',
            }}
          >
            Recarregar
          </button>
        </div>
      </body>
    </html>
  );
}
