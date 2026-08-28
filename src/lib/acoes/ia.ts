'use server';

import { z } from 'zod';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { buscaMetricas } from '@/lib/db/metricas';
import { env } from '@/lib/env';
import { HttpError } from '@/lib/http';
import { analisaComGroq, montaResumo } from '@/lib/ia';
import { CANAIS, RANGES, resolvePeriodo } from '@/lib/periodo';

/**
 * Ação da tela "Análise por IA" — porte de `POST /painel-api/ia-analise`.
 *
 * Só o clique no botão dispara a chamada. Trocar o período não gera
 * análise sozinho, como no painel antigo: cada execução custa uma
 * chamada à Groq, e disparo automático em troca de filtro vira gasto
 * silencioso.
 */

export type ResultadoIa = { ok: true; analise: string } | { ok: false; erro: string };

const Schema = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  canal: z.enum(CANAIS),
  range: z.enum(RANGES).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  pergunta: z.string().max(2000).optional(),
});

export async function acaoAnalisarIa(entrada: z.input<typeof Schema>): Promise<ResultadoIa> {
  const analise = Schema.safeParse(entrada);
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = analise.data;

  const { usuario, conta, db } = await requireClientAccess(dados.cliente);

  const periodo = resolvePeriodo({
    range: dados.range,
    date_from: dados.date_from,
    date_to: dados.date_to,
    channel: dados.canal,
  });

  let texto: string;
  try {
    const metricas = await buscaMetricas(db, periodo);
    texto = await analisaComGroq(
      montaResumo(metricas, periodo),
      conta.account_name ?? conta.client_db_name,
      dados.pergunta ?? '',
    );
  } catch (erro) {
    if (erro instanceof HttpError) return { ok: false, erro: erro.message };
    console.error('[ia] falha ao gerar análise:', erro);
    return { ok: false, erro: 'Não foi possível gerar a análise por IA agora. Tente novamente.' };
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.IA_ANALISE_EXECUTADA,
    clientDb: conta.client_db_name,
    // A pergunta e a resposta não entram no log: o que interessa para
    // auditoria é quem gastou uma chamada, quando e sobre qual recorte.
    detalhe: {
      canal: periodo.canal,
      range: periodo.range,
      modelo: env.groq.model,
      pergunta_caracteres: (dados.pergunta ?? '').trim().length,
    },
  });

  return { ok: true, analise: texto };
}
