'use client';

import { useActionState } from 'react';
import { acaoSalvarSubdominioKommo } from '@/lib/acoes/clientes';
import type { EstadoFormulario } from '@/lib/auth/actions';
import { Alerta, BotaoEnviar } from '@/components/form';

/**
 * Subdomínio do Kommo deste cliente.
 *
 * O fluxo de eventos recebe o subdomínio dentro do próprio webhook do
 * Kommo, então nunca precisou dele gravado. A automação
 * "Kommo - Sincroniza Perdidos" roda por agenda, sem webhook, e sem isto
 * não sabe em qual conta perguntar — em branco, ela pula o cliente.
 */
export function SubdominioKommo({ banco, subdominio }: { banco: string; subdominio: string | null }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoSalvarSubdominioKommo, {});

  return (
    <form action={acao} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="client_db" value={banco} />

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]">
          Subdomínio do Kommo
        </span>
        <input
          name="kommo_subdomain"
          className="field !w-56"
          autoComplete="off"
          maxLength={120}
          defaultValue={subdominio ?? ''}
          placeholder="ex.: minhaempresa"
        />
      </label>

      <BotaoEnviar carregando="Salvando…" className="!w-auto px-3 py-1.5 text-xs">
        Salvar subdomínio
      </BotaoEnviar>

      <p className="w-full text-xs text-[var(--text-tertiary)]">
        Só o nome da conta, sem https e sem .kommo.com. É o que a automação de negócios perdidos
        usa para consultar o CRM; em branco, este cliente fica de fora dela.
      </p>

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}
    </form>
  );
}
