'use client';

import { useActionState } from 'react';
import { acaoRedefinirSenha, type EstadoFormulario } from '@/lib/auth/actions';
import { Alerta, BotaoEnviar, Campo } from '@/components/form';

export function FormularioRedefinir({ token }: { token: string }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoRedefinirSenha, {});

  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Campo
        label="Nova senha"
        name="senha"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        autoFocus
      />
      <Campo
        label="Confirmar nova senha"
        name="confirmacao"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
      />
      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      <BotaoEnviar carregando="Salvando…">Salvar senha</BotaoEnviar>
    </form>
  );
}
