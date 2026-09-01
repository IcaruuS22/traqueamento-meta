'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { acaoEnviarMensagem, acaoExcluirConversa, acaoSalvarLead } from '@/lib/acoes/conversas';
import { acaoExcluirLead } from '@/lib/acoes/leads';
import { ehEtapaDePerda, MOTIVOS_PERDA_SUGERIDOS, TAMANHO_MOTIVO } from '@/lib/funil';
import { fmtBRL, fmtDataHora, fmtHoraRelativa } from '@/lib/format';
import { Dica } from '@/components/dica';
import Link from 'next/link';
import { IconesNav } from '@/components/icones';
import { ModalRastreio } from '@/components/modal-rastreio';
import {
  FAIXAS,
  FAIXA_PADRAO,
  fimDaJanela,
  iniciais,
  nomeExibicao,
  rotuloEstagio,
  textoDaBolha,
  textoDaMensagem,
  avisoMidia,
  formatoMidia,
  nomeArquivo,
  tamanhoLegivel,
  temMidia,
  type Conversa,
  type FaixaConversa,
  type LeadConversa,
  type MensagemWhatsapp,
} from '@/lib/whatsapp-conversas';

/**
 * Tela de Conversas — porte da aba "Conversas" do painel antigo, com as
 * mesmas três colunas: lista, thread e dados do lead.
 *
 * A atualização é por espera longa em `/api/conversas/novidades`: a tela
 * manda o cursor que já tem e a resposta fica pendurada até o banco
 * mudar, então mensagem nova aparece em cerca de um segundo em vez dos 5
 * a 10 do polling antigo. Quem escreve as mensagens é o n8n, em outro
 * processo, então não existe evento em memória para empurrar daqui — e
 * um canal de push exigiria pub/sub externo mais uma conexão viva, que é
 * a infraestrutura que este projeto decidiu não ter (ver
 * PLANO_IMPLEMENTACAO.md).
 *
 * Três detalhes que vieram do sintoma relatado ("só aparece ao atualizar
 * a página"): a espera é interrompida enquanto a aba está oculta, mas
 * voltar para a aba, para a janela ou para a rede recarrega na hora — o
 * `setInterval` antigo era estrangulado pelo navegador em segundo plano
 * e não tinha nenhuma volta dessas; e um intervalo lento de segurança
 * cobre o caso de a espera longa morrer sem avisar.
 *
 * Comparar uma assinatura do que chegou antes de trocar o estado evita
 * dois problemas: re-render inútil de 200 linhas e, principalmente,
 * sobrescrever um campo que a pessoa está digitando no painel da
 * direita.
 *
 * Duas diferenças em relação ao painel antigo:
 *
 *  - não existe botão "Resolver". Ele gravava o estágio fixo
 *    `'resolvida'`, que pode não existir na lista de estágios do cliente;
 *    quem muda o estágio é o seletor, alimentado por `whatsapp_event_map`;
 *  - o aviso da janela de 24h vem dos segundos calculados pelo servidor,
 *    não do relógio do navegador.
 *
 * O filtro da lista é por faixa do funil — Em aberto, Ganho, Perdido —, e
 * não por estágio. Os estágios continuam existindo inteiros no seletor do
 * lead: são eles que disparam os eventos da Meta. O que muda é só a
 * navegação da lista, onde uma aba por estágio dava sete filtros que
 * ninguém usava e escondia o que importa (o que ainda está aberto).
 */

/** Rede de segurança: só age se a espera longa parar de responder. */
const INTERVALO_SEGURANCA_MS = 30_000;
/** Espera antes de reabrir a conexão que falhou, para não virar laço quente. */
const ESPERA_APOS_ERRO_MS = 5_000;
/** Piso entre duas recargas seguidas — `focus` e `visibilitychange` disparam juntos. */
const MIN_ENTRE_CARGAS_MS = 1_000;
const DEBOUNCE_BUSCA_MS = 300;

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve quando a aba volta a ficar visível (ou quando o ciclo é
 * encerrado). Segurar a espera longa com a aba oculta manteria uma função
 * do servidor de pé para ninguém olhar.
 */
function esperaVisivel(sinal: AbortSignal): Promise<void> {
  if (!document.hidden || sinal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const fim = () => {
      if (document.hidden && !sinal.aborted) return;
      document.removeEventListener('visibilitychange', fim);
      sinal.removeEventListener('abort', fim);
      resolve();
    };
    document.addEventListener('visibilitychange', fim);
    sinal.addEventListener('abort', fim);
  });
}

type ThreadCarregada = {
  lead: LeadConversa;
  mensagens: MensagemWhatsapp[];
  /** Quando esta resposta chegou, para posicionar a janela de 24h. */
  recebidoEm: number;
};

type FormLead = {
  first_name: string;
  email: string;
  status: string;
  notes: string;
  tags: string;
  /** Só é gravado quando o estágio salvo é o de perda. */
  motivo_perda: string;
};

const assinaturaLista = (itens: Conversa[]) =>
  itens
    .map((c) => `${c.customer_id}:${c.last_message_at}:${c.unread_count}:${c.status}`)
    .join('|');

// O terceiro campo é o que faz a bolha trocar o "Baixando arquivo…" pelo
// arquivo: o download acontece depois de a mensagem já estar gravada, e
// sem contar os pendentes a assinatura não mudaria — a mídia só apareceria
// na próxima mensagem da conversa.
const assinaturaMensagens = (msgs: MensagemWhatsapp[]) =>
  msgs.length
    ? `${msgs.length}:${msgs[msgs.length - 1].id}:${
        msgs.filter((m) => m.media_status === 'pendente').length
      }`
    : '0';

const assinaturaLead = (l: LeadConversa) =>
  [l.first_name, l.email, l.status, l.notes, l.tags, l.motivo_perda].join('|');

const doFormulario = (l: LeadConversa): FormLead => ({
  first_name: l.first_name ?? '',
  email: l.email ?? '',
  status: l.status || 'novo',
  notes: l.notes ?? '',
  tags: l.tags ?? '',
  motivo_perda: l.motivo_perda ?? '',
});

/**
 * O arquivo de uma mensagem dentro da bolha.
 *
 * Imagem, áudio e vídeo saem no player do próprio navegador; o resto
 * vira link de download. Os bytes vêm da rota autenticada
 * `/api/conversas/midia`, nunca da URL do WhatsApp — a mídia lá expira
 * e a URL exige a credencial do cliente.
 *
 * Quando não há arquivo para mostrar, devolve `null` e a bolha fica só
 * com o rótulo de `textoDaMensagem` ("📎 Imagem recebida"), que é o que
 * já acontecia antes da captura existir.
 */
/**
 * Valor que a IA extraiu da conversa.
 *
 * Vem como string do MySQL (DECIMAL com `dateStrings` no pool) ou como
 * `null` — tanto quando a IA não achou valor nenhum quanto quando o banco
 * do cliente ainda não rodou `migracao_whatsapp_ia_valor.sql`. Os dois
 * casos aparecem como "—": o painel não tem como distinguir um do outro,
 * e inventar mensagem diferente pra cada um seria chute.
 */
function valorDaIA(valor: string | number | null): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? fmtBRL(n) : '—';
}

function Anexo({
  cliente,
  customerId,
  msg,
}: {
  cliente: string;
  customerId: number;
  msg: MensagemWhatsapp;
}) {
  const aviso = avisoMidia(msg.media_status);
  if (aviso) return <span className="crm-bubble-midia-aviso">{aviso}</span>;
  if (!temMidia(msg)) return null;

  const base = `/api/conversas/midia?client_db=${encodeURIComponent(cliente)}&customer_id=${customerId}&message_id=${msg.id}`;
  const formato = formatoMidia(msg);

  if (formato === 'imagem') {
    // <img> e não <Image>: o arquivo vem do banco, sem dimensão conhecida
    // antes do download, e não há o que o otimizador do Next faça com uma
    // rota autenticada por sessão.
    return (
      <a href={base} target="_blank" rel="noreferrer" className="crm-bubble-midia">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={base} alt={nomeArquivo(msg)} className="crm-bubble-img" />
      </a>
    );
  }

  if (formato === 'audio') {
    return <audio className="crm-bubble-audio" controls preload="none" src={base} />;
  }

  if (formato === 'video') {
    return <video className="crm-bubble-video" controls preload="metadata" src={base} />;
  }

  const tamanho = tamanhoLegivel(msg.media_size);
  return (
    <a href={`${base}&baixar=1`} className="crm-bubble-arquivo" download>
      <span aria-hidden>📎</span>
      <span>
        {nomeArquivo(msg)}
        {tamanho ? ` · ${tamanho}` : ''}
      </span>
    </a>
  );
}

export function TelaConversas({
  cliente,
  estagios,
  iniciaisConversas,
  leadInicial = null,
  provider = 'cloud',
  podeExcluir = false,
}: {
  cliente: string;
  /** Estágios cadastrados em `whatsapp_event_map`. */
  estagios: string[];
  iniciaisConversas: Conversa[];
  /**
   * Conversa a abrir de saída, vinda de `?lead=` — é assim que o card do
   * CRM chega aqui. Pode não estar na lista da faixa em que a tela abre;
   * a thread é buscada pelo id, então ela aparece do mesmo jeito.
   */
  leadInicial?: number | null;
  /**
   * Sessão de administrador. Só controla o que a tela mostra — quem
   * recusa a exclusão de fato é `acaoExcluirConversa`, no servidor.
   */
  podeExcluir?: boolean;
  /**
   * Conexão em uso. A janela de 24h é regra da Cloud API da Meta; pela
   * Evolution a conversa sai do mesmo jeito que sairia do celular, e
   * bloquear o campo ali seria inventar uma restrição que não existe.
   */
  provider?: 'cloud' | 'evolution';
}) {
  const [conversas, setConversas] = useState<Conversa[]>(iniciaisConversas);
  const [faixa, setFaixa] = useState<FaixaConversa>(FAIXA_PADRAO);
  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState('');
  const [erroLista, setErroLista] = useState<string | null>(null);

  const [selecionado, setSelecionado] = useState<number | null>(leadInicial);
  const [thread, setThread] = useState<ThreadCarregada | null>(null);
  const [erroThread, setErroThread] = useState<string | null>(null);
  const [rastreioAberto, setRastreioAberto] = useState(false);

  const [form, setForm] = useState<FormLead>({
    first_name: '',
    email: '',
    status: 'novo',
    notes: '',
    tags: '',
    motivo_perda: '',
  });
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [salvando, iniciaSalvar] = useTransition();

  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Qual exclusão está com a confirmação aberta. Estado único porque as
  // duas são destrutivas e mostrar as duas perguntas ao mesmo tempo
  // convida a clicar na errada.
  const [confirmando, setConfirmando] = useState<'conversa' | 'lead' | null>(null);

  // Relógio próprio: sem ele, o aviso da janela de 24h só mudaria quando
  // chegasse mensagem nova.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // `null` significa "ainda não sei o que o servidor tem". Guardar string
  // vazia aqui esconderia a resposta legítima de uma lista vazia, que tem
  // assinatura vazia: o filtro que não devolve nada não limparia a tela.
  const sigLista = useRef<string | null>(assinaturaLista(iniciaisConversas));
  const sigMensagens = useRef<string | null>(null);
  const sigLead = useRef<string | null>(null);
  const fimDaListaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca.trim()), DEBOUNCE_BUSCA_MS);
    return () => clearTimeout(t);
  }, [busca]);

  // ---------------------------------------------------------------
  // Lista de conversas
  // ---------------------------------------------------------------
  const carregaLista = useCallback(async () => {
    const params = new URLSearchParams({ client_db: cliente, faixa });
    if (buscaAtiva) params.set('busca', buscaAtiva);
    try {
      const r = await fetch(`/api/conversas?${params.toString()}`);
      const corpo = await r.json();
      if (!r.ok || !corpo?.ok) throw new Error(corpo?.erro || 'Erro ao carregar conversas.');
      const itens = corpo.data.itens as Conversa[];
      const assinatura = assinaturaLista(itens);
      if (assinatura !== sigLista.current) {
        sigLista.current = assinatura;
        setConversas(itens);
      }
      setErroLista(null);
    } catch (e) {
      setErroLista(e instanceof Error ? e.message : 'Falha ao carregar conversas.');
    }
  }, [cliente, faixa, buscaAtiva]);

  useEffect(() => {
    // Filtro ou busca mudaram: recarrega na hora. A atualização contínua
    // fica com o ciclo de espera longa, mais abaixo.
    sigLista.current = null;
    void carregaLista();
  }, [carregaLista]);

  // ---------------------------------------------------------------
  // Conversa aberta
  // ---------------------------------------------------------------
  const carregaThread = useCallback(
    async (customerId: number) => {
      try {
        const params = new URLSearchParams({
          client_db: cliente,
          customer_id: String(customerId),
        });
        const r = await fetch(`/api/conversas/thread?${params.toString()}`);
        const corpo = await r.json();
        if (!r.ok || !corpo?.ok) throw new Error(corpo?.erro || 'Erro ao carregar a conversa.');

        const lead = corpo.data.lead as LeadConversa;
        const mensagens = corpo.data.mensagens as MensagemWhatsapp[];
        const recebidoEm = Date.now();

        const sigM = assinaturaMensagens(mensagens);
        const sigL = assinaturaLead(lead);
        const mudouMensagem = sigM !== sigMensagens.current;
        const mudouLead = sigL !== sigLead.current;

        // A janela de 24h é recalculada a cada resposta, mesmo quando
        // nada mais mudou — é ela que libera ou bloqueia o envio.
        setThread((atual) =>
          !atual || mudouMensagem || mudouLead
            ? { lead, mensagens, recebidoEm }
            : { ...atual, lead, recebidoEm },
        );

        if (mudouLead) {
          sigLead.current = sigL;
          setForm(doFormulario(lead));
        }
        if (mudouMensagem) sigMensagens.current = sigM;
        setErroThread(null);
      } catch (e) {
        setErroThread(e instanceof Error ? e.message : 'Falha ao carregar a conversa.');
      }
    },
    [cliente],
  );

  useEffect(() => {
    if (selecionado === null) return;
    void carregaThread(selecionado);
  }, [selecionado, carregaThread]);

  // ---------------------------------------------------------------
  // Espera longa: é ela que faz a tela andar sozinha
  // ---------------------------------------------------------------

  // Os carregadores trocam de identidade a cada filtro digitado. Guardar
  // o mais recente em ref deixa o ciclo abaixo depender só do cliente e
  // da conversa aberta — sem isso, cada letra da busca derrubaria a
  // conexão pendurada e abriria outra.
  const refLista = useRef(carregaLista);
  const refThread = useRef(carregaThread);
  const refSelecionado = useRef(selecionado);
  useEffect(() => {
    refLista.current = carregaLista;
    refThread.current = carregaThread;
    refSelecionado.current = selecionado;
  }, [carregaLista, carregaThread, selecionado]);

  const ultimaCarga = useRef(0);
  const atualiza = useCallback(async (forcado = false) => {
    const quando = Date.now();
    if (!forcado && quando - ultimaCarga.current < MIN_ENTRE_CARGAS_MS) return;
    ultimaCarga.current = quando;
    const aberta = refSelecionado.current;
    await Promise.all([
      refLista.current(),
      aberta === null ? Promise.resolve() : refThread.current(aberta),
    ]);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    // O cursor mistura a lista com a conversa aberta: ao trocar de
    // conversa ele muda de formato, e o valor antigo acusaria uma
    // mudança que não houve.
    let cursor: string | null = null;
    let vivo = true;

    async function ciclo() {
      while (vivo) {
        await esperaVisivel(ctrl.signal);
        if (!vivo) return;
        try {
          const params = new URLSearchParams({ client_db: cliente });
          if (cursor !== null) params.set('cursor', cursor);
          if (selecionado !== null) params.set('customer_id', String(selecionado));
          const r = await fetch(`/api/conversas/novidades?${params.toString()}`, {
            signal: ctrl.signal,
          });
          const corpo = await r.json();
          if (!vivo) return;
          if (!r.ok || !corpo?.ok) throw new Error(corpo?.erro || 'Falha ao aguardar novidades.');
          const novo = String(corpo.data.cursor);
          const mudou = cursor !== null && novo !== cursor;
          cursor = novo;
          if (mudou) await atualiza(true);
        } catch {
          if (!vivo) return;
          // Rede caída, sessão expirada ou a função cortada no meio da
          // espera. A lista continua na tela; a próxima volta tenta de novo.
          await pausa(ESPERA_APOS_ERRO_MS);
        }
      }
    }
    void ciclo();

    // A aba em segundo plano não fica pendurada na espera, então voltar
    // para ela precisa recarregar na hora — é exatamente o caso em que a
    // tela parecia só atualizar com F5.
    const aoVoltar = () => {
      if (!document.hidden) void atualiza();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    window.addEventListener('online', aoVoltar);

    const seguranca = setInterval(aoVoltar, INTERVALO_SEGURANCA_MS);

    return () => {
      vivo = false;
      ctrl.abort();
      clearInterval(seguranca);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
      window.removeEventListener('online', aoVoltar);
    };
  }, [cliente, selecionado, atualiza]);

  // Rola para a última mensagem quando a conversa muda ou chega mensagem.
  useEffect(() => {
    fimDaListaRef.current?.scrollIntoView({ block: 'end' });
  }, [thread?.lead.customer_id, thread?.mensagens.length]);

  function selecionaConversa(customerId: number) {
    if (customerId === selecionado) return;
    setConfirmando(null);
    setRastreioAberto(false);
    sigMensagens.current = null;
    sigLead.current = null;
    setThread(null);
    setTexto('');
    setAviso(null);
    setErroThread(null);
    setSelecionado(customerId);
    // O badge some assim que a conversa abre; o servidor zera junto.
    setConversas((atual) =>
      atual.map((c) => (c.customer_id === customerId ? { ...c, unread_count: 0 } : c)),
    );
  }

  // ---------------------------------------------------------------
  // Janela de 24h
  // ---------------------------------------------------------------
  const fim = thread ? fimDaJanela(thread.lead.segundos_desde_inbound, thread.recebidoEm) : null;
  const janelaSeAplica = provider === 'cloud';
  const dentroDaJanela = !janelaSeAplica || (fim !== null && fim > agora);
  const horasRestantes = fim === null ? 0 : Math.max(0, Math.floor((fim - agora) / 3_600_000));

  async function envia() {
    if (!thread || !texto.trim() || enviando) return;
    setEnviando(true);
    setAviso(null);
    const r = await acaoEnviarMensagem({
      cliente,
      customer_id: thread.lead.customer_id,
      texto,
    });
    setEnviando(false);
    if (!r.ok) {
      setAviso({ tipo: 'erro', texto: r.erro });
      return;
    }
    setTexto('');
    await carregaThread(thread.lead.customer_id);
    await carregaLista();
  }

  function salva() {
    if (!thread) return;
    setAviso(null);
    const customerId = thread.lead.customer_id;
    iniciaSalvar(async () => {
      const r = await acaoSalvarLead({ cliente, customer_id: customerId, ...form });
      setAviso(r.ok ? { tipo: 'sucesso', texto: r.sucesso } : { tipo: 'erro', texto: r.erro });
      if (r.ok) {
        // Força a próxima resposta a reescrever o formulário com o que o
        // banco realmente gravou.
        sigLead.current = null;
        await carregaThread(customerId);
        await carregaLista();
      }
    });
  }

  function exclui() {
    if (!thread) return;
    setAviso(null);
    const customerId = thread.lead.customer_id;
    iniciaSalvar(async () => {
      const r = await acaoExcluirConversa({ cliente, customer_id: customerId });
      setConfirmando(null);
      if (!r.ok) {
        setAviso({ tipo: 'erro', texto: r.erro });
        return;
      }
      // A conversa não existe mais: fechar o painel antes de recarregar
      // evita o polling pedir uma thread recém-apagada.
      setSelecionado(null);
      setThread(null);
      sigMensagens.current = null;
      sigLead.current = null;
      sigLista.current = null;
      setConversas((atual) => atual.filter((c) => c.customer_id !== customerId));
      await carregaLista();
    });
  }

  function excluiLead() {
    if (!thread) return;
    setAviso(null);
    const customerId = thread.lead.customer_id;
    iniciaSalvar(async () => {
      const r = await acaoExcluirLead({ cliente, customer_id: customerId });
      setConfirmando(null);
      if (!r.ok) {
        setAviso({ tipo: 'erro', texto: r.erro });
        return;
      }
      // Mesmo cuidado da exclusão de conversa: fechar o painel antes de
      // recarregar evita o polling pedir uma thread recém-apagada.
      setSelecionado(null);
      setThread(null);
      sigMensagens.current = null;
      sigLead.current = null;
      sigLista.current = null;
      setConversas((atual) => atual.filter((c) => c.customer_id !== customerId));
      await carregaLista();
    });
  }

  const opcoesEstagio = estagios.includes(form.status) ? estagios : [form.status, ...estagios];

  return (
    <div className="crm-shell">
      {/* Coluna 1 — lista */}
      <div className="crm-col crm-col-list">
        <div className="crm-list-head">
          <div className="search-inline">
            <IconesNav.busca />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
            />
          </div>
          <div className="crm-status-tabs">
            {FAIXAS.map((f) => (
              <button
                key={f.valor}
                type="button"
                onClick={() => setFaixa(f.valor)}
                className={`crm-status-tab${faixa === f.valor ? ' active' : ''}`}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
        </div>

        {erroLista ? <p className="crm-thread-window-warning">{erroLista}</p> : null}

        <ul className="crm-list">
          {conversas.length === 0 ? (
            <li className="crm-thread-empty">Nenhuma conversa encontrada.</li>
          ) : null}
          {conversas.map((c) => {
            const nome = nomeExibicao(c.first_name, c.last_name, c.phone);
            const ativo = c.customer_id === selecionado;
            return (
              <li key={c.customer_id}>
                <button
                  type="button"
                  onClick={() => selecionaConversa(c.customer_id)}
                  aria-current={ativo ? 'true' : undefined}
                  className={`crm-list-item${ativo ? ' active' : ''}`}
                >
                  <span className="avatar-circle">{iniciais(nome)}</span>
                  <span className="crm-list-item-body">
                    <span className="crm-list-item-top">
                      <span className="crm-list-item-name">{nome}</span>
                      <span
                        className="crm-list-item-time"
                        title={c.last_message_at ? fmtDataHora(c.last_message_at) : undefined}
                      >
                        {fmtHoraRelativa(c.last_message_at)}
                      </span>
                    </span>
                    <span className="crm-list-item-preview">
                      {c.ultima_mensagem_direcao === 'outbound' ? 'Você: ' : ''}
                      {textoDaMensagem(c.ultima_mensagem_tipo, c.ultima_mensagem) || '—'}
                    </span>
                    <span className="crm-list-item-top" style={{ marginTop: 4 }}>
                      {(c.status ?? '').trim() ? (
                        <span className="crm-list-item-estagio" title="Estágio do funil">
                          {rotuloEstagio(c.status)}
                        </span>
                      ) : (
                        <span />
                      )}
                      {c.unread_count > 0 ? (
                        <span className="crm-unread-badge">{c.unread_count}</span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Coluna 2 — conversa */}
      <div className="crm-col crm-col-thread">
        {!thread ? (
          <div className="crm-thread-empty">
            <IconesNav.conversas width={28} height={28} />
            <span>{erroThread ?? 'Selecione uma conversa à esquerda para ver o histórico.'}</span>
          </div>
        ) : (
          <>
            <div className="crm-thread-head">
              <div>
                <div className="text-body-medium">
                  {nomeExibicao(thread.lead.first_name, thread.lead.last_name, thread.lead.phone)}
                </div>
                <div className="text-body-small text-tertiary">
                  {thread.lead.phone ?? 'sem telefone'} · {rotuloEstagio(thread.lead.status)}
                </div>
              </div>
            </div>

            <div className="crm-thread-messages">
              {thread.mensagens.length === 0 ? (
                <p className="text-body-small text-tertiary">Nenhuma mensagem nesta conversa.</p>
              ) : null}
              {thread.mensagens.map((m) => {
                const saiu = m.direction === 'outbound';
                return (
                  <div
                    key={m.id}
                    className={`crm-bubble-row ${saiu ? 'outbound' : 'inbound'}`}
                  >
                    <div className="crm-bubble">
                      <Anexo cliente={cliente} customerId={thread.lead.customer_id} msg={m} />
                      {textoDaBolha(m)}
                      <span className="crm-bubble-time">{fmtDataHora(m.created_at)}</span>
                    </div>
                  </div>
                );
              })}
              <div ref={fimDaListaRef} />
            </div>

            {dentroDaJanela ? null : (
              <p className="crm-thread-window-warning">
                Fora da janela de 24h da Meta: só é possível enviar mensagens livres até 24h após
                a última mensagem do lead. Envio por template não está disponível nesta versão.
              </p>
            )}

            {aviso ? (
              <p
                role="alert"
                className={
                  aviso.tipo === 'erro'
                    ? 'crm-thread-window-warning'
                    : 'crm-thread-window-warning crm-thread-ok'
                }
              >
                {aviso.texto}
              </p>
            ) : null}

            <div className={`crm-thread-compose${dentroDaJanela ? '' : ' disabled'}`}>
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void envia();
                  }
                }}
                disabled={!dentroDaJanela || enviando}
                rows={1}
                placeholder={
                  dentroDaJanela ? 'Digite uma mensagem...' : 'Janela de 24h encerrada'
                }
              />
              <button
                type="button"
                onClick={() => void envia()}
                disabled={!dentroDaJanela || enviando || !texto.trim()}
                className="btn btn-primary"
              >
                {enviando ? 'Enviando…' : 'Enviar'}
              </button>
            </div>

            {janelaSeAplica && dentroDaJanela ? (
              <p className="crm-janela-restante">
                Restam cerca de {horasRestantes}h na janela de resposta livre.
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Coluna 3 — lead */}
      <div className="crm-col crm-col-lead">
        {!thread ? (
          <div className="crm-thread-empty">
            <span>Selecione uma conversa para ver os dados do lead.</span>
          </div>
        ) : (
          <>
            <h3>Dados do lead</h3>

            <div className="crm-field">
              <label htmlFor="leadNome">Nome</label>
              <input
                id="leadNome"
                type="text"
                className="field"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              />
            </div>

            <div className="crm-field">
              <label htmlFor="leadEmail">Email</label>
              <input
                id="leadEmail"
                type="text"
                className="field"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>

            <div className="crm-field">
              <label htmlFor="leadStatus">Status</label>
              <select
                id="leadStatus"
                className="field"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {opcoesEstagio.map((e) => (
                  <option key={e} value={e}>
                    {rotuloEstagio(e)}
                  </option>
                ))}
              </select>
              <span className="crm-field-hint">
                Mudar o estágio dispara o evento configurado em “Estágios e eventos”.
              </span>
            </div>

            {/* O motivo só faz sentido no estágio de perda, e é dele que
                sai o ranking da tela de Funil. Fica em branco quando
                ninguém quis dizer — o funil conta como sem motivo. */}
            {ehEtapaDePerda(form.status) ? (
              <div className="crm-field">
                <label htmlFor="leadMotivoPerda">Motivo da perda</label>
                <input
                  id="leadMotivoPerda"
                  type="text"
                  className="field"
                  list="conversasMotivosSugeridos"
                  placeholder="Escolha ou escreva"
                  maxLength={TAMANHO_MOTIVO}
                  value={form.motivo_perda}
                  onChange={(e) => setForm({ ...form, motivo_perda: e.target.value })}
                />
                <datalist id="conversasMotivosSugeridos">
                  {MOTIVOS_PERDA_SUGERIDOS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <span className="crm-field-hint">
                  Gravado ao salvar. Em branco, o funil conta como “sem motivo registrado”.
                </span>
              </div>
            ) : null}

            <div className="crm-field">
              <label htmlFor="leadNotas">Notas</label>
              <textarea
                id="leadNotas"
                rows={4}
                className="field crm-textarea"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <div className="crm-field">
              <label htmlFor="leadTags">Tags</label>
              <input
                id="leadTags"
                type="text"
                className="field"
                placeholder="Separadas por vírgula"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
              />
            </div>

            <button
              type="button"
              onClick={salva}
              disabled={salvando}
              className="btn btn-primary btn-sm"
              style={{ width: '100%' }}
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>

            <div className="crm-lead-origem">
              <h4>Origem do Anúncio</h4>
              <div className="crm-field">
                <label>Ad ID</label>
                <div className="crm-readonly">{thread.lead.referral_ad_id ?? '—'}</div>
              </div>
              <div className="crm-field">
                <label>Click ID (ctwa_clid)</label>
                <div className="crm-readonly">{thread.lead.referral_ctwa_clid ?? '—'}</div>
              </div>
              {/* Aqui ficam os identificadores crus; nome de campanha,
                  conjunto, anúncio e os eventos já enviados moram no modal
                  de rastreio, que é o mesmo da tela "Rastreamento". */}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setRastreioAberto(true)}
                >
                  Ver rastreio completo
                </button>
                <Link
                  href={`/app/${encodeURIComponent(cliente)}/whatsapp/crm?lead=${thread.lead.customer_id}`}
                  className="btn btn-secondary btn-sm"
                >
                  Ver no CRM
                </Link>
              </div>
            </div>

            {podeExcluir ? (
              <div className="crm-lead-origem">
                <h4>Área do administrador</h4>
                {confirmando === 'conversa' ? (
                  <div className="space-y-2">
                    <p className="text-body-small text-tertiary">
                      Apagar todas as mensagens desta conversa e o estado dela? O lead e os
                      eventos já enviados à Meta continuam no banco. Não há como desfazer.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={salvando}
                        onClick={exclui}
                      >
                        Confirmar exclusão
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={salvando}
                        onClick={() => setConfirmando(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : confirmando === 'lead' ? (
                  <div className="space-y-2">
                    <p className="text-body-small text-tertiary">
                      Apagar o lead inteiro? Saem as mensagens, os arquivos, o estado da
                      conversa, os eventos enviados à Meta e o próprio contato. O que já foi
                      recebido pela Meta continua lá — some daqui, não de lá. Não há como
                      desfazer.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={salvando}
                        onClick={excluiLead}
                      >
                        Confirmar exclusão do lead
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={salvando}
                        onClick={() => setConfirmando(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={salvando}
                      onClick={() => setConfirmando('conversa')}
                    >
                      Excluir conversa
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={salvando}
                      onClick={() => setConfirmando('lead')}
                    >
                      Excluir lead
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            <div className="crm-lead-origem">
              <h4>Classificação por IA</h4>
              <div className="crm-field">
                <label>Última análise</label>
                <div className="crm-readonly">
                  {thread.lead.ai_last_analyzed_at
                    ? fmtDataHora(thread.lead.ai_last_analyzed_at)
                    : '—'}
                </div>
              </div>
              <div className="crm-field">
                <label>Estágio sugerido</label>
                <div className="crm-readonly">
                  {rotuloEstagio(thread.lead.ai_last_classification)}
                </div>
              </div>
              <div className="crm-field">
                <label>
                  Valor identificado{' '}
                  <Dica texto="Valor que a IA leu nas próprias mensagens da conversa. Quando existe, é ele que vai como valor do evento enviado à Meta, no lugar do valor fixo cadastrado em Configuração de Eventos." />
                </label>
                <div className="crm-readonly">{valorDaIA(thread.lead.ai_last_value)}</div>
              </div>
              <div className="crm-field">
                <label>Motivo</label>
                <div className="crm-readonly">{thread.lead.ai_last_reason ?? '—'}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {rastreioAberto && thread ? (
        <ModalRastreio
          cliente={cliente}
          customerId={thread.lead.customer_id}
          nomeInicial={nomeExibicao(thread.lead.first_name, thread.lead.last_name, thread.lead.phone)}
          aoFechar={() => setRastreioAberto(false)}
        />
      ) : null}
    </div>
  );
}
