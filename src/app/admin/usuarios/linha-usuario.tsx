'use client';

import { useState } from 'react';
import {
  acaoAprovar,
  acaoBloquear,
  acaoDefinirPapel,
  acaoDefinirVinculos,
} from '@/lib/auth/admin-actions';

type UsuarioLinha = {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'cliente';
  status: 'ativo' | 'pendente' | 'bloqueado';
  last_login_at: string | null;
  clientes: string[];
};

const CORES_STATUS: Record<UsuarioLinha['status'], string> = {
  ativo: 'bg-green-50 text-green-700',
  pendente: 'bg-amber-50 text-amber-700',
  bloqueado: 'bg-red-50 text-red-700',
};

export function LinhaUsuario({
  usuario,
  clientes,
  ehVoceMesmo,
}: {
  usuario: UsuarioLinha;
  clientes: { nome: string; rotulo: string }[];
  ehVoceMesmo: boolean;
}) {
  const [editando, setEditando] = useState(false);

  return (
    <div className="border-b px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[200px] flex-1">
          <span className="block text-sm font-medium">
            {usuario.name}
            {ehVoceMesmo ? (
              <span className="ml-2 text-xs text-[var(--text-tertiary)]">(você)</span>
            ) : null}
          </span>
          <span className="block text-xs text-[var(--text-tertiary)]">{usuario.email}</span>
        </div>

        <span
          className={`rounded-[var(--radius-chip)] px-2 py-0.5 text-xs ${CORES_STATUS[usuario.status]}`}
        >
          {usuario.status}
        </span>

        <form action={acaoDefinirPapel} className="flex items-center gap-1.5">
          <input type="hidden" name="userId" value={usuario.id} />
          <select
            name="papel"
            defaultValue={usuario.role}
            disabled={ehVoceMesmo}
            className="field filtro-campo"
          >
            <option value="cliente">Cliente</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" disabled={ehVoceMesmo} className="btn-ghost px-2 py-1 text-xs">
            Aplicar
          </button>
        </form>

        <div className="flex items-center gap-1.5">
          {usuario.status !== 'ativo' ? (
            <form action={acaoAprovar}>
              <input type="hidden" name="userId" value={usuario.id} />
              <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                Liberar acesso
              </button>
            </form>
          ) : (
            <form action={acaoBloquear}>
              <input type="hidden" name="userId" value={usuario.id} />
              <button
                type="submit"
                disabled={ehVoceMesmo}
                className="btn-ghost px-2 py-1 text-xs text-red-700"
              >
                Bloquear
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => setEditando((v) => !v)}
            className="btn-ghost px-2 py-1 text-xs"
          >
            {usuario.role === 'admin'
              ? 'Clientes (todos)'
              : `Clientes (${usuario.clientes.length})`}
          </button>
        </div>
      </div>

      {editando ? (
        <form action={acaoDefinirVinculos} className="mt-3 rounded-[var(--radius-control)] border p-3">
          <input type="hidden" name="userId" value={usuario.id} />
          {usuario.role === 'admin' ? (
            <p className="mb-2 text-xs text-[var(--text-tertiary)]">
              Esta conta é administradora e enxerga todos os clientes independentemente da seleção
              abaixo. A seleção passa a valer se o papel virar Cliente.
            </p>
          ) : null}
          {clientes.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">Nenhum cliente cadastrado.</p>
          ) : (
            <div className="grid max-h-52 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {clientes.map((c) => (
                <label key={c.nome} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="clientes"
                    value={c.nome}
                    defaultChecked={usuario.clientes.includes(c.nome)}
                  />
                  <span>{c.rotulo}</span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button type="submit" className="btn-primary px-3 py-1.5 text-xs">
              Salvar vínculos
            </button>
            <button
              type="button"
              onClick={() => setEditando(false)}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
