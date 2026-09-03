'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  acaoConectarEvolution,
  acaoDesconectarEvolution,
  acaoEstadoEvolution,
  acaoNovoQrEvolution,
  acaoReapontarWebhookEvolution,
  acaoRemoverEvolution,
} from '@/lib/acoes/whatsapp-evolution';
import { Alerta, Campo } from '@/components/form';
import type { ConfigEvolution } from '@/lib/db/whatsapp';

/**
 * Conexão por Evolution API: cadastro do servidor, QR Code e estado.
 *
 * O QR da Evolution expira em poucos dezenas de segundos, e o pareamento
 * só termina quando o celular lê o código — nada avisa esta tela. Por isso
 * o componente consulta o estado em laço enquanto o QR está aberto, e
 * troca sozinho para "conectado" quando a instância abre.
 *
 * A chave da API nasce em branco mesmo quando já existe uma gravada, pela
 * mesma razão do token da Cloud API: a tela nunca recebe o valor. A URL do
 * webhook é mostrada sem o token — quem precisa dele é o servidor da
 * Evolution, e é o servidor do painel que o entrega.
 */

const INTERVALO_MS = 4_000;

/** Mesma forma do `QrCode` de `@/lib/evolution`, redeclarada porque
 * aquele módulo é `server-only` e não pode ser importado daqui. */
type Qr = { base64: string | null; code: string | null; pairingCode: string | null } | null;

/** Rótulo humano para o estado bruto da Evolution. */
function rotuloEstado(estado: string | null): string {
  if (estado === 'open') return 'Conectado';
  if (estado === 'connecting') return 'Aguardando leitura do QR Code';
  if (estado === 'close') return 'Desconectado';
  return 'Estado desconhecido';
}

/**
 * A Evolution devolve o QR ora como data URL completa, ora como base64
 * puro. `<img src>` só aceita a primeira forma.
 */
function fonteDoQr(base64: string): string {
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
}

export function FormConexaoEvolution({
  cliente,
  inicial,
  urlWebhook,
}: {
  cliente: string;
  inicial: ConfigEvolution;
  /** Sem o token: serve para o usuário conferir se o endereço é alcançável. */
  urlWebhook: string;
}) {
  const [baseUrl, setBaseUrl] = useState(inicial.base_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [estado, setEstado] = useState<string | null>(inicial.estado);
  const [numero, setNumero] = useState<string | null>(inicial.numero);
  const [qr, setQr] = useState<Qr>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);
  const [pendente, iniciaTransicao] = useTransition();

  const conectado = estado === 'open';

  // O laço precisa parar sozinho quando o componente sai da tela; sem a
  // ref, um estado velho continuaria agendando consultas ao servidor.
  const ativo = useRef(true);
  useEffect(() => {
    ativo.current = true;
    return () => {
      ativo.current = false;
    };
  }, []);

  const consultaEstado = useCallback(async () => {
    const r = await acaoEstadoEvolution({ cliente });
    if (!ativo.current) return;
    if (!r.ok) {
      // Falha de consulta não apaga o QR que está na tela: o pareamento
      // pode estar funcionando mesmo com uma consulta perdida.
      return;
    }
    setEstado(r.estado);
    setNumero(r.numero);
    if (r.estado === 'open') {
      setQr(null);
      setSucesso('WhatsApp conectado.');
    }
  }, [cliente]);

  // Laço enquanto o QR está aberto. Para no instante em que conecta.
  useEffect(() => {
    if (!qr || conectado) return;
    const id = setInterval(() => {
      void consultaEstado();
    }, INTERVALO_MS);
    return () => clearInterval(id);
  }, [qr, conectado, consultaEstado]);

  function limpaAvisos() {
    setErro(null);
    setSucesso(null);
  }

  function conectar() {
    limpaAvisos();
    iniciaTransicao(async () => {
      const r = await acaoConectarEvolution({ cliente, base_url: baseUrl, api_key: apiKey });
      if (!ativo.current) return;
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      // A chave já está gravada; manter o valor digitado no campo só
      // deixaria um segredo à toa na memória da página.
      setApiKey('');
      setEstado(r.estado);
      setQr(r.qr);
      if (r.estado === 'open') {
        setSucesso('WhatsApp já estava conectado.');
      } else if (!r.qr?.base64 && !r.qr?.code) {
        setErro('A Evolution não devolveu QR Code. Tente gerar um novo em alguns segundos.');
      }
    });
  }

  function novoQr() {
    limpaAvisos();
    iniciaTransicao(async () => {
      const r = await acaoNovoQrEvolution({ cliente });
      if (!ativo.current) return;
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setEstado(r.estado);
      setQr(r.qr);
    });
  }

  function desconectar() {
    limpaAvisos();
    iniciaTransicao(async () => {
      const r = await acaoDesconectarEvolution({ cliente });
      if (!ativo.current) return;
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setQr(null);
      setEstado('close');
      setNumero(null);
      setSucesso(r.sucesso);
    });
  }

  function reapontarWebhook() {
    limpaAvisos();
    iniciaTransicao(async () => {
      const r = await acaoReapontarWebhookEvolution({ cliente });
      if (!ativo.current) return;
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setSucesso(r.sucesso);
    });
  }

  function remover() {
    limpaAvisos();
    iniciaTransicao(async () => {
      const r = await acaoRemoverEvolution({ cliente });
      if (!ativo.current) return;
      setConfirmandoRemocao(false);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setQr(null);
      setEstado(null);
      setNumero(null);
      setBaseUrl('');
      setSucesso(r.sucesso);
    });
  }

  // Mesma checagem que a ação faz no servidor, aqui só para o aviso na
  // tela: `urlWebhook` já chega sem o token.
  const enderecoLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(urlWebhook);

  return (
    <div className="space-y-4">
      {erro ? <Alerta tipo="erro">{erro}</Alerta> : null}
      {sucesso ? <Alerta tipo="sucesso">{sucesso}</Alerta> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          label="URL da Evolution API"
          name="evolution_base_url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://evolution.seudominio.com"
          dica="Endereço do seu servidor da Evolution, sem barra no fim."
        />
        <Campo
          label="Chave da API (apikey)"
          name="evolution_api_key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={inicial.api_key_cadastrada ? '•••• já cadastrada' : ''}
          dica={
            inicial.api_key_cadastrada
              ? 'Deixe em branco para manter a chave atual.'
              : 'A AUTHENTICATION_API_KEY global do seu servidor. Depois de criada a instância, o painel passa a usar a chave própria dela.'
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pendente || !baseUrl.trim()}
          onClick={conectar}
        >
          {pendente ? 'Aguarde…' : inicial.criada ? 'Reconectar / Gerar QR Code' : 'Conectar e gerar QR Code'}
        </button>

        {inicial.criada && !qr ? (
          <button type="button" className="btn btn-secondary" disabled={pendente} onClick={novoQr}>
            Gerar novo QR Code
          </button>
        ) : null}

        {conectado ? (
          <button type="button" className="btn btn-secondary" disabled={pendente} onClick={desconectar}>
            Desconectar aparelho
          </button>
        ) : null}

        <span className="chip-static">
          {rotuloEstado(estado)}
          {numero ? ` · ${numero}` : ''}
        </span>
      </div>

      {qr && (qr.base64 || qr.code) ? (
        <div className="rounded-[var(--radius-control)] border border-[var(--border-default)] p-4">
          <p className="mb-3 text-sm text-[var(--text-secondary)]">
            No celular: <strong>WhatsApp → Aparelhos conectados → Conectar aparelho</strong> e aponte
            para o código. Ele expira em cerca de 40 segundos. Se passar, gere um novo.
          </p>

          {qr.base64 ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={fonteDoQr(qr.base64)}
              alt="QR Code para conectar o WhatsApp"
              width={264}
              height={264}
              className="rounded-[var(--radius-control)] bg-white"
            />
          ) : (
            <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-[var(--bg-field-on-canvas)] p-3 text-xs">
              {qr.code}
            </pre>
          )}

          {qr.pairingCode ? (
            <p className="mt-3 text-sm text-[var(--text-secondary)]">
              Código de pareamento: <strong>{qr.pairingCode}</strong>
            </p>
          ) : null}

          <button
            type="button"
            className="btn btn-secondary btn-sm mt-3"
            disabled={pendente}
            onClick={novoQr}
          >
            Gerar novo QR Code
          </button>
        </div>
      ) : null}

      <div className="rounded-[var(--radius-control)] bg-[var(--bg-field-on-canvas)] px-3 py-2.5 text-xs text-[var(--text-tertiary)]">
        Webhook cadastrado na instância: <code>{urlWebhook}</code>
        <br />O token de autenticação é acrescentado pelo servidor e não aparece aqui. A Evolution
        precisa conseguir alcançar esse endereço. Se o painel roda atrás de proxy, ajuste{' '}
        <code>EVOLUTION_WEBHOOK_BASE_URL</code>.
        {enderecoLocal ? (
          <>
            <br />
            <strong>
              Esse endereço é local. Se a Evolution roda em outro servidor, nenhuma mensagem chega
              ao painel: publique o painel, defina EVOLUTION_WEBHOOK_BASE_URL com o endereço
              público e clique em &quot;Atualizar webhook&quot;.
            </strong>
          </>
        ) : null}
        {inicial.criada ? (
          <div className="mt-3">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={pendente}
              onClick={reapontarWebhook}
            >
              Atualizar webhook
            </button>{' '}
            <span className="text-xs text-[var(--text-tertiary)]">
              Use depois de mudar o endereço do painel. Não precisa ler o QR Code de novo.
            </span>
          </div>
        ) : null}
      </div>

      {inicial.criada ? (
        <div className="border-t border-[var(--border-default)] pt-4">
          {confirmandoRemocao ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-[var(--text-secondary)]">
                Apagar a instância no servidor da Evolution e voltar este cliente para a Cloud API?
                As mensagens já recebidas continuam no banco.
              </span>
              <button type="button" className="btn btn-danger btn-sm" disabled={pendente} onClick={remover}>
                Confirmar remoção
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={pendente}
                onClick={() => setConfirmandoRemocao(false)}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={pendente}
              onClick={() => setConfirmandoRemocao(true)}
            >
              Remover conexão
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
