import type { Metricas, Transicao } from '@/lib/db/metricas';
import type { OrcamentoDoMes } from '@/lib/db/orcamento';
import { kpisDoEscopo } from '@/lib/kpis';
import { ROTULO_RECOMENDACAO, fraseOrcamento, type Orcamento } from '@/lib/orcamento';
import { avisoDistribuicao } from '@/lib/orcamento-categorias';
import { montaRankingPerdas } from '@/lib/perdas';
import { agrupaSerie, preencheDias, rotuloPeriodo, type Canal, type Periodo } from '@/lib/periodo';
import {
  fmtBRL,
  fmtData,
  fmtDataHora,
  fmtDec,
  fmtDuracao,
  fmtInt,
  ouTraco,
  variacao,
} from '@/lib/format';

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

/**
 * O card de orçamento do mês, já em texto.
 *
 * Guarda string formatada e não número solto pelo mesmo motivo dos KPIs:
 * o que o relatório imprime tem de ser exatamente o que a tela mostra, e
 * formatar duas vezes é a maneira mais fácil de os dois divergirem numa
 * casa decimal.
 */
export type BlocoOrcamento = {
  titulo: string;
  /** Há investimento mensal cadastrado para comparar. */
  temInvestimento: boolean;
  gasto: string;
  investimento: string;
  /** Fração do investimento consumida; a barra trava em 1. */
  consumo: number;
  /** "No alvo", "Reduzir", "Estourado"… o mesmo rótulo do card da tela. */
  situacao: string;
  recomendacao: Orcamento['recomendacao'];
  frase: string;
  /** Diária, projeção e restante — ou o pedido de cadastro do investimento. */
  detalhe: string;
};

export type LinhaVerba = {
  nome: string;
  /** Linha das campanhas ainda não classificadas. */
  semCategoria: boolean;
  /** Categoria sem verba própria: não tem teto para comparar. */
  semVerba: boolean;
  gasto: string;
  /** A verba combinada, ou a fatia do mês quando não há verba. */
  referencia: string;
  consumo: number;
  situacao: string;
  frase: string;
  recomendacao: Orcamento['recomendacao'];
};

export type BlocoVerba = {
  titulo: string;
  linhas: LinhaVerba[];
  /** Sobra ou excesso na distribuição da verba. */
  aviso: string | null;
  /** Mensagem quando não há linha nenhuma para mostrar. */
  vazio: string;
};

export type LinhaPerda = {
  rotulo: string;
  valor: number;
  /** Fatia das perdas do período, já formatada com uma casa. */
  percentual: string;
  /** Linha dos perdidos sem motivo registrado — não é um motivo. */
  semMotivo: boolean;
};

export type BlocoPerdas = {
  linhas: LinhaPerda[];
  /** "12 leads perdidos · 4 motivos distintos", ou `null` sem perda. */
  resumo: string | null;
  /** Nota sobre o preenchimento, só quando há perda sem motivo. */
  nota: string | null;
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
  orcamento: BlocoOrcamento;
  verba: BlocoVerba;
  perdas: BlocoPerdas;
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

/**
 * Card de orçamento do mês, com as mesmas frases do painel.
 *
 * A tela e o PDF chamam `fraseOrcamento` e `ROTULO_RECOMENDACAO`, então
 * a recomendação impressa é sempre a que o gestor viu antes de exportar.
 */
function montaBlocoOrcamento(o: Orcamento): BlocoOrcamento {
  const temInvestimento = o.investimento > 0;
  return {
    titulo: `Orçamento de ${o.mesRotulo}`,
    temInvestimento,
    gasto: fmtBRL(o.gasto),
    investimento: temInvestimento ? fmtBRL(o.investimento) : '—',
    consumo: o.consumo,
    situacao: ROTULO_RECOMENDACAO[o.recomendacao],
    recomendacao: o.recomendacao,
    frase: fraseOrcamento(o),
    detalhe: !temInvestimento
      ? 'O investimento mensal é cadastrado por cliente na área de administração.'
      : o.fechado
        ? `Diária dos dias fechados ${fmtBRL(o.diarioAtual)}`
        : `Diária dos dias fechados ${fmtBRL(o.diarioAtual)} · Projeção ${fmtBRL(o.projecao)} · Restam ${fmtBRL(o.restante)}`,
  };
}

/**
 * Quebra da verba por categoria de campanha.
 *
 * Categoria sem verba cadastrada não recebe barra nem recomendação: um
 * consumo calculado sobre teto zero diria "estourou" sobre um limite que
 * ninguém combinou. No lugar dela vai a fatia do gasto do mês, que é a
 * informação que de fato existe.
 */
function montaBlocoVerba(c: OrcamentoDoMes['categorias'], mesRotulo: string): BlocoVerba {
  return {
    titulo: `Verba por categoria — ${mesRotulo}`,
    aviso: avisoDistribuicao(c),
    vazio: c.temCategorias
      ? 'Nenhum gasto no mês para dividir entre as categorias.'
      : 'Nenhuma categoria de verba cadastrada. As categorias são criadas na tela "Verba por categoria".',
    linhas: c.linhas.map((linha) => {
      const o = linha.orcamento;
      const semCategoria = linha.id === null;
      return {
        nome: linha.nome,
        semCategoria,
        semVerba: linha.semVerba,
        gasto: fmtBRL(o.gasto),
        referencia: linha.semVerba
          ? `${Math.round(linha.fatiaDoGasto * 100)}% do gasto do mês`
          : `de ${fmtBRL(o.investimento)}`,
        consumo: linha.semVerba ? 0 : o.consumo,
        situacao: linha.semVerba ? '' : ROTULO_RECOMENDACAO[o.recomendacao],
        frase: linha.semVerba
          ? semCategoria
            ? 'Campanhas ainda não atribuídas a nenhuma categoria.'
            : 'Sem verba própria cadastrada.'
          : fraseOrcamento(o),
        recomendacao: o.recomendacao,
      };
    }),
  };
}

/**
 * Ranking dos motivos de perda do período.
 *
 * Passa pelo mesmo `montaRankingPerdas` da tela, que é onde mora a junção
 * de "Preço", "preço" e "Preço " num motivo só. Refazer a contagem aqui
 * daria um relatório com três barras pequenas onde a tela mostrou uma
 * grande.
 */
function montaBlocoPerdas(linhas: Metricas['motivos_de_perda']): BlocoPerdas {
  const ranking = montaRankingPerdas(linhas ?? []);
  const plural = (n: number, um: string, muitos: string) => (n === 1 ? um : muitos);

  return {
    linhas: ranking.itens.map((i) => ({
      rotulo: i.rotulo,
      valor: i.valor,
      percentual: `${fmtDec(i.percentual, 1)}%`,
      semMotivo: i.sem_motivo,
    })),
    resumo:
      ranking.total === 0
        ? null
        : `${fmtInt(ranking.total)} ${plural(ranking.total, 'lead perdido', 'leads perdidos')} · ` +
          `${fmtInt(ranking.motivos_distintos)} ${plural(ranking.motivos_distintos, 'motivo distinto', 'motivos distintos')}`,
    nota:
      ranking.sem_motivo > 0
        ? 'O motivo do lead de formulário vem do CRM do cliente, pela automação; o do WhatsApp é digitado no painel ao mover a conversa para perdido. Perda sem motivo é perda que ninguém registrou.'
        : null,
  };
}

export function montaDadosRelatorio(
  metricas: Metricas,
  periodo: Periodo,
  visiveis: Map<string, boolean>,
  conta: { account_name: string; ad_account_id: string },
  orcamento: OrcamentoDoMes,
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
    orcamento: montaBlocoOrcamento(orcamento.orcamento),
    verba: montaBlocoVerba(orcamento.categorias, orcamento.orcamento.mesRotulo),
    perdas: montaBlocoPerdas(metricas.motivos_de_perda),
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
