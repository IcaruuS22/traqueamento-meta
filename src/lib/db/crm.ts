import 'server-only';
import type { BancoCliente } from '@/lib/db/cliente';
import { LacunasDeEsquema, lacunaDeEsquema, transacao } from '@/lib/db/pool';
import { condicaoTimestamp, montaWhere, type Periodo } from '@/lib/periodo';
import {
  ehContatoDeWhatsapp,
  etapaDoFunilForm,
  montaQuadro,
  type CartaoCrm,
  type ColunaCrm,
  type LinhaCartao,
  type LinhaEtapaForm,
  type LinhaEtapaWhatsapp,
  type OrigemLead,
} from '@/lib/crm';
import { rotuloEstagio } from '@/lib/whatsapp-conversas';
import { ehEtapaDePerda } from '@/lib/funil';
import { gravaConversa } from '@/lib/db/conversas';

/**
 * CRM unificado — leads de Formulário e contatos de WhatsApp no mesmo
 * quadro.
 *
 * Antes eram duas telas que nunca se olhavam: o Kanban da seção
 * Formulários (etapa do Kommo) e a lista de Conversas (etapa do painel).
 * Um mesmo contato podia estar nos dois e ninguém via. Aqui o quadro é um
 * só e cada card diz de onde veio.
 *
 * O que NÃO foi unificado, de propósito: o funil. São dois cadastros
 * diferentes, do cliente, com nomes diferentes — `crm_meta_event_map`
 * (etapas do Kommo) e `whatsapp_event_map` (etapas do painel). Inventar
 * um terceiro funil aqui obrigaria a traduzir etapa de volta na hora de
 * gravar, e é essa tradução que quebra quando o cliente renomeia uma
 * etapa. Então as colunas dos dois funis convivem no mesmo quadro, cada
 * uma sabendo de qual origem aceita card.
 *
 * Por que só card de WhatsApp se move: a etapa do WhatsApp é do painel —
 * está em `whatsapp_conversations.status`, escrita por esta tela. A do
 * Kommo é espelho; quem a muda é o CRM do cliente, via n8n. Escrevê-la
 * aqui não moveria nada no Kommo, seria desfeita na próxima sincronia e,
 * pior, contaria conversão que não houve: as métricas contam conversão
 * fazendo JOIN de `customers.current_stage` com `crm_meta_event_map`
 * onde `is_conversion = 1`. Mover um card à mão inflaria o número sem
 * nenhum evento ter sido enviado à Meta.
 */

/** Mesmo teto do Kanban antigo: o quadro mostra o funil, não pagina. */
const TETO_LEADS = 3000;

export type QuadroCrm = {
  colunas: ColunaCrm[];
  cartoes: CartaoCrm[];
  total: number;
  /** Se há ao menos um funil cadastrado (Kommo ou WhatsApp). */
  tem_etapas: boolean;
  lacunas_de_esquema: string[];
};

export type FiltrosCrm = {
  /** Já validada contra a whitelist pela página. */
  origem?: OrigemLead | null;
  busca?: string | null;
};

/**
 * Cards do período.
 *
 * `tem_conversa` sai de `whatsapp_conversations`, não de
 * `whatsapp_messages`: a linha de conversa é criada no primeiro contato
 * (webhook ou envio pelo painel) e é ela que guarda a etapa. Contar
 * mensagem daria o mesmo resultado com uma subconsulta a mais.
 */
async function leCartoes(
  db: BancoCliente,
  periodo: Periodo,
  filtros: FiltrosCrm,
  comConversas: boolean,
  comPerda: boolean,
): Promise<LinhaCartao[]> {
  const data = condicaoTimestamp('c.created_at', periodo.inicioSec, periodo.fimSec);
  const condicoes: { sql: string; params: unknown[] }[] = [data];

  const busca = (filtros.busca ?? '').trim();
  if (busca) {
    const termo = `%${busca}%`;
    condicoes.push({
      sql: '(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)',
      params: [termo, termo, termo, termo],
    });
  }

  const onde = montaWhere(condicoes.map((c) => c.sql));
  const params = condicoes.flatMap((c) => c.params);

  const conversa = comConversas
    ? `LEFT JOIN ${db.tabela('whatsapp_conversations')} wc ON wc.customer_id = c.id`
    : '';

  // Mesma pergunta que `leadVeioDeAnuncio` faz para liberar evento de
  // CAPI, só que em lote: o card diz "Meta Ads" exatamente quando o
  // contato tem identificador de anúncio. Do lado do formulário está em
  // `customers`; do lado do WhatsApp, no referral da primeira mensagem —
  // por isso a subconsulta, presa à mesma condição de esquema do resto.
  const anuncioNaConversa = comConversas
    ? `OR EXISTS (SELECT 1 FROM ${db.tabela('whatsapp_messages')} wm
                   WHERE wm.customer_id = c.id
                     AND (COALESCE(wm.referral_ctwa_clid, '') <> ''
                       OR COALESCE(wm.referral_ad_id, '') <> ''))`
    : '';
  const camposConversa = comConversas
    ? `wc.status AS status_conversa, wc.tags, wc.unread_count, wc.last_message_at,
       CASE WHEN wc.customer_id IS NULL THEN 0 ELSE 1 END AS tem_conversa`
    : `NULL AS status_conversa, NULL AS tags, 0 AS unread_count, NULL AS last_message_at,
       0 AS tem_conversa`;

  // Banco sem a migração da etapa de perda troca a coluna por um
  // literal: o quadro inteiro não pode cair por causa do motivo.
  const campoPerda = comPerda ? "NULLIF(c.lost_reason, '')" : 'NULL';
  const campoPerdidoEm = comPerda ? 'c.lost_at' : 'NULL';

  // Quando o lead chegou na etapa em que está hoje.
  //
  // Não sai de `customers.updated_at`: aquela coluna é
  // `DEFAULT CURRENT_TIMESTAMP` sem `ON UPDATE`, e a automação que muda
  // `current_stage` não a toca — ela guarda a criação da linha, não a
  // última mexida. O que marca a passagem pela etapa é o evento que ela
  // dispara, gravado em `meta_capi_events` no mesmo instante.
  //
  // Perda vem antes na fila porque etapa de perda não manda evento
  // nenhum (fica com `ativo = 0`): sem `lost_at`, os 188 perdidos
  // ficariam todos com a data da última etapa por onde passaram.
  const campoMovido = `COALESCE(
      ${campoPerdidoEm},
      (SELECT MAX(e.created_at)
         FROM ${db.tabela('meta_capi_events')} e
         JOIN ${db.tabela('crm_meta_event_map')} em
           ON em.meta_event = e.event_name AND em.status_id = c.current_stage
        WHERE e.customer_id = c.id AND UPPER(e.status) = 'SENT')
    )`;

  // Do lado do WhatsApp a etapa é do painel e mora em
  // `whatsapp_conversations`, que tem `ON UPDATE CURRENT_TIMESTAMP` — ali
  // `updated_at` serve. Vai em coluna separada, e não no COALESCE acima,
  // porque lead de formulário que também tem conversa mexeria essa data a
  // cada mensagem recebida, sem etapa nenhuma ter mudado.
  const campoMovidoConversa = comConversas ? 'wc.updated_at' : 'NULL';

  return db.query<LinhaCartao>(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.created_at,
            c.current_stage, NULLIF(c.meta_lead_id, '') AS meta_lead_id,
            ${campoPerda} AS lost_reason,
            ${campoMovido} AS movido_em,
            ${campoMovidoConversa} AS movido_conversa_em,
            ${camposConversa},
            COALESCE(NULLIF(c.meta_campaign_name, ''), NULLIF(c.utm_campaign, '')) AS campanha,
            (COALESCE(c.meta_ad_id, '') <> ''
              OR COALESCE(c.meta_adset_id, '') <> ''
              OR COALESCE(c.meta_campaign_id, '') <> ''
              OR COALESCE(c.meta_lead_id, '') <> ''
              ${anuncioNaConversa}) AS de_anuncio
       FROM ${db.tabela('customers')} c
       ${conversa}
       ${onde}
      ORDER BY c.created_at DESC
      LIMIT ${TETO_LEADS}`,
    params,
  );
}

export async function buscaQuadroCrm(
  db: BancoCliente,
  periodo: Periodo,
  filtros: FiltrosCrm = {},
): Promise<QuadroCrm> {
  const lacunas = new LacunasDeEsquema();

  const [etapasForm, etapasWhatsapp, cartoesBrutos] = await Promise.all([
    // A etapa de perda fica gravada com `ativo = 0` — é isso que impede
    // o n8n de casar evento com ela — então o quadro precisa pedir as
    // duas coisas para a coluna continuar aparecendo.
    lacunas.ou(
      (async () => {
        try {
          return await db.query<LinhaEtapaForm>(
            `SELECT status_id, content_name, is_lost
               FROM ${db.tabela('crm_meta_event_map')}
              WHERE ativo = 1 OR is_lost = 1
              ORDER BY id ASC`,
          );
        } catch (erro) {
          if (!lacunaDeEsquema(erro)) throw erro;
          return await db.query<LinhaEtapaForm>(
            `SELECT status_id, content_name, 0 AS is_lost
               FROM ${db.tabela('crm_meta_event_map')}
              WHERE ativo = 1
              ORDER BY id ASC`,
          );
        }
      })(),
      [] as LinhaEtapaForm[],
    ),
    lacunas.ou(
      db.query<LinhaEtapaWhatsapp>(
        `SELECT estagio, content_name
           FROM ${db.tabela('whatsapp_event_map')}
          WHERE ativo = 1
          ORDER BY id ASC`,
      ),
      [] as LinhaEtapaWhatsapp[],
    ),
    // Sem `whatsapp_conversations` o quadro ainda faz sentido: vira o
    // funil de formulário, e a lacuna aparece no aviso da tela.
    (async () => {
      const leTudo = async (comPerda: boolean) => {
        const comConversas = await lacunas.ou<LinhaCartao[] | null>(
          leCartoes(db, periodo, filtros, true, comPerda),
          null,
        );
        return comConversas === null
          ? leCartoes(db, periodo, filtros, false, comPerda)
          : comConversas;
      };
      try {
        return await leTudo(true);
      } catch (erro) {
        if (!lacunaDeEsquema(erro)) throw erro;
        return await leTudo(false);
      }
    })(),
  ]);

  return {
    ...montaQuadro(etapasForm, etapasWhatsapp, cartoesBrutos, filtros.origem ?? null),
    lacunas_de_esquema: lacunas.lista(),
  };
}

export type MensagemPrevia = {
  id: number;
  created_at: string;
  direction: string;
  message_type: string;
  message_text: string | null;
};

export type DetalheLeadCrm = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  current_stage: string | null;
  /** Valor do negócio no CRM. `null` quando o banco não tem a coluna. */
  crm_value: number | null;
  origem: OrigemLead;
  etapa_form: string | null;
  etapa_whatsapp: string | null;
  motivo_perda: string | null;
  /** Quando o negócio foi dado como perdido; `null` se não foi. */
  perdido_em: string | null;
  /** Motivos que este cliente já usou, para o campo sugerir os dele. */
  motivos_usados: string[];
  notes: string | null;
  tags: string | null;
  tem_conversa: boolean;
  ultima_mensagem_em: string | null;
  campanha: string | null;
  conjunto: string | null;
  anuncio: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  meta_lead_id: string | null;
  ctwa_clid: string | null;
  /** Últimas mensagens da conversa, quando houver. */
  mensagens: MensagemPrevia[];
  /** Etapas do funil do WhatsApp, para o seletor do modal. */
  etapas_whatsapp: { valor: string; rotulo: string }[];
  lacunas_de_esquema: string[];
};

const LIMITE_MENSAGENS_MODAL = 8;

/** Sugestões vindas do próprio cliente; o resto o campo aceita digitado. */
const LIMITE_MOTIVOS_USADOS = 20;

type LinhaConversaModal = {
  status: string | null;
  notes: string | null;
  tags: string | null;
  last_message_at: string | null;
  lost_reason: string | null;
};

/** Tudo o que o modal do CRM mostra de um lead, em uma chamada. */
export async function buscaLeadCrm(
  db: BancoCliente,
  customerId: number,
): Promise<DetalheLeadCrm | null> {
  const lacunas = new LacunasDeEsquema();

  const base = await db.queryOne<{
    id: number;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    created_at: string;
    current_stage: string | null;
    meta_lead_id: string | null;
    utm_source: string | null;
    utm_campaign: string | null;
    campanha: string | null;
    conjunto: string | null;
    anuncio: string | null;
  }>(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.created_at,
            c.current_stage, NULLIF(c.meta_lead_id, '') AS meta_lead_id,
            NULLIF(c.utm_source, '') AS utm_source, NULLIF(c.utm_campaign, '') AS utm_campaign,
            COALESCE(NULLIF(c.meta_campaign_name, ''), NULLIF(c.utm_campaign, '')) AS campanha,
            NULLIF(c.meta_adset_name, '') AS conjunto,
            NULLIF(c.meta_ad_name, '') AS anuncio
       FROM ${db.tabela('customers')} c
      WHERE c.id = ?
      LIMIT 1`,
    [customerId],
  );
  if (!base) return null;

  // Banco sem a migração de motivo de perda repete a consulta sem a
  // coluna: perder a conversa inteira do modal por causa dela seria pior
  // do que perder só o motivo. A segunda consulta só sai se a primeira
  // falhar — no banco migrado, que é o caso normal, é uma consulta só.
  const leConversa = async (): Promise<LinhaConversaModal | null> => {
    try {
      return await db.queryOne<LinhaConversaModal>(
        `SELECT status, notes, tags, last_message_at, lost_reason
           FROM ${db.tabela('whatsapp_conversations')}
          WHERE customer_id = ?
          LIMIT 1`,
        [customerId],
      );
    } catch (erro) {
      if (!lacunaDeEsquema(erro)) throw erro;
      return await db.queryOne<LinhaConversaModal>(
        `SELECT status, notes, tags, last_message_at, NULL AS lost_reason
           FROM ${db.tabela('whatsapp_conversations')}
          WHERE customer_id = ?
          LIMIT 1`,
        [customerId],
      );
    }
  };

  const [conversa, etapaForm, mensagens, etapasWhatsapp, motivosUsados, ctwa, valor, perda] =
    await Promise.all([
      lacunas.ou(leConversa(), null),
      lacunas.ou(
        db.queryOne<{ content_name: string | null }>(
          `SELECT content_name FROM ${db.tabela('crm_meta_event_map')}
            WHERE status_id = ? LIMIT 1`,
          [base.current_stage],
        ),
        null,
      ),
      lacunas.ou(
        db.query<MensagemPrevia>(
          `SELECT id, created_at, direction, message_type, message_text
             FROM ${db.tabela('whatsapp_messages')}
            WHERE customer_id = ?
            ORDER BY id DESC
            LIMIT ${LIMITE_MENSAGENS_MODAL}`,
          [customerId],
        ),
        [] as MensagemPrevia[],
      ),
      lacunas.ou(
        db.query<{ estagio: string; content_name: string | null }>(
          `SELECT estagio, content_name FROM ${db.tabela('whatsapp_event_map')}
            WHERE ativo = 1 ORDER BY id ASC`,
        ),
        [] as { estagio: string; content_name: string | null }[],
      ),
      lacunas.ou(
        db.query<{ motivo: string }>(
          `SELECT DISTINCT lost_reason AS motivo
             FROM ${db.tabela('whatsapp_conversations')}
            WHERE lost_reason IS NOT NULL AND lost_reason <> ''
            ORDER BY lost_reason ASC
            LIMIT ${LIMITE_MOTIVOS_USADOS}`,
        ),
        [] as { motivo: string }[],
      ),
      lacunas.ou(
        db.queryOne<{ ctwa: string | null }>(
          `SELECT MAX(referral_ctwa_clid) AS ctwa FROM ${db.tabela('whatsapp_messages')}
            WHERE customer_id = ?`,
          [customerId],
        ),
        null,
      ),
      // Em consulta própria, e não junto do SELECT de cima: banco sem a
      // migração de `crm_value` derrubaria o modal inteiro por causa de
      // um campo só.
      lacunas.ou(
        db.queryOne<{ crm_value: string | number | null }>(
          `SELECT crm_value FROM ${db.tabela('customers')} WHERE id = ? LIMIT 1`,
          [customerId],
        ),
        null,
      ),
      // Perda do lead de formulário: quem grava é a automação
      // "Kommo - Sincroniza Perdidos", lendo o motivo do próprio CRM.
      // Mesmo motivo da consulta acima para ela ser separada.
      lacunas.ou(
        db.queryOne<{ lost_reason: string | null; lost_at: string | null }>(
          `SELECT NULLIF(lost_reason, '') AS lost_reason, lost_at
             FROM ${db.tabela('customers')} WHERE id = ? LIMIT 1`,
          [customerId],
        ),
        null,
      ),
    ]);

  const temConversa = conversa !== null;
  const origem: OrigemLead = ehContatoDeWhatsapp(
    base.meta_lead_id,
    base.current_stage,
    temConversa,
  )
    ? 'whatsapp'
    : 'form';

  return {
    ...base,
    origem,
    etapa_form: (etapaForm?.content_name ?? '').trim() || etapaDoFunilForm(base.current_stage),
    etapa_whatsapp: conversa?.status ?? null,
    // O lead de formulário perde no Kommo, o de WhatsApp perde no
    // painel; o modal mostra o que existir, sem precisar saber qual é.
    motivo_perda: conversa?.lost_reason ?? perda?.lost_reason ?? null,
    perdido_em: perda?.lost_at ?? null,
    motivos_usados: motivosUsados.map((m) => m.motivo),
    notes: conversa?.notes ?? null,
    tags: conversa?.tags ?? null,
    tem_conversa: temConversa,
    ultima_mensagem_em: conversa?.last_message_at ?? null,
    ctwa_clid: ctwa?.ctwa ?? null,
    crm_value: valor?.crm_value == null ? null : Number(valor.crm_value),
    // A prévia vem do banco em ordem decrescente; a tela lê de cima para
    // baixo, como na conversa.
    mensagens: mensagens.slice().reverse(),
    etapas_whatsapp: etapasWhatsapp.map((e) => ({
      valor: e.estagio,
      rotulo: (e.content_name ?? '').trim() || rotuloEstagio(e.estagio),
    })),
    lacunas_de_esquema: lacunas.lista(),
  };
}

/**
 * Move o card de um contato de WhatsApp para outra etapa.
 *
 * Só a etapa (e o motivo, quando a etapa é a de perda) é tocada — nome,
 * e-mail, notas e tags ficam como estão. Devolve a etapa anterior para
 * quem chamou decidir se dispara o evento da Meta, mesma divisão de
 * responsabilidade de `salvaLead`.
 *
 * `motivo_gravado` vem `false` quando o banco do cliente ainda não rodou
 * a migração das colunas de perda: o card se move do mesmo jeito, e a
 * tela avisa que o motivo se perdeu em vez de fingir que gravou.
 */
export async function moveEtapaWhatsapp(
  db: BancoCliente,
  customerId: number,
  etapa: string,
  motivo: string | null = null,
): Promise<{ status_anterior: string | null; motivo_gravado: boolean }> {
  return transacao(async (conn) => {
    const [linhas] = await conn.query(
      `SELECT status FROM ${db.tabela('whatsapp_conversations')} WHERE customer_id = ? LIMIT 1`,
      [customerId],
    );
    const anterior = (linhas as { status: string | null }[])[0]?.status ?? null;

    const perda = ehEtapaDePerda(etapa);
    const gravou = await gravaConversa(conn, db, customerId, {
      status: etapa,
      perda: perda ? { motivo } : null,
    });

    return { status_anterior: anterior, motivo_gravado: perda && gravou };
  });
}

/** Etapa existe e está ativa no funil do WhatsApp? */
export async function etapaWhatsappAtiva(db: BancoCliente, etapa: string): Promise<boolean> {
  const linha = await db.queryOne<{ existe: number }>(
    `SELECT 1 AS existe FROM ${db.tabela('whatsapp_event_map')}
      WHERE estagio = ? AND ativo = 1 LIMIT 1`,
    [etapa],
  );
  return Boolean(linha);
}

/**
 * Grava à mão o valor do negócio de um lead.
 *
 * O caminho normal é a automação: o fluxo do n8n consulta o preço no
 * Kommo e escreve aqui. Esta função é para quando esse caminho não
 * responde — cliente que não usa o campo de valor do CRM, negócio
 * fechado por fora, correção de um preço que mudou depois.
 *
 * O valor também vai para o evento enviado à Meta mais recente, porque é
 * de `meta_capi_events.value` que sai a receita do painel; os outros
 * eventos enviados do mesmo lead são zerados, já que a receita soma
 * todos eles e um lead que fechou por 11.210 não pode somar esse valor
 * uma vez por etapa por que passou.
 *
 * Nada é reenviado à Meta: o evento que ela recebeu já foi contado lá, e
 * mandar de novo com o mesmo `event_id` seria descartado por
 * deduplicação — com um id novo, viraria conversão duplicada.
 *
 * `evento_atualizado: false` significa que o lead ainda não tem evento
 * enviado. O valor fica guardado no lead, mas não entra na receita
 * enquanto o evento não sair.
 */
export async function salvaValorLead(
  db: BancoCliente,
  customerId: number,
  valor: number,
): Promise<{ existia: boolean; evento_atualizado: boolean }> {
  return transacao(async (conn) => {
    const [r] = await conn.query(
      `UPDATE ${db.tabela('customers')} SET crm_value = ? WHERE id = ?`,
      [valor, customerId],
    );
    const existia = ((r as { affectedRows?: number }).affectedRows ?? 0) > 0;
    if (!existia) return { existia: false, evento_atualizado: false };

    const [linhas] = await conn.query(
      `SELECT id FROM ${db.tabela('meta_capi_events')}
        WHERE customer_id = ? AND status = 'SENT'
        ORDER BY id DESC LIMIT 1`,
      [customerId],
    );
    const alvo = (linhas as { id: number }[])[0]?.id;
    if (!alvo) return { existia: true, evento_atualizado: false };

    await conn.query(
      `UPDATE ${db.tabela('meta_capi_events')}
          SET value = ?, currency = COALESCE(NULLIF(currency, ''), 'BRL')
        WHERE id = ?`,
      [valor, alvo],
    );
    await conn.query(
      `UPDATE ${db.tabela('meta_capi_events')} SET value = 0
        WHERE customer_id = ? AND status = 'SENT' AND id <> ? AND value > 0`,
      [customerId, alvo],
    );
    return { existia: true, evento_atualizado: true };
  });
}

// -------------------------------------------------------------------
// Inclusão manual de lead de formulário
// -------------------------------------------------------------------

/** O que a ação já resolveu (Meta + Kommo) e vai virar linha em `customers`. */
export type NovoLeadDeFormulario = {
  ad_account_id: string;
  crm_lead_id: string;
  meta_lead_id: string;
  /** `status_id` do Kommo, ou `null` quando o CRM não pôde ser consultado. */
  current_stage: string | null;
  crm_value: number | null;
  /** ISO. Vira `created_at`, para o lead cair no mês em que de fato entrou. */
  created_at: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  meta_ad_id: string | null;
  meta_ad_name: string | null;
  meta_adset_id: string | null;
  meta_adset_name: string | null;
  meta_campaign_id: string | null;
  meta_campaign_name: string | null;
  meta_form_id: string | null;
};

/**
 * Procura o lead pelos dois identificadores que a tela pede.
 *
 * Os dois, e não só um: o mesmo lead pode já estar no painel gravado só
 * com o id do Kommo (veio pelo webhook de status, sem passar pelo fluxo
 * de recebimento) ou só com o da Meta (chegou pelo formulário e nunca
 * virou negócio). Inserir de novo criaria dois cards para uma pessoa só.
 */
export async function buscaLeadExistente(
  db: BancoCliente,
  crmLeadId: string,
  metaLeadId: string,
): Promise<{ id: number } | null> {
  return db.queryOne<{ id: number }>(
    `SELECT id FROM ${db.tabela('customers')}
      WHERE crm_lead_id = ? OR meta_lead_id = ?
      ORDER BY id ASC LIMIT 1`,
    [crmLeadId, metaLeadId],
  );
}

/**
 * Insere o lead.
 *
 * `crm_value` entra por consulta ao `information_schema` e não por
 * try/catch: a migração do campo ainda não rodou em todo cliente, e um
 * INSERT que falha por causa de uma coluna ausente perderia junto o
 * lead inteiro. É a mesma tolerância que a automação de ganhos faz.
 *
 * Nada de evento CAPI aqui. O lead entra no painel; o que foi ou não
 * enviado à Meta continua sendo o que os workflows enviaram, e inventar
 * um `Purchase` retroativo mentiria para a única tela que hoje serve
 * para conferir o que saiu daqui.
 */
export async function insereLeadDeFormulario(
  db: BancoCliente,
  dados: NovoLeadDeFormulario,
): Promise<number> {
  const temValor = await db.queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'crm_value'`,
    [db.nome],
  );
  const comValor = Number(temValor?.total ?? 0) > 0;

  const colunas = [
    'ad_account_id',
    'crm_lead_id',
    'meta_lead_id',
    'current_stage',
    'first_name',
    'last_name',
    'email',
    'phone',
    'city',
    'state',
    'zipcode',
    'country',
    'meta_ad_id',
    'meta_ad_name',
    'meta_adset_id',
    'meta_adset_name',
    'meta_campaign_id',
    'meta_campaign_name',
    'meta_form_id',
  ];
  const valores: unknown[] = [
    dados.ad_account_id,
    dados.crm_lead_id,
    dados.meta_lead_id,
    dados.current_stage,
    dados.first_name,
    dados.last_name,
    dados.email,
    dados.phone,
    dados.city,
    dados.state,
    dados.zipcode,
    'br',
    dados.meta_ad_id,
    dados.meta_ad_name,
    dados.meta_adset_id,
    dados.meta_adset_name,
    dados.meta_campaign_id,
    dados.meta_campaign_name,
    dados.meta_form_id,
  ];

  if (comValor) {
    colunas.push('crm_value');
    valores.push(dados.crm_value);
  }

  // `created_at` tem DEFAULT CURRENT_TIMESTAMP: sem data da Meta, o lead
  // entra com a data de hoje, e é isso mesmo — melhor um lead datado de
  // hoje do que um lead fora de todo período do painel.
  if (dados.created_at) {
    colunas.push('created_at');
    valores.push(new Date(dados.created_at));
  }

  const marcadores = colunas.map(() => '?').join(', ');
  const resultado = await db.execute(
    `INSERT INTO ${db.tabela('customers')} (${colunas.join(', ')}) VALUES (${marcadores})`,
    valores,
  );
  return resultado.insertId;
}
