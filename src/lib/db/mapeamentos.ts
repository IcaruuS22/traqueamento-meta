import 'server-only';
import type { BancoCliente } from '@/lib/db/cliente';
import { LacunasDeEsquema } from '@/lib/db/pool';
import type { TipoDeValor } from '@/lib/meta-eventos';

/**
 * Mapeamento de estágio → evento Meta, nas duas variantes.
 *
 * Porte de seis endpoints do painel antigo: `eventos`, `eventos-salvar`,
 * `eventos-excluir` (tabela `crm_meta_event_map`, estágios do Kommo) e
 * `whatsapp-eventos`, `whatsapp-eventos-salvar`,
 * `whatsapp-eventos-excluir` (tabela `whatsapp_event_map`, estágios do
 * funil de Conversas).
 *
 * As duas tabelas respondem à mesma pergunta — "quando o lead chega
 * neste estágio, qual evento vai para a Meta?" — mas têm colunas e
 * regras de escrita diferentes, e por isso continuam com funções
 * separadas em vez de uma abstração comum:
 *
 *  - `crm_meta_event_map` é chaveada por `(pipeline_id, status_id)`, que
 *    vêm do Kommo. Salvar é sempre upsert por essa chave; o `id` nunca é
 *    usado para localizar a linha. O valor do evento é dinâmico
 *    (`value_type`), porque o negócio tem preço no CRM;
 *  - `whatsapp_event_map` é chaveada por `estagio`, um nome escrito pelo
 *    próprio cliente. Como o nome pode ser corrigido, editar uma linha
 *    existente é UPDATE por `id` — assim renomear não cria linha nova. O
 *    valor é um número fixo (`value`), porque conversa de WhatsApp não
 *    tem preço vindo de lugar nenhum.
 *
 * O SQL do painel antigo era montado por concatenação de texto dentro de
 * Code nodes do n8n. Aqui os mesmos comandos usam `?`: o nome do banco
 * continua sendo o único pedaço interpolado, e vem de `BancoCliente`, que
 * já passou por `sanitizaNomeBanco` e pelo catálogo.
 */

export type MapeamentoForm = {
  id: number;
  pipeline_id: string;
  status_id: string;
  meta_event: string;
  content_name: string | null;
  currency: string | null;
  value_type: string | null;
  ativo: boolean;
  is_conversion: boolean;
};

export type MapeamentoWhatsapp = {
  id: number;
  estagio: string;
  meta_event: string | null;
  content_name: string | null;
  currency: string | null;
  value: number;
  ativo: boolean;
  is_conversion: boolean;
};

/** O MySQL devolve BOOLEAN como 0/1 e DECIMAL como texto. */
type LinhaForm = Omit<MapeamentoForm, 'ativo' | 'is_conversion'> & {
  ativo: number;
  is_conversion: number;
};
type LinhaWhatsapp = Omit<MapeamentoWhatsapp, 'ativo' | 'is_conversion' | 'value'> & {
  ativo: number;
  is_conversion: number;
  value: string | number | null;
};

export type ListaMapeamentos<T> = {
  itens: T[];
  lacunas_de_esquema: string[];
};

// -------------------------------------------------------------------
// Formulário Instantâneo — crm_meta_event_map
// -------------------------------------------------------------------

export async function listaMapeamentosForm(
  db: BancoCliente,
): Promise<ListaMapeamentos<MapeamentoForm>> {
  const lacunas = new LacunasDeEsquema();
  const linhas = await lacunas.ou(
    db.query<LinhaForm>(
      `SELECT id, pipeline_id, status_id, meta_event, content_name, currency,
              value_type, ativo, is_conversion
         FROM ${db.tabela('crm_meta_event_map')}
        ORDER BY id ASC`,
    ),
    [],
  );

  return {
    itens: linhas.map((l) => ({
      ...l,
      ativo: Boolean(l.ativo),
      is_conversion: Boolean(l.is_conversion),
    })),
    lacunas_de_esquema: lacunas.lista(),
  };
}

export type EntradaMapeamentoForm = {
  pipeline_id: string;
  status_id: string;
  meta_event: string;
  content_name: string | null;
  currency: string;
  value_type: TipoDeValor;
  ativo: boolean;
  is_conversion: boolean;
};

/**
 * Upsert por `(pipeline_id, status_id)` — a chave única da tabela.
 * Salvar duas vezes a mesma combinação atualiza, nunca duplica.
 */
export async function salvaMapeamentoForm(
  db: BancoCliente,
  entrada: EntradaMapeamentoForm,
): Promise<void> {
  await db.execute(
    `INSERT INTO ${db.tabela('crm_meta_event_map')}
       (pipeline_id, status_id, meta_event, content_name, currency, value_type, ativo, is_conversion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       meta_event = ?, content_name = ?, currency = ?, value_type = ?,
       ativo = ?, is_conversion = ?`,
    [
      entrada.pipeline_id,
      entrada.status_id,
      entrada.meta_event,
      entrada.content_name,
      entrada.currency,
      entrada.value_type,
      entrada.ativo ? 1 : 0,
      entrada.is_conversion ? 1 : 0,
      entrada.meta_event,
      entrada.content_name,
      entrada.currency,
      entrada.value_type,
      entrada.ativo ? 1 : 0,
      entrada.is_conversion ? 1 : 0,
    ],
  );
}

/** Devolve `false` quando não havia linha com aquele id. */
export async function excluiMapeamentoForm(db: BancoCliente, id: number): Promise<boolean> {
  const { affectedRows } = await db.execute(
    `DELETE FROM ${db.tabela('crm_meta_event_map')} WHERE id = ?`,
    [id],
  );
  return affectedRows > 0;
}

// -------------------------------------------------------------------
// WhatsApp — whatsapp_event_map
// -------------------------------------------------------------------

export async function listaMapeamentosWhatsapp(
  db: BancoCliente,
): Promise<ListaMapeamentos<MapeamentoWhatsapp>> {
  const lacunas = new LacunasDeEsquema();
  const linhas = await lacunas.ou(
    db.query<LinhaWhatsapp>(
      `SELECT id, estagio, meta_event, content_name, currency, value, ativo, is_conversion
         FROM ${db.tabela('whatsapp_event_map')}
        ORDER BY id ASC`,
    ),
    [],
  );

  return {
    itens: linhas.map((l) => ({
      ...l,
      value: Number(l.value) || 0,
      ativo: Boolean(l.ativo),
      is_conversion: Boolean(l.is_conversion),
    })),
    lacunas_de_esquema: lacunas.lista(),
  };
}

export type EntradaMapeamentoWhatsapp = {
  /** Ausente na criação; presente ao editar uma linha existente. */
  id: number | null;
  estagio: string;
  meta_event: string | null;
  content_name: string | null;
  currency: string;
  value: number;
  ativo: boolean;
  is_conversion: boolean;
};

/**
 * Com `id`: UPDATE pela chave primária, o que permite renomear o estágio
 * (`estagio` continua UNIQUE só para impedir dois estágios com o mesmo
 * nome). Sem `id`: INSERT, com `ON DUPLICATE KEY UPDATE` apenas como
 * proteção contra duplo clique na criação.
 */
export async function salvaMapeamentoWhatsapp(
  db: BancoCliente,
  entrada: EntradaMapeamentoWhatsapp,
): Promise<void> {
  const tabela = db.tabela('whatsapp_event_map');
  const comuns = [
    entrada.meta_event,
    entrada.content_name,
    entrada.currency,
    entrada.value,
    entrada.ativo ? 1 : 0,
    entrada.is_conversion ? 1 : 0,
  ];

  if (entrada.id) {
    await db.execute(
      `UPDATE ${tabela}
          SET estagio = ?, meta_event = ?, content_name = ?, currency = ?,
              value = ?, ativo = ?, is_conversion = ?
        WHERE id = ?`,
      [entrada.estagio, ...comuns, entrada.id],
    );
    return;
  }

  await db.execute(
    `INSERT INTO ${tabela}
       (estagio, meta_event, content_name, currency, value, ativo, is_conversion)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       meta_event = ?, content_name = ?, currency = ?, value = ?,
       ativo = ?, is_conversion = ?`,
    [entrada.estagio, ...comuns, ...comuns],
  );
}

/** Devolve `false` quando não havia linha com aquele id. */
export async function excluiMapeamentoWhatsapp(db: BancoCliente, id: number): Promise<boolean> {
  const { affectedRows } = await db.execute(
    `DELETE FROM ${db.tabela('whatsapp_event_map')} WHERE id = ?`,
    [id],
  );
  return affectedRows > 0;
}
