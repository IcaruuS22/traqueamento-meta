import 'server-only';
import type { BancoCliente } from '@/lib/db/cliente';
import { LacunasDeEsquema } from '@/lib/db/pool';
import type { Periodo } from '@/lib/periodo';
import { filtroLeads, ultimosLeads, type Lead } from '@/lib/db/metricas';

/**
 * Board do CRM — leads agrupados por estágio.
 *
 * Porte de `GET /painel-api/kanban` (nodes "Estagios Kanban", "Leads
 * Kanban" e "Monta Resposta Kanban" de
 * `Painel Administrativo/build_admin_panel_workflow.js`).
 *
 * As colunas NÃO saem dos leads: saem de `crm_meta_event_map` (estágios
 * ativos, na ordem de cadastro), para que um estágio vazio continue
 * aparecendo no board. Estágio que aparece em algum lead mas não está
 * cadastrado como ativo vira coluna extra no fim — melhor uma coluna com
 * o id bruto do CRM do que um lead sumindo da tela.
 */

export const SEM_EVENTO = 'Sem Evento';

/**
 * Mesmo teto do painel antigo. O board não é paginado no servidor: ele
 * mostra o funil inteiro, e o corte existe só para não estourar a
 * memória num banco absurdamente grande. Ordena pela MESMA coluna do
 * filtro (`created_at`), então se o teto for atingido o corte é
 * previsível — os leads mais antigos do período.
 */
const TETO_LEADS = 5000;

export type ColunaKanban = { nome: string; leads: Lead[] };

export type Kanban = {
  colunas: ColunaKanban[];
  /** Total de leads no board, somando todas as colunas. */
  total: number;
  /**
   * Se há algum estágio ativo cadastrado em `crm_meta_event_map`. Sem
   * isso o board não seria "vazio": `colunas` sempre traz ao menos a
   * coluna "Sem Evento", e a tela precisa distinguir "cliente sem
   * estágios configurados" de "período sem leads".
   */
  tem_estagios: boolean;
  /** Mesma semântica de `Metricas.lacunas_de_esquema`. */
  lacunas_de_esquema: string[];
};

type LinhaEstagio = { status_id: string | null; content_name: string | null };

export async function buscaKanban(db: BancoCliente, periodo: Periodo): Promise<Kanban> {
  // O mesmo fragmento de WHERE de "Últimos leads" — board e lista têm de
  // concordar sobre o que é um lead do período.
  const filtro = filtroLeads(db, periodo);

  const lacunas = new LacunasDeEsquema();
  const [estagios, leads] = await Promise.all([
    lacunas.ou(
      db.query<LinhaEstagio>(
        `SELECT status_id, content_name
           FROM ${db.tabela('crm_meta_event_map')}
          WHERE ativo = 1
          ORDER BY id ASC`,
      ),
      [] as LinhaEstagio[],
    ),
    lacunas.ou(ultimosLeads(db, filtro, TETO_LEADS), [] as Lead[]),
  ]);

  return {
    ...montaColunas(estagios, leads),
    lacunas_de_esquema: lacunas.lista(),
  };
}

/**
 * Separada da consulta porque é onde mora a regra e é o que vale testar:
 * ordem das colunas, estágio não cadastrado e lead sem estágio nenhum.
 */
export function montaColunas(
  estagios: LinhaEstagio[],
  leads: Lead[],
): { colunas: ColunaKanban[]; total: number; tem_estagios: boolean } {
  const nomes: string[] = [];
  const cadastrados = new Set<string>();
  for (const e of estagios) {
    const rotulo = e.content_name || e.status_id;
    if (!rotulo || cadastrados.has(rotulo)) continue;
    cadastrados.add(rotulo);
    nomes.push(rotulo);
  }

  // `ultimosLeads` já devolve `current_stage` traduzido pelo mesmo
  // `crm_meta_event_map`; o que não bateu chega aqui como o status_id
  // bruto do CRM e vira coluna extra.
  const extras: string[] = [];
  const vistos = new Set<string>();
  for (const l of leads) {
    const estagio = l.current_stage;
    if (estagio && !cadastrados.has(estagio) && !vistos.has(estagio)) {
      vistos.add(estagio);
      extras.push(estagio);
    }
  }

  const porColuna = new Map<string, Lead[]>();
  for (const nome of [...nomes, ...extras, SEM_EVENTO]) porColuna.set(nome, []);
  for (const l of leads) {
    porColuna.get(l.current_stage || SEM_EVENTO)?.push(l);
  }

  return {
    colunas: [...porColuna].map(([nome, leadsDaColuna]) => ({ nome, leads: leadsDaColuna })),
    total: leads.length,
    tem_estagios: nomes.length > 0,
  };
}
