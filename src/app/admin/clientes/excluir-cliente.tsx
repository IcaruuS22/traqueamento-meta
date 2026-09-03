'use client';

import { useActionState, useState } from 'react';
import { acaoExcluirCliente } from '@/lib/acoes/clientes';
import { confirmacaoDeExclusaoBate } from '@/lib/nomes-banco';
import type { EstadoFormulario } from '@/lib/auth/actions';
import { Alerta, BotaoEnviar } from '@/components/form';

/**
 * Exclusão de cliente, com a confirmação por digitação.
 *
 * São dois passos de propósito: o botão só abre o aviso, e o aviso só
 * libera o envio quando o nome digitado bate. A checagem daqui é
 * conveniência de tela — quem decide de verdade é a Server Action, que
 * refaz a mesma comparação com o nome vindo do catálogo.
 *
 * O texto não suaviza nada: não existe lixeira, backup automático nem
 * desfazer. Depois de excluído, o único caminho de volta é um dump feito
 * antes.
 */
export function ExcluirCliente({ nome, banco }: { nome: string; banco: string }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoExcluirCliente, {});
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');

  const confere = confirmacaoDeExclusaoBate(texto, [nome, banco]);

  if (estado.sucesso) return <Alerta tipo="sucesso">{estado.sucesso}</Alerta>;

  if (!aberto) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="btn-ghost px-2 py-1 text-xs text-red-700"
        >
          Excluir cliente
        </button>
        {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      </div>
    );
  }

  return (
    <form action={acao} className="space-y-3 rounded-[var(--radius-control)] bg-red-50 p-4">
      <input type="hidden" name="client_db" value={banco} />

      <p className="text-sm font-medium text-red-700">
        Excluir “{nome}” é permanente e não tem como reverter.
      </p>
      <p className="text-xs text-red-700">
        Some o banco <code>{banco}</code> inteiro: leads, conversas, mensagens, campanhas,
        mapeamentos de evento, mais o cadastro no catálogo, a conexão de WhatsApp, as
        preferências de métrica e os vínculos dos usuários com este cliente. Não existe lixeira
        nem backup automático: se você quer guardar esses dados, faça o dump antes de continuar.
      </p>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-red-700">
          Para confirmar, digite <strong>{nome}</strong>
        </span>
        <input
          name="confirmacao"
          className="field"
          autoComplete="off"
          maxLength={255}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={nome}
        />
      </label>

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}

      <div className="flex items-center gap-2">
        <BotaoEnviar
          disabled={!confere}
          carregando="Excluindo…"
          className="!w-auto !bg-red-700 px-3 py-1.5 text-xs disabled:opacity-50"
        >
          Excluir em definitivo
        </BotaoEnviar>
        <button
          type="button"
          onClick={() => {
            setAberto(false);
            setTexto('');
          }}
          className="btn-ghost px-2 py-1 text-xs"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
