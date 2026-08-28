'use client';

import { useActionState } from 'react';
import { acaoConvidar } from '@/lib/auth/admin-actions';
import type { EstadoFormulario } from '@/lib/auth/actions';
import { Alerta, BotaoEnviar, Campo } from '@/components/form';

export function ConviteForm({ clientes }: { clientes: { nome: string; rotulo: string }[] }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoConvidar, {});

  return (
    <form action={acao} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="E-mail" name="email" type="email" required placeholder="pessoa@empresa.com" />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">
            Papel
          </span>
          <select name="papel" defaultValue="cliente" className="field">
            <option value="cliente">Cliente</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">
          Clientes liberados
        </legend>
        {clientes.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">Nenhum cliente cadastrado ainda.</p>
        ) : (
          <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-[var(--radius-control)] border p-3">
            {clientes.map((c) => (
              <label key={c.nome} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="clientes" value={c.nome} />
                <span>{c.rotulo}</span>
              </label>
            ))}
          </div>
        )}
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          Administradores acessam todos os clientes; a seleção só vale para o papel Cliente.
        </p>
      </fieldset>

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}

      <div className="sm:max-w-[220px]">
        <BotaoEnviar carregando="Enviando…">Enviar convite</BotaoEnviar>
      </div>
    </form>
  );
}
