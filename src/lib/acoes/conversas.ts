'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import {
  apagaConversa,
  buscaMapeamentoEstagio,
  buscaTelefone,
  dadosParaEnvio,
  registraMensagemEnviada,
  salvaLead,
} from '@/lib/db/conversas';
import { enviaEventoEstagio, VERSAO_GRAPH_CLOUD } from '@/lib/meta-capi';
import { enviaTexto as enviaTextoEvolution, ErroEvolution } from '@/lib/evolution';
import { JANELA_24H_SEGUNDOS } from '@/lib/whatsapp-conversas';

/**
 * Ações da tela "Conversas" — porte de `POST /painel-api/whatsapp-enviar`
 * e `POST /painel-api/whatsapp-lead-salvar`.
 *
 * A tela também bloqueia o campo de composição fora da janela de 24h,
 * mas isso é conveniência: quem decide é a checagem daqui, feita com o
 * relógio do banco no instante do envio. A tela pode estar com um número
 * de segundos velho, ou nem ser a nossa tela.
 */

export type ResultadoAcao = { ok: true; sucesso: string } | { ok: false; erro: string };

const TIMEOUT_MS = 15_000;

// -------------------------------------------------------------------
// Enviar mensagem
// -------------------------------------------------------------------

const SchemaEnvio = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  customer_id: z.coerce.number().int().positive(),
  texto: z.string().max(4096),
});

export async function acaoEnviarMensagem(
  entrada: z.input<typeof SchemaEnvio>,
): Promise<ResultadoAcao> {
  const analise = SchemaEnvio.safeParse(entrada);
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = analise.data;
  const texto = dados.texto.trim();

  const { usuario, conta, db } = await requireClientAccess(dados.cliente);

  // Mesmas recusas, com os mesmos textos, do endpoint antigo.
  if (!texto) return { ok: false, erro: 'Mensagem vazia.' };

  const envio = await dadosParaEnvio(conta.client_db_name, db, dados.customer_id);
  if (!envio.phone) return { ok: false, erro: 'Lead não encontrado.' };

  // -----------------------------------------------------------------
  // Evolution API
  //
  // A janela de 24h NÃO é checada aqui, e isso é regra, não esquecimento:
  // ela é uma restrição da Meta para a Cloud API. A Evolution fala com o
  // WhatsApp pelo mesmo caminho de um celular, onde responder um contato
  // antigo é permitido.
  // -----------------------------------------------------------------
  if (envio.provider === 'evolution') {
    if (!envio.evolution_base_url || !envio.evolution_api_key || !envio.evolution_instance) {
      return { ok: false, erro: 'Conexão da Evolution não configurada para este cliente.' };
    }

    let idEvolution = '';
    try {
      idEvolution = await enviaTextoEvolution(
        {
          base_url: envio.evolution_base_url,
          api_key: envio.evolution_api_key,
          instancia: envio.evolution_instance,
        },
        envio.phone,
        texto,
      );
    } catch (erro) {
      const detalhe = erro instanceof ErroEvolution ? erro.message : 'falha de rede';
      if (!(erro instanceof ErroEvolution)) {
        console.error('[conversas] falha na Evolution API:', erro);
      }
      return { ok: false, erro: 'Não foi possível enviar a mensagem pela Evolution: ' + detalhe };
    }

    // A Evolution também devolve a mensagem enviada pelo webhook
    // `messages.upsert` com `fromMe: true`. Gravar aqui com o mesmo
    // `wa_message_id` faz o `INSERT IGNORE` de lá descartar a repetida —
    // é o UNIQUE da coluna que impede a bolha duplicada.
    try {
      await registraMensagemEnviada(db, {
        customerId: dados.customer_id,
        phone: envio.phone,
        texto,
        waMessageId: idEvolution,
      });
    } catch (erro) {
      console.error('[conversas] mensagem enviada mas não gravada:', erro);
    }

    await registraAuditoria({
      userId: usuario.id,
      userEmail: usuario.email,
      acao: ACOES.WHATSAPP_MENSAGEM_ENVIADA,
      clientDb: conta.client_db_name,
      detalhe: {
        customer_id: dados.customer_id,
        caracteres: texto.length,
        wa_message_id: idEvolution,
        provider: 'evolution',
      },
    });

    return { ok: true, sucesso: 'Mensagem enviada.' };
  }

  // -----------------------------------------------------------------
  // WhatsApp Cloud API (Meta)
  // -----------------------------------------------------------------
  if (!envio.cloud_phone_number_id || !envio.cloud_access_token) {
    return { ok: false, erro: 'WhatsApp não configurado para este cliente.' };
  }

  const segundos = envio.segundos_desde_inbound;
  if (segundos === null || segundos > JANELA_24H_SEGUNDOS) {
    return {
      ok: false,
      erro:
        'Fora da janela de 24h: só é possível responder livremente até 24h após a última ' +
        'mensagem do lead. Envio por template não está incluído nesta versão.',
    };
  }

  let waMessageId = '';
  try {
    const r = await fetch(
      `https://graph.facebook.com/${VERSAO_GRAPH_CLOUD}/${envio.cloud_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${envio.cloud_access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: envio.phone,
          type: 'text',
          text: { body: texto },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const corpo = (await r.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string };
    };
    if (!r.ok) {
      const detalhe = corpo?.error?.message || `HTTP ${r.status}`;
      return {
        ok: false,
        erro: 'Não foi possível enviar a mensagem pela Cloud API: ' + detalhe,
      };
    }
    waMessageId = corpo?.messages?.[0]?.id || `local-${Date.now()}`;
  } catch (erro) {
    // O log fica no servidor; para a tela vai só o motivo, sem stack.
    console.error('[conversas] falha na Cloud API:', erro);
    const detalhe = erro instanceof Error ? erro.message : 'falha de rede';
    return { ok: false, erro: 'Não foi possível enviar a mensagem pela Cloud API: ' + detalhe };
  }

  try {
    await registraMensagemEnviada(db, {
      customerId: dados.customer_id,
      phone: envio.phone,
      texto,
      waMessageId,
    });
  } catch (erro) {
    // A mensagem já saiu; recusar aqui faria o usuário mandar de novo.
    console.error('[conversas] mensagem enviada mas não gravada:', erro);
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.WHATSAPP_MENSAGEM_ENVIADA,
    clientDb: conta.client_db_name,
    // O conteúdo da mensagem já está em `whatsapp_messages`; repetir aqui
    // só espalharia conversa de lead por mais uma tabela.
    detalhe: { customer_id: dados.customer_id, caracteres: texto.length, wa_message_id: waMessageId },
  });

  return { ok: true, sucesso: 'Mensagem enviada.' };
}

// -------------------------------------------------------------------
// Salvar dados do lead
// -------------------------------------------------------------------

const SchemaLead = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  customer_id: z.coerce.number().int().positive(),
  first_name: z.string().trim().max(120).optional(),
  email: z.string().trim().max(190).optional(),
  status: z.string().trim().max(60).optional(),
  notes: z.string().max(10_000).optional(),
  tags: z.string().trim().max(500).optional(),
});

export async function acaoSalvarLead(
  entrada: z.input<typeof SchemaLead>,
): Promise<ResultadoAcao> {
  const analise = SchemaLead.safeParse(entrada);
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = analise.data;

  const { usuario, conta, db } = await requireClientAccess(dados.cliente);

  const status = dados.status || 'novo';

  let statusAnterior: string | null;
  try {
    ({ status_anterior: statusAnterior } = await salvaLead(db, {
      customerId: dados.customer_id,
      first_name: dados.first_name || null,
      email: dados.email || null,
      status,
      notes: dados.notes || null,
      tags: dados.tags || null,
    }));
  } catch (erro) {
    console.error('[conversas] falha ao salvar lead:', erro);
    return { ok: false, erro: 'Não foi possível salvar os dados do lead. Tente novamente.' };
  }

  // Evento para a Meta: só quando o estágio mudou de fato e existe
  // mapeamento ativo para o novo. Falha no envio não invalida o
  // salvamento — o lead já está gravado.
  let capi: string | null = null;
  if ((statusAnterior ?? '') !== status) {
    try {
      const mapa = await buscaMapeamentoEstagio(db, status);
      if (mapa?.meta_event) {
        const phone = await buscaTelefone(db, dados.customer_id);
        const r = await enviaEventoEstagio(conta.client_db_name, db, {
          customerId: dados.customer_id,
          phone,
          estagio: status,
          meta_event: mapa.meta_event,
          content_name: mapa.content_name,
          currency: mapa.currency,
          value: mapa.value,
        });
        capi = r.enviado ? `enviado (${mapa.meta_event})` : `não enviado: ${r.motivo}`;
      }
    } catch (erro) {
      console.error('[conversas] falha no disparo do evento de estágio:', erro);
      capi = 'não enviado: erro inesperado';
    }
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.WHATSAPP_LEAD_SALVO,
    clientDb: conta.client_db_name,
    detalhe: {
      customer_id: dados.customer_id,
      status,
      status_anterior: statusAnterior,
      capi,
    },
  });

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/whatsapp/conversas`);
  return { ok: true, sucesso: 'Dados do lead salvos com sucesso.' };
}

// -------------------------------------------------------------------
// Excluir conversa (somente administrador)
// -------------------------------------------------------------------

const SchemaExclusao = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  customer_id: z.coerce.number().int().positive(),
});

/**
 * Apaga a conversa de um lead — mensagens e estado, não o lead.
 *
 * A restrição a administrador é feita AQUI, no servidor, e não só
 * escondendo o botão: uma Server Action é um endpoint, e qualquer sessão
 * autenticada consegue chamá-la direto. Esconder o botão é conveniência
 * de tela; o que impede a exclusão é esta linha.
 *
 * Exclusão é irreversível: não há lixeira, e as mensagens não voltam nem
 * pelo webhook, porque o `wa_message_id` reenviado é descartado pelo
 * `INSERT IGNORE`. Por isso a tela pede confirmação antes de chamar.
 */
export async function acaoExcluirConversa(
  entrada: z.input<typeof SchemaExclusao>,
): Promise<ResultadoAcao> {
  const analise = SchemaExclusao.safeParse(entrada);
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = analise.data;

  const { usuario, conta, db } = await requireClientAccess(dados.cliente);
  // Recusa como resposta, não como exceção: Server Action que lança vira
  // erro 500 na página inteira, e quem clicou precisa ler o motivo.
  if (usuario.papel !== 'admin') {
    return { ok: false, erro: 'Apenas administradores podem excluir conversas.' };
  }

  const { mensagens } = await apagaConversa(db, dados.customer_id);

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.WHATSAPP_CONVERSA_EXCLUIDA,
    clientDb: conta.client_db_name,
    detalhe: { customer_id: dados.customer_id, mensagens_apagadas: mensagens },
  });

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/whatsapp/conversas`);
  return { ok: true, sucesso: `Conversa excluída (${mensagens} mensagens apagadas).` };
}
