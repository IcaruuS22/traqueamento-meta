'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

/**
 * Busca do CRM.
 *
 * Não tem mais seletor de origem: cada quadro é de um funil só, e a rota
 * já diz qual. Um seletor aqui deixaria a tela "CRM — Formulários"
 * mostrando contato de WhatsApp, contra o próprio rótulo.
 *
 * Mesmo padrão das outras telas: o estado mora na URL, sobrevive ao F5 e
 * mantém a tela como Server Component.
 */

export function FiltrosCrm() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendente, startTransition] = useTransition();

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
      <input
        type="search"
        aria-label="Buscar por nome, e-mail ou telefone"
        placeholder="Buscar contato..."
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

      {busca ? (
        <button
          type="button"
          onClick={() => {
            setTermo('');
            atualiza({ search: null });
          }}
          className="text-xs text-[var(--text-tertiary)] underline underline-offset-2"
        >
          Limpar
        </button>
      ) : null}
    </form>
  );
}
