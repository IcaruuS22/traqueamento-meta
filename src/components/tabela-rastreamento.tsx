'use client';

import { useState } from 'react';
import type { LinhaRastreio } from '@/lib/db/rastreamento';
import {
  CLASSE_CONFIANCA,
  CLASSE_FONTE,
  DICA_CONFIANCA,
  ROTULO_CONFIANCA,
  ROTULO_FONTE,
} from '@/lib/rastreamento';
import { fmtDataHora, ouTraco } from '@/lib/format';
import { ModalRastreio } from '@/components/modal-rastreio';

/**
 * Tabela de Rastreamento com "Carregar mais" e o modal de detalhe.
 *
 * A primeira página vem do servidor junto com a tela; as seguintes chegam
 * por `/api/rastreamento`. Trocar fonte, busca ou período continua sendo
 * navegação — o estado de cliente aqui é só a paginação e qual contato
 * está aberto no modal.
 */

const POR_PAGINA = 30;

function nomeDoLead(l: LinhaRastreio): string {
  const nome = `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim();
  return nome || String(l.email ?? '').trim() || 'Contato sem nome';
}

export function TabelaRastreamento({
  cliente,
  iniciais,
  busca,
}: {
  cliente: string;
  iniciais: LinhaRastreio[];
  /** Query string de período, fonte e busca, repassada à paginação. */
  busca: string;
}) {
  const [leads, setLeads] = useState<LinhaRastreio[]>(iniciais);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [acabou, setAcabou] = useState(iniciais.length < POR_PAGINA);
  const [aberto, setAberto] = useState<LinhaRastreio | null>(null);

  async function carregaMais() {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams(busca);
      params.set('client_db', cliente);
      params.set('limit', String(POR_PAGINA));
      params.set('offset', String(leads.length));
      const resposta = await fetch(`/api/rastreamento?${params.toString()}`);
      const corpo = await resposta.json();
      if (!resposta.ok || !corpo?.ok) {
        throw new Error(corpo?.erro || 'Erro ao carregar mais leads.');
      }
      const novos = corpo.data.leads as LinhaRastreio[];
      // Filtra por id: entre uma página e outra pode entrar lead novo no
      // topo e empurrar o offset, duplicando linhas.
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
              {['Contato', 'Fonte', 'Campanha', 'Anúncio', 'Data', 'Confiança', ''].map((c, i) => (
                <th key={c || `acao-${i}`}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>
                  {nomeDoLead(l)}
                  {l.phone || l.email ? (
                    <span className="block text-[11px] text-[var(--text-tertiary)]">
                      {l.phone || l.email}
                    </span>
                  ) : null}
                </td>
                <td>
                  <span
                    className={`inline-flex h-[22px] items-center rounded-[var(--radius-pill)] px-2.5 text-[11px] font-medium ${CLASSE_FONTE[l.fonte]}`}
                  >
                    {ROTULO_FONTE[l.fonte]}
                  </span>
                </td>
                <td className="max-w-[220px]">
                  <span className="line-clamp-2">{ouTraco(l.campanha)}</span>
                </td>
                <td className="max-w-[220px]">
                  <span className="line-clamp-2">{ouTraco(l.anuncio)}</span>
                </td>
                <td className="whitespace-nowrap">{fmtDataHora(l.created_at)}</td>
                <td>
                  <span
                    title={DICA_CONFIANCA[l.confianca]}
                    className={`inline-flex h-[22px] items-center rounded-[var(--radius-pill)] px-2.5 text-[11px] font-medium ${CLASSE_CONFIANCA[l.confianca]}`}
                  >
                    {ROTULO_CONFIANCA[l.confianca]}
                  </span>
                </td>
                <td className="whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setAberto(l)}
                    className="rounded-[var(--radius-control)] border px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-field)]"
                  >
                    Ver detalhe
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {erro ? (
        <p className="rounded-[var(--radius-control)] bg-[var(--red-50)] px-3 py-2 text-sm text-[var(--red-700)]">
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

      {aberto ? (
        <ModalRastreio
          cliente={cliente}
          customerId={aberto.id}
          nomeInicial={nomeDoLead(aberto)}
          aoFechar={() => setAberto(null)}
        />
      ) : null}
    </div>
  );
}
