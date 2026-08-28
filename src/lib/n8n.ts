import 'server-only';
import { env } from '@/lib/env';
import { HttpError } from '@/lib/http';

/**
 * Chamada aos dois webhooks que continuam no n8n.
 *
 * `sync-meta-agora` e `campanhas-importar-historico` ficam onde estão
 * porque são o miolo do que o n8n faz bem: paginação da Graph API,
 * repetição em caso de falha e escrita em lote. Portá-los para o app
 * seria reescrever um ETL inteiro sem ganho para o usuário.
 *
 * O que muda é quem chama. Hoje o navegador chama o n8n direto, com
 * Basic Auth — ou seja, a credencial precisa estar no front-end, e
 * qualquer pessoa com ela dispara sincronização de QUALQUER cliente,
 * porque o webhook só olha o `client_db` que recebeu. Aqui o navegador
 * fala com o app, o app confere sessão e vínculo, e só então repassa ao
 * n8n com o token que nunca sai do servidor.
 */

/** Nome do parâmetro é o mesmo que os webhooks já esperam hoje. */
const PARAM_CLIENTE = 'client_db';

export type RespostaN8n = {
  /** `false` quando o n8n recusou por já haver execução em andamento (429). */
  executou: boolean;
  mensagem: string;
};

/**
 * Dispara um webhook e devolve a mensagem que o n8n produziu.
 *
 * O `429` da trava de 60s não é erro: o painel antigo já o tratava como
 * "outra aba está sincronizando, siga com os dados do banco". Manter
 * esse desfecho como sucesso evita que um segundo clique vire alerta
 * vermelho para o usuário.
 */
export async function disparaWebhook(
  caminho: 'sync-meta-agora' | 'campanhas-importar-historico',
  clientDb: string,
  timeoutMs: number,
): Promise<RespostaN8n> {
  if (!env.n8n.configurado) {
    throw new HttpError(
      503,
      'Integração com o n8n não configurada neste ambiente (N8N_WEBHOOK_BASE_URL e N8N_WEBHOOK_TOKEN).',
    );
  }

  const url = `${env.n8n.baseUrl}/painel-api/${caminho}?${PARAM_CLIENTE}=${encodeURIComponent(clientDb)}`;

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: {
        // O n8n valida por credencial de Header Auth. O token não é
        // exposto em nenhuma resposta nem gravado na auditoria.
        authorization: `Bearer ${env.n8n.token}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (erro) {
    console.error(`[n8n] falha ao chamar ${caminho}:`, erro);
    const tempoEsgotado = erro instanceof Error && erro.name === 'TimeoutError';
    throw new HttpError(
      504,
      tempoEsgotado
        ? 'O n8n não respondeu a tempo. A execução pode ter continuado lá; confira os dados em alguns minutos.'
        : 'Não foi possível falar com o n8n. Tente novamente em alguns instantes.',
    );
  }

  // Lê como texto antes de decodificar: quando o n8n devolve algo que não
  // é JSON (uma execução interrompida, um proxy no caminho), o corpo cru
  // vai para o log do servidor em vez de sumir dentro de um catch mudo — foi
  // assim que se investigou uma resposta sem `message`.
  const bruto = await resposta.text();
  let corpo: { message?: string } = {};
  try {
    corpo = JSON.parse(bruto) as { message?: string };
  } catch {
    console.warn('[n8n] resposta não-JSON de', caminho, resposta.status, JSON.stringify(bruto.slice(0, 300)));
  }

  if (resposta.status === 429) {
    return {
      executou: false,
      mensagem: corpo.message || 'Sincronização já em andamento, aguarde alguns instantes.',
    };
  }

  if (!resposta.ok) {
    console.error(`[n8n] ${caminho} respondeu ${resposta.status}`);
    // A mensagem do n8n pode citar nome de banco e estrutura de node;
    // para a tela vai só o status.
    throw new HttpError(
      502,
      resposta.status === 401 || resposta.status === 403
        ? 'O n8n recusou a credencial do app. Confira o token do webhook.'
        : `O n8n respondeu ${resposta.status}. Confira a execução no n8n.`,
    );
  }

  return { executou: true, mensagem: corpo.message || 'Concluído.' };
}
