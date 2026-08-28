'use client';

import { useActionState } from 'react';
import {
  acaoCadastroPorConvite,
  acaoSolicitarAcesso,
  type EstadoFormulario,
} from '@/lib/auth/actions';
import { Alerta, BotaoEnviar, Campo } from '@/components/form';

export function FormularioConvite({ token, email }: { token: string; email: string }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoCadastroPorConvite, {});

  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {/* Somente leitura: o e-mail é o do convite, não pode ser trocado. */}
      <Campo label="E-mail" value={email} readOnly disabled />
      <Campo label="Seu nome" name="nome" autoComplete="name" required autoFocus />
      <Campo
        label="Senha"
        name="senha"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        dica="Mínimo de 10 caracteres."
      />
      <Campo
        label="Confirmar senha"
        name="confirmacao"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
      />
      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      <BotaoEnviar carregando="Criando…">Criar conta e entrar</BotaoEnviar>
    </form>
  );
}

export function FormularioSolicitacao() {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoSolicitarAcesso, {});

  if (estado.sucesso) {
    return <Alerta tipo="sucesso">{estado.sucesso}</Alerta>;
  }

  return (
    <form action={acao} className="space-y-4">
      <Campo label="Seu nome" name="nome" autoComplete="name" required autoFocus />
      <Campo label="E-mail" name="email" type="email" autoComplete="email" required />
      <Campo
        label="Senha"
        name="senha"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        dica="Mínimo de 10 caracteres."
      />
      <Campo
        label="Confirmar senha"
        name="confirmacao"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
      />
      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      <BotaoEnviar carregando="Enviando…">Solicitar acesso</BotaoEnviar>
    </form>
  );
}
