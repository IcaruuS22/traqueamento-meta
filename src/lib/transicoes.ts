import { posicaoNoFunil } from '@/lib/meta-eventos';

/** Primeira vez que um lead alcançou uma etapa. */
export type MarcoDeEtapa = {
  customer_id: number;
  /** Nome exibido da etapa (content_name do mapeamento, ou o próprio evento). */
  stage_name: string;
  /** Evento Meta que a etapa dispara — é o que define a posição no funil. */
  event_name: string;
  /** Momento do primeiro registro dessa etapa para esse lead, em ms. */
  ms: number;
};

export type Transicao = { from_stage: string; to_stage: string; avg_ms: number; count: number };

/**
 * Ordena as etapas observadas pela ordem real do funil.
 *
 * O nome da etapa é livre (cada cliente batiza como quiser no CRM), então
 * a ordem vem do evento Meta que ela dispara. Empate entre etapas que
 * mapeiam para o mesmo evento — comum, várias etapas do CRM viram `Lead` —
 * é desfeito pela primeira ocorrência da etapa no período.
 */
export function ordemDasEtapas(marcos: MarcoDeEtapa[]): string[] {
  const primeira = new Map<string, { evento: string; ms: number }>();
  for (const m of marcos) {
    const atual = primeira.get(m.stage_name);
    if (!atual || m.ms < atual.ms) primeira.set(m.stage_name, { evento: m.event_name, ms: m.ms });
  }

  return [...primeira.entries()]
    .sort(([, a], [, b]) => {
      const pa = posicaoNoFunil(a.evento);
      const pb = posicaoNoFunil(b.evento);
      return pa !== pb ? pa - pb : a.ms - b.ms;
    })
    .map(([nome]) => nome);
}

/**
 * Tempo médio de cada passo do funil.
 *
 * Mede só pares de etapas **vizinhas no funil** (etapa 1 → 2, 2 → 3, ...),
 * nunca dois eventos que por acaso ficaram lado a lado na timeline de um
 * lead. Lead que pulou uma etapa não entra na média daquele passo — ele
 * não percorreu esse trecho, e usar o salto inteiro inflaria o tempo.
 * O resultado sai na ordem do funil, não por volume.
 */
export function transicoesDoFunil(marcos: MarcoDeEtapa[]): Transicao[] {
  const ordem = ordemDasEtapas(marcos);

  const porLead = new Map<number, Map<string, number>>();
  for (const m of marcos) {
    const etapas = porLead.get(m.customer_id) ?? new Map<string, number>();
    const anterior = etapas.get(m.stage_name);
    if (anterior === undefined || m.ms < anterior) etapas.set(m.stage_name, m.ms);
    porLead.set(m.customer_id, etapas);
  }

  const saida: Transicao[] = [];
  for (let i = 1; i < ordem.length; i++) {
    const de = ordem[i - 1];
    const para = ordem[i];
    let totalMs = 0;
    let count = 0;
    for (const etapas of porLead.values()) {
      const inicio = etapas.get(de);
      const fim = etapas.get(para);
      if (inicio === undefined || fim === undefined || fim < inicio) continue;
      totalMs += fim - inicio;
      count += 1;
    }
    if (count > 0) saida.push({ from_stage: de, to_stage: para, avg_ms: Math.round(totalMs / count), count });
  }
  return saida;
}
