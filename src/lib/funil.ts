import { ESTAGIO_GANHO, ESTAGIO_PERDIDO, rotuloEstagio } from '@/lib/whatsapp-conversas';

/**
 * Analytics do funil — a parte que os dois lados usam.
 *
 * Fica fora de `lib/db/funil.ts` porque aquele módulo é `server-only` e
 * o modal do CRM, o quadro e a tela de Conversas precisam das mesmas
 * regras de motivo de perda. Mesmo motivo de `lib/crm.ts`.
 *
 * O que o funil daqui é, e o que não é: um retrato de onde os contatos
 * do período estão AGORA, etapa por etapa. Não é a jornada de cada lead
 * ao longo do tempo — essa já existe na Visão geral ("Tempo médio entre
 * etapas"), calculada a partir dos eventos enviados à Meta. Um contato
 * conta em uma etapa só, a atual.
 */

/**
 * Motivos oferecidos de saída, para o time não escrever cinco variações
 * do mesmo motivo e o ranking virar poeira.
 *
 * Não são uma tabela de cadastro de propósito: seria mais uma tela de
 * configuração para o cliente manter e mais uma migração. O campo aceita
 * texto livre, e a tela também oferece os motivos que o próprio cliente
 * já usou — na prática o cadastro se forma sozinho, sem tela.
 */
export const MOTIVOS_PERDA_SUGERIDOS = [
  'Preço',
  'Sem resposta',
  'Fora da região',
  'Comprou do concorrente',
  'Não é o público',
  'Sem interesse',
  'Contato inválido',
] as const;

/** Limite da coluna `whatsapp_conversations.lost_reason`. */
export const TAMANHO_MOTIVO = 120;

/** Rótulo do que ficou sem motivo, usado na tela e no ranking. */
export const SEM_MOTIVO = 'Sem motivo registrado';

/**
 * Texto do motivo pronto para gravar: sem espaços sobrando, no limite da
 * coluna, e `null` quando não há nada — motivo em branco é ausência de
 * motivo, não a string vazia, senão o ranking ganharia uma fatia anônima
 * diferente de "sem motivo registrado".
 */
export function normalizaMotivo(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const texto = valor.replace(/\s+/g, ' ').trim();
  return texto ? texto.slice(0, TAMANHO_MOTIVO) : null;
}

/** A etapa de destino é a que fecha a conversa como perdida? */
export function ehEtapaDePerda(etapa: string | null | undefined): boolean {
  return (etapa ?? '').trim() === ESTAGIO_PERDIDO;
}

export type EtapaCadastrada = {
  valor: string;
  content_name: string | null;
  /**
   * Só no funil de formulário: a etapa que o cliente marcou como venda.
   * Vem do MySQL como 0/1, por isso não é `boolean`.
   */
  is_conversion?: boolean | number | null;
};
export type ContagemEtapa = { etapa: string | null; total: number | string };

export type PassoFunil = {
  valor: string;
  rotulo: string;
  total: number;
  /** Fatia do total de contatos do período. */
  pct_total: number;
  /** Quanto sobrou da etapa anterior — é aqui que se vê onde vaza. */
  pct_anterior: number | null;
};

export type ResumoFunil = {
  passos: PassoFunil[];
  total: number;
  /** Contatos em etapa que saiu do cadastro, ou sem etapa nenhuma. */
  fora_do_funil: number;
};

const arredonda = (n: number) => Math.round(n * 10) / 10;

function contaPorEtapa(contagens: ContagemEtapa[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const c of contagens) {
    const chave = (c.etapa ?? '').trim();
    if (!chave) continue;
    mapa.set(chave, (mapa.get(chave) ?? 0) + (Number(c.total) || 0));
  }
  return mapa;
}

const somaTudo = (contagens: ContagemEtapa[]) =>
  contagens.reduce((soma, c) => soma + (Number(c.total) || 0), 0);

/**
 * Junta o cadastro de etapas com a contagem de contatos por etapa.
 *
 * A ordem é a do cadastro (a ordem em que o cliente montou o funil), não
 * a da contagem: um funil ordenado por volume mostraria a última etapa
 * primeiro sempre que o time estivesse trabalhando bem, o que inverte a
 * leitura. Etapa cadastrada sem ninguém dentro continua aparecendo, com
 * zero — é justamente o buraco que interessa ver.
 */
export function montaFunil(etapas: EtapaCadastrada[], contagens: ContagemEtapa[]): ResumoFunil {
  const porEtapa = contaPorEtapa(contagens);
  const total = somaTudo(contagens);

  let dentro = 0;
  const passos: PassoFunil[] = [];
  for (const etapa of etapas) {
    const quantos = porEtapa.get(etapa.valor) ?? 0;
    dentro += quantos;
    const anterior = passos.length ? passos[passos.length - 1].total : null;
    passos.push({
      valor: etapa.valor,
      rotulo: (etapa.content_name ?? '').trim() || rotuloEstagio(etapa.valor),
      total: quantos,
      pct_total: total > 0 ? arredonda((quantos / total) * 100) : 0,
      pct_anterior:
        anterior === null ? null : anterior > 0 ? arredonda((quantos / anterior) * 100) : 0,
    });
  }

  return { passos, total, fora_do_funil: total - dentro };
}

export type FaixasFunil = {
  abertos: number;
  ganhos: number;
  perdidos: number;
  /** Ganhos sobre o que já foi decidido (ganhos + perdidos). */
  taxa_ganho: number;
};

/**
 * Ganho, perdido e em aberto do funil de WhatsApp.
 *
 * Sai do valor gravado em `status`, não do cadastro de etapas: `ganho` e
 * `perdido` são os dois estágios fixos do painel (ver
 * `lib/whatsapp-conversas.ts`) e o cliente pode tê-los tirado do funil
 * sem que as conversas já fechadas mudem de status.
 */
export function faixasDoWhatsapp(contagens: ContagemEtapa[]): FaixasFunil {
  const porEtapa = contaPorEtapa(contagens);
  const ganhos = porEtapa.get(ESTAGIO_GANHO) ?? 0;
  const perdidos = porEtapa.get(ESTAGIO_PERDIDO) ?? 0;
  const decididos = ganhos + perdidos;
  return {
    abertos: somaTudo(contagens) - decididos,
    ganhos,
    perdidos,
    taxa_ganho: decididos > 0 ? arredonda((ganhos / decididos) * 100) : 0,
  };
}

/**
 * Conversões do funil de formulário.
 *
 * Aqui não existem `ganho`/`perdido`: as etapas são os status do CRM do
 * cliente e quem diz qual delas é venda é a marcação `is_conversion` em
 * `crm_meta_event_map` — a mesma que já alimenta o CAC da aba Campanhas.
 * Usar outro critério aqui daria dois números de conversão diferentes no
 * mesmo painel.
 */
export function conversoesDoFormulario(
  etapas: EtapaCadastrada[],
  contagens: ContagemEtapa[],
): { conversoes: number; taxa: number } {
  const porEtapa = contaPorEtapa(contagens);
  const total = somaTudo(contagens);
  const conversoes = etapas
    .filter((e) => Number(e.is_conversion) === 1)
    .reduce((soma, e) => soma + (porEtapa.get(e.valor) ?? 0), 0);
  return { conversoes, taxa: total > 0 ? arredonda((conversoes / total) * 100) : 0 };
}

export type MotivoPerda = { motivo: string; total: number; pct: number };

/**
 * Ranking dos motivos, com os sem motivo no fim.
 *
 * Quem não tem motivo registrado entra como uma linha própria em vez de
 * sumir: uma perda sem motivo é informação sobre o processo, e escondê-la
 * faria o ranking parecer completo quando ele cobre metade das perdas.
 */
export function rankingMotivos(
  linhas: { motivo: string | null; total: number | string }[],
  totalPerdidos: number,
): MotivoPerda[] {
  let comMotivo = 0;
  const itens: MotivoPerda[] = [];
  for (const l of linhas) {
    const motivo = normalizaMotivo(l.motivo);
    const total = Number(l.total) || 0;
    if (!motivo || total <= 0) continue;
    comMotivo += total;
    itens.push({ motivo, total, pct: 0 });
  }
  itens.sort((a, b) => b.total - a.total || a.motivo.localeCompare(b.motivo, 'pt-BR'));

  const semMotivo = Math.max(0, totalPerdidos - comMotivo);
  if (semMotivo > 0) itens.push({ motivo: SEM_MOTIVO, total: semMotivo, pct: 0 });

  const base = totalPerdidos > 0 ? totalPerdidos : comMotivo;
  return itens.map((i) => ({ ...i, pct: base > 0 ? arredonda((i.total / base) * 100) : 0 }));
}

export type PerdaPorCampanha = {
  campanha: string;
  total: number;
  perdidos: number;
  taxa: number;
};

/**
 * Onde o dinheiro entra e o lead morre.
 *
 * Ordena por taxa de perda, não por número absoluto: a campanha maior
 * sempre perde mais em números, e é a taxa que diz qual delas está
 * trazendo o público errado. Campanha com pouquíssimo contato fica fora
 * porque 1 perda em 2 contatos vira 50% e lidera o relatório sem
 * significar nada.
 */
export function perdasPorCampanha(
  linhas: { campanha: string | null; total: number | string; perdidos: number | string }[],
  minimoContatos = 5,
): PerdaPorCampanha[] {
  return linhas
    .map((l) => {
      const total = Number(l.total) || 0;
      const perdidos = Number(l.perdidos) || 0;
      return {
        campanha: (l.campanha ?? '').trim() || 'Sem campanha',
        total,
        perdidos,
        taxa: total > 0 ? arredonda((perdidos / total) * 100) : 0,
      };
    })
    .filter((l) => l.total >= minimoContatos && l.perdidos > 0)
    .sort((a, b) => b.taxa - a.taxa || b.perdidos - a.perdidos);
}
