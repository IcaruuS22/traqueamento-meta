'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { acaoCriarCliente } from '@/lib/acoes/clientes';
import type { EstadoFormulario } from '@/lib/auth/actions';
import { Alerta, BotaoEnviar, Campo } from '@/components/form';

/**
 * Formulário de cliente novo.
 *
 * Os campos de credencial são `type="password"`: o cadastro costuma ser
 * feito com a tela compartilhada, e token da Meta é credencial de
 * terceiro. `autoComplete="off"` evita que o navegador guarde.
 */
export function ClienteForm() {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoCriarCliente, {});

  return (
    <form action={acao} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          label="Nome do cliente"
          name="account_name"
          required
          maxLength={255}
          placeholder="ANRG Energia Solar"
          dica="Vira o nome do banco isolado do cliente."
        />
        <Campo
          label="ID da conta de anúncios"
          name="ad_account_id"
          required
          maxLength={255}
          placeholder="1234567890123456"
          dica="Só os números. O prefixo act_ é removido automaticamente."
        />
        <Campo
          label="ID do pixel / dataset"
          name="meta_pixel_dataset_id"
          required
          maxLength={255}
          placeholder="1234567890123456"
        />
        <Campo
          label="Categoria de conteúdo"
          name="content_category"
          maxLength={255}
          placeholder="energia_solar"
          dica="Opcional. Vai junto nos eventos enviados à Meta."
        />
      </div>

      <Campo
        label="Token de acesso da Meta"
        name="meta_access_token"
        type="password"
        required
        autoComplete="off"
        dica="Token de System User, com permissão na conta de anúncios e no dataset."
      />

      <fieldset className="space-y-4 rounded-[var(--radius-control)] border border-[var(--border-default)] p-4">
        <legend className="px-1 text-sm font-medium text-[var(--text-secondary)]">
          CRM (Kommo), opcional
        </legend>
        <p className="text-xs text-[var(--text-tertiary)]">
          Preencha apenas se este cliente usa Formulários Instantâneos com Kommo. Cliente que só
          usa WhatsApp pode deixar em branco.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="ID da conta no CRM" name="crm_account_id" maxLength={255} />
          <Campo
            label="Token de acesso do Kommo"
            name="kommo_access_token"
            type="password"
            autoComplete="off"
          />
          <Campo
            label="Subdomínio do Kommo"
            name="kommo_subdomain"
            maxLength={120}
            placeholder="minhaempresa"
            dica={
              'Só o nome da conta, sem https e sem .kommo.com. É o que a automação de ' +
              'negócios perdidos usa para consultar o CRM.'
            }
          />
        </div>
      </fieldset>

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      {estado.sucesso ? (
        <div className="space-y-2">
          <Alerta tipo="sucesso">{estado.sucesso}</Alerta>
          <Link href="/app" className="text-sm underline">
            Ir para a lista de clientes
          </Link>
        </div>
      ) : null}

      <div className="sm:max-w-[220px]">
        <BotaoEnviar carregando="Criando…">Criar cliente</BotaoEnviar>
      </div>
    </form>
  );
}
