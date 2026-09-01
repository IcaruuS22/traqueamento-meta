import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { buscaAdAccount, BancoCliente } from '@/lib/db/cliente';
import {
  atualizaEstadoEvolution,
  buscaContaPorInstanciaEvolution,
} from '@/lib/db/whatsapp';
import {
  encontraOuCriaLead,
  gravaEventoNaMensagem,
  gravaMensagemEvolution,
  gravaMidia,
  LIMITE_MIDIA_BYTES,
  liberaContactCapi,
  marcaMidiaIndisponivel,
  reservaContactCapi,
} from '@/lib/db/evolution-ingestao';
import { baixaMidia } from '@/lib/evolution';
import { leEstadoConexao, leMensagemUpsert, leNumeroConexao } from '@/lib/evolution-payload';
import { mesmoTelefone } from '@/lib/telefone';
import type { ContaPorInstancia } from '@/lib/db/whatsapp';
import { enviaEventoContatoWhatsapp } from '@/lib/meta-capi';
import type { BancoCliente as TipoBancoCliente } from '@/lib/db/cliente';
import type { MensagemEvolution } from '@/lib/evolution-payload';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Webhook da Evolution API.
 *
 * ESTA ROTA NÃO TEM SESSÃO. Quem chama é o servidor da Evolution, que
 * não tem como fazer login. Por isso ela é a única porta de escrita do
 * app que não passa por `lib/auth/guard.ts`, e o que faz o papel do
 * guard aqui são duas checagens, nesta ordem:
 *
 *  1. o `token` da query bate com `evolution_webhook_token` daquele
 *     cliente — segredo aleatório gerado na criação da instância, que só
 *     existe dentro da URL cadastrada no servidor da Evolution;
 *  2. o nome do banco usado é o que veio do catálogo a partir do nome da
 *     instância, nunca um valor do corpo da requisição.
 *
 * Sem a primeira, saber o nome de uma instância bastaria para inserir
 * mensagens falsas na conversa de um lead. Sem a segunda, o corpo da
 * requisição escolheria em qual banco de cliente escrever.
 *
 * A rota responde 200 mesmo quando ignora o evento: a Evolution reenvia
 * o que não recebeu 2xx, e um evento que não interessa (grupo, status,
 * presença) responderia erro para sempre.
 */

/** Comparação de tempo constante: `a === b` vaza o tamanho do prefixo
 * correto e permitiria descobrir o token por tentativa. */
function tokenConfere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Dispara o `Contact` da primeira mensagem vinda de anúncio.
 *
 * Roda depois da mensagem já estar gravada, e nunca lança: a mensagem do
 * lead não pode ser perdida porque a Graph API respondeu erro. Um `throw`
 * aqui faria a rota devolver 500 e a Evolution reenviar o webhook inteiro
 * — a mensagem já gravada seria descartada pelo `INSERT IGNORE`, e o
 * evento continuaria sem sair.
 */
async function disparaContato(
  clientDb: string,
  db: TipoBancoCliente,
  customerId: number,
  msg: MensagemEvolution,
): Promise<void> {
  if (msg.direcao !== 'inbound' || !msg.referral_ctwa_clid) return;

  try {
    // A reserva vem antes do envio: é ela que impede duas mensagens
    // simultâneas do mesmo lead virarem dois eventos.
    if (!(await reservaContactCapi(db, customerId))) return;

    const r = await enviaEventoContatoWhatsapp(clientDb, db, {
      customerId,
      phone: msg.telefone,
      ctwa_clid: msg.referral_ctwa_clid,
      ad_id: msg.referral_ad_id,
      wa_message_id: msg.wa_message_id,
    });

    if (r.enviado) {
      await gravaEventoNaMensagem(db, msg.wa_message_id, r.event_id);
    } else {
      console.error('[webhook evolution] Contact não enviado:', r.motivo);
      await liberaContactCapi(db, customerId);
    }
  } catch (erro) {
    console.error('[webhook evolution] falha no disparo do Contact:', erro);
  }
}

/**
 * Guarda o arquivo de uma mensagem de mídia.
 *
 * Roda logo depois da mensagem ser gravada, e não quando alguém abre a
 * conversa, porque a mídia expira no servidor do WhatsApp: buscá-la dias
 * depois devolve erro e o arquivo se perde para sempre.
 *
 * Como `disparaContato`, nunca lança. Arquivo que não veio é uma bolha
 * com rótulo em vez de imagem; erro aqui derrubaria a rota e faria a
 * Evolution reenviar o webhook inteiro, cuja mensagem já está gravada e
 * seria descartada pelo `INSERT IGNORE` — a conversa perderia a bolha
 * por causa de uma falha que só afeta o anexo.
 */
async function guardaMidia(
  conta: ContaPorInstancia,
  db: TipoBancoCliente,
  messageId: number,
  msg: MensagemEvolution,
): Promise<void> {
  if (!msg.midia) return;

  try {
    // Tamanho anunciado pelo WhatsApp: evita baixar 300 MB para só
    // então descobrir que não cabe.
    if (msg.midia.tamanho && msg.midia.tamanho > LIMITE_MIDIA_BYTES) {
      await marcaMidiaIndisponivel(db, messageId, 'grande');
      return;
    }

    let bytes: Buffer | null = null;
    let mime = msg.midia.mime;
    let nome = msg.midia.nome;

    if (msg.midia.base64) {
      bytes = Buffer.from(msg.midia.base64, 'base64');
    } else if (conta.evolution_base_url && conta.evolution_api_key && conta.evolution_instance) {
      const baixada = await baixaMidia(
        {
          base_url: conta.evolution_base_url,
          api_key: conta.evolution_api_key,
          instancia: conta.evolution_instance,
        },
        msg.wa_message_id,
      );
      if (baixada) {
        bytes = baixada.bytes;
        mime = mime ?? baixada.mime;
        nome = nome ?? baixada.nome;
      }
    }

    if (!bytes?.length) {
      await marcaMidiaIndisponivel(db, messageId, 'falha');
      return;
    }
    if (bytes.length > LIMITE_MIDIA_BYTES) {
      await marcaMidiaIndisponivel(db, messageId, 'grande');
      return;
    }

    await gravaMidia(db, messageId, { bytes, mime, nome });
  } catch (erro) {
    console.error('[webhook evolution] falha ao guardar a mídia:', msg.wa_message_id, erro);
    try {
      await marcaMidiaIndisponivel(db, messageId, 'falha');
    } catch {
      // Banco sem a migração de mídia: a mensagem já está gravada e a
      // tela mostra o rótulo do tipo, que é o comportamento anterior.
    }
  }
}

type Payload = {
  event?: unknown;
  instance?: unknown;
  data?: unknown;
};

export async function POST(req: Request): Promise<NextResponse> {
  const token = new URL(req.url).searchParams.get('token') ?? '';

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo inválido' }, { status: 400 });
  }

  const instancia = typeof payload.instance === 'string' ? payload.instance : '';
  if (!instancia || !token) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 });
  }

  const conta = await buscaContaPorInstanciaEvolution(instancia);
  if (!conta?.evolution_webhook_token || !tokenConfere(token, conta.evolution_webhook_token)) {
    // Mesma resposta para instância inexistente e para token errado: se
    // fossem diferentes, daria para descobrir quais instâncias existem.
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 });
  }

  const evento = String(payload.event ?? '').toLowerCase().replace(/_/g, '.');

  try {
    if (evento === 'connection.update') {
      const estado = leEstadoConexao(payload.data);
      const numero = leNumeroConexao(payload.data);
      if (estado) await atualizaEstadoEvolution(conta.client_db_name, estado, numero);
      return NextResponse.json({ ok: true, tratado: 'connection.update' });
    }

    if (evento !== 'messages.upsert') {
      return NextResponse.json({ ok: true, ignorado: evento || 'sem evento' });
    }

    // `messages.upsert` pode vir como um objeto ou como uma lista.
    const bruto = payload.data;
    const itens = Array.isArray(bruto) ? bruto : [bruto];

    const adAccount = await buscaAdAccount(conta.client_db_name);
    if (!adAccount) {
      return NextResponse.json({ ok: true, ignorado: 'cliente fora do catálogo' });
    }
    const db = new BancoCliente(adAccount.client_db_name);

    let gravadas = 0;
    let ignoradasProprias = 0;
    for (const item of itens) {
      const msg = leMensagemUpsert(item);
      if (!msg) continue;

      // Conversa do painel com o próprio número (o "recado para mim
      // mesmo" do WhatsApp, e o que a Evolution sincroniza ao conectar).
      // Sem isto, o número conectado aparece no CRM como se fosse um
      // lead — e, pior, um lead que ninguém pode atender, porque do
      // outro lado da conversa está o próprio atendente.
      if (conta.evolution_number && mesmoTelefone(msg.telefone, conta.evolution_number)) {
        ignoradasProprias += 1;
        continue;
      }

      const customerId = await encontraOuCriaLead(db, {
        telefone: msg.telefone,
        nome: msg.direcao === 'inbound' ? msg.nome_perfil : null,
        adAccountId: adAccount.ad_account_id,
      });
      const messageId = await gravaMensagemEvolution(db, customerId, msg);
      if (messageId === null) continue;
      gravadas += 1;

      // Só para mensagem nova: a reentrega do webhook não pode gerar um
      // segundo evento para a mesma conversa, nem baixar o arquivo duas
      // vezes.
      await guardaMidia(conta, db, messageId, msg);
      await disparaContato(conta.client_db_name, db, customerId, msg);
    }

    return NextResponse.json({ ok: true, gravadas, ignoradas_proprias: ignoradasProprias });
  } catch (erro) {
    // O detalhe fica no log; a resposta não devolve mensagem de MySQL,
    // que carregaria nome de banco e estrutura de tabela.
    console.error('[webhook evolution] falha ao processar evento:', evento, erro);
    return NextResponse.json({ ok: false, erro: 'Erro ao processar evento' }, { status: 500 });
  }
}

/**
 * A Evolution não faz handshake de verificação como a Meta, mas alguns
 * ambientes testam a URL com GET antes de salvar. Responder aqui evita
 * um 405 que parece configuração errada.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, servico: 'webhook evolution' });
}
