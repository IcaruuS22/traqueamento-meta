'use server';

import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { env } from '@/lib/env';
import { lacunaDeEsquema } from '@/lib/db/pool';
import {
  AVISO_MIGRACAO_EVOLUTION,
  atualizaApiKeyEvolution,
  atualizaEstadoEvolution,
  buscaCredenciaisEvolution,
  removeConexaoEvolution,
  salvaConexaoEvolution,
} from '@/lib/db/whatsapp';
import {
  apagaInstancia,
  conectaInstancia,
  criaInstancia,
  defineWebhook,
  desconectaInstancia,
  ErroEvolution,
  estadoInstancia,
  nomeInstancia,
  normalizaBaseUrl,
  numeroConectado,
  type EstadoInstancia,
  type QrCode,
} from '@/lib/evolution';

/**
 * Ações da conexão por Evolution API.
 *
 * Toda a comunicação com a Evolution acontece aqui, no servidor. O
 * navegador manda o nome do cliente e recebe QR Code e estado — nunca a
 * api key, nunca o token do webhook, nunca a URL com o token dentro.
 *
 * As ações são chamadas em laço pela tela enquanto o QR está aberto
 * (o QR expira em cerca de 40 segundos), então cada uma faz uma
 * requisição só à Evolution e nada mais.
 */

export type ResultadoConexao =
  | { ok: true; estado: EstadoInstancia; qr: QrCode | null; numero: string | null }
  | { ok: false; erro: string };

export type ResultadoSimples = { ok: true; sucesso: string } | { ok: false; erro: string };

const SchemaCliente = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
});

const SchemaConexao = SchemaCliente.extend({
  base_url: z.string().trim().min(1, 'Informe a URL da Evolution API').max(255),
  /** Vazio significa "manter a chave já cadastrada". */
  api_key: z.string().trim().max(255).optional(),
});

/**
 * Leitura das credenciais que tolera o catálogo defasado.
 *
 * Sem isto, o cliente cujo `whatsapp_accounts` ainda não tem as colunas
 * da Evolution recebia erro 500 na tela inteira: o SELECT lança
 * `ER_BAD_FIELD_ERROR`, e uma Server Action que lança derruba a página,
 * não só o botão. Migração pendente é estado esperado — cada banco é
 * migrado à mão, um por vez —, então vira mensagem, não queda.
 *
 * Qualquer outro erro de banco continua subindo: engolir falha de
 * conexão aqui faria a tela dizer "rode a migração" para um problema que
 * não é esse.
 */
type Credenciais = Awaited<ReturnType<typeof buscaCredenciaisEvolution>>;

async function leCredenciais(
  clientDb: string,
): Promise<{ ok: true; cred: Credenciais } | { ok: false; erro: string }> {
  try {
    return { ok: true, cred: await buscaCredenciaisEvolution(clientDb) };
  } catch (erro) {
    if (lacunaDeEsquema(erro)) return { ok: false, erro: AVISO_MIGRACAO_EVOLUTION };
    throw erro;
  }
}

/** Texto de erro para a tela, sem stack e sem endereço interno. */
function mensagemDeErro(erro: unknown, prefixo: string): string {
  if (erro instanceof ErroEvolution) return `${prefixo}: ${erro.message}`;
  console.error('[evolution] erro inesperado:', erro);
  return `${prefixo}. Confira a URL e a chave da API e tente de novo.`;
}

/**
 * Monta a URL que a Evolution vai chamar.
 *
 * O token vai na query porque é o único lugar que a Evolution garante
 * repassar sem configuração extra por instância. Ele nunca aparece na
 * tela: quem precisa dele é o servidor da Evolution, e é para lá que
 * esta função manda o valor.
 */
function urlDoWebhook(token: string): string {
  return `${env.evolution.webhookBaseUrl}/api/webhooks/evolution?token=${encodeURIComponent(token)}`;
}

/**
 * Cria (ou reaponta) a instância e devolve o QR Code.
 *
 * Chamar de novo com a instância já criada não é erro: a Evolution
 * responde 403/409 no `/instance/create`, e o caminho segue para
 * reapontar o webhook e pedir um QR novo. É esse o comportamento
 * esperado do botão "Gerar novo QR Code" depois que a primeira tentativa
 * expirou.
 */
export async function acaoConectarEvolution(
  entrada: z.input<typeof SchemaConexao>,
): Promise<ResultadoConexao> {
  const analise = SchemaConexao.safeParse(entrada);
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = analise.data;

  const { usuario, conta } = await requireClientAccess(dados.cliente);

  let baseUrl: string;
  try {
    baseUrl = normalizaBaseUrl(dados.base_url);
  } catch (erro) {
    return { ok: false, erro: erro instanceof ErroEvolution ? erro.message : 'URL inválida.' };
  }

  const leitura = await leCredenciais(conta.client_db_name);
  if (!leitura.ok) return { ok: false, erro: leitura.erro };
  const atual = leitura.cred;

  const apiKey = dados.api_key || atual?.api_key || '';
  if (!apiKey) {
    return { ok: false, erro: 'Informe a chave da API (apikey) da sua Evolution.' };
  }

  const instancia = atual?.instancia || nomeInstancia(conta.client_db_name);
  // O token do webhook é gerado uma vez e mantido: trocá-lo a cada
  // reconexão invalidaria a URL já cadastrada em instâncias que
  // continuam funcionando.
  const webhookToken = atual?.webhook_token || randomBytes(24).toString('hex');

  try {
    await salvaConexaoEvolution(conta.client_db_name, {
      base_url: baseUrl,
      api_key: dados.api_key || '',
      instancia,
      webhook_token: webhookToken,
    });
  } catch (erro) {
    console.error('[evolution] falha ao gravar a conexão:', erro);
    return {
      ok: false,
      erro: lacunaDeEsquema(erro)
        ? AVISO_MIGRACAO_EVOLUTION
        : 'Não foi possível gravar a conexão. Tente de novo.',
    };
  }

  const cred = { base_url: baseUrl, api_key: apiKey, instancia };
  const webhook = urlDoWebhook(webhookToken);

  let qr: QrCode | null = null;
  try {
    const criada = await criaInstancia(cred, webhook);
    qr = criada.qr;
    // A v2 devolve uma chave só daquela instância. A partir daqui é ela
    // que autentica as chamadas, e é ela que fica gravada.
    if (criada.hash && criada.hash !== apiKey) {
      await atualizaApiKeyEvolution(conta.client_db_name, criada.hash);
      cred.api_key = criada.hash;
    }
  } catch (erro) {
    // Instância já existente é o caso comum de reconexão, não falha.
    const jaExiste = erro instanceof ErroEvolution && (erro.status === 403 || erro.status === 409);
    if (!jaExiste) {
      return { ok: false, erro: mensagemDeErro(erro, 'Não foi possível criar a instância') };
    }
    try {
      await defineWebhook(cred, webhook);
    } catch (erroWebhook) {
      // O webhook pode falhar em versões que usam outro caminho para
      // configurá-lo; o pareamento em si não depende disso.
      console.error('[evolution] não foi possível reapontar o webhook:', erroWebhook);
    }
  }

  if (!qr?.base64 && !qr?.code) {
    try {
      qr = await conectaInstancia(cred);
    } catch (erro) {
      return { ok: false, erro: mensagemDeErro(erro, 'Não foi possível gerar o QR Code') };
    }
  }

  let estado: EstadoInstancia = 'connecting';
  try {
    estado = await estadoInstancia(cred);
  } catch {
    // Estado é informativo aqui: o QR já está na mão do usuário.
  }
  await atualizaEstadoEvolution(conta.client_db_name, estado, null);

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.WHATSAPP_EVOLUTION_CONECTADA,
    clientDb: conta.client_db_name,
    // Sem api key, sem token do webhook e sem QR: o registro diz o que
    // foi feito, não como entrar na conexão.
    detalhe: { instancia, base_url: baseUrl, estado },
  });

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/whatsapp`);
  return { ok: true, estado, qr, numero: null };
}

/**
 * Estado da instância, chamado em laço enquanto o QR está na tela.
 *
 * Quando a conexão abre, grava o estado e o número que atendeu — é o que
 * faz a tela trocar o QR pelo aviso de conectado sem o usuário recarregar.
 */
export async function acaoEstadoEvolution(
  entrada: z.input<typeof SchemaCliente>,
): Promise<ResultadoConexao> {
  const analise = SchemaCliente.safeParse(entrada);
  if (!analise.success) return { ok: false, erro: 'Dados inválidos' };

  const { conta } = await requireClientAccess(analise.data.cliente);
  const leitura = await leCredenciais(conta.client_db_name);
  if (!leitura.ok) return { ok: false, erro: leitura.erro };
  const cred = leitura.cred;
  if (!cred?.base_url || !cred.api_key || !cred.instancia) {
    return { ok: false, erro: 'Conexão da Evolution não configurada para este cliente.' };
  }

  const completa = { base_url: cred.base_url, api_key: cred.api_key, instancia: cred.instancia };

  let estado: EstadoInstancia;
  try {
    estado = await estadoInstancia(completa);
  } catch (erro) {
    return { ok: false, erro: mensagemDeErro(erro, 'Não foi possível consultar a conexão') };
  }

  const numero = estado === 'open' ? await numeroConectado(completa) : null;
  await atualizaEstadoEvolution(conta.client_db_name, estado, numero);

  return { ok: true, estado, qr: null, numero };
}

/** Pede um QR novo para uma instância já cadastrada. */
export async function acaoNovoQrEvolution(
  entrada: z.input<typeof SchemaCliente>,
): Promise<ResultadoConexao> {
  const analise = SchemaCliente.safeParse(entrada);
  if (!analise.success) return { ok: false, erro: 'Dados inválidos' };

  const { conta } = await requireClientAccess(analise.data.cliente);
  const leitura = await leCredenciais(conta.client_db_name);
  if (!leitura.ok) return { ok: false, erro: leitura.erro };
  const cred = leitura.cred;
  if (!cred?.base_url || !cred.api_key || !cred.instancia) {
    return { ok: false, erro: 'Conexão da Evolution não configurada para este cliente.' };
  }

  const completa = { base_url: cred.base_url, api_key: cred.api_key, instancia: cred.instancia };

  try {
    const qr = await conectaInstancia(completa);
    return { ok: true, estado: 'connecting', qr, numero: null };
  } catch (erro) {
    return { ok: false, erro: mensagemDeErro(erro, 'Não foi possível gerar o QR Code') };
  }
}

/**
 * Reaponta o webhook da instância para a URL atual do painel.
 *
 * Existe porque o endereço do painel muda depois que a instância já foi
 * criada — subir para a Vercel, trocar de domínio, sair de `localhost`.
 * Até aqui o webhook só era gravado dentro de `acaoConectarEvolution`, o
 * que obrigava a refazer o pareamento (ler o QR de novo) só para trocar
 * uma URL. A instância e o token continuam os mesmos; muda só para onde
 * a Evolution entrega as mensagens.
 */
export async function acaoReapontarWebhookEvolution(
  entrada: z.input<typeof SchemaCliente>,
): Promise<ResultadoSimples> {
  const analise = SchemaCliente.safeParse(entrada);
  if (!analise.success) return { ok: false, erro: 'Dados inválidos' };

  const { usuario, conta } = await requireClientAccess(analise.data.cliente);
  const leitura = await leCredenciais(conta.client_db_name);
  if (!leitura.ok) return { ok: false, erro: leitura.erro };
  const cred = leitura.cred;
  if (!cred?.base_url || !cred.api_key || !cred.instancia || !cred.webhook_token) {
    return { ok: false, erro: 'Conexão da Evolution não configurada para este cliente.' };
  }

  const base = env.evolution.webhookBaseUrl;
  try {
    await defineWebhook(
      { base_url: cred.base_url, api_key: cred.api_key, instancia: cred.instancia },
      urlDoWebhook(cred.webhook_token),
    );
  } catch (erro) {
    return { ok: false, erro: mensagemDeErro(erro, 'Não foi possível atualizar o webhook') };
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.WHATSAPP_EVOLUTION_WEBHOOK,
    clientDb: conta.client_db_name,
    // Sem o token: o registro guarda para onde aponta, não a credencial.
    detalhe: { instancia: cred.instancia, base },
  });

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/whatsapp`);

  // `localhost` no endereço do painel é o erro que mais custa a
  // aparecer: a Evolution aceita o cadastro, responde sucesso e entrega
  // as mensagens no próprio servidor dela, onde não há painel nenhum
  // ouvindo. Melhor dizer agora do que o usuário procurar mensagem que
  // nunca chegou.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(base);
  return {
    ok: true,
    sucesso: local
      ? `Webhook atualizado para ${base}/api/webhooks/evolution, mas esse endereço é local. Se a Evolution roda em outro servidor, ela não alcança o painel: defina EVOLUTION_WEBHOOK_BASE_URL com o endereço público e clique de novo.`
      : `Webhook atualizado para ${base}/api/webhooks/evolution`,
  };
}

/** Desconecta o aparelho, mantendo a instância e a configuração. */
export async function acaoDesconectarEvolution(
  entrada: z.input<typeof SchemaCliente>,
): Promise<ResultadoSimples> {
  const analise = SchemaCliente.safeParse(entrada);
  if (!analise.success) return { ok: false, erro: 'Dados inválidos' };

  const { usuario, conta } = await requireClientAccess(analise.data.cliente);
  const leitura = await leCredenciais(conta.client_db_name);
  if (!leitura.ok) return { ok: false, erro: leitura.erro };
  const cred = leitura.cred;
  if (!cred?.base_url || !cred.api_key || !cred.instancia) {
    return { ok: false, erro: 'Conexão da Evolution não configurada para este cliente.' };
  }

  try {
    await desconectaInstancia({
      base_url: cred.base_url,
      api_key: cred.api_key,
      instancia: cred.instancia,
    });
  } catch (erro) {
    return { ok: false, erro: mensagemDeErro(erro, 'Não foi possível desconectar') };
  }

  await atualizaEstadoEvolution(conta.client_db_name, 'close', null);
  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.WHATSAPP_EVOLUTION_DESCONECTADA,
    clientDb: conta.client_db_name,
    detalhe: { instancia: cred.instancia },
  });

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/whatsapp`);
  return { ok: true, sucesso: 'Aparelho desconectado.' };
}

/**
 * Apaga a instância no servidor da Evolution e limpa a configuração.
 *
 * As mensagens já recebidas continuam no banco do cliente: elas são
 * histórico da conversa, não da conexão.
 */
export async function acaoRemoverEvolution(
  entrada: z.input<typeof SchemaCliente>,
): Promise<ResultadoSimples> {
  const analise = SchemaCliente.safeParse(entrada);
  if (!analise.success) return { ok: false, erro: 'Dados inválidos' };

  const { usuario, conta } = await requireClientAccess(analise.data.cliente);
  const leitura = await leCredenciais(conta.client_db_name);
  if (!leitura.ok) return { ok: false, erro: leitura.erro };
  const cred = leitura.cred;
  if (!cred?.base_url || !cred.api_key || !cred.instancia) {
    return { ok: false, erro: 'Conexão da Evolution não configurada para este cliente.' };
  }

  try {
    await apagaInstancia({
      base_url: cred.base_url,
      api_key: cred.api_key,
      instancia: cred.instancia,
    });
  } catch (erro) {
    // A instância pode já não existir no servidor. Nesse caso limpar o
    // catálogo é justamente o que resolve, então o erro não interrompe.
    console.error('[evolution] falha ao apagar a instância:', erro);
  }

  await removeConexaoEvolution(conta.client_db_name);
  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.WHATSAPP_EVOLUTION_REMOVIDA,
    clientDb: conta.client_db_name,
    detalhe: { instancia: cred.instancia },
  });

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/whatsapp`);
  return { ok: true, sucesso: 'Conexão removida. O cliente voltou para a Cloud API.' };
}
