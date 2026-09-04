'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lead } from '@/lib/db/metricas';
import { fmtDataHora, fmtDecorrido, ouTraco } from '@/lib/format';
import { nomeParaExibir, telefoneParaExibir } from '@/lib/exibicao';
import { BadgeGanho } from '@/components/badge-ganho';
import { BadgePerdido } from '@/components/badge-perdido';
import { ModalLeadCrm } from '@/components/modal-lead-crm';

/**
 * Tabela "Últimos leads" com filtros e "Carregar mais".
 *
 * A primeira página vem renderizada do servidor junto com a Visão geral;
 * as seguintes chegam por `/api/leads`, que é o porte de
 * `GET /painel-api/leads`.
 *
 * Os filtros de etapa e nome ficam em estado local e refazem a consulta
 * pela mesma rota, em vez de irem para a URL: mexer na URL faria a Visão
 * geral inteira ser renderizada de novo no servidor — todas as consultas
 * de métricas do período — só para filtrar uma tabela.
 */

const POR_PAGINA = 10;
/** Espera antes de buscar, enquanto o usuário ainda está digitando. */
const MS_DEBOUNCE = 350;

export function ListaLeads({
  cliente,
  iniciais,
  busca,
  etapas,
}: {
  cliente: string;
  iniciais: Lead[];
  /** Query string de período e canal, repassada à paginação. */
  busca: string;
  /** Etapas presentes no período, para as opções do filtro. */
  etapas: string[];
}) {
  const [leads, setLeads] = useState<Lead[]>(iniciais);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // A primeira página só é "a última" quando veio incompleta. Vindo
  // cheia não dá para saber sem perguntar — o botão continua à mostra.
  const [acabou, setAcabou] = useState(iniciais.length < POR_PAGINA);

  // Lead aberto no modal de resumo. É o mesmo modal do quadro do CRM:
  // ali o motivo da perda, a campanha e o rastreio já estão montados, e
  // uma segunda tela de detalhe divergiria da primeira no primeiro
  // campo novo. A lista não passa `podeExcluir`, então o modal abre sem
  // o botão de excluir — apagar lead é assunto do CRM.
  const [aberto, setAberto] = useState<Lead | null>(null);

  const [etapa, setEtapa] = useState('');
  const [nome, setNome] = useState('');
  // `termo` é o `nome` depois que o usuário parou de digitar — é ele que
  // vai ao servidor.
  const [termo, setTermo] = useState('');
  const filtrando = etapa !== '' || termo !== '';

  useEffect(() => {
    const t = setTimeout(() => setTermo(nome.trim()), MS_DEBOUNCE);
    return () => clearTimeout(t);
  }, [nome]);

  const montaUrl = useCallback(
    (offset: number) => {
      const params = new URLSearchParams(busca);
      params.set('client_db', cliente);
      params.set('limit', String(POR_PAGINA));
      params.set('offset', String(offset));
      if (etapa) params.set('stage', etapa);
      if (termo) params.set('nome', termo);
      return `/api/leads?${params.toString()}`;
    },
    [busca, cliente, etapa, termo],
  );

  const pedePagina = useCallback(
    async (offset: number, sinal?: AbortSignal): Promise<Lead[]> => {
      const resposta = await fetch(montaUrl(offset), { signal: sinal });
      const corpo = await resposta.json();
      if (!resposta.ok || !corpo?.ok) {
        throw new Error(corpo?.erro || 'Erro ao carregar leads.');
      }
      return corpo.data.leads as Lead[];
    },
    [montaUrl],
  );

  // Ao mudar um filtro a lista recomeça do zero. Sem filtro nenhum a
  // primeira página já está em mãos (veio do servidor), então não vale
  // uma ida ao banco só para receber o que já está na tela.
  const primeiraCarga = useRef(true);
  useEffect(() => {
    if (primeiraCarga.current) {
      primeiraCarga.current = false;
      return;
    }
    if (!filtrando) {
      setLeads(iniciais);
      setAcabou(iniciais.length < POR_PAGINA);
      setErro(null);
      return;
    }
    const ctrl = new AbortController();
    setCarregando(true);
    setErro(null);
    pedePagina(0, ctrl.signal)
      .then((novos) => {
        setLeads(novos);
        setAcabou(novos.length < POR_PAGINA);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCarregando(false);
      });
    // Cada troca de filtro cancela a busca anterior: sem isso, a resposta
    // lenta do filtro antigo poderia chegar depois e sobrescrever a lista
    // do filtro novo.
    return () => ctrl.abort();
    // Só etapa e termo entram aqui de propósito: `iniciais` é um array
    // novo a cada render do servidor, e listá-lo faria a tabela voltar à
    // primeira página sozinha, jogando fora o que o "Carregar mais" já
    // tinha trazido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa, termo]);

  async function carregaMais() {
    setCarregando(true);
    setErro(null);
    try {
      const novos = await pedePagina(leads.length);
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
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filtrar por etapa"
          className="field filtro-campo"
          value={etapa}
          onChange={(e) => setEtapa(e.target.value)}
        >
          <option value="">Todas as etapas</option>
          {etapas.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>

        <input
          type="search"
          aria-label="Filtrar por nome"
          placeholder="Filtrar por nome..."
          className="field filtro-campo min-w-[180px]"
          value={nome}
          maxLength={120}
          onChange={(e) => setNome(e.target.value)}
        />

        {etapa || nome ? (
          <button
            type="button"
            onClick={() => {
              setNome('');
              setEtapa('');
            }}
            className="text-xs text-[var(--text-tertiary)] underline underline-offset-2"
          >
            Limpar
          </button>
        ) : null}
      </div>

      <div className="table-wrap">
        <table className="tabela-painel">
          <thead>
            <tr>
              {['Nome', 'E-mail', 'Telefone', 'Etapa', 'Gerado em', 'Movimentação'].map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th>
                <span className="sr-only">Resumo</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>
                  {ouTraco(nomeParaExibir(l.first_name, l.last_name))}
                </td>
                <td>{ouTraco(l.email)}</td>
                <td>{ouTraco(telefoneParaExibir(l.phone))}</td>
                <td>
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {ouTraco(l.current_stage)}
                    <BadgeGanho etapa={l.current_stage} />
                    <BadgePerdido perdido={Number(l.is_lost) === 1} motivo={l.lost_reason} />
                  </span>
                </td>
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
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAberto(l)}
                  >
                    Resumo
                  </button>
                </td>
              </tr>
            ))}
            {leads.length === 0 && !carregando ? (
              <tr>
                <td colSpan={7} className="text-[var(--text-tertiary)]">
                  {etapa || termo ? 'Nenhum lead com esses filtros.' : 'Nenhum lead no período.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {erro ? (
        <p className="rounded-[var(--radius-control)] bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}

      {aberto ? (
        <ModalLeadCrm
          cliente={cliente}
          cartao={aberto}
          aoFechar={() => setAberto(null)}
          // A etapa só é editável no modal quando o lead é de WhatsApp;
          // quando isso acontece, a linha da tabela precisa acompanhar,
          // senão fica mostrando a etapa antiga até o próximo F5.
          aoAtualizar={(mudanca) =>
            setLeads((atual) =>
              atual.map((l) =>
                l.id === mudanca.id && mudanca.etapa !== undefined
                  ? { ...l, current_stage: mudanca.etapa }
                  : l,
              ),
            )
          }
        />
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
