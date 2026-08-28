'use client';

import { useActionState } from 'react';
import { acaoLogin, type EstadoFormulario } from '@/lib/auth/actions';
import { Alerta, BotaoEnviar, Campo } from '@/components/form';

export function FormularioLogin({ destino }: { destino?: string }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoLogin, {});

  return (
    <form action={acao} className="space-y-4">
      {destino ? <input type="hidden" name="next" value={destino} /> : null}

      <Campo
        label="E-mail"
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus
        placeholder="voce@empresa.com"
      />
      <Campo label="Senha" name="senha" type="password" autoComplete="current-password" required />

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}

      <BotaoEnviar carregando="Entrando…">Entrar</BotaoEnviar>
    </form>
  );
}
