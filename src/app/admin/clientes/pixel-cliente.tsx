'use client';

import { useActionState } from 'react';
import { acaoSalvarPixelCliente } from '@/lib/acoes/clientes';
import type { EstadoFormulario } from '@/lib/auth/actions';
import { Alerta, BotaoEnviar } from '@/components/form';

/**
 * Pixel/dataset da Meta deste cliente.
 *
 * Fica fora dos blocos por produto porque todos usam o mesmo: a tag da
 * Página de vendas, a Conversions API, os formulários e o WhatsApp.
 */
export function PixelCliente({ banco, pixel }: { banco: string; pixel: string | null }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoSalvarPixelCliente, {});

  return (
    <form action={acao} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="client_db" value={banco} />

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]">
          Pixel / conjunto de dados da Meta
        </span>
        <input
          name="meta_pixel_dataset_id"
          className="field !w-56"
          autoComplete="off"
          inputMode="numeric"
          required
          maxLength={40}
          defaultValue={pixel ?? ''}
          placeholder="ex.: 851293484396043"
        />
      </label>

      <BotaoEnviar carregando="Salvando…" className="!w-auto px-3 py-1.5 text-xs">
        Salvar pixel
      </BotaoEnviar>

      <p className="w-full text-xs text-[var(--text-tertiary)]">
        Gerenciador de Eventos › conjunto de dados › Configurações › Identificação. Vale para todos
        os produtos do cliente (sites, formulários e WhatsApp). O token da Meta do cliente precisa
        ter acesso a este conjunto de dados, senão a Conversions API recusa os eventos.
      </p>

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}
    </form>
  );
}
