'use client';

import { useState } from 'react';
import type { EventoRecente } from '@/lib/db/eventos';
import { fmtDataHora, fmtBRL, ouTraco } from '@/lib/format';
import { nomeParaExibir, telefoneParaExibir } from '@/lib/exibicao';

/**
 * Tabela de "Últimos eventos" com "Carregar mais".
 *
 * A primeira página vem do servidor junto com a tela; as seguintes chegam
 * por `/api/eventos`. Componente de cliente só por causa do botão — trocar
 * status, busca ou período continua sendo navegação, não estado local.
 *
 * `POR_PAGINA` repete o padrão do endpoint antigo (30). Está aqui e não
 * importado de `@/lib/db/eventos` porque aquele módulo é `server-only`.
 */

const POR_PAGINA = 30;

const ROTULOS_STATUS: Record<string, string> = {
  SENT: 'Enviado',
  ERROR: 'Erro',
  PENDING: 'Pendente',
  DUPLICATE: 'Duplicado',
};

function Status({ valor }: { valor: string }) {
  // As cores vêm de `.status-tag.SENT|ERROR|PENDING|DUPLICATE`, portadas
  // do painel; o rótulo em português é do app.
  return (
    <span className={`status-tag ${valor}`}>{ROTULOS_STATUS[valor] ?? valor}</span>
  );
}

/** Nome completo, e-mail como segunda opção — igual ao painel antigo. */
function nomeDoLead(e: EventoRecente): string {
  const nome = nomeParaExibir(e.lead_first_name, e.lead_last_name);
  return nome || String(e.lead_email ?? '').trim() || '—';
}

function valorDoEvento(e: EventoRecente): string {
  if (e.value === null || e.value === undefined || e.value === '') return '—';
  const n = Number(e.value);
  if (!Number.isFinite(n)) return '—';
  // Fora de BRL não dá para usar o formatador de real: mostra o número com
  // a moeda que o evento carrega, sem fingir que é outra coisa.
  return e.currency && e.currency !== 'BRL'
    ? `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${e.currency}`
    : fmtBRL(n);
}

export function TabelaEventos({
  cliente,
  iniciais,
  busca,
}: {
  cliente: string;
  iniciais: EventoRecente[];
  /** Query string de período, canal, status e busca, repassada à paginação. */
  busca: string;
}) {
  const [eventos, setEventos] = useState<EventoRecente[]>(iniciais);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Página cheia não prova que existe outra; incompleta prova que não.
  const [acabou, setAcabou] = useState(iniciais.length < POR_PAGINA);

  async function carregaMais() {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams(busca);
      params.set('client_db', cliente);
      params.set('limit', String(POR_PAGINA));
      params.set('offset', String(eventos.length));
      const resposta = await fetch(`/api/eventos?${params.toString()}`);
      const corpo = await resposta.json();
      if (!resposta.ok || !corpo?.ok) {
        throw new Error(corpo?.erro || 'Erro ao carregar mais eventos.');
      }
      const novos = corpo.data.eventos as EventoRecente[];
      // Filtra por id: entre uma página e outra pode entrar evento novo no
      // topo e empurrar o offset, duplicando linhas.
      const vistos = new Set(eventos.map((e) => e.id));
      setEventos((atual) => [...atual, ...novos.filter((e) => !vistos.has(e.id))]);
      if (novos.length < POR_PAGINA) setAcabou(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="table-wrap">
        <table className="tabela-painel">
          <thead>
            <tr>
              {['Data', 'Evento', 'Lead', 'Status', 'Valor', 'Erro'].map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap">{fmtDataHora(e.created_at)}</td>
                <td>
                  {ouTraco(e.content_name || e.event_name)}
                  {e.content_name && e.event_name ? (
                    <span className="block text-[11px] text-[var(--text-tertiary)]">
                      {e.event_name}
                    </span>
                  ) : null}
                </td>
                <td>
                  {nomeDoLead(e)}
                  {e.lead_phone ? (
                    <span className="block text-[11px] text-[var(--text-tertiary)]">
                      {telefoneParaExibir(e.lead_phone)}
                    </span>
                  ) : null}
                </td>
                <td>
                  <Status valor={e.status} />
                </td>
                <td className="tabular-nums whitespace-nowrap">{valorDoEvento(e)}</td>
                <td className="max-w-[280px] text-xs text-[var(--text-tertiary)]">
                  {e.error_message ? (
                    <span title={e.error_message} className="line-clamp-2">
                      {e.error_message}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {erro ? (
        <p className="rounded-[var(--radius-control)] bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}

      {acabou ? null : (
        <div className="load-more-wrap">
          <button
            type="button"
            onClick={carregaMais}
            disabled={carregando}
            className="rounded-[var(--radius-control)] border px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-field)] disabled:opacity-60"
          >
            {carregando ? 'Carregando...' : 'Carregar mais'}
          </button>
        </div>
      )}
    </div>
  );
}
