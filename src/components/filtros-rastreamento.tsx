'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { FONTES, ROTULO_FONTE } from '@/lib/rastreamento';

/**
 * Filtros de fonte e busca da tela "Rastreamento".
 *
 * Mesma escolha das outras telas: o estado mora na URL, não em React
 * state — o filtro sobrevive ao F5, vai junto num link compartilhado e a
 * tela continua sendo Server Component.
 */

export function FiltrosRastreamento() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendente, startTransition] = useTransition();

  const fonte = searchParams.get('fonte') ?? '';
  const busca = searchParams.get('search') ?? '';

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
        aria-label="Fonte do lead"
        className="field filtro-campo"
        value={fonte}
        onChange={(e) => atualiza({ fonte: e.target.value })}
      >
        <option value="">Todas as fontes</option>
        {FONTES.map((f) => (
          <option key={f} value={f}>
            {ROTULO_FONTE[f]}
          </option>
        ))}
      </select>

      <input
        type="search"
        aria-label="Buscar por nome, e-mail, telefone, campanha ou anúncio"
        placeholder="Buscar lead ou campanha..."
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

      {fonte || busca ? (
        <button
          type="button"
          onClick={() => {
            setTermo('');
            atualiza({ fonte: null, search: null });
          }}
          className="text-xs text-[var(--text-tertiary)] underline underline-offset-2"
        >
          Limpar
        </button>
      ) : null}
    </form>
  );
}
