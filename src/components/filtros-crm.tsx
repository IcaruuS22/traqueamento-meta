'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { ORIGENS, ROTULO_ORIGEM } from '@/lib/crm';

/**
 * Filtros de origem e busca do CRM.
 *
 * Mesmo padrão das outras telas: o estado mora na URL, sobrevive ao F5 e
 * mantém a tela como Server Component.
 */

export function FiltrosCrm() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendente, startTransition] = useTransition();

  const origem = searchParams.get('origem') ?? '';
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
        aria-label="Origem do contato"
        className="field w-auto"
        value={origem}
        onChange={(e) => atualiza({ origem: e.target.value })}
      >
        <option value="">Formulário e WhatsApp</option>
        {ORIGENS.map((o) => (
          <option key={o} value={o}>
            Só {ROTULO_ORIGEM[o]}
          </option>
        ))}
      </select>

      <input
        type="search"
        aria-label="Buscar por nome, e-mail ou telefone"
        placeholder="Buscar contato..."
        className="field w-auto min-w-[200px]"
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

      {origem || busca ? (
        <button
          type="button"
          onClick={() => {
            setTermo('');
            atualiza({ origem: null, search: null });
          }}
          className="text-xs text-[var(--text-tertiary)] underline underline-offset-2"
        >
          Limpar
        </button>
      ) : null}
    </form>
  );
}
