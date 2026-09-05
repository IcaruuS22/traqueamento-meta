import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type {
  BlocoOrcamento,
  BlocoPerdas,
  BlocoVerba,
  DadosRelatorio,
  LinhaBarra,
  LinhaKpi,
} from '@/lib/relatorio';
import { escalaBarras } from '@/lib/relatorio';
import type { Recomendacao } from '@/lib/orcamento';
import { fmtInt } from '@/lib/format';

/**
 * Documento do PDF de "Métricas Gerais".
 *
 * Desenhado com `@react-pdf/renderer` e não com um navegador headless: a
 * Vercel roda funções serverless, onde subir um Chromium por download de
 * relatório custa dezenas de MB e segundos de arranque. Aqui o PDF é
 * montado no próprio processo do Node, em milissegundos.
 *
 * As cores são as mesmas de `globals.css` — copiadas como literais porque
 * o PDF não tem acesso a variável CSS. Só o tema claro existe aqui: papel
 * é branco, e um relatório em tema escuro gasta tinta sem melhorar nada.
 */

const COR = {
  marca: '#6d5efc',
  marcaSuave: '#eeecfe',
  marcaBorda: '#ccc6fb',
  texto: '#0d0f14',
  textoSec: '#4e525a',
  textoTer: '#9ba0a6',
  borda: '#e2e4e6',
  bordaForte: '#d2d5d9',
  fundoSuave: '#f5f7f9',
  positivo: '#147a3a',
  negativo: '#b42318',
  avisoFundo: '#fbf0da',
  avisoTexto: '#a66a08',
} as const;

/**
 * Cor de cada recomendação de orçamento.
 *
 * Mesma leitura do card da tela — azul pede mais, âmbar pede menos,
 * verde está no alvo, vermelho estourou — traduzida para literais porque
 * o PDF não enxerga variável CSS. Cinza para o que não dá para opinar.
 */
const COR_RECOMENDACAO: Record<Recomendacao, string> = {
  aumentar: '#2563eb',
  reduzir: '#d97706',
  manter: COR.positivo,
  estourado: COR.negativo,
  fechado: COR.textoTer,
  indefinido: COR.textoTer,
};

const ALTURA_GRAFICO = 96;
const ALTURA_BARRA_FUNIL = 13;

/**
 * Quantas barras a série diária mostra.
 *
 * `agrupaSerie` já reduz períodos longos a semanas/meses, mas "Todo o
 * período" de um cliente antigo ainda pode passar de 60 colunas — que
 * numa página A4 viram traços de meio milímetro. Passando do teto, o
 * relatório mostra a cauda recente, que é a que interessa.
 */
const MAX_BARRAS_SERIE = 32;

const s = StyleSheet.create({
  pagina: {
    paddingTop: 34,
    paddingBottom: 44,
    paddingHorizontal: 34,
    fontSize: 9,
    color: COR.texto,
    fontFamily: 'Helvetica',
    backgroundColor: '#ffffff',
  },

  cabecalho: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    borderBottomColor: COR.marca,
    paddingBottom: 10,
    marginBottom: 14,
  },
  titulo: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: COR.texto },
  subtitulo: { fontSize: 9.5, color: COR.textoSec, marginTop: 3 },
  selo: {
    backgroundColor: COR.marcaSuave,
    borderWidth: 1,
    borderColor: COR.marcaBorda,
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    maxWidth: 190,
  },
  seloRotulo: { fontSize: 6.5, color: COR.textoSec, textTransform: 'uppercase', letterSpacing: 0.6 },
  seloValor: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: COR.texto, marginTop: 1 },

  aviso: {
    backgroundColor: COR.avisoFundo,
    borderRadius: 6,
    padding: 8,
    marginBottom: 12,
    fontSize: 8,
    color: COR.avisoTexto,
    lineHeight: 1.4,
  },

  secao: { marginBottom: 14 },
  secaoTitulo: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 7,
    color: COR.texto,
  },
  secaoNota: { fontSize: 7.5, color: COR.textoTer, marginTop: 5, lineHeight: 1.4 },

  gradeKpi: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  // 3 colunas: (523 de área útil - 2 vãos de 7) / 3 ≈ 169,6.
  cartao: {
    width: 169,
    borderWidth: 1,
    borderColor: COR.borda,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 9,
  },
  cartaoRotulo: { fontSize: 7.5, color: COR.textoSec, marginBottom: 4 },
  cartaoValor: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: COR.texto },
  cartaoVariacao: { fontSize: 7.5, marginTop: 3 },

  caixa: {
    borderWidth: 1,
    borderColor: COR.borda,
    borderRadius: 8,
    padding: 10,
  },

  funilLinha: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  funilRotulo: { width: 100, fontSize: 8, color: COR.textoSec },
  funilTrilho: {
    flexGrow: 1,
    height: ALTURA_BARRA_FUNIL,
    backgroundColor: COR.fundoSuave,
    borderRadius: 3,
  },
  funilBarra: { height: ALTURA_BARRA_FUNIL, backgroundColor: COR.marca, borderRadius: 3 },
  funilValor: { width: 92, fontSize: 8, textAlign: 'right', fontFamily: 'Helvetica-Bold' },

  grafico: { flexDirection: 'row', alignItems: 'flex-end', height: ALTURA_GRAFICO, gap: 2 },
  graficoColuna: { flexGrow: 1, alignItems: 'center', justifyContent: 'flex-end' },
  graficoBarra: { width: '100%', backgroundColor: COR.marca, borderRadius: 1.5 },
  graficoEixo: { flexDirection: 'row', marginTop: 4, gap: 2 },
  graficoRotulo: { flexGrow: 1, fontSize: 5.5, color: COR.textoTer, textAlign: 'center' },

  tabelaCabecalho: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COR.bordaForte,
    paddingBottom: 4,
    marginBottom: 2,
  },
  tabelaLinha: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COR.borda,
    paddingVertical: 4,
  },
  th: { fontSize: 7, color: COR.textoSec, textTransform: 'uppercase', letterSpacing: 0.4 },
  td: { fontSize: 8.5, color: COR.texto },

  vazio: { fontSize: 8, color: COR.textoTer, fontStyle: 'italic', paddingVertical: 6 },

  // Barra de consumo do orçamento: mesmo traço fino do card da tela.
  trilho: { height: 5, backgroundColor: COR.fundoSuave, borderRadius: 3, marginTop: 5 },
  trilhoBarra: { height: 5, borderRadius: 3 },

  orcamentoTopo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  orcamentoValor: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  orcamentoDe: { fontSize: 9, fontFamily: 'Helvetica', color: COR.textoTer },
  orcamentoSituacao: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  orcamentoFrase: { fontSize: 8, color: COR.textoSec, marginTop: 6 },
  orcamentoDetalhe: { fontSize: 7.5, color: COR.textoTer, marginTop: 3 },

  verbaLinha: { marginBottom: 9 },
  verbaTopo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  verbaNome: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  verbaGasto: { fontSize: 8.5 },
  verbaNota: { fontSize: 7.5, color: COR.textoTer, marginTop: 3 },
  verbaAviso: {
    fontSize: 7.5,
    color: COR.avisoTexto,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: COR.borda,
    paddingTop: 6,
    lineHeight: 1.4,
  },

  perdaResumo: { fontSize: 8, color: COR.textoTer, marginBottom: 7 },
  perdaLinha: { marginBottom: 7 },
  perdaTopo: { flexDirection: 'row', justifyContent: 'space-between' },
  perdaRotulo: { fontSize: 8.5 },
  perdaValor: { fontSize: 8, color: COR.textoSec },

  rodape: {
    position: 'absolute',
    bottom: 20,
    left: 34,
    right: 34,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: COR.borda,
    paddingTop: 6,
    fontSize: 7,
    color: COR.textoTer,
  },
});

function Cartao({ kpi }: { kpi: LinhaKpi }) {
  // Sem base de comparação a linha some — "0%" seria mentira, e "—"
  // ocupa uma linha que os outros cartões usam para o número.
  const v = kpi.variacao;
  const bom = v === null ? false : kpi.melhorQuandoCai ? v < 0 : v > 0;
  return (
    <View style={s.cartao} wrap={false}>
      <Text style={s.cartaoRotulo}>{kpi.rotulo}</Text>
      <Text style={s.cartaoValor}>{kpi.valor}</Text>
      {v === null ? null : (
        <Text style={[s.cartaoVariacao, { color: bom ? COR.positivo : COR.negativo }]}>
          {v > 0 ? '+' : ''}
          {String(v).replace('.', ',')}% vs. período anterior
        </Text>
      )}
    </View>
  );
}

function Funil({ itens }: { itens: LinhaBarra[] }) {
  if (!itens.length) return <Text style={s.vazio}>Nenhum evento no período.</Text>;
  const topo = Math.max(...itens.map((i) => i.valor), 0);
  return (
    <View>
      {itens.map((item) => {
        const proporcao = topo > 0 ? Math.max(item.valor / topo, 0.012) : 0.012;
        // Percentual em relação ao topo do funil — a leitura que interessa
        // é "quanto sobrou de uma etapa para a outra".
        const pct = topo > 0 ? Math.round((item.valor / topo) * 100) : 0;
        return (
          <View key={item.label} style={s.funilLinha} wrap={false}>
            <Text style={s.funilRotulo}>{item.label}</Text>
            <View style={s.funilTrilho}>
              <View style={[s.funilBarra, { width: `${proporcao * 100}%` }]} />
            </View>
            <Text style={s.funilValor}>
              {fmtInt(item.valor)} · {pct}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function GraficoDiario({ itens }: { itens: LinhaBarra[] }) {
  if (!itens.length) return <Text style={s.vazio}>Nenhum lead no período.</Text>;
  const visiveis = itens.slice(-MAX_BARRAS_SERIE);
  const alturas = escalaBarras(
    visiveis.map((i) => i.valor),
    ALTURA_GRAFICO,
  );
  // Com muitas colunas os rótulos se sobrepõem; mostra um a cada N.
  const passo = Math.ceil(visiveis.length / 16);
  return (
    <View>
      <View style={s.grafico}>
        {visiveis.map((item, i) => (
          <View key={`${item.label}-${i}`} style={s.graficoColuna}>
            <View style={[s.graficoBarra, { height: alturas[i] }]} />
          </View>
        ))}
      </View>
      <View style={s.graficoEixo}>
        {visiveis.map((item, i) => (
          <Text key={`r-${item.label}-${i}`} style={s.graficoRotulo}>
            {i % passo === 0 ? item.label : ' '}
          </Text>
        ))}
      </View>
      {itens.length > visiveis.length ? (
        <Text style={s.secaoNota}>
          Mostrando os {visiveis.length} períodos mais recentes de {itens.length}.
        </Text>
      ) : null}
    </View>
  );
}

function Tabela({
  colunas,
  linhas,
  vazio,
}: {
  colunas: { titulo: string; largura: string; alinhaDireita?: boolean }[];
  linhas: string[][];
  vazio: string;
}) {
  if (!linhas.length) return <Text style={s.vazio}>{vazio}</Text>;
  return (
    <View>
      <View style={s.tabelaCabecalho}>
        {colunas.map((c) => (
          <Text
            key={c.titulo}
            style={[s.th, { width: c.largura, textAlign: c.alinhaDireita ? 'right' : 'left' }]}
          >
            {c.titulo}
          </Text>
        ))}
      </View>
      {linhas.map((linha, i) => (
        <View key={i} style={s.tabelaLinha} wrap={false}>
          {linha.map((celula, j) => (
            <Text
              key={j}
              style={[
                s.td,
                {
                  width: colunas[j].largura,
                  textAlign: colunas[j].alinhaDireita ? 'right' : 'left',
                },
              ]}
            >
              {celula}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Barra de consumo, travada em 100%: acima disso ela não distingue mais nada. */
function Consumo({ fracao, cor }: { fracao: number; cor: string }) {
  const largura = Math.min(Math.max(Math.round(fracao * 100), 0), 100);
  return (
    <View style={s.trilho}>
      <View style={[s.trilhoBarra, { width: `${largura}%`, backgroundColor: cor }]} />
    </View>
  );
}

function Orcamento({ bloco }: { bloco: BlocoOrcamento }) {
  const cor = COR_RECOMENDACAO[bloco.recomendacao];
  const pct = Math.round(bloco.consumo * 100);
  return (
    <View>
      <View style={s.orcamentoTopo}>
        <Text style={s.orcamentoValor}>
          {bloco.gasto}
          <Text style={s.orcamentoDe}> de {bloco.investimento}</Text>
        </Text>
        <Text style={[s.orcamentoSituacao, { color: cor }]}>
          {bloco.situacao}
          {bloco.temInvestimento ? ` · ${pct}% do investimento` : ''}
        </Text>
      </View>
      {bloco.temInvestimento ? <Consumo fracao={bloco.consumo} cor={cor} /> : null}
      <Text style={s.orcamentoFrase}>{bloco.frase}</Text>
      <Text style={s.orcamentoDetalhe}>{bloco.detalhe}</Text>
    </View>
  );
}

function Verba({ bloco }: { bloco: BlocoVerba }) {
  if (!bloco.linhas.length) return <Text style={s.vazio}>{bloco.vazio}</Text>;
  return (
    <View>
      {bloco.linhas.map((linha, i) => {
        const cor = COR_RECOMENDACAO[linha.recomendacao];
        return (
          <View key={`${linha.nome}-${i}`} style={s.verbaLinha} wrap={false}>
            <View style={s.verbaTopo}>
              <Text style={[s.verbaNome, linha.semCategoria ? { color: COR.textoTer } : {}]}>
                {linha.nome}
              </Text>
              <Text style={s.verbaGasto}>
                {linha.gasto}
                <Text style={s.orcamentoDe}> {linha.referencia}</Text>
              </Text>
            </View>
            {linha.semVerba ? null : <Consumo fracao={linha.consumo} cor={cor} />}
            <Text style={s.verbaNota}>
              {linha.situacao ? <Text style={{ color: cor }}>{linha.situacao} · </Text> : null}
              {linha.frase}
            </Text>
          </View>
        );
      })}
      {bloco.aviso ? (
        <Text style={s.verbaAviso}>
          {bloco.aviso} A soma das categorias não precisa bater com o investimento mensal, mas
          quando não bate o card geral e estas barras contam histórias diferentes.
        </Text>
      ) : null}
    </View>
  );
}

function Perdas({ bloco }: { bloco: BlocoPerdas }) {
  if (!bloco.linhas.length) return <Text style={s.vazio}>Nenhum lead perdido no período.</Text>;
  const topo = Math.max(...bloco.linhas.map((l) => l.valor), 1);
  return (
    <View>
      {bloco.resumo ? <Text style={s.perdaResumo}>{bloco.resumo}</Text> : null}
      {bloco.linhas.map((linha) => (
        <View key={linha.rotulo} style={s.perdaLinha} wrap={false}>
          <View style={s.perdaTopo}>
            <Text style={[s.perdaRotulo, linha.semMotivo ? { color: COR.textoTer } : {}]}>
              {linha.rotulo}
            </Text>
            <Text style={s.perdaValor}>
              {linha.percentual} · {fmtInt(linha.valor)} {linha.valor === 1 ? 'lead' : 'leads'}
            </Text>
          </View>
          <Consumo
            fracao={linha.valor / topo}
            cor={linha.semMotivo ? COR.textoTer : COR.marca}
          />
        </View>
      ))}
      {bloco.nota ? <Text style={s.secaoNota}>{bloco.nota}</Text> : null}
    </View>
  );
}

export function RelatorioMetricas({ dados }: { dados: DadosRelatorio }) {
  return (
    <Document
      title={`Métricas Gerais: ${dados.cliente}`}
      author="Trakeamento"
      subject={`${dados.canal} · ${dados.periodo}`}
      creator="Trakeamento"
      producer="Trakeamento"
    >
      <Page size="A4" style={s.pagina}>
        <View style={s.cabecalho} fixed>
          <View>
            <Text style={s.titulo}>Métricas Gerais</Text>
            <Text style={s.subtitulo}>
              {dados.cliente} · conta {dados.adAccountId}
            </Text>
          </View>
          <View style={s.selo}>
            <Text style={s.seloRotulo}>Período</Text>
            <Text style={s.seloValor}>{dados.periodo}</Text>
            <Text style={[s.seloRotulo, { marginTop: 4 }]}>Canal</Text>
            <Text style={s.seloValor}>{dados.canal}</Text>
          </View>
        </View>

        {dados.lacunas.length ? (
          <View style={s.aviso}>
            <Text>
              O banco deste cliente está atrás do template. Falta: {dados.lacunas.join(', ')}. As
              métricas que dependem disso aparecem como zero, e zero aqui é falta de migração, não
              falta de resultado.
            </Text>
          </View>
        ) : null}

        <View style={s.secao}>
          <Text style={s.secaoTitulo}>Indicadores do período</Text>
          {dados.kpis.length ? (
            <View style={s.gradeKpi}>
              {dados.kpis.map((k) => (
                <Cartao key={k.id} kpi={k} />
              ))}
            </View>
          ) : (
            <Text style={s.vazio}>
              Nenhuma métrica está visível. Marque alguma em &quot;Personalizar&quot;.
            </Text>
          )}
          <Text style={s.secaoNota}>
            A variação compara com o período imediatamente anterior de mesma duração. Onde ela não
            aparece, não havia base de comparação.
          </Text>
        </View>

        <View style={s.secao} wrap={false}>
          <Text style={s.secaoTitulo}>Funil de vendas</Text>
          <View style={s.caixa}>
            <Funil itens={dados.funil} />
          </View>
        </View>

        <View style={s.secao} wrap={false}>
          <Text style={s.secaoTitulo}>Leads capturados</Text>
          <View style={s.caixa}>
            <GraficoDiario itens={dados.serie} />
          </View>
        </View>

        <View style={s.secao} wrap={false}>
          <Text style={s.secaoTitulo}>{dados.orcamento.titulo}</Text>
          <View style={s.caixa}>
            <Orcamento bloco={dados.orcamento} />
          </View>
          <Text style={s.secaoNota}>
            O orçamento é sempre do mês inteiro, não do período do relatório: o investimento é
            mensal, e compará-lo com o gasto de sete dias não diria nada.
          </Text>
        </View>

        <View style={s.secao}>
          <Text style={s.secaoTitulo}>{dados.verba.titulo}</Text>
          <View style={s.caixa}>
            <Verba bloco={dados.verba} />
          </View>
        </View>

        <View style={s.secao}>
          <Text style={s.secaoTitulo}>Motivos de perda</Text>
          <View style={s.caixa}>
            <Perdas bloco={dados.perdas} />
          </View>
        </View>

        <View style={s.secao} wrap={false}>
          <Text style={s.secaoTitulo}>Tempo médio entre etapas</Text>
          <View style={s.caixa}>
            <Tabela
              colunas={[
                { titulo: 'De', largura: '32%' },
                { titulo: 'Para', largura: '32%' },
                { titulo: 'Tempo médio', largura: '20%', alinhaDireita: true },
                { titulo: 'Leads', largura: '16%', alinhaDireita: true },
              ]}
              linhas={dados.etapas.map((e) => [e.de, e.para, e.media, e.leads])}
              vazio="Nenhuma transição de etapa no período."
            />
          </View>
        </View>

        <View style={s.secao} wrap={false}>
          <Text style={s.secaoTitulo}>Últimos leads</Text>
          <View style={s.caixa}>
            <Tabela
              colunas={[
                { titulo: 'Nome', largura: '34%' },
                { titulo: 'Contato', largura: '28%' },
                { titulo: 'Etapa', largura: '22%' },
                { titulo: 'Entrada', largura: '16%', alinhaDireita: true },
              ]}
              linhas={dados.leads.map((l) => [l.nome, l.contato, l.etapa, l.entrada])}
              vazio="Nenhum lead no período."
            />
            {dados.totalLeadsListados > dados.leads.length ? (
              <Text style={s.secaoNota}>
                Mostrando {dados.leads.length} de {dados.totalLeadsListados} leads recentes. A lista
                completa fica na tela de Métricas Gerais.
              </Text>
            ) : null}
          </View>
        </View>

        <View style={s.rodape} fixed>
          <Text>Gerado em {dados.geradoEm} (horário de São Paulo)</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
