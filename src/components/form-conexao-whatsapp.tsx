'use client';

import { useActionState } from 'react';
import { acaoSalvarConexaoWhatsapp } from '@/lib/acoes/whatsapp';
import { Alerta, BotaoEnviar, Campo } from '@/components/form';
import type { EstadoFormulario } from '@/lib/auth/actions';

/**
 * Formulário da conexão do WhatsApp Cloud API.
 *
 * O campo de token nasce vazio mesmo quando já existe um token gravado —
 * a tela nunca recebe o valor, nem mascarado. Por isso a dica embaixo do
 * campo diz explicitamente o que "deixar em branco" faz: sem isso, a
 * leitura natural de um campo vazio num formulário de edição é "está
 * apagado".
 */
export function FormConexaoWhatsapp({
  cliente,
  inicial,
}: {
  cliente: string;
  inicial: {
    cloud_phone_number_id: string | null;
    cloud_waba_id: string | null;
    meta_test_event_code: string | null;
    token_cadastrado: boolean;
  };
}) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(
    acaoSalvarConexaoWhatsapp,
    {},
  );

  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="cliente" value={cliente} />

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          label="Phone Number ID"
          name="cloud_phone_number_id"
          defaultValue={inicial.cloud_phone_number_id ?? ''}
          required
          inputMode="numeric"
          dica="Meta → App → WhatsApp → API Setup, campo “Phone number ID”."
        />
        <Campo
          label="WABA ID"
          name="cloud_waba_id"
          defaultValue={inicial.cloud_waba_id ?? ''}
          dica="Opcional. Identificador da conta do WhatsApp Business."
        />
      </div>

      <Campo
        label="Token de acesso"
        name="cloud_access_token"
        type="password"
        autoComplete="off"
        placeholder={inicial.token_cadastrado ? '•••• já cadastrado' : ''}
        dica={
          inicial.token_cadastrado
            ? 'Deixe em branco para manter o token atual. Preencher substitui o token guardado.'
            : 'Obrigatório na primeira configuração. Use o token permanente do System User.'
        }
      />

      <Campo
        label="Test Event Code"
        name="meta_test_event_code"
        defaultValue={inicial.meta_test_event_code ?? ''}
        dica="Opcional. Preenchido, os eventos vão como teste: aparecem no Gerenciador de Eventos sem contar como conversão real. Limpe o campo para voltar a enviar eventos reais."
      />

      <div className="flex justify-end">
        <BotaoEnviar carregando="Salvando…" className="w-auto px-4">
          Salvar conexão
        </BotaoEnviar>
      </div>
    </form>
  );
}
