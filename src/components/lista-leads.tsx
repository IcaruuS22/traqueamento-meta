'use client';

import { useState } from 'react';
import type { Lead } from '@/lib/db/metricas';
import { fmtDataHora, fmtDecorrido, ouTraco } from '@/lib/format';

/**
 * Tabela "Últimos leads" com "Carregar mais".
 *
 * A primeira página vem renderizada do servidor junto com a Visão geral;
 * as seguintes chegam por `/api/leads`, que é o porte de
 * `GET /painel-api/leads`. O componente é de cliente só por causa do
 * botão — a tabela em si é a mesma marcação que estava na página.
 */

const POR_PAGINA = 10;

export function ListaLeads({
  cliente,
  iniciais,
  busca,
}: {
  cliente: string;
  iniciais: Lead[];
  /** Query string de período e canal, repassada à paginação. */
  busca: string;
}) {
  const [leads, setLeads] = useState<Lead[]>(iniciais);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // A primeira página só é "a última" quando veio incompleta. Vindo
  // cheia não dá para saber sem perguntar — o botão continua à mostra.
  const [acabou, setAcabou] = useState(iniciais.length < POR_PAGINA);

  async function carregaMais() {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams(busca);
      params.set('client_db', cliente);
      params.set('limit', String(POR_PAGINA));
      params.set('offset', String(leads.length));
      const resposta = await fetch(`/api/leads?${params.toString()}`);
      const corpo = await resposta.json();
      if (!resposta.ok || !corpo?.ok) {
        throw new Error(corpo?.erro || 'Erro ao carregar mais leads.');
      }
      const novos = corpo.data.leads as Lead[];
      // Filtra por id: entre uma página e outra pode entrar lead novo no
      // topo, e sem isso o mesmo lead apareceria duas vezes.
      const vistos = new Set(leads.map((l) => l.id));
      setLeads((atual) => [...atual, ...novos.filter((l) => !vistos.has(l.id))]);
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
              {['Nome', 'E-mail', 'Telefone', 'Etapa', 'Gerado em', 'Movimentação'].map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>
                  {ouTraco(`${l.first_name ?? ''} ${l.last_name ?? ''}`.trim())}
                </td>
                <td>{ouTraco(l.email)}</td>
                <td>{ouTraco(l.phone)}</td>
                <td>{ouTraco(l.current_stage)}</td>
                <td className="whitespace-nowrap">{fmtDataHora(l.created_at)}</td>
                <td className="whitespace-nowrap">
                  {l.last_moved_at ? (
                    <>
                      {fmtDataHora(l.last_moved_at)}
                      <span className="block text-[11px] text-[var(--text-tertiary)]">
                        {fmtDecorrido(l.created_at, l.last_moved_at)} após gerado
                      </span>
                    </>
                  ) : (
                    <span className="text-[var(--text-tertiary)]">Ainda não moveu</span>
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
