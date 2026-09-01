import type { ReactElement } from 'react';
import { fmtInt, fmtDec, fmtDuracao, variacao } from '@/lib/format';
import { Icones, type PropsSvg } from '@/components/icones';

/**
 * Componentes de exibição de dados.
 *
 * Tudo aqui é Server Component: gráficos em SVG estático, sem biblioteca
 * de charts e sem JavaScript no navegador. O painel atual já desenhava
 * assim, os gráficos não têm interação, e manter isso no servidor evita
 * mandar ~100 kB de runtime de charts para renderizar cinco barras.
 *
 * As classes (`panel-card`, `kpi-card`, `chart-bars`, `funnel-wrap`…) são
 * as mesmas do painel antigo, portadas para `globals.css` — o objetivo é
 * que a tela seja visualmente indistinguível dele.
 */

export function Card({
  titulo,
  descricao,
  acessorio,
  children,
  className = '',
}: {
  titulo?: string;
  descricao?: string;
  acessorio?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel-card ${className}`}>
      {titulo ? (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3>{titulo}</h3>
            {descricao ? <p className="card-sub">{descricao}</p> : null}
          </div>
          {acessorio}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Vazio({ children = 'Sem dados ainda.' }: { children?: React.ReactNode }) {
  return <p className="empty-msg text-body-small text-tertiary">{children}</p>;
}

/** Ícone de ajuda com tooltip em CSS — mesmo `.info-tip` do painel. */
export function InfoTip({ dica }: { dica: string }) {
  return (
    <span className="info-tip" tabIndex={0} data-tip={dica}>
      <Icones.info />
    </span>
  );
}

/**
 * Variação contra o período anterior.
 *
 * `melhorQuandoCai` inverte a cor: para CPL e CPC, cair é bom. Sem isso
 * o painel pintaria de vermelho justamente a melhora que interessa.
 */
export function BadgeVariacao({
  atual,
  anterior,
  melhorQuandoCai = false,
}: {
  atual: unknown;
  anterior: unknown;
  melhorQuandoCai?: boolean;
}) {
  if (anterior === null || anterior === undefined) return null;
  const a = Number(atual);
  const b = Number(anterior);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  // Sem base de comparação não há percentual: o painel mostra "novo".
  if (b === 0) {
    if (a === 0) return null;
    return (
      <span className="kpi-delta up">
        <Icones.trendUp /> novo
      </span>
    );
  }

  const pct = variacao(atual, anterior);
  if (pct === null) return null;

  const subiu = pct >= 0;
  const bom = melhorQuandoCai ? !subiu : subiu;

  return (
    <span className={`kpi-delta ${bom ? 'up' : 'down'}`}>
      {subiu ? <Icones.trendUp /> : <Icones.trendDown />} {fmtDec(Math.abs(pct), 1)}%
    </span>
  );
}

/** Sparkline de 72×28 no canto do cartão de KPI, igual ao painel. */
export function Sparkline({ valores }: { valores: number[] }) {
  if (valores.length < 2) return null;

  const L = 72;
  const A = 28;
  const pad = 2;
  const max = Math.max(...valores, 1);
  const min = Math.min(...valores, 0);
  const amplitude = max - min || 1;
  const passoX = (L - pad * 2) / (valores.length - 1);

  const pontos = valores
    .map((v, i) => {
      const x = pad + i * passoX;
      const y = A - pad - ((v - min) / amplitude) * (A - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={L} height={A} viewBox={`0 0 ${L} ${A}`} aria-hidden="true">
      <polyline
        points={pontos}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Cor do ícone do card quando a métrica tem uma cor de referência:
 * verde para dinheiro que entra e resultado, âmbar para custo e espera,
 * vermelho para falha. Métrica de volume — leads, alcance, frequência —
 * não tem cor própria e fica no azul da marca, que é o padrão.
 */
export type TomKpi = 'verde' | 'ambar' | 'vermelho';

export function KpiCard({
  rotulo,
  valor,
  dica,
  icone,
  tom,
  atual,
  anterior,
  melhorQuandoCai,
  destaque,
  spark,
}: {
  rotulo: string;
  valor: string;
  dica?: string;
  icone?: (props?: PropsSvg) => ReactElement;
  tom?: TomKpi;
  atual?: unknown;
  anterior?: unknown;
  melhorQuandoCai?: boolean;
  /** Pinta o valor de verde — o painel usa em taxa de conversão boa. */
  destaque?: boolean;
  spark?: number[];
}) {
  const Icone = icone ?? Icones.target;
  return (
    <div className="kpi-card">
      <div className={`kpi-icon-box${tom ? ` tom-${tom}` : ''}`}>
        <Icone />
      </div>
      <p className="label text-label-caps">
        {rotulo}
        {dica ? <InfoTip dica={dica} /> : null}
      </p>
      <p className={`value text-kpi-value${destaque ? ' ok' : ''}`}>
        {valor}
        {anterior !== undefined && anterior !== null ? (
          <BadgeVariacao atual={atual} anterior={anterior} melhorQuandoCai={melhorQuandoCai} />
        ) : null}
      </p>
      {spark && spark.length > 1 ? (
        <div className="kpi-spark">
          <Sparkline valores={spark} />
        </div>
      ) : null}
    </div>
  );
}

/** Barras horizontais — usado em "Eventos por status". */
export function BarrasHorizontais({
  itens,
}: {
  itens: { rotulo: string; valor: number; sufixo?: string }[];
}) {
  if (!itens.length) return <Vazio />;
  const max = Math.max(...itens.map((i) => i.valor), 1);

  return (
    <div>
      {itens.map((item) => (
        <div className="bar-row" key={item.rotulo}>
          <span className="bar-label text-body-small">{item.rotulo}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${Math.max((item.valor / max) * 100, 2)}%` }}
            />
          </span>
          <span className="bar-count text-label-score">
            {fmtInt(item.valor)}
            {item.sufixo ?? ''}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Funil em Sankey — porte de `renderFunnel` do painel.
 *
 * Cada estágio vira um bloco cuja altura é proporcional à contagem, com
 * transição em curva entre eles. Uma barra por evento diria a mesma
 * coisa, mas o painel desenha o afunilamento, e é isso que se reconhece
 * na tela.
 */
export function Funil({
  itens,
  id = 'funil',
}: {
  itens: { label: string; count: number }[];
  id?: string;
}) {
  if (!itens.length) return <Vazio />;

  const n = itens.length;
  // O maior do conjunto, não o primeiro: os estágios chegam na ordem da
  // jornada (ver `ORDEM_FUNIL`), e nessa ordem o primeiro nem sempre é o
  // de maior volume — usar `itens[0]` daria percentual acima de 100%.
  const maxCount = Math.max(...itens.map((it) => it.count), 1);
  const L = 640;
  const A = 176;
  const padTop = 30;
  const padBottom = 24;
  const alturaInterna = A - padTop - padBottom;
  const alturaMin = alturaInterna * 0.14;
  const segL = L / n;
  const chanfro = Math.min(segL * 0.4, 60);
  const centroY = padTop + alturaInterna / 2;

  const alturas = itens.map((it) =>
    Math.max(alturaMin, alturaInterna * (maxCount > 0 ? it.count / maxCount : 0)),
  );

  const topo: [number, number][] = [];
  const base: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const xIni = i * segL;
    const xFim = (i + 1) * segL;
    const retoIni = xIni + (i === 0 ? 0 : chanfro / 2);
    const retoFim = xFim - (i === n - 1 ? 0 : chanfro / 2);
    const ty = centroY - alturas[i] / 2;
    const by = centroY + alturas[i] / 2;
    topo.push([retoIni, ty], [retoFim, ty]);
    base.push([retoIni, by], [retoFim, by]);
  }

  const traco = (pts: [number, number][]) => {
    let d = '';
    for (let j = 0; j < pts.length; j++) {
      const [x, y] = pts[j];
      if (j === 0) {
        d += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      } else if (j % 2 === 1) {
        d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      } else {
        const [px, py] = pts[j - 1];
        const meioX = ((px + x) / 2).toFixed(1);
        d += ` C ${meioX} ${py.toFixed(1)} ${meioX} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
    }
    return d;
  };

  const caminho = `${traco(topo)} ${traco([...base].reverse()).replace(/^M/, 'L')} Z`;
  const maxChars = Math.max(4, Math.floor(segL / 6.2));
  const corta = (s: string) =>
    s.length <= maxChars ? s : `${s.slice(0, Math.max(1, maxChars - 1))}…`;

  return (
    <div className="funnel-wrap">
      <svg viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`funnelGrad-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--bg-primary)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--bg-primary)" stopOpacity="1" />
          </linearGradient>
        </defs>
        <path d={caminho} fill={`url(#funnelGrad-${id})`} />
        {Array.from({ length: Math.max(0, n - 1) }, (_, b) => (
          <line
            key={b}
            className="funnel-divider"
            x1={((b + 1) * segL).toFixed(1)}
            y1={2}
            x2={((b + 1) * segL).toFixed(1)}
            y2={A - 2}
          />
        ))}
        {itens.map((it, i) => {
          const cx = ((i + 0.5) * segL).toFixed(1);
          const pct = maxCount > 0 ? Math.round((it.count / maxCount) * 1000) / 10 : 0;
          return (
            <g key={`${it.label}-${i}`}>
              <text className="funnel-stage-label" x={cx} y={16} textAnchor="middle">
                {corta(it.label || '—')}
              </text>
              <text className="funnel-pct" x={cx} y={(centroY + 4.5).toFixed(1)} textAnchor="middle">
                {pct}%
              </text>
              <text className="funnel-count" x={cx} y={A - 8} textAnchor="middle">
                {it.count}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Lista "De → Para" com barra de tempo relativo, igual ao painel. */
export function TempoEntreEtapas({
  itens,
}: {
  itens: {
    from_stage: string | null;
    to_stage: string | null;
    avg_ms: number;
    count: number;
  }[];
}) {
  if (!itens.length) {
    return <Vazio>Sem movimentações suficientes no período para calcular.</Vazio>;
  }
  const max = Math.max(...itens.map((i) => Number(i.avg_ms) || 0), 1);

  return (
    <div className="etapa-list">
      {itens.map((i) => {
        const ms = Number(i.avg_ms) || 0;
        const pct = Math.max(4, Math.round((ms / max) * 100));
        const n = Number(i.count) || 0;
        return (
          <div className="etapa-row" key={`${i.from_stage}||${i.to_stage}`}>
            <div className="etapa-row-top">
              <span className="etapa-label">
                {i.from_stage || '—'}
                <span className="arrow">→</span>
                {i.to_stage || '—'}
              </span>
              <span className="etapa-meta">
                <span className="etapa-time">{fmtDuracao(ms)}</span>
                <span className="etapa-count">
                  {n} {n === 1 ? 'lead' : 'leads'}
                </span>
              </span>
            </div>
            <div className="etapa-track">
              <div className="etapa-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Barras verticais por período.
 *
 * Espera a série já agrupada por `agrupaSerie` — os dias sem lead entram
 * com zero, porque um gráfico que pula dia vazio comprime o eixo e
 * sugere um volume constante que não existiu.
 *
 * O gráfico cabe sempre na largura do card, sem rolagem horizontal: as
 * colunas dividem o espaço disponível. Rolar era pior do que parecia —
 * o período de 30 dias mostrava uns 17 dias e escondia o resto atrás de
 * uma barra de rolagem que ninguém procura num gráfico, então o pico do
 * mês podia simplesmente não estar na tela.
 *
 * O que não cabe é a etiqueta de data: "13/08" precisa de ~28px e a
 * coluna de um mês tem ~16px. Por isso, em série densa, só uma etiqueta
 * a cada N colunas é desenhada — o eixo continua legível e as barras
 * continuam todas lá. O número em cima da barra fica, só menor: dois
 * dígitos cabem, e é ele que dá o valor exato de cada dia.
 */
export function GraficoDiario({ serie }: { serie: { label: string; count: number }[] }) {
  if (!serie.length) return <Vazio />;
  const max = Math.max(...serie.map((p) => p.count), 1);
  // Acima de 16 colunas a etiqueta de data começa a encostar na vizinha.
  const densa = serie.length > 16;
  // Uma etiqueta a cada `passo` colunas, mirando ~8 datas no eixo.
  const passo = densa ? Math.ceil(serie.length / 8) : 1;
  // Índice da última coluna que recebe etiqueta. É o fim do período, e um
  // eixo terminando sem data deixa o leitor sem referência — mas só entra
  // se não for cair colada na etiqueta anterior.
  const ultimo = serie.length - 1;
  const ultimoRotulado = ultimo % passo >= Math.ceil(passo / 2) ? ultimo : -1;

  return (
    <div className={densa ? 'chart-bars chart-bars-densa' : 'chart-bars'}>
      {serie.map((p, i) => {
        const mostraLabel = i % passo === 0 || i === ultimoRotulado;
        return (
          <div
            className="chart-bar-col"
            key={`${p.label}-${i}`}
            title={`${p.label}: ${p.count}`}
          >
            <span className="chart-bar-value text-label-score">{p.count}</span>
            <div className="chart-bar-track">
              <div
                className="chart-bar-fill"
                style={{
                  height: `${p.count > 0 ? Math.max(4, Math.round((p.count / max) * 100)) : 2}%`,
                }}
              />
            </div>
            <span className="chart-bar-label text-body-small">
              {mostraLabel ? p.label || '—' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Tabela({
  colunas,
  children,
}: {
  colunas: React.ReactNode[];
  children: React.ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table className="tabela-painel">
        <thead>
          <tr>
            {colunas.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
