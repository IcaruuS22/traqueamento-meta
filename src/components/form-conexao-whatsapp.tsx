'use client';

import { useActionState, useState } from 'react';
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
 *
 * O bloco do pixel de mensagens vive aqui, e não na tela de Pixel/CAPI
 * dos formulários, porque é outro destino: evento de conversa não pode
 * cair no pixel do site. O seletor de modo é a trava — nasce em "teste"
 * e só passa a valer como conversão quando alguém escolhe "produção".
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
    capi: {
      modo: 'desligado' | 'teste' | 'producao';
      dataset_id: string | null;
      test_event_code: string | null;
      token_cadastrado: boolean;
      disponivel: boolean;
    };
  };
}) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(
    acaoSalvarConexaoWhatsapp,
    {},
  );
  // Só para o texto de aviso mudar junto com o select; quem decide o
  // envio é o servidor, com o valor gravado.
  const [modo, setModo] = useState(inicial.capi.modo);

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
        dica="Opcional, e só vale para os eventos de formulário enviados pelo n8n. O código de teste do WhatsApp é o do bloco abaixo."
      />

      <div className="space-y-4 rounded-[var(--radius-control)] border border-[var(--border)] p-4">
        <div>
          <h3 className="text-sm font-medium text-[var(--text-secondary)]">
            Pixel de mensagens (Conversions API)
          </h3>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Destino dos eventos de WhatsApp. É um dataset separado do pixel dos formulários — as
            conversas não entram na contagem do site.
          </p>
        </div>

        {inicial.capi.disponivel ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">
                Modo de envio
              </span>
              <select
                name="capi_modo"
                className="field"
                value={modo}
                onChange={(e) => setModo(e.target.value as typeof modo)}
              >
                <option value="desligado">Desligado — nenhum evento sai</option>
                <option value="teste">Teste — só em “Testar eventos”, não vira conversão</option>
                <option value="producao">Produção — os eventos valem como conversão</option>
              </select>
              <span className="mt-1 block text-xs text-[var(--text-tertiary)]">
                {modo === 'producao'
                  ? 'Os eventos passam a contar como conversão no pixel de mensagens.'
                  : modo === 'teste'
                    ? 'Exige o Test Event Code abaixo: sem ele o evento sairia valendo.'
                    : 'Nada é enviado à Meta enquanto estiver desligado.'}
              </span>
            </label>

            <Campo
              label="Dataset do pixel de mensagens"
              name="capi_dataset_id"
              defaultValue={inicial.capi.dataset_id ?? ''}
              inputMode="numeric"
              dica="Gerenciador de Eventos → o pixel/dataset criado para mensagens → Configurações, campo “ID do conjunto de dados”. Sem ele nenhum evento sai."
            />

            <Campo
              label="Test Event Code do WhatsApp"
              name="capi_test_event_code"
              defaultValue={inicial.capi.test_event_code ?? ''}
              dica="Gerenciador de Eventos → Testar eventos. Separado do código dos formulários: dá para testar as mensagens sem marcar os formulários como teste."
            />

            <Campo
              label="Token da CAPI de mensagens"
              name="capi_access_token"
              type="password"
              autoComplete="off"
              placeholder={inicial.capi.token_cadastrado ? '•••• já cadastrado' : ''}
              dica={
                inicial.capi.token_cadastrado
                  ? 'Deixe em branco para manter o token atual.'
                  : 'Opcional. Em branco, usa o token da Meta já cadastrado no cliente — serve quando os dois datasets estão na mesma conta de negócios.'
              }
            />
          </>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">
            O catálogo ainda não tem as colunas do pixel de mensagens. Rode{' '}
            <code>migracao_whatsapp_pixel_mensagens.sql</code> no banco{' '}
            <code>trakeamento_controle</code> e recarregue esta página. Até lá nenhum evento de
            WhatsApp é enviado à Meta.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <BotaoEnviar carregando="Salvando…" className="w-auto px-4">
          Salvar conexão
        </BotaoEnviar>
      </div>
    </form>
  );
}
