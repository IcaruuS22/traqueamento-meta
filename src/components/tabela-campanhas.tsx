'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { EventoFunil, LinhaHierarquia, NivelHierarquia } from '@/lib/db/campanhas';
import {
  proximoStatus,
  rotuloStatus,
  somaCampanhas,
  tomStatus,
  type TotaisCampanhas,
} from '@/lib/campanhas';
import { acaoAlterarStatus } from '@/lib/acoes/campanhas';
import { Icones } from '@/components/icones';
import { Alerta } from '@/components/form';
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
 *
 * São 19 colunas: a tabela rola na horizontal e a coluna Nome fica presa à
 * esquerda (`col-fixa`), senão quem rola até o ROI não sabe mais de qual
 * campanha é a linha.
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

const ROTULO_NIVEL: Record<NivelHierarquia, string> = {
  campaign: 'Campanha',
  adset: 'Conjunto',
  ad: 'Anúncio',
};

export type ColunasOpcionais = { receita: boolean; roas: boolean; roi: boolean };

type Item =
  | {
      tipo: 'linha';
      chave: string;
      nivel: NivelHierarquia;
      profundidade: number;
      linha: LinhaHierarquia;
    }
  | { tipo: 'aviso'; chave: string; profundidade: number; texto: string };

/**
 * Uma coluna de métrica descreve cabeçalho, célula e total no mesmo lugar.
 *
 * Antes o cabeçalho era um array solto e as células eram JSX escrito à mão
 * em outra parte do arquivo: bastava inserir uma coluna em um dos dois para
 * a tabela sair torta. Com o rodapé de totais seriam três listas paralelas
 * para manter em sincronia.
 */
type ColunaMetrica = {
  chave: string;
  rotulo: string;
  /** Explicação no `title` do cabeçalho, para as siglas. */
  dica?: string;
  /** Coluna que o cliente pode esconder pelo seletor de métricas. */
  opcional?: keyof ColunasOpcionais;
  valor: (l: LinhaHierarquia) => string;
  total: (t: TotaisCampanhas) => string;
};

const COLUNAS: ColunaMetrica[] = [
  {
    chave: 'orcamento',
    rotulo: 'Orçamento',
    dica: 'Orçamento diário quando existe; senão o vitalício. Anúncio não tem orçamento próprio.',
    valor: (l) => (l.orcamento === null ? '—' : fmtBRL(l.orcamento)),
    // Somar diário com vitalício daria um número sem significado.
    total: () => '—',
  },
  { chave: 'spend', rotulo: 'Gasto', valor: (l) => fmtBRL(l.spend), total: (t) => fmtBRL(t.spend) },
  {
    chave: 'impressions',
    rotulo: 'Impressões',
    valor: (l) => fmtInt(l.impressions),
    total: (t) => fmtInt(t.impressions),
  },
  {
    chave: 'reach',
    rotulo: 'Alcance',
    dica: 'Pessoas únicas alcançadas. Não soma entre campanhas: quem viu duas contaria duas vezes.',
    valor: (l) => fmtInt(l.reach),
    total: () => '—',
  },
  {
    chave: 'frequency',
    rotulo: 'Frequência',
    dica: 'Impressões por pessoa alcançada.',
    valor: (l) => fmtDec(l.frequency, 2),
    total: () => '—',
  },
  {
    chave: 'clicks',
    rotulo: 'Cliques',
    valor: (l) => fmtInt(l.clicks),
    total: (t) => fmtInt(t.clicks),
  },
  {
    chave: 'ctr',
    rotulo: 'CTR',
    dica: 'Cliques ÷ impressões.',
    valor: (l) => fmtPct(l.ctr),
    total: (t) => fmtPct(t.ctr),
  },
  {
    chave: 'cpc',
    rotulo: 'CPC',
    dica: 'Custo por clique.',
    valor: (l) => fmtBRL(l.cpc),
    total: (t) => fmtBRL(t.cpc),
  },
  {
    chave: 'cpm',
    rotulo: 'CPM',
    dica: 'Custo por mil impressões.',
    valor: (l) => fmtBRL(l.cpm),
    total: (t) => fmtBRL(t.cpm),
  },
  {
    chave: 'leads',
    rotulo: 'Leads',
    valor: (l) => fmtInt(l.total_leads),
    total: (t) => fmtInt(t.total_leads),
  },
  {
    chave: 'conversoes',
    rotulo: 'Conversões',
    valor: (l) => fmtInt(l.total_conversoes),
    total: (t) => fmtInt(t.total_conversoes),
  },
  {
    chave: 'cpl',
    rotulo: 'CPL',
    dica: 'Custo por lead: gasto ÷ leads.',
    valor: (l) => (l.cpl === null ? '—' : fmtBRL(l.cpl)),
    total: (t) => (t.cpl === null ? '—' : fmtBRL(t.cpl)),
  },
  {
    chave: 'cac',
    rotulo: 'CAC',
    dica: 'Custo por cliente: gasto ÷ conversões.',
    valor: (l) => (l.cac === null ? '—' : fmtBRL(l.cac)),
    total: (t) => (t.cac === null ? '—' : fmtBRL(t.cac)),
  },
  {
    chave: 'receita',
    rotulo: 'Receita',
    opcional: 'receita',
    valor: (l) => fmtBRL(l.receita),
    total: (t) => fmtBRL(t.receita),
  },
  {
    chave: 'roas',
    rotulo: 'ROAS',
    dica: 'Receita ÷ gasto.',
    opcional: 'roas',
    valor: (l) => fmtRoas(l.spend, l.receita),
    total: (t) => fmtRoas(t.spend, t.receita),
  },
  {
    chave: 'roi',
    rotulo: 'ROI',
    dica: 'Retorno sobre o gasto: (receita − gasto) ÷ gasto.',
    opcional: 'roi',
    valor: (l) => fmtRoi(l.spend, l.receita),
    total: (t) => fmtRoi(t.spend, t.receita),
  },
];

type Tom = ReturnType<typeof tomStatus>;

const COR_TEXTO_STATUS: Record<Tom, string> = {
  ativo: 'text-green-700 dark:text-green-400',
  pausado: 'text-[var(--text-secondary)]',
  atencao: 'text-amber-700 dark:text-amber-400',
};

const COR_PONTO_STATUS: Record<Tom, string> = {
  ativo: 'bg-green-500',
  pausado: 'bg-[var(--border-strong)]',
  atencao: 'bg-amber-500',
};

/**
 * Chave liga/desliga + palavra, igual ao Gerenciador de Anúncios: quando o
 * status dá para alternar (só ACTIVE e PAUSED — ver `proximoStatus`), a
 * própria chave é o botão, e a posição dela mostra se a entidade está no ar.
 *
 * Status que a Meta não deixa alternar por aqui (arquivado, excluído, em
 * processamento) continua sendo ponto colorido + texto, porque uma chave que
 * não vira é pior do que nenhuma chave.
 */
function Status({
  status,
  nivel,
  onAlterna,
  pendente,
}: {
  status: string | null;
  nivel: NivelHierarquia;
  onAlterna?: () => void;
  pendente?: boolean;
}) {
  const tom = tomStatus(status);
  const rotulo = rotuloStatus(status, nivel);
  const proximo = onAlterna ? proximoStatus(status) : null;

  if (!proximo) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap ${COR_TEXTO_STATUS[tom]}`}
      >
        {pendente ? (
          <span className="spinner-inline" aria-hidden />
        ) : (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${COR_PONTO_STATUS[tom]}`} />
        )}
        {rotulo}
      </span>
    );
  }

  const ligado = tom === 'ativo';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={`${rotulo} — ${proximo === 'PAUSED' ? 'pausar' : 'ativar'} na Meta`}
      onClick={onAlterna}
      disabled={pendente}
      title={
        proximo === 'PAUSED'
          ? 'Pausar na Meta — a entrega para e o gasto também.'
          : 'Ativar na Meta — a entrega recomeça e volta a gastar.'
      }
      className={`inline-flex items-center gap-2 whitespace-nowrap disabled:cursor-default ${COR_TEXTO_STATUS[tom]}`}
    >
      {pendente ? (
        <span className="spinner-inline" aria-hidden />
      ) : (
        <span className={`toggle-status ${ligado ? 'toggle-status-ligado' : ''}`} aria-hidden>
          <span className="toggle-status-knob" />
        </span>
      )}
      {rotulo}
    </button>
  );
}

/** Quantos eventos do funil cabem na célula antes de virarem "+N". */
const MAX_CHIPS_FUNIL = 3;

/**
 * O funil vinha como uma nuvem de chips sem limite, e era ele que esticava
 * a linha: uma campanha com oito eventos quebrava em quatro fileiras e
 * empurrava a altura da linha inteira. Agora mostra os três maiores e
 * resume o resto em "+N", com a lista completa no `title`.
 */
function Funil({ eventos }: { eventos: EventoFunil[] }) {
  if (!eventos.length) return <span className="text-[var(--text-tertiary)]">—</span>;

  const visiveis = eventos.slice(0, MAX_CHIPS_FUNIL);
  const resto = eventos.length - visiveis.length;

  return (
    <span
      className="flex items-center gap-1"
      title={eventos.map((e) => `${e.event_name}: ${fmtInt(e.total)}`).join(' · ')}
    >
      {visiveis.map((e) => (
        <span
          key={e.event_name}
          className="rounded-[var(--radius-chip)] bg-[var(--bg-field)] px-1.5 py-0.5 text-[11px] whitespace-nowrap"
        >
          {e.event_name} <b className="tabular-nums">{fmtInt(e.total)}</b>
        </span>
      ))}
      {resto > 0 ? (
        <span className="text-[11px] whitespace-nowrap text-[var(--text-tertiary)]">+{resto}</span>
      ) : null}
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
  const router = useRouter();
  const [filhos, setFilhos] = useState<Record<string, LinhaHierarquia[]>>({});
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Status que a Meta já aceitou nesta sessão de tela. `router.refresh()`
  // recarrega as campanhas do servidor, mas os conjuntos e anúncios
  // abertos vivem em `filhos`, que é estado de cliente e não é refeito —
  // sem este mapa, a linha filha voltaria ao status antigo logo depois de
  // mudar.
  const [statusLocal, setStatusLocal] = useState<Record<string, string>>({});
  const [mudando, setMudando] = useState<string | null>(null);
  const [, iniciaMudanca] = useTransition();

  function alteraStatus(chave: string, nivel: NivelHierarquia, id: string, atual: string | null) {
    const proximo = proximoStatus(atual);
    if (!proximo || mudando) return;

    const pergunta =
      proximo === 'PAUSED'
        ? `Pausar ${ROTULO_NIVEL[nivel].toLowerCase()} na Meta? A entrega para imediatamente.`
        : `Ativar ${ROTULO_NIVEL[nivel].toLowerCase()} na Meta? A entrega recomeça e a conta volta a gastar.`;
    if (!window.confirm(pergunta)) return;

    setErro(null);
    setAviso(null);
    setMudando(chave);
    iniciaMudanca(async () => {
      try {
        const r = await acaoAlterarStatus({ cliente, nivel, id, status: proximo });
        if (!r.ok) {
          setErro(r.erro);
          return;
        }
        setStatusLocal((atualMapa) => ({ ...atualMapa, [chave]: proximo }));
        setAviso(r.sucesso);
        // As métricas não mudam com o status, mas o orçamento e o próprio
        // status vêm do servidor: sem o refresh, sair da tela e voltar
        // mostraria o valor antigo até a próxima sincronização.
        router.refresh();
      } catch {
        setErro('Falha ao falar com o servidor. Tente novamente.');
      } finally {
        setMudando(null);
      }
    });
  }

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

  const visiveis = COLUNAS.filter((c) => !c.opcional || colunas[c.opcional]);
  // Nome + Status + métricas + Funil de eventos.
  const totalDeColunas = visiveis.length + 3;
  const totais = somaCampanhas(linhas);

  return (
    <div className="space-y-3">
      {erro ? <Alerta tipo="erro">{erro}</Alerta> : null}
      {aviso ? <Alerta tipo="sucesso">{aviso}</Alerta> : null}

      <div className="table-wrap">
        <table className="tabela-painel tabela-metricas">
          <thead>
            <tr>
              <th className="col-fixa">Nome</th>
              <th>Status</th>
              {visiveis.map((c) => (
                <th key={c.chave} className="num" title={c.dica}>
                  {c.rotulo}
                </th>
              ))}
              <th>Funil de eventos</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) =>
              item.tipo === 'aviso' ? (
                <tr key={item.chave} className="linha-aninhada">
                  <td
                    colSpan={totalDeColunas}
                    className="text-[var(--text-tertiary)]"
                    style={{ paddingLeft: 12 + item.profundidade * 22 }}
                  >
                    {item.texto}
                  </td>
                </tr>
              ) : (
                <LinhaTabela
                  key={item.chave}
                  item={item}
                  colunas={visiveis}
                  aberto={abertos.has(item.chave)}
                  onAlterna={() => alterna(item.chave, item.nivel, item.linha.id)}
                  status={statusLocal[item.chave] ?? item.linha.status}
                  mudandoStatus={mudando === item.chave}
                  onStatus={() =>
                    alteraStatus(
                      item.chave,
                      item.nivel,
                      item.linha.id,
                      statusLocal[item.chave] ?? item.linha.status,
                    )
                  }
                />
              ),
            )}
          </tbody>
          {/* Uma campanha só já é o próprio total: a linha repetida só ocupa espaço. */}
          {linhas.length > 1 ? (
            <tfoot>
              <tr>
                <td className="col-fixa whitespace-nowrap">
                  Total · {fmtInt(totais.campanhas)} campanhas
                </td>
                <td />
                {visiveis.map((c) => (
                  <td key={c.chave} className="num">
                    {c.total(totais)}
                  </td>
                ))}
                <td>
                  <Funil eventos={totais.funil_eventos} />
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <p className="text-xs text-[var(--text-tertiary)]">
        A seta abre os conjuntos de uma campanha e os anúncios de um conjunto. A chave da coluna
        de status liga ou desliga a campanha, o conjunto ou o anúncio direto na Meta. A tabela
        rola para o lado; a coluna de nome fica fixa.
      </p>
    </div>
  );
}

function LinhaTabela({
  item,
  colunas,
  aberto,
  onAlterna,
  status,
  mudandoStatus,
  onStatus,
}: {
  item: Extract<Item, { tipo: 'linha' }>;
  colunas: ColunaMetrica[];
  aberto: boolean;
  onAlterna: () => void;
  /** Status vigente: o do servidor, ou o que a Meta acabou de aceitar. */
  status: string | null;
  mudandoStatus: boolean;
  onStatus: () => void;
}) {
  const l = item.linha;
  const podeExpandir = FILHO[item.nivel] !== null;

  return (
    <tr className={item.profundidade > 0 ? 'linha-aninhada' : undefined}>
      <td className="col-fixa">
        <span className="flex items-center gap-1.5" style={{ paddingLeft: item.profundidade * 22 }}>
          {podeExpandir ? (
            <button
              type="button"
              onClick={onAlterna}
              aria-expanded={aberto}
              aria-label={aberto ? 'Recolher' : 'Expandir'}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-chip)] text-[var(--text-tertiary)] hover:bg-[var(--bg-field)] hover:text-[var(--text-primary)]"
            >
              <Icones.chevron
                className={`block shrink-0 transition-transform ${aberto ? 'rotate-90' : ''}`}
                width={13}
                height={13}
              />
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <span className="min-w-0">
            <span
              className={`block max-w-[320px] truncate ${l.nome ? '' : 'text-[var(--text-tertiary)]'}`}
              title={l.nome ?? undefined}
            >
              {l.nome || '(sem nome)'}
            </span>
            {item.profundidade > 0 ? (
              <span className="block text-[11px] text-[var(--text-tertiary)]">
                {ROTULO_NIVEL[item.nivel]}
              </span>
            ) : null}
          </span>
        </span>
      </td>
      <td>
        <Status
          status={status}
          nivel={item.nivel}
          onAlterna={proximoStatus(status) ? onStatus : undefined}
          pendente={mudandoStatus}
        />
      </td>
      {colunas.map((c) => (
        <td key={c.chave} className="num">
          {c.valor(l)}
        </td>
      ))}
      <td>
        <Funil eventos={l.funil_eventos} />
      </td>
    </tr>
  );
}
