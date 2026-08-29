import 'server-only';
import type { BancoCliente } from '@/lib/db/cliente';
import { LacunasDeEsquema } from '@/lib/db/pool';
import { condicaoTimestamp, montaWhere, type Periodo } from '@/lib/periodo';
import {
  conversoesDoFormulario,
  faixasDoWhatsapp,
  montaFunil,
  perdasPorCampanha,
  rankingMotivos,
  type ContagemEtapa,
  type EtapaCadastrada,
  type FaixasFunil,
  type MotivoPerda,
  type PerdaPorCampanha,
  type ResumoFunil,
} from '@/lib/funil';
import { ETAPA_CONTATO_WHATSAPP } from '@/lib/crm';
import { ESTAGIO_PERDIDO } from '@/lib/whatsapp-conversas';

/**
 * Analytics do funil.
 *
 * Dois funis, como no CRM e pelo mesmo motivo: o do WhatsApp é do painel
 * (`whatsapp_conversations.status`) e o do formulário é espelho do CRM do
 * cliente (`customers.current_stage` × `crm_meta_event_map`). Somar os
 * dois num número só exigiria equivaler etapas de cadastros diferentes,
 * que é exatamente o que quebra quando o cliente renomeia uma etapa.
 *
 * O recorte de período é sempre `customers.created_at` — a data de
 * entrada do contato, igual ao resto do painel. Recortar pela data da
 * perda daria um relatório em que o total de contatos e o total de
 * perdas falam de conjuntos diferentes.
 */

export type AnalyticsFunil = {
  whatsapp: ResumoFunil & { faixas: FaixasFunil };
  formulario: ResumoFunil & { conversoes: number; taxa_conversao: number };
  motivos: MotivoPerda[];
  campanhas: PerdaPorCampanha[];
  lacunas_de_esquema: string[];
};

/** Teto do relatório de campanhas: a cauda longa não cabe na tela. */
const TETO_CAMPANHAS = 12;

export async function buscaAnalyticsFunil(
  db: BancoCliente,
  periodo: Periodo,
): Promise<AnalyticsFunil> {
  const lacunas = new LacunasDeEsquema();
  const data = condicaoTimestamp('c.created_at', periodo.inicioSec, periodo.fimSec);
  const onde = montaWhere([data.sql]);

  const [etapasWhatsapp, etapasForm, contagemWhatsapp, contagemForm, motivos, campanhas] =
    await Promise.all([
      lacunas.ou(
        db.query<EtapaCadastrada>(
          `SELECT estagio AS valor, content_name
             FROM ${db.tabela('whatsapp_event_map')}
            WHERE ativo = 1
            ORDER BY id ASC`,
        ),
        [] as EtapaCadastrada[],
      ),
      lacunas.ou(
        db.query<EtapaCadastrada>(
          `SELECT status_id AS valor, content_name, is_conversion
             FROM ${db.tabela('crm_meta_event_map')}
            WHERE ativo = 1
            ORDER BY id ASC`,
        ),
        [] as EtapaCadastrada[],
      ),
      lacunas.ou(
        db.query<ContagemEtapa>(
          `SELECT wc.status AS etapa, COUNT(*) AS total
             FROM ${db.tabela('whatsapp_conversations')} wc
             JOIN ${db.tabela('customers')} c ON c.id = wc.customer_id
             ${onde}
            GROUP BY wc.status`,
          data.params,
        ),
        [] as ContagemEtapa[],
      ),
      // O sentinela da ingestão do WhatsApp fica de fora: ele mora em
      // `current_stage` mas não é etapa do funil do Kommo (ver lib/crm.ts).
      lacunas.ou(
        db.query<ContagemEtapa>(
          `SELECT c.current_stage AS etapa, COUNT(*) AS total
             FROM ${db.tabela('customers')} c
             ${montaWhere([
               data.sql,
               "COALESCE(c.current_stage, '') <> ''",
               'c.current_stage <> ?',
             ])}
            GROUP BY c.current_stage`,
          [...data.params, ETAPA_CONTATO_WHATSAPP],
        ),
        [] as ContagemEtapa[],
      ),
      lacunas.ou(
        db.query<{ motivo: string | null; total: number }>(
          `SELECT wc.lost_reason AS motivo, COUNT(*) AS total
             FROM ${db.tabela('whatsapp_conversations')} wc
             JOIN ${db.tabela('customers')} c ON c.id = wc.customer_id
             ${montaWhere([data.sql, 'wc.status = ?'])}
            GROUP BY wc.lost_reason`,
          [...data.params, ESTAGIO_PERDIDO],
        ),
        [] as { motivo: string | null; total: number }[],
      ),
      // Perda por campanha só existe do lado do WhatsApp, que é o funil
      // que o painel fecha. O LEFT JOIN mantém no denominador o contato
      // que veio da campanha e nunca abriu conversa.
      lacunas.ou(
        db.query<{ campanha: string | null; total: number; perdidos: number }>(
          `SELECT COALESCE(NULLIF(c.meta_campaign_name, ''), NULLIF(c.utm_campaign, '')) AS campanha,
                  COUNT(*) AS total,
                  SUM(CASE WHEN wc.status = ? THEN 1 ELSE 0 END) AS perdidos
             FROM ${db.tabela('customers')} c
             LEFT JOIN ${db.tabela('whatsapp_conversations')} wc ON wc.customer_id = c.id
             ${onde}
            GROUP BY campanha`,
          [ESTAGIO_PERDIDO, ...data.params],
        ),
        [] as { campanha: string | null; total: number; perdidos: number }[],
      ),
    ]);

  const faixas = faixasDoWhatsapp(contagemWhatsapp);

  return {
    whatsapp: { ...montaFunil(etapasWhatsapp, contagemWhatsapp), faixas },
    formulario: (() => {
      const base = montaFunil(etapasForm, contagemForm);
      const { conversoes, taxa } = conversoesDoFormulario(etapasForm, contagemForm);
      return { ...base, conversoes, taxa_conversao: taxa };
    })(),
    motivos: rankingMotivos(motivos, faixas.perdidos),
    campanhas: perdasPorCampanha(campanhas).slice(0, TETO_CAMPANHAS),
    lacunas_de_esquema: lacunas.lista(),
  };
}
