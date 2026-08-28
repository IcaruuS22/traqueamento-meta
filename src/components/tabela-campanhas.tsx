'use client';

import { useState } from 'react';
import type { LinhaHierarquia, NivelHierarquia } from '@/lib/db/campanhas';
import { fmtBRL, fmtInt, fmtDec, fmtPct, fmtRoas, fmtRoi } from '@/lib/format';

/**
 * Hierarquia Campanha → Conjunto → Anúncio.
 *
 * É o único componente de cliente das telas de leitura, e por um motivo
 * concreto: expandir uma linha precisa buscar os filhos sob demanda. As
 * campanhas já chegam renderizadas do servidor; conjuntos e anúncios são
 * carregados só quando alguém abre a linha — o painel antigo fazia igual,
 * porque carregar os três níveis de antemão são dezenas de consultas por
 * render para dados que quase nunca são abertos.
 */

const FILHO: Record<NivelHierarquia, NivelHierarquia | null> = {
  campaign: 'adset',
  adset: 'ad',
  ad: null,
};

const ROTULO_FILHO: Record<NivelHierarquia, string> = {
  campaign: 'campanhas',
  adset: 'conjuntos',
  ad: 'anúncios',
};

export type ColunasOpcionais = { receita: boolean; roas: boolean; roi: boolean };

type Item =
  | { tipo: 'linha'; chave: string; nivel: NivelHierarquia; profundidade: number; linha: LinhaHierarquia }
  | { tipo: 'aviso'; chave: string; profundidade: number; texto: string };

function Chip({ status }: { status: string | null }) {
  const bruto = String(status ?? '').trim();
  const s = bruto.toUpperCase();
  const cor =
    s === 'ACTIVE'
      ? 'bg-green-50 text-green-700'
      : s === 'PAUSED'
        ? 'bg-[var(--bg-field)] text-[var(--text-secondary)]'
        : 'bg-amber-50 text-amber-700';
  return (
    <span
      className={`inline-block rounded-[var(--radius-chip)] px-1.5 py-0.5 text-[11px] font-medium ${cor}`}
    >
      {bruto ? bruto.toLowerCase() : '—'}
    </span>
  );
}

export function TabelaCampanhas({
  cliente,
  linhas,
  busca,
  colunas,
}: {
  cliente: string;
  linhas: LinhaHierarquia[];
  /** Query string do período, repassada às chamadas de filhos. */
  busca: string;
  colunas: ColunasOpcionais;
}) {
  const [filhos, setFilhos] = useState<Record<string, LinhaHierarquia[]>>({});
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  async function alterna(chave: string, nivel: NivelHierarquia, id: string) {
    const filho = FILHO[nivel];
    if (!filho) return;

    if (abertos.has(chave)) {
      setAbertos((atual) => {
        const proximo = new Set(atual);
        proximo.delete(chave);
        return proximo;
      });
      return;
    }

    setAbertos((atual) => new Set(atual).add(chave));
    // Já carregado antes: reabrir não refaz a consulta. O período não muda
    // sem uma navegação, e a navegação remonta o componente inteiro.
    if (filhos[chave]) return;

    setErro(null);
    setCarregando((atual) => new Set(atual).add(chave));
    try {
      const params = new URLSearchParams(busca);
      params.set('client_db', cliente);
      params.set('nivel', filho);
      params.set('pai', id);
      const resposta = await fetch(`/api/campanhas?${params.toString()}`);
      const corpo = await resposta.json();
      if (!resposta.ok || !corpo?.ok) {
        throw new Error(corpo?.erro || `Erro ao carregar ${ROTULO_FILHO[nivel]}.`);
      }
      setFilhos((atual) => ({ ...atual, [chave]: corpo.data.linhas as LinhaHierarquia[] }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
      setAbertos((atual) => {
        const proximo = new Set(atual);
        proximo.delete(chave);
        return proximo;
      });
    } finally {
      setCarregando((atual) => {
        const proximo = new Set(atual);
        proximo.delete(chave);
        return proximo;
      });
    }
  }

  function achata(
    lista: LinhaHierarquia[],
    nivel: NivelHierarquia,
    profundidade: number,
    saida: Item[],
  ) {
    for (const linha of lista) {
      const chave = `${nivel}:${linha.id}`;
      saida.push({ tipo: 'linha', chave, nivel, profundidade, linha });
      if (!abertos.has(chave)) continue;

      const filho = FILHO[nivel];
      const carregados = filhos[chave];
      if (!filho) continue;
      if (carregando.has(chave) || !carregados) {
        saida.push({
          tipo: 'aviso',
          chave: `${chave}:carregando`,
          profundidade: profundidade + 1,
          texto: `Carregando ${ROTULO_FILHO[nivel]}...`,
        });
      } else if (!carregados.length) {
        saida.push({
          tipo: 'aviso',
          chave: `${chave}:vazio`,
          profundidade: profundidade + 1,
          texto: `Nenhum ${filho === 'adset' ? 'conjunto' : 'anúncio'} encontrado.`,
        });
      } else {
        achata(carregados, filho, profundidade + 1, saida);
      }
    }
  }

  const itens: Item[] = [];
  achata(linhas, 'campaign', 0, itens);

  const cabecalhos = [
    'Nome',
    'Status',
    'Orçamento',
    'Gasto',
    'Impressões',
    'Alcance',
    'Frequência',
    'Cliques',
    'CTR',
    'CPC',
    'CPM',
    'Leads',
    'Conversões',
    'CPL',
    'CAC',
    ...(colunas.receita ? ['Receita'] : []),
    ...(colunas.roas ? ['ROAS'] : []),
    ...(colunas.roi ? ['ROI'] : []),
    'Funil de eventos',
  ];

  return (
    <div className="space-y-3">
      {erro ? (
        <p className="rounded-[var(--radius-control)] bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}

      <div className="table-wrap">
        <table className="tabela-painel" style={{ minWidth: 1400 }}>
          <thead>
            <tr>
              {cabecalhos.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {itens.map((item) =>
              item.tipo === 'aviso' ? (
                <tr key={item.chave}>
                  <td
                    colSpan={cabecalhos.length}
                    className="text-[var(--text-tertiary)]"
                    style={{ paddingLeft: item.profundidade * 20 }}
                  >
                    {item.texto}
                  </td>
                </tr>
              ) : (
                <LinhaTabela
                  key={item.chave}
                  item={item}
                  colunas={colunas}
                  aberto={abertos.has(item.chave)}
                  onAlterna={() => alterna(item.chave, item.nivel, item.linha.id)}
                />
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinhaTabela({
  item,
  colunas,
  aberto,
  onAlterna,
}: {
  item: Extract<Item, { tipo: 'linha' }>;
  colunas: ColunasOpcionais;
  aberto: boolean;
  onAlterna: () => void;
}) {
  const l = item.linha;
  const podeExpandir = FILHO[item.nivel] !== null;

  return (
    <tr className={item.profundidade > 0 ? 'bg-[var(--bg-field-on-canvas)]' : undefined}>
      <td style={{ paddingLeft: item.profundidade * 20 }}>
        <span className="flex items-center gap-1.5">
          {podeExpandir ? (
            <button
              type="button"
              onClick={onAlterna}
              aria-expanded={aberto}
              aria-label={aberto ? 'Recolher' : 'Expandir'}
              className="shrink-0 rounded-[var(--radius-chip)] px-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-field)]"
            >
              {aberto ? '▾' : '▸'}
            </button>
          ) : (
            <span className="w-[18px] shrink-0" />
          )}
          <span
            className={
              l.nome
                ? 'max-w-[280px] truncate'
                : 'max-w-[280px] truncate text-[var(--text-tertiary)]'
            }
            title={l.nome ?? undefined}
          >
            {l.nome || '(sem nome)'}
          </span>
        </span>
      </td>
      <td>
        <Chip status={l.status} />
      </td>
      <td className="tabular-nums whitespace-nowrap">
        {l.orcamento === null ? '—' : fmtBRL(l.orcamento)}
      </td>
      <td className="tabular-nums whitespace-nowrap">{fmtBRL(l.spend)}</td>
      <td className="tabular-nums">{fmtInt(l.impressions)}</td>
      <td className="tabular-nums">{fmtInt(l.reach)}</td>
      <td className="tabular-nums">{fmtDec(l.frequency, 2)}</td>
      <td className="tabular-nums">{fmtInt(l.clicks)}</td>
      <td className="tabular-nums">{fmtPct(l.ctr)}</td>
      <td className="tabular-nums whitespace-nowrap">{fmtBRL(l.cpc)}</td>
      <td className="tabular-nums whitespace-nowrap">{fmtBRL(l.cpm)}</td>
      <td className="tabular-nums">{fmtInt(l.total_leads)}</td>
      <td className="tabular-nums">{fmtInt(l.total_conversoes)}</td>
      <td className="tabular-nums whitespace-nowrap">
        {l.cpl === null ? '—' : fmtBRL(l.cpl)}
      </td>
      <td className="tabular-nums whitespace-nowrap">
        {l.cac === null ? '—' : fmtBRL(l.cac)}
      </td>
      {colunas.receita ? (
        <td className="tabular-nums whitespace-nowrap">{fmtBRL(l.receita)}</td>
      ) : null}
      {colunas.roas ? (
        <td className="tabular-nums">{fmtRoas(l.spend, l.receita)}</td>
      ) : null}
      {colunas.roi ? <td className="tabular-nums">{fmtRoi(l.spend, l.receita)}</td> : null}
      <td>
        {l.funil_eventos.length ? (
          <span className="flex flex-wrap gap-1">
            {l.funil_eventos.map((e) => (
              <span
                key={e.event_name}
                className="rounded-[var(--radius-chip)] bg-[var(--bg-field)] px-1.5 py-0.5 text-[11px] whitespace-nowrap"
              >
                {e.event_name} <b className="tabular-nums">{fmtInt(e.total)}</b>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-[var(--text-tertiary)]">—</span>
        )}
      </td>
    </tr>
  );
}
