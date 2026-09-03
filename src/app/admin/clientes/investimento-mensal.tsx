'use client';

import { useActionState } from 'react';
import { acaoSalvarInvestimentoMensal } from '@/lib/acoes/clientes';
import type { EstadoFormulario } from '@/lib/auth/actions';
import { Alerta, BotaoEnviar } from '@/components/form';

/**
 * Investimento (budget) mensal do cliente, na lista da administração.
 *
 * Um campo e um botão, sem confirmação: é um número que muda quando o
 * contrato muda, e trocá-lo não apaga nada — o valor anterior fica no
 * log de auditoria. Deixar em branco remove o teto, e o indicador da aba
 * Métricas volta a ficar neutro em vez de acusar estouro.
 */
export function InvestimentoMensal({
  banco,
  investimento,
}: {
  banco: string;
  investimento: number | null;
}) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(
    acaoSalvarInvestimentoMensal,
    {},
  );

  return (
    <form action={acao} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="client_db" value={banco} />

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]">
          Investimento mensal (Meta Ads)
        </span>
        <input
          name="monthly_fee"
          className="field !w-40"
          autoComplete="off"
          inputMode="decimal"
          maxLength={20}
          defaultValue={investimento === null ? '' : String(investimento)}
          placeholder="ex.: 3500,00"
        />
      </label>

      <BotaoEnviar carregando="Salvando…" className="!w-auto px-3 py-1.5 text-xs">
        Salvar investimento
      </BotaoEnviar>

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}
    </form>
  );
}
