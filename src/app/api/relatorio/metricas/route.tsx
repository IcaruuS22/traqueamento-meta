import { z } from 'zod';
import { renderToBuffer } from '@react-pdf/renderer';
import { rota, queryParams, entradaInvalida } from '@/lib/http';
import { requireClientAccess } from '@/lib/auth/guard';
import { buscaMetricas } from '@/lib/db/metricas';
import { visibilidadeMetricas } from '@/lib/db/prefs';
import { resolvePeriodo } from '@/lib/periodo';
import { montaDadosRelatorio, nomeArquivoRelatorio } from '@/lib/relatorio';
import { RelatorioMetricas } from '@/lib/relatorio-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Exportação em PDF de "Métricas Gerais".
 *
 * Repete de propósito a mesma busca da página (`buscaMetricas` +
 * `visibilidadeMetricas` com o mesmo `resolvePeriodo`): o PDF precisa
 * refletir o que está na tela, e o caminho seguro para isso é reexecutar
 * a consulta com os mesmos parâmetros, não confiar em números vindos
 * pela query string — que qualquer um poderia forjar.
 *
 * Devolve `Response` cru em vez de JSON; `rota()` deixa passar sem
 * envelopar, e é isso que permite mandar bytes com cabeçalho próprio.
 */

const Entrada = z.object({
  client_db: z.string().min(1),
  range: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  channel: z.string().optional(),
});

export const GET = rota(async (req) => {
  const analise = Entrada.safeParse(queryParams(req));
  if (!analise.success) throw entradaInvalida('Parâmetros inválidos', analise.error.flatten());
  const entrada = analise.data;

  const { conta, db } = await requireClientAccess(entrada.client_db);
  const periodo = resolvePeriodo({
    range: entrada.range,
    date_from: entrada.date_from,
    date_to: entrada.date_to,
    channel: entrada.channel,
  });

  const [metricas, visiveis] = await Promise.all([
    buscaMetricas(db, periodo),
    visibilidadeMetricas(conta.client_db_name),
  ]);

  const agora = new Date();
  const dados = montaDadosRelatorio(metricas, periodo, visiveis, conta, agora);
  const pdf = await renderToBuffer(<RelatorioMetricas dados={dados} />);
  const arquivo = nomeArquivoRelatorio(conta.client_db_name, periodo.canal, agora);

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `attachment; filename="${arquivo}"`,
      // Relatório é sempre do instante em que foi pedido: nada de cache
      // intermediário servindo o PDF de ontem para o período de hoje.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
});
