import 'server-only';
import { lacunaDeEsquema, transacao } from '@/lib/db/pool';
import type { BancoCliente } from '@/lib/db/cliente';
import type { MensagemEvolution } from '@/lib/evolution-payload';

/**
 * Gravação das mensagens que chegam pela Evolution API.
 *
 * As tabelas são as mesmas que o workflow n8n da Cloud API já alimenta
 * (`whatsapp_messages` e `whatsapp_conversations`), com o mesmo formato
 * de telefone e a mesma regra de não-lidas. É o que faz a tela
 * "Conversas" funcionar igual nas duas conexões sem saber qual está em
 * uso: quem lê a conversa não pergunta de onde a mensagem veio.
 *
 * A diferença de caminho é só de onde parte a escrita — pela Cloud API
 * quem grava é o n8n, pela Evolution é a rota de webhook deste app.
 */

/**
 * Encontra o lead pelo telefone ou cria um novo.
 *
 * O casamento por telefone usa os últimos 10 dígitos, exatamente como o
 * workflow da Cloud API: os números brasileiros aparecem ora com o nono
 * dígito, ora sem, e ora com o 55 na frente. Comparar a cauda é o que já
 * está em produção; usar outra regra aqui criaria dois leads para a
 * mesma pessoa dependendo de por onde a mensagem entrou.
 */
export async function encontraOuCriaLead(
  db: BancoCliente,
  entrada: { telefone: string; nome: string | null; adAccountId: string | null },
): Promise<number> {
  const existente = await db.queryOne<{ id: number }>(
    `SELECT id
       FROM ${db.tabela('customers')}
      WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = RIGHT(?, 10)
      ORDER BY id DESC
      LIMIT 1`,
    [entrada.telefone],
  );
  if (existente) return existente.id;

  const { insertId } = await db.execute(
    `INSERT INTO ${db.tabela('customers')}
       (ad_account_id, first_name, phone, current_stage)
     VALUES (?, ?, ?, 'whatsapp_contact')`,
    [entrada.adAccountId, entrada.nome, entrada.telefone],
  );
  return insertId;
}

/**
 * Grava a mensagem e atualiza o estado da conversa.
 *
 * Devolve o `id` da linha criada, ou `null` quando a mensagem já estava
 * gravada. A Evolution reenvia o webhook quando a resposta demora, e
 * `wa_message_id` é UNIQUE justamente para isso — mas só o INSERT ser
 * idempotente não basta: sem o retorno, a reentrega incrementaria de
 * novo o contador de não-lidas, e a conversa apareceria com mensagens
 * que ninguém deixou de ler. O `id` é o que permite guardar o arquivo
 * logo em seguida, na mesma passagem.
 *
 * As duas escritas vão na mesma transação pelo mesmo motivo do envio
 * pela Cloud API: mensagem sem `last_message_at` some do topo da lista,
 * e `last_message_at` sem mensagem aponta para nada.
 *
 * Quando o banco do cliente ainda não passou por
 * `migracao_whatsapp_midia.sql`, o INSERT com as colunas `media_*`
 * falharia e a mensagem seria perdida. Nesse caso a gravação é refeita
 * sem elas: a conversa continua chegando ao painel, só sem o arquivo.
 */
const COLUNAS_BASE =
  '(customer_id, direction, wa_message_id, phone, message_type, message_text, ' +
  'message_timestamp_unix, referral_ad_id, referral_ctwa_clid';

export async function gravaMensagemEvolution(
  db: BancoCliente,
  customerId: number,
  msg: MensagemEvolution,
): Promise<number | null> {
  const base = [
    customerId,
    msg.direcao,
    msg.wa_message_id,
    msg.telefone,
    msg.tipo,
    msg.texto,
    msg.timestamp_unix,
    msg.referral_ad_id,
    msg.referral_ctwa_clid,
  ];

  return transacao(async (conn) => {
    const insere = async (comMidia: boolean) => {
      const sql = comMidia
        ? `INSERT IGNORE INTO ${db.tabela('whatsapp_messages')}
             ${COLUNAS_BASE}, media_mime, media_filename, media_size, media_seconds, media_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        : `INSERT IGNORE INTO ${db.tabela('whatsapp_messages')}
             ${COLUNAS_BASE})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const params = comMidia
        ? [
            ...base,
            msg.midia?.mime ?? null,
            msg.midia?.nome ?? null,
            msg.midia?.tamanho ?? null,
            msg.midia?.segundos ?? null,
            msg.midia ? 'pendente' : null,
          ]
        : base;
      const [resultado] = await conn.query(sql, params);
      return resultado as { affectedRows?: number; insertId?: number };
    };

    let resultado: { affectedRows?: number; insertId?: number };
    try {
      resultado = await insere(true);
    } catch (erro) {
      if (!lacunaDeEsquema(erro)) throw erro;
      resultado = await insere(false);
    }

    if (resultado.affectedRows !== 1) return null;

    if (msg.direcao === 'inbound') {
      await conn.query(
        `INSERT INTO ${db.tabela('whatsapp_conversations')}
           (customer_id, unread_count, last_message_at, last_inbound_at)
         VALUES (?, 1, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           unread_count = unread_count + 1,
           last_message_at = NOW(),
           last_inbound_at = NOW()`,
        [customerId],
      );
    } else {
      // Resposta enviada pelo celular do atendente, fora do painel:
      // atualiza o topo da lista, mas não mexe em não-lidas (ninguém
      // deixou de ler a própria mensagem) nem em `last_inbound_at`.
      await conn.query(
        `INSERT INTO ${db.tabela('whatsapp_conversations')} (customer_id, last_message_at)
         VALUES (?, NOW())
         ON DUPLICATE KEY UPDATE last_message_at = NOW()`,
        [customerId],
      );
    }

    return resultado.insertId ?? null;
  });
}

/** Limite do arquivo guardado no banco. Acima disso fica só o rótulo. */
export const LIMITE_MIDIA_BYTES = 16 * 1024 * 1024;

/**
 * Guarda o arquivo e marca a mensagem como tendo mídia disponível.
 *
 * `ON DUPLICATE KEY UPDATE` porque a mesma mensagem pode ser processada
 * duas vezes em uma reentrega que cruzou com a primeira gravação; o
 * arquivo é o mesmo, então regravar é inofensivo e mais simples do que
 * travar a linha antes.
 */
export async function gravaMidia(
  db: BancoCliente,
  messageId: number,
  midia: { bytes: Buffer; mime: string | null; nome: string | null },
): Promise<void> {
  const mime = midia.mime || 'application/octet-stream';
  await db.execute(
    `INSERT INTO ${db.tabela('whatsapp_media')} (message_id, mime_type, bytes)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), bytes = VALUES(bytes)`,
    [messageId, mime, midia.bytes],
  );
  await db.execute(
    `UPDATE ${db.tabela('whatsapp_messages')}
        SET media_status = 'ok',
            media_mime = COALESCE(?, media_mime),
            media_filename = COALESCE(media_filename, ?),
            media_size = ?
      WHERE id = ?`,
    [midia.mime, midia.nome, midia.bytes.length, messageId],
  );
}

/**
 * Registra que o arquivo não foi guardado, e por quê.
 *
 * A bolha continua aparecendo com o rótulo do tipo — o que se perde é só
 * o arquivo. Sem esta marca, a tela não teria como distinguir "mídia que
 * o app não conseguiu buscar" de "mensagem antiga, de antes da captura".
 */
export async function marcaMidiaIndisponivel(
  db: BancoCliente,
  messageId: number,
  motivo: 'grande' | 'falha',
): Promise<void> {
  await db.execute(
    `UPDATE ${db.tabela('whatsapp_messages')} SET media_status = ? WHERE id = ?`,
    [motivo, messageId],
  );
}

/**
 * Marca o `Contact` como disparado e amarra o evento à mensagem.
 *
 * O `UPDATE ... WHERE whatsapp_contact_capi_sent_at IS NULL` é o que
 * garante um evento por lead: se duas mensagens do mesmo anúncio
 * chegarem juntas, só a primeira encontra a coluna nula e as demais
 * atualizam zero linhas. É a mesma trava que o workflow da Cloud API já
 * usa — o `event_id` sozinho só desduplica dentro da janela da Meta.
 *
 * Devolve `true` quando esta chamada foi a que reservou o disparo.
 */
export async function reservaContactCapi(
  db: BancoCliente,
  customerId: number,
): Promise<boolean> {
  const { affectedRows } = await db.execute(
    `UPDATE ${db.tabela('customers')}
        SET whatsapp_contact_capi_sent_at = NOW()
      WHERE id = ? AND whatsapp_contact_capi_sent_at IS NULL`,
    [customerId],
  );
  return affectedRows === 1;
}

/**
 * Desfaz a reserva quando o envio à Meta falhou.
 *
 * Sem isso, uma indisponibilidade momentânea da Graph API custaria o
 * evento do lead para sempre: a coluna ficaria preenchida sem que nenhum
 * `Contact` tivesse chegado. A próxima mensagem do mesmo lead tenta de
 * novo.
 */
export async function liberaContactCapi(db: BancoCliente, customerId: number): Promise<void> {
  await db.execute(
    `UPDATE ${db.tabela('customers')}
        SET whatsapp_contact_capi_sent_at = NULL
      WHERE id = ?`,
    [customerId],
  );
}

/** Liga a mensagem ao evento enviado, para auditoria na aba Conversas. */
export async function gravaEventoNaMensagem(
  db: BancoCliente,
  waMessageId: string,
  eventId: string,
): Promise<void> {
  await db.execute(
    `UPDATE ${db.tabela('whatsapp_messages')}
        SET capi_event_id = ?
      WHERE wa_message_id = ?`,
    [eventId, waMessageId],
  );
}
