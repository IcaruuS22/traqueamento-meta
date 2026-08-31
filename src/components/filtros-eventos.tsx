'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

/**
 * Filtros de status e busca da tela "Últimos eventos".
 *
 * Mesma escolha do seletor de período: o estado mora na URL, não em React
 * state. Assim o filtro sobrevive ao F5, vai junto num link compartilhado
 * e a tela continua sendo Server Component — mudar o filtro é navegar.
 *
 * A lista de status está duplicada aqui de propósito: `@/lib/db/eventos`
 * é `server-only`, e importar um valor de runtime de lá para um componente
 * de cliente quebra o build. São 4 constantes que o endpoint original
 * também já tratava como whitelist fixa.
 */

const STATUS: { valor: string; rotulo: string }[] = [
  { valor: '', rotulo: 'Todos os status' },
  { valor: 'SENT', rotulo: 'Enviados' },
  { valor: 'ERROR', rotulo: 'Com erro' },
  { valor: 'PENDING', rotulo: 'Pendentes' },
  { valor: 'DUPLICATE', rotulo: 'Duplicados' },
];

export function FiltrosEventos() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendente, startTransition] = useTransition();

  const status = searchParams.get('status') ?? '';
  const busca = searchParams.get('search') ?? '';

  // O input é controlado localmente para não navegar a cada tecla; a URL
  // continua sendo a fonte da verdade, e este estado a acompanha quando
  // ela muda por fora (voltar do navegador, troca de período).
  const [termo, setTermo] = useState(busca);
  useEffect(() => setTermo(busca), [busca]);

  const atualiza = (mudancas: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === '') params.delete(chave);
      else params.set(chave, valor);
    }
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      data-pendente={pendente || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        atualiza({ search: termo.trim() });
      }}
    >
      <select
        aria-label="Status do evento"
        className="field filtro-campo"
        value={status}
        onChange={(e) => atualiza({ status: e.target.value })}
      >
        {STATUS.map((s) => (
          <option key={s.valor} value={s.valor}>
            {s.rotulo}
          </option>
        ))}
      </select>

      <input
        type="search"
        aria-label="Buscar por nome, e-mail ou telefone"
        placeholder="Buscar lead..."
        className="field filtro-campo min-w-[180px]"
        value={termo}
        maxLength={120}
        onChange={(e) => setTermo(e.target.value)}
      />

      <button
        type="submit"
        className="rounded-[var(--radius-control)] border px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-field)]"
      >
        Buscar
      </button>

      {status || busca ? (
        <button
          type="button"
          onClick={() => {
            setTermo('');
            atualiza({ status: null, search: null });
          }}
          className="text-xs text-[var(--text-tertiary)] underline underline-offset-2"
        >
          Limpar
        </button>
      ) : null}
    </form>
  );
}
