import 'server-only';
import { BancoCliente, sanitizaNomeBanco } from '@/lib/db/cliente';
import { queryOne, transacao, lacunaDeEsquema, LacunasDeEsquema } from '@/lib/db/pool';
import {
  ESTAGIO_GANHO,
  ESTAGIO_PERDIDO,
  type Conversa,
  type FaixaConversa,
  type LeadConversa,
  type MensagemWhatsapp,
} from '@/lib/whatsapp-conversas';

/**
 * Dados da tela "Conversas" — porte de `whatsapp-conversas`,
 * `whatsapp-thread`, `whatsapp-enviar` e `whatsapp-lead-salvar` do painel
 * antigo.
 *
 * Duas diferenças em relação ao n8n, ambas deliberadas:
 *
 *  - o filtro de estágio não é mais checado contra uma lista de 7 nomes
 *    escrita no código. Os estágios são criados pelo usuário em
 *    `whatsapp_event_map`, então um estágio próprio nunca passava pela
 *    validação antiga e o filtro voltava vazio. Aqui o valor vai como
 *    parâmetro (`?`), que é o que já o tornava seguro — a lista fixa não
 *    protegia nada que o `?` não protegesse;
 *  - a janela de 24h sai do banco já calculada em segundos
 *    (`TIMESTAMPDIFF`), em vez de mandar `last_inbound_at` para o
 *    navegador comparar com o próprio relógio.
 */

const LIMITE_CONVERSAS = 200;
const LIMITE_MENSAGENS = 300;

type LinhaConversa = Omit<Conversa, 'unread_count'> & { unread_count: number | string };

/**
 * Lista da coluna da esquerda, filtrada por faixa do funil.
 *
 * A faixa não é um estágio: "Em aberto" é tudo que ainda não fechou —
 * inclusive um estágio que o cliente criou depois. Por isso o SQL nega os
 * dois estágios de fechamento em vez de listar os de abertura, que mudam
 * a cada cadastro. `status` nulo (conversa sem estágio gravado) conta
 * como em aberto: `NOT IN` sozinho descartaria a linha.
 */
export async function listaConversas(
  db: BancoCliente,
  filtros: { faixa?: FaixaConversa; busca?: string },
): Promise<{ itens: Conversa[]; lacunas_de_esquema: string[] }> {
  const msgs = db.tabela('whatsapp_messages');
  const condicoes: string[] = [];
  const params: unknown[] = [];

  if (filtros.faixa === 'ganho' || filtros.faixa === 'perdido') {
    condicoes.push('wc.status = ?');
    params.push(filtros.faixa === 'ganho' ? ESTAGIO_GANHO : ESTAGIO_PERDIDO);
  } else if (filtros.faixa === 'aberto') {
    condicoes.push('COALESCE(wc.status, ?) NOT IN (?, ?)');
    params.push('', ESTAGIO_GANHO, ESTAGIO_PERDIDO);
  }

  const busca = (filtros.busca ?? '').trim();
  if (busca) {
    condicoes.push('(c.phone LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?)');
    const termo = `%${busca}%`;
    params.push(termo, termo, termo);
  }

  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  const lacunas = new LacunasDeEsquema();
  const linhas = await lacunas.ou(
    db.query<LinhaConversa>(
      `SELECT c.id AS customer_id, c.first_name, c.last_name, c.phone,
              wc.status, wc.unread_count, wc.last_message_at,
              (SELECT m.message_text FROM ${msgs} m
                WHERE m.customer_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem,
              (SELECT m.message_type FROM ${msgs} m
                WHERE m.customer_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem_tipo,
              (SELECT m.direction FROM ${msgs} m
                WHERE m.customer_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem_direcao
         FROM ${db.tabela('customers')} c
         JOIN ${db.tabela('whatsapp_conversations')} wc ON wc.customer_id = c.id
        ${onde}
        ORDER BY wc.last_message_at DESC
        LIMIT ${LIMITE_CONVERSAS}`,
      params,
    ),
    [],
  );

  return {
    itens: linhas.map((l) => ({ ...l, unread_count: Number(l.unread_count) || 0 })),
    lacunas_de_esquema: lacunas.lista(),
  };
}

type LinhaLead = Omit<LeadConversa, 'segundos_desde_inbound'> & {
  segundos_desde_inbound: number | string | null;
};

/**
 * Conversa aberta: dados do lead e histórico.
 *
 * Zera `unread_count` como efeito colateral — abrir é ler, mesmo
 * comportamento do painel antigo. A zeragem vem antes das leituras para
 * que a lista, ao atualizar em seguida, já não mostre o badge.
 */
/**
 * Mensagens da conversa, com os campos de mídia quando o banco os tem.
 *
 * A captura de arquivo (`migracao_whatsapp_midia.sql`) é aplicada banco a
 * banco, como toda migração aqui. Enquanto um cliente não passou por ela,
 * pedir `media_status` derrubaria a thread inteira — a conversa some da
 * tela por causa de uma coluna que só decide como desenhar o anexo. Por
 * isso a segunda tentativa sem as colunas: o cliente ainda não migrado
 * continua vendo as mensagens, com o rótulo do tipo, como antes.
 */
async function leMensagens(
  db: BancoCliente,
  msgs: string,
  customerId: number,
): Promise<MensagemWhatsapp[]> {
  const base = 'id, created_at, direction, message_type, message_text';
  const comMidia = `${base}, media_mime, media_filename, media_size, media_seconds, media_status`;
  const consulta = (campos: string) =>
    db.query<MensagemWhatsapp>(
      `SELECT ${campos}
         FROM ${msgs}
        WHERE customer_id = ?
        ORDER BY id ASC
        LIMIT ${LIMITE_MENSAGENS}`,
      [customerId],
    );

  try {
    return await consulta(comMidia);
  } catch (erro) {
    if (!lacunaDeEsquema(erro)) throw erro;
    return consulta(base);
  }
}

export async function buscaThread(
  db: BancoCliente,
  customerId: number,
): Promise<{
  lead: LeadConversa | null;
  mensagens: MensagemWhatsapp[];
  lacunas_de_esquema: string[];
}> {
  const lacunas = new LacunasDeEsquema();
  const msgs = db.tabela('whatsapp_messages');

  await lacunas.ou(
    db.execute(
      `UPDATE ${db.tabela('whatsapp_conversations')}
          SET unread_count = 0
        WHERE customer_id = ?`,
      [customerId],
    ),
    { affectedRows: 0, insertId: 0 },
  );

  const lead = await lacunas.ou(
    db.queryOne<LinhaLead>(
      `SELECT c.id AS customer_id, c.first_name, c.last_name, c.email, c.phone,
              COALESCE(wc.status, 'novo') AS status, wc.notes, wc.tags,
              TIMESTAMPDIFF(SECOND, wc.last_inbound_at, NOW()) AS segundos_desde_inbound,
              wc.ai_last_analyzed_at, wc.ai_last_classification, wc.ai_last_reason,
              (SELECT m.referral_ctwa_clid FROM ${msgs} m
                WHERE m.customer_id = c.id AND m.referral_ctwa_clid IS NOT NULL
                ORDER BY m.id ASC LIMIT 1) AS referral_ctwa_clid,
              (SELECT m.referral_ad_id FROM ${msgs} m
                WHERE m.customer_id = c.id AND m.referral_ad_id IS NOT NULL
                ORDER BY m.id ASC LIMIT 1) AS referral_ad_id
         FROM ${db.tabela('customers')} c
         LEFT JOIN ${db.tabela('whatsapp_conversations')} wc ON wc.customer_id = c.id
        WHERE c.id = ?
        LIMIT 1`,
      [customerId],
    ),
    null,
  );

  const mensagens = await lacunas.ou(leMensagens(db, msgs, customerId), []);

  return {
    lead: lead
      ? {
          ...lead,
          segundos_desde_inbound:
            lead.segundos_desde_inbound === null ? null : Number(lead.segundos_desde_inbound),
        }
      : null,
    mensagens,
    lacunas_de_esquema: lacunas.lista(),
  };
}

/**
 * Tudo que o envio precisa, em uma leitura só.
 *
 * O token da Cloud API sai daqui e não pode ir para lugar nenhum além da
 * chamada à Graph API: nenhuma rota, ação ou log pode devolver este
 * objeto inteiro.
 */
export async function dadosParaEnvio(
  clientDb: string,
  db: BancoCliente,
  customerId: number,
): Promise<{
  phone: string | null;
  segundos_desde_inbound: number | null;
  provider: 'cloud' | 'evolution';
  cloud_phone_number_id: string | null;
  cloud_access_token: string | null;
  evolution_base_url: string | null;
  evolution_api_key: string | null;
  evolution_instance: string | null;
}> {
  const nome = sanitizaNomeBanco(clientDb);
  if (!nome) throw new Error('Nome de banco de cliente inválido');

  const [conta, lead] = await Promise.all([
    queryOne<{
      provider: string | null;
      cloud_phone_number_id: string | null;
      cloud_access_token: string | null;
      evolution_base_url: string | null;
      evolution_api_key: string | null;
      evolution_instance: string | null;
    }>(
      `SELECT provider, cloud_phone_number_id, cloud_access_token,
              evolution_base_url, evolution_api_key, evolution_instance
         FROM trakeamento_controle.whatsapp_accounts
        WHERE client_db_name = ? AND status = 'ACTIVE'
        LIMIT 1`,
      [nome],
    ),
    db.queryOne<{ phone: string | null; segundos_desde_inbound: number | string | null }>(
      `SELECT c.phone,
              TIMESTAMPDIFF(SECOND, wc.last_inbound_at, NOW()) AS segundos_desde_inbound
         FROM ${db.tabela('customers')} c
         LEFT JOIN ${db.tabela('whatsapp_conversations')} wc ON wc.customer_id = c.id
        WHERE c.id = ?
        LIMIT 1`,
      [customerId],
    ),
  ]);

  const segundos = lead?.segundos_desde_inbound;

  return {
    phone: lead?.phone ?? null,
    segundos_desde_inbound: segundos === null || segundos === undefined ? null : Number(segundos),
    provider: conta?.provider === 'evolution' ? 'evolution' : 'cloud',
    cloud_phone_number_id: conta?.cloud_phone_number_id ?? null,
    cloud_access_token: conta?.cloud_access_token ?? null,
    evolution_base_url: conta?.evolution_base_url ?? null,
    evolution_api_key: conta?.evolution_api_key ?? null,
    evolution_instance: conta?.evolution_instance ?? null,
  };
}

/**
 * Guarda a mensagem que acabou de sair.
 *
 * As duas escritas vão juntas: mensagem gravada sem atualizar
 * `last_message_at` sumiria do topo da lista de conversas, e um
 * `last_message_at` novo sem mensagem apontaria para nada.
 */
export async function registraMensagemEnviada(
  db: BancoCliente,
  entrada: { customerId: number; phone: string; texto: string; waMessageId: string },
): Promise<void> {
  await transacao(async (conn) => {
    await conn.query(
      `INSERT INTO ${db.tabela('whatsapp_messages')}
         (customer_id, direction, wa_message_id, phone, message_type, message_text,
          message_timestamp_unix)
       VALUES (?, 'outbound', ?, ?, 'text', ?, UNIX_TIMESTAMP())`,
      [entrada.customerId, entrada.waMessageId, entrada.phone, entrada.texto],
    );
    await conn.query(
      `INSERT INTO ${db.tabela('whatsapp_conversations')} (customer_id, last_message_at)
       VALUES (?, NOW())
       ON DUPLICATE KEY UPDATE last_message_at = NOW()`,
      [entrada.customerId],
    );
  });
}

export type EntradaLead = {
  customerId: number;
  first_name: string | null;
  email: string | null;
  status: string;
  notes: string | null;
  tags: string | null;
};

/**
 * Salva o painel da direita.
 *
 * Devolve o estágio que estava gravado antes para quem chamou decidir se
 * houve mudança — é essa mudança, e só ela, que dispara o evento para a
 * Meta.
 */
export async function salvaLead(
  db: BancoCliente,
  entrada: EntradaLead,
): Promise<{ status_anterior: string | null }> {
  return transacao(async (conn) => {
    const [linhas] = await conn.query(
      `SELECT status FROM ${db.tabela('whatsapp_conversations')} WHERE customer_id = ? LIMIT 1`,
      [entrada.customerId],
    );
    const anterior = (linhas as { status: string | null }[])[0]?.status ?? null;

    await conn.query(
      `UPDATE ${db.tabela('customers')} SET first_name = ?, email = ? WHERE id = ?`,
      [entrada.first_name, entrada.email, entrada.customerId],
    );

    await conn.query(
      `INSERT INTO ${db.tabela('whatsapp_conversations')} (customer_id, status, notes, tags)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = ?, notes = ?, tags = ?`,
      [
        entrada.customerId, entrada.status, entrada.notes, entrada.tags,
        entrada.status, entrada.notes, entrada.tags,
      ],
    );

    return { status_anterior: anterior };
  });
}

/** Telefone do lead, para hashear no evento da Meta. */
export async function buscaTelefone(
  db: BancoCliente,
  customerId: number,
): Promise<string | null> {
  const linha = await db.queryOne<{ phone: string | null }>(
    `SELECT phone FROM ${db.tabela('customers')} WHERE id = ? LIMIT 1`,
    [customerId],
  );
  return linha?.phone ?? null;
}

export type MapeamentoEstagio = {
  estagio: string;
  meta_event: string | null;
  content_name: string | null;
  currency: string | null;
  value: number;
};

/** Mapeamento ativo do estágio, ou `null` quando não há evento configurado. */
export async function buscaMapeamentoEstagio(
  db: BancoCliente,
  estagio: string,
): Promise<MapeamentoEstagio | null> {
  const linha = await db.queryOne<
    Omit<MapeamentoEstagio, 'value'> & { value: string | number | null }
  >(
    `SELECT estagio, meta_event, content_name, currency, value
       FROM ${db.tabela('whatsapp_event_map')}
      WHERE estagio = ? AND ativo = 1 AND meta_event IS NOT NULL AND meta_event <> ''
      LIMIT 1`,
    [estagio],
  );
  return linha ? { ...linha, value: Number(linha.value) || 0 } : null;
}

/**
 * Apaga a conversa inteira de um lead: mensagens e estado.
 *
 * Só administrador chega aqui (ver `acaoExcluirConversa`). As duas
 * escritas vão na mesma transação porque meia exclusão é pior que
 * nenhuma: sem as mensagens, a linha de `whatsapp_conversations`
 * continuaria na lista apontando para uma conversa vazia.
 *
 * O lead em `customers` NÃO é apagado. Ele é o mesmo registro que os
 * eventos da CAPI (`meta_capi_events.customer_id`) e os leads de
 * formulário referenciam; apagá-lo levaria junto histórico que não é da
 * conversa. Some a conversa, fica o lead.
 */
export async function apagaConversa(
  db: BancoCliente,
  customerId: number,
): Promise<{ mensagens: number }> {
  return transacao(async (conn) => {
    const [resultado] = await conn.query(
      `DELETE FROM ${db.tabela('whatsapp_messages')} WHERE customer_id = ?`,
      [customerId],
    );
    await conn.query(
      `DELETE FROM ${db.tabela('whatsapp_conversations')} WHERE customer_id = ?`,
      [customerId],
    );
    return { mensagens: (resultado as { affectedRows?: number }).affectedRows ?? 0 };
  });
}

/**
 * Bytes de um anexo, para a rota que serve o arquivo.
 *
 * Faz JOIN com `whatsapp_messages` de propósito: o `message_id` chega
 * pela URL, e sem o JOIN bastaria trocar o número para ler o anexo de
 * outra conversa do mesmo cliente. O `customer_id` vem da conversa que o
 * usuário abriu, e a linha só volta se os dois baterem.
 *
 * Devolve `null` quando o cliente não tem a tabela (banco sem
 * `migracao_whatsapp_midia.sql`) — quem chama responde 404, que é o
 * mesmo que "esta mensagem não tem arquivo".
 */
export async function buscaMidia(
  db: BancoCliente,
  customerId: number,
  messageId: number,
): Promise<{ mime_type: string; bytes: Buffer; nome: string | null } | null> {
  try {
    return await db.queryOne<{ mime_type: string; bytes: Buffer; nome: string | null }>(
      `SELECT md.mime_type, md.bytes, m.media_filename AS nome
         FROM ${db.tabela('whatsapp_media')} md
         JOIN ${msgsDe(db)} m ON m.id = md.message_id
        WHERE md.message_id = ? AND m.customer_id = ?
        LIMIT 1`,
      [messageId, customerId],
    );
  } catch (erro) {
    if (lacunaDeEsquema(erro)) return null;
    throw erro;
  }
}

function msgsDe(db: BancoCliente): string {
  return db.tabela('whatsapp_messages');
}
