'use client';

import { useActionState, useEffect, useState } from 'react';
import { Alerta, BotaoEnviar, Campo } from '@/components/form';
import { acaoAdicionarLead } from '@/lib/acoes/leads';
import type { EstadoFormulario } from '@/lib/auth/actions';

/**
 * Botão "Adicionar lead" do CRM de Formulários.
 *
 * Pede dois identificadores e mais nada: o `leadgen_id` da Meta e o id do
 * negócio no Kommo. Todo o resto — nome, telefone, campanha, etapa,
 * valor — é buscado no servidor, nas duas APIs. Um formulário com vinte
 * campos convidaria a digitar `current_stage` errado, que é justamente o
 * erro que este botão existe para não repetir.
 *
 * Só aparece para administrador. A ação repete a checagem no servidor.
 */

const ESTADO_INICIAL: EstadoFormulario = {};

export function BotaoAdicionarLead({ cliente }: { cliente: string }) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(acaoAdicionarLead, ESTADO_INICIAL);

  // Fecha sozinho depois do sucesso, mas só depois de a pessoa ter tido
  // tempo de ler o aviso — a mensagem diz em que data o lead entrou, e é
  // por essa data que ele vai ser procurado no quadro.
  useEffect(() => {
    if (!estado.sucesso) return;
    const t = setTimeout(() => setAberto(false), 6000);
    return () => clearTimeout(t);
  }, [estado.sucesso]);

  if (!aberto) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setAberto(true)}>
        + Adicionar lead
      </button>
    );
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) setAberto(false);
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Adicionar lead">
        <header className="modal-head">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold">Adicionar lead</h3>
            <p className="truncate text-body-small text-tertiary">
              Para lead que ficou de fora das automações
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAberto(false)}
            aria-label="Fechar"
            className="rounded-[var(--radius-control)] px-2 py-1 text-lg leading-none text-[var(--text-secondary)] hover:bg-[var(--bg-field)]"
          >
            ×
          </button>
        </header>

        <div className="modal-body">
          <form action={acao} className="space-y-4">
            <input type="hidden" name="cliente" value={cliente} />

            <Campo
              label="leadgen_id (Meta)"
              name="leadgen_id"
              inputMode="numeric"
              autoComplete="off"
              required
              placeholder="1398009702228225"
              dica="ID do lead no Formulário Instantâneo. Traz nome, telefone, campanha e anúncio."
            />

            <Campo
              label="ID do lead (Kommo)"
              name="crm_lead_id"
              inputMode="numeric"
              autoComplete="off"
              required
              placeholder="12345678"
              dica="Número no fim da URL do negócio: /leads/detail/12345678. Traz a etapa e o valor."
            />

            {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
            {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}

            <p className="text-xs text-[var(--text-tertiary)]">
              O lead entra com a data em que chegou na Meta e com a etapa em que o Kommo o tem
              hoje. Nenhum evento é enviado à Meta e nada é alterado no Kommo.
            </p>

            <BotaoEnviar carregando="Buscando…">Adicionar</BotaoEnviar>
          </form>
        </div>
      </div>
    </div>
  );
}
