import 'server-only';
import type { BancoCliente } from '@/lib/db/cliente';
import { LacunasDeEsquema } from '@/lib/db/pool';
import { condicaoTimestamp, condicaoCanalPorId, montaWhere, type Periodo } from '@/lib/periodo';

/**
 * Log de envios à Meta CAPI — porte de `GET /painel-api/eventos-recentes`.
 *
 * A tela tem duas partes com escopos DIFERENTES de propósito, igual ao
 * painel antigo:
 *
 *  - os 4 cards e o gráfico "Eventos por status" cobrem o período
 *    inteiro e ignoram os filtros de status e busca. Filtrar por
 *    "ERROR" e ver o card "Taxa de Sucesso" cair para 0% seria uma
 *    leitura errada do próprio filtro;
 *  - a tabela respeita status, busca e paginação.
 *
 * O SQL foi copiado literalmente. O que mudou: datas, status, termo de
 * busca, limite e offset entram por `?` — no workflow o termo de busca
 * era escapado à mão (aspas simples dobradas) e o resto interpolado.
 */

export const LIMITE_PADRAO = 30;

export type EventoRecente = {
  id: number;
  created_at: string;
  event_name: string | null;
  content_name: string | null;
  status: string;
  value: string | number | null;
  currency: string | null;
  error_message: string | null;
  lead_first_name: string | null;
  lead_last_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
};

export type ContagemStatus = { status: string; total: number };

export type PainelEventos = {
  eventos: EventoRecente[];
  por_status: ContagemStatus[];
  /** `null` em `max`, que não tem janela anterior computável. */
  por_status_anterior: ContagemStatus[] | null;
  /** Mesma semântica de `Metricas.lacunas_de_esquema`. */
  lacunas_de_esquema: string[];
};

export type FiltrosEventos = {
  /** Já validado contra a whitelist pela rota/página. */
  status?: string | null;
  search?: string | null;
  limite?: number;
  offset?: number;
};

/** Escopo de canal sobre `meta_capi_events e` — a tabela não tem coluna de canal. */
function escopoCanal(db: BancoCliente, periodo: Periodo): string {
  return condicaoCanalPorId(
    periodo.canal,
    'e.customer_id',
    db.tabela('whatsapp_conversations'),
  );
}

async function contaPorStatus(
  db: BancoCliente,
  where: { sql: string; params: unknown[] },
): Promise<ContagemStatus[]> {
  const linhas = await db.query<{ status: string; total: unknown }>(
    `SELECT e.status, COUNT(*) AS total
       FROM ${db.tabela('meta_capi_events')} e
       ${where.sql}
      GROUP BY e.status`,
    where.params,
  );
  return linhas.map((l) => ({ status: l.status, total: Number(l.total) || 0 }));
}

async function listaEventos(
  db: BancoCliente,
  periodo: Periodo,
  filtros: FiltrosEventos,
): Promise<EventoRecente[]> {
  const data = condicaoTimestamp('e.created_at', periodo.inicioSec, periodo.fimSec);
  const condicoes: string[] = [data.sql, escopoCanal(db, periodo)];
  const params: unknown[] = [...data.params];

  if (filtros.status) {
    condicoes.push('e.status = ?');
    params.push(filtros.status);
  }

  const termo = String(filtros.search ?? '').trim();
  if (termo) {
    condicoes.push(
      `(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?
        OR CONCAT_WS(' ', c.first_name, c.last_name) LIKE ?)`,
    );
    const like = `%${termo}%`;
    params.push(like, like, like, like, like);
  }

  const limite = filtros.limite ?? LIMITE_PADRAO;
  const offset = filtros.offset ?? 0;

  return db.query<EventoRecente>(
    `SELECT e.id, e.created_at, e.event_name, e.content_name, e.status, e.value,
            e.currency, e.error_message,
            c.first_name AS lead_first_name, c.last_name AS lead_last_name,
            c.email AS lead_email, c.phone AS lead_phone
       FROM ${db.tabela('meta_capi_events')} e
       LEFT JOIN ${db.tabela('customers')} c ON c.id = e.customer_id
       ${montaWhere(condicoes)}
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limite, offset],
  );
}

/** Tabela + resumo, na mesma ida ao banco que a tela precisa. */
export async function buscaPainelEventos(
  db: BancoCliente,
  periodo: Periodo,
  filtros: FiltrosEventos = {},
): Promise<PainelEventos> {
  const canal = escopoCanal(db, periodo);
  const atual = condicaoTimestamp('e.created_at', periodo.inicioSec, periodo.fimSec);
  const anterior = condicaoTimestamp(
    'e.created_at',
    periodo.anteriorInicioSec,
    periodo.anteriorFimSec,
  );

  const lacunas = new LacunasDeEsquema();
  const [eventos, porStatus, porStatusAnterior] = await Promise.all([
    lacunas.ou(listaEventos(db, periodo, filtros), [] as EventoRecente[]),
    lacunas.ou(
      contaPorStatus(db, {
        sql: montaWhere([atual.sql, canal]),
        params: atual.params as unknown[],
      }),
      [] as ContagemStatus[],
    ),
    periodo.anteriorInicioSec === null
      ? Promise.resolve(null)
      : lacunas.ou(
          contaPorStatus(db, {
            sql: montaWhere([anterior.sql, canal]),
            params: anterior.params as unknown[],
          }),
          [] as ContagemStatus[],
        ),
  ]);

  return {
    eventos,
    por_status: porStatus,
    por_status_anterior: porStatusAnterior,
    lacunas_de_esquema: lacunas.lista(),
  };
}

/**
 * Só a página seguinte da tabela — o "Carregar mais" não recalcula os
 * cards, que não dependem de paginação.
 */
export async function paginaEventos(
  db: BancoCliente,
  periodo: Periodo,
  filtros: FiltrosEventos,
): Promise<EventoRecente[]> {
  return listaEventos(db, periodo, filtros);
}
