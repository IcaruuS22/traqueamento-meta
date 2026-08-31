import type { Metricas, Transicao } from '@/lib/db/metricas';
import { kpisDoEscopo } from '@/lib/kpis';
import { agrupaSerie, preencheDias, rotuloPeriodo, type Canal, type Periodo } from '@/lib/periodo';
import { fmtData, fmtDataHora, fmtDuracao, ouTraco, variacao } from '@/lib/format';

/**
 * Preparação dos dados do PDF de "Métricas Gerais".
 *
 * Módulo puro: recebe as métricas já buscadas e devolve exatamente o que
 * o documento desenha. Fica separado do `.tsx` do relatório porque toda a
 * regra que importa — quais KPIs entram, como a variação é calculada,
 * quantas linhas cabem — é testável sem renderizar PDF nenhum.
 */

export const ROTULO_CANAL: Record<Canal, string> = {
  geral: 'Todos os canais',
  form: 'Formulários instantâneos',
  whatsapp: 'WhatsApp',
};

/**
 * Teto de linhas das duas tabelas do fim do relatório.
 *
 * O relatório é um retrato do período, não um dump: a tela já pagina os
 * leads e o CSV existe para quem quer a lista inteira. Cortar aqui evita
 * um PDF de 40 páginas de tabela onde o gestor procurava dois números.
 */
export const MAX_LINHAS_TABELA = 12;

export type LinhaKpi = {
  id: string;
  rotulo: string;
  valor: string;
  /** Variação percentual contra o período anterior; `null` sem base. */
  variacao: number | null;
  /** Verdadeiro quando cair é bom (CPL). Decide a cor da variação. */
  melhorQuandoCai: boolean;
};

export type LinhaBarra = { label: string; valor: number };

export type LinhaEtapa = {
  de: string;
  para: string;
  media: string;
  leads: string;
};

export type LinhaLead = {
  nome: string;
  contato: string;
  etapa: string;
  entrada: string;
};

export type DadosRelatorio = {
  cliente: string;
  adAccountId: string;
  canal: string;
  periodo: string;
  geradoEm: string;
  kpis: LinhaKpi[];
  funil: LinhaBarra[];
  serie: LinhaBarra[];
  etapas: LinhaEtapa[];
  leads: LinhaLead[];
  totalLeadsListados: number;
  lacunas: string[];
};

function nomeDoLead(l: { first_name: string | null; last_name: string | null }): string {
  const nome = [l.first_name, l.last_name].filter(Boolean).join(' ').trim();
  return nome || 'Sem nome';
}

function linhasEtapa(itens: Transicao[]): LinhaEtapa[] {
  return itens.slice(0, MAX_LINHAS_TABELA).map((t) => ({
    de: ouTraco(t.from_stage),
    para: ouTraco(t.to_stage),
    media: fmtDuracao(t.avg_ms),
    leads: String(t.count ?? 0),
  }));
}

export function montaDadosRelatorio(
  metricas: Metricas,
  periodo: Periodo,
  visiveis: Map<string, boolean>,
  conta: { account_name: string; ad_account_id: string },
  agora: Date = new Date(),
): DadosRelatorio {
  const cmp = metricas.comparativo_anterior;

  const kpis: LinhaKpi[] = kpisDoEscopo(periodo.canal, visiveis).map((k) => ({
    id: k.id,
    rotulo: k.rotulo,
    valor: k.valor(metricas),
    variacao:
      cmp && k.atual && k.anterior ? variacao(k.atual(metricas), k.anterior(cmp)) : null,
    melhorQuandoCai: k.melhorQuandoCai === true,
  }));

  const serie = preencheDias(metricas.leads_por_dia, periodo.inicioSec, periodo.fimSec);

  return {
    cliente: conta.account_name,
    adAccountId: conta.ad_account_id,
    canal: ROTULO_CANAL[periodo.canal],
    periodo: rotuloPeriodo(periodo),
    geradoEm: fmtDataHora(agora),
    kpis,
    funil: metricas.eventos_por_nome.map((e) => ({
      label: e.event_name,
      valor: Number(e.total) || 0,
    })),
    serie: agrupaSerie(serie).map((p) => ({ label: p.label, valor: p.count })),
    etapas: linhasEtapa(metricas.tempo_medio_entre_etapas),
    leads: metricas.ultimos_leads.slice(0, MAX_LINHAS_TABELA).map((l) => ({
      nome: nomeDoLead(l),
      contato: ouTraco(l.phone || l.email),
      etapa: ouTraco(l.current_stage),
      entrada: fmtData(l.created_at),
    })),
    totalLeadsListados: metricas.ultimos_leads.length,
    lacunas: metricas.lacunas_de_esquema,
  };
}

/**
 * Nome do arquivo baixado.
 *
 * Vai para `Content-Disposition`, então só ASCII simples: acento e espaço
 * em cabeçalho HTTP dependem de codificação que nem todo navegador trata
 * igual, e o resultado seria um arquivo com nome quebrado.
 */
export function nomeArquivoRelatorio(clientDb: string, canal: Canal, agora: Date = new Date()): string {
  const base = clientDb
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const p = (n: number) => String(n).padStart(2, '0');
  const d = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const carimbo = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  return `metricas-${base || 'cliente'}-${canal}-${carimbo}.pdf`;
}

/**
 * Altura de cada barra em proporção à maior do conjunto.
 *
 * Barra de valor zero fica com um fio visível em vez de sumir: numa série
 * diária, o dia sem lead é informação — o gráfico precisa mostrar que o
 * dia existiu e deu zero, não pular a coluna.
 */
export function escalaBarras(valores: number[], alturaMax: number, minimo = 1.5): number[] {
  const maior = Math.max(0, ...valores);
  if (maior <= 0) return valores.map(() => minimo);
  return valores.map((v) => Math.max(minimo, (Math.max(0, v) / maior) * alturaMax));
}
