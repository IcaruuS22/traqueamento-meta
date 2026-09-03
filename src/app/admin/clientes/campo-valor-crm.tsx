'use client';

import { useActionState } from 'react';
import { acaoSalvarCampoValorCrm } from '@/lib/acoes/clientes';
import type { EstadoFormulario } from '@/lib/auth/actions';
import { Alerta, BotaoEnviar } from '@/components/form';

/**
 * Campo do Kommo que guarda o valor do negócio deste cliente.
 *
 * O fluxo de eventos lê o campo nativo "Venda" (price) primeiro; isto
 * diz qual campo personalizado consultar quando o nativo vem zerado. O
 * id numérico do campo é preferível ao rótulo: sobrevive a alguém
 * renomear o campo no Kommo. Em branco, o fluxo volta a procurar pelos
 * rótulos conhecidos ("Venda", "Valor do contrato", ...).
 */
export function CampoValorCrm({ banco, campo }: { banco: string; campo: string | null }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoSalvarCampoValorCrm, {});

  return (
    <form action={acao} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="client_db" value={banco} />

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]">
          Campo do valor no Kommo
        </span>
        <input
          name="crm_value_field"
          className="field !w-56"
          autoComplete="off"
          maxLength={120}
          defaultValue={campo ?? ''}
          placeholder="ex.: 1053417 ou Valor do contrato"
        />
      </label>

      <BotaoEnviar carregando="Salvando…" className="!w-auto px-3 py-1.5 text-xs">
        Salvar campo
      </BotaoEnviar>

      <p className="w-full text-xs text-[var(--text-tertiary)]">
        Só para quem não usa o campo nativo &quot;Venda&quot;. Aceita o id numérico do campo
        personalizado (mais seguro) ou o rótulo exato. Em branco, valem os rótulos conhecidos.
      </p>

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}
    </form>
  );
}
