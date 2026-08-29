'use client';

import { useFormStatus } from 'react-dom';

/** Botão de envio que se desabilita sozinho enquanto a action roda. */
export function BotaoEnviar({
  children,
  carregando = 'Aguarde…',
  className = '',
  disabled = false,
}: {
  children: React.ReactNode;
  carregando?: string;
  className?: string;
  /** Trava o envio por regra da tela (confirmação ainda não digitada, por exemplo). */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`btn-primary w-full ${className}`}
    >
      {pending ? carregando : children}
    </button>
  );
}

export function Alerta({ tipo, children }: { tipo: 'erro' | 'sucesso' | 'aviso'; children: React.ReactNode }) {
  const estilos: Record<typeof tipo, string> = {
    erro: 'bg-red-50 text-red-700',
    sucesso: 'bg-green-50 text-green-700',
    aviso: 'bg-amber-50 text-amber-700',
  };
  return (
    <p
      role={tipo === 'erro' ? 'alert' : 'status'}
      className={`rounded-[var(--radius-control)] px-3 py-2.5 text-sm ${estilos[tipo]}`}
    >
      {children}
    </p>
  );
}

export function Campo({
  label,
  dica,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; dica?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">{label}</span>
      <input className="field" {...props} />
      {dica ? <span className="mt-1 block text-xs text-[var(--text-tertiary)]">{dica}</span> : null}
    </label>
  );
}
