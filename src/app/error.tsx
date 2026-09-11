'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Fronteira de erro da aplicação inteira.
 *
 * Sem este arquivo, qualquer exceção não tratada num Server Component
 * subia até o Next e virava a tela crua de erro em produção: fundo
 * branco, "Application error: a server-side exception has occurred", sem
 * caminho de volta e sem identificação do que aconteceu. Para quem está
 * olhando um painel de cliente às 9h da manhã, isso é indistinguível de
 * "o sistema morreu".
 *
 * Client Component por exigência do Next — é ele que segura o estado do
 * `reset()`. O `digest` é o único elo entre o que a pessoa vê e o
 * `console.error` do servidor: em produção a mensagem real nunca chega
 * ao navegador (e não deve chegar — mensagem de erro de banco costuma
 * carregar nome de tabela e de coluna), então é esse código que ela
 * informa no suporte.
 */
export default function ErroApp({
  // O Next passa a prop pelo nome `error`; o apelido mantém o corpo do
  // componente no português do resto do arquivo sem quebrar o contrato.
  error: erro,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[error-boundary]', erro);
  }, [erro]);

  return (
    <div className="card mx-auto my-10 max-w-md p-6 text-center">
      <h1 className="mb-2 text-lg font-semibold">Algo deu errado ao carregar esta página</h1>
      <p className="mb-5 text-sm text-[var(--text-secondary)]">
        A falha foi registrada. Tente de novo — se continuar acontecendo, informe o código abaixo ao
        suporte.
      </p>
      {erro.digest && (
        <p className="mb-5 font-mono text-xs text-[var(--text-secondary)]">
          código: {erro.digest}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-[var(--radius-control)] bg-[var(--bg-field)] px-4 py-2 text-sm font-medium"
        >
          Tentar de novo
        </button>
        <Link
          href="/app"
          className="rounded-[var(--radius-control)] bg-[var(--bg-field)] px-4 py-2 text-sm font-medium"
        >
          Voltar para meus clientes
        </Link>
      </div>
    </div>
  );
}
