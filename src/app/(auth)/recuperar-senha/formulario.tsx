'use client';

import { useActionState } from 'react';
import { acaoRecuperarSenha, type EstadoFormulario } from '@/lib/auth/actions';
import { Alerta, BotaoEnviar, Campo } from '@/components/form';

export function FormularioRecuperar() {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoRecuperarSenha, {});

  if (estado.sucesso) {
    return <Alerta tipo="sucesso">{estado.sucesso}</Alerta>;
  }

  return (
    <form action={acao} className="space-y-4">
      <Campo label="E-mail" name="email" type="email" autoComplete="email" required autoFocus />
      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      <BotaoEnviar carregando="Enviando…">Enviar link</BotaoEnviar>
    </form>
  );
}
