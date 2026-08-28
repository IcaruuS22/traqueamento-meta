'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alerta } from '@/components/form';

/**
 * Botões "Atualizar dados da Meta" e "Importar histórico".
 *
 * Os dois disparam webhooks que continuam no n8n, mas passando pelo app
 * (`/api/clientes/[cliente]/…`): assim a chamada carrega a sessão de quem
 * clicou, é registrada na auditoria e o token do n8n não vai para o
 * navegador. No painel antigo o `fetch` ia direto do HTML para o n8n com
 * Basic Auth.
 *
 * Terminada a chamada, `router.refresh()` recarrega os dados renderizados
 * no servidor — sem ele a tela continuaria mostrando o que já estava lá,
 * que é justamente o que a pessoa acabou de pedir para atualizar.
 */

type Estado = { tipo: 'erro' | 'sucesso' | 'aviso'; texto: string } | null;

export function BotoesMeta({
  cliente,
  mostrarImportacao = false,
}: {
  cliente: string;
  /** A importação de 90 dias só aparece na tela de Campanhas. */
  mostrarImportacao?: boolean;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>(null);
  const [acao, setAcao] = useState<'sync' | 'historico' | null>(null);
  const [pendente, iniciar] = useTransition();

  function chama(qual: 'sync' | 'historico') {
    setEstado(null);
    setAcao(qual);
    iniciar(async () => {
      const rota = qual === 'sync' ? 'sync' : 'importar-historico';
      try {
        const r = await fetch(
          `/api/clientes/${encodeURIComponent(cliente)}/${rota}`,
          { method: 'POST' },
        );
        const corpo = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          data?: { executou: boolean; mensagem: string };
          erro?: string;
        };
        if (!r.ok || !corpo.ok || !corpo.data) {
          setEstado({ tipo: 'erro', texto: corpo.erro || 'Não foi possível concluir.' });
          return;
        }
        // "Já em andamento" não é falha: é o segundo clique encontrando a
        // trava de 60s do n8n. Aviso, e os dados do banco seguem na tela.
        setEstado({
          tipo: corpo.data.executou ? 'sucesso' : 'aviso',
          texto: corpo.data.mensagem,
        });
        router.refresh();
      } catch {
        setEstado({ tipo: 'erro', texto: 'Falha de conexão com o app.' });
      } finally {
        setAcao(null);
      }
    });
  }

  const ocupado = pendente;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => chama('sync')}
          disabled={ocupado}
          className="btn-ghost disabled:opacity-50"
        >
          {ocupado && acao === 'sync' ? 'Sincronizando…' : 'Atualizar dados da Meta'}
        </button>

        {mostrarImportacao ? (
          <button
            type="button"
            onClick={() => {
              // Confirmação porque a importação ocupa a conta do Meta por
              // minutos e reescreve 90 dias de métricas; o painel antigo
              // também perguntava, com `window.confirm`.
              const ok = window.confirm(
                'Importar até 90 dias de métricas do Meta Ads para este cliente? ' +
                  'A importação pode levar alguns minutos.',
              );
              if (ok) chama('historico');
            }}
            disabled={ocupado}
            className="btn-ghost disabled:opacity-50"
          >
            {ocupado && acao === 'historico'
              ? 'Importando histórico…'
              : 'Importar histórico (90 dias)'}
          </button>
        ) : null}
      </div>

      {ocupado ? (
        <p className="text-xs text-[var(--text-tertiary)]">
          {acao === 'historico'
            ? 'A importação varre até 90 dias de métricas e pode levar alguns minutos.'
            : 'Buscando os últimos 3 dias de métricas na Meta.'}
        </p>
      ) : null}

      {estado ? <Alerta tipo={estado.tipo}>{estado.texto}</Alerta> : null}
    </div>
  );
}
