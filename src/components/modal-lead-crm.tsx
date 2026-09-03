'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { DetalheLeadCrm } from '@/lib/db/crm';
import type { CartaoCrm } from '@/lib/crm';
import {
  CLASSE_ORIGEM,
  DESCRICAO_ORIGEM,
  ROTULO_ORIGEM,
  chaveColuna,
  nomeDoCartao,
  valorDigitado,
} from '@/lib/crm';
import { acaoMoverLeadCrm, acaoSalvarValorLead } from '@/lib/acoes/crm';
import { acaoExcluirLead } from '@/lib/acoes/leads';
import { ehEtapaDePerda, MOTIVOS_PERDA_SUGERIDOS, TAMANHO_MOTIVO } from '@/lib/funil';
import { textoDaMensagem } from '@/lib/whatsapp-conversas';
import { fmtBRL, fmtDataHora, ouTraco } from '@/lib/format';
import { telefoneParaExibir } from '@/lib/exibicao';

/**
 * Modal do lead no CRM: só leitura, com uma exceção.
 *
 * Nome, e-mail, tags e notas não são editáveis aqui: quem manda nesses
 * campos é o CRM do cliente, e um formulário no painel criaria duas
 * versões do mesmo lead — a daqui e a de lá — sem dizer qual vale.
 *
 * A etapa continua editável em contato de WhatsApp, porque esse funil é
 * do painel e não existe no CRM do cliente. A do lead de formulário é
 * espelho do CRM e por isso segue somente leitura.
 *
 * As mensagens aqui são prévia (últimas 8, sem mídia e sem envio). Para
 * responder, o caminho é a tela de Conversas, que já faz isso com a
 * checagem da janela de 24h.
 */

type Aviso = { tipo: 'ok' | 'erro'; texto: string };

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h4 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-tertiary)] uppercase">
        {titulo}
      </h4>
      {children}
    </section>
  );
}

function Linha({ rotulo, valor, mono = false }: { rotulo: string; valor: React.ReactNode; mono?: boolean }) {
  const vazio = valor === null || valor === undefined || valor === '';
  return (
    <div className="rastreio-linha">
      <dt>{rotulo}</dt>
      <dd className={mono && !vazio ? 'font-mono text-[12px] break-all' : undefined}>
        {vazio ? <span className="text-[var(--text-tertiary)]">-</span> : valor}
      </dd>
    </div>
  );
}

export function ModalLeadCrm({
  cliente,
  cartao,
  aoFechar,
  aoAtualizar,
  aoExcluir,
  podeExcluir = false,
}: {
  cliente: string;
  cartao: CartaoCrm;
  aoFechar: () => void;
  /** Reflete no quadro o que foi editado aqui, sem recarregar a tela. */
  aoAtualizar: (mudanca: Partial<CartaoCrm> & { id: number }) => void;
  /** Tira o card do quadro depois que o lead foi apagado no banco. */
  aoExcluir: (id: number) => void;
  /**
   * Sessão de administrador. Só controla o que o modal mostra — quem
   * recusa a exclusão de fato é `acaoExcluirLead`, no servidor.
   */
  podeExcluir?: boolean;
}) {
  const [lead, setLead] = useState<DetalheLeadCrm | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [movendo, setMovendo] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [valor, setValor] = useState('');
  const [salvandoValor, setSalvandoValor] = useState(false);

  // Mandar para "perdido" não move na hora: primeiro pergunta o motivo.
  // Sem essa pausa o motivo nunca seria registrado — e é dele que sai o
  // ranking da tela de Funil.
  const [etapaPendente, setEtapaPendente] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    const fecharComEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    document.addEventListener('keydown', fecharComEsc);
    return () => document.removeEventListener('keydown', fecharComEsc);
  }, [aoFechar]);

  useEffect(() => {
    let ativo = true;
    const params = new URLSearchParams({
      client_db: cliente,
      customer_id: String(cartao.id),
    });
    fetch(`/api/crm/lead?${params.toString()}`)
      .then(async (r) => {
        const corpo = await r.json();
        if (!r.ok || !corpo?.ok) throw new Error(corpo?.erro || 'Erro ao carregar o lead.');
        return corpo.data.lead as DetalheLeadCrm;
      })
      .then((d) => {
        if (!ativo) return;
        setLead(d);
        setValor(d.crm_value == null ? '' : String(d.crm_value));
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
      });
    return () => {
      ativo = false;
    };
  }, [cliente, cartao.id]);

  const nome = lead ? nomeDoCartao(lead) : nomeDoCartao(cartao);

  async function excluir() {
    if (!lead) return;
    setExcluindo(true);
    setAviso(null);
    const r = await acaoExcluirLead({ cliente, customer_id: lead.id });
    setExcluindo(false);
    if (!r.ok) {
      setConfirmandoExclusao(false);
      setAviso({ tipo: 'erro', texto: r.erro });
      return;
    }
    // O card não pode continuar no quadro apontando para um lead que não
    // existe mais: sai do quadro e o modal fecha junto.
    aoExcluir(lead.id);
    aoFechar();
  }

  async function salvaValor() {
    if (!lead) return;
    const numero = valorDigitado(valor);
    if (numero === null) {
      setAviso({ tipo: 'erro', texto: 'Valor inválido. Use apenas números, como 11210,00.' });
      return;
    }
    setSalvandoValor(true);
    setAviso(null);
    const r = await acaoSalvarValorLead({ cliente, customer_id: lead.id, valor: numero });
    setSalvandoValor(false);
    if (!r.ok) {
      setAviso({ tipo: 'erro', texto: r.erro });
      return;
    }
    setAviso({ tipo: 'ok', texto: r.sucesso });
    setLead({ ...lead, crm_value: numero });
  }

  async function mudaEtapa(etapa: string, motivoPerda: string | null = null) {
    // Mesma etapa é recusada, exceto quando o que mudou é o motivo: o
    // servidor não redispara evento para etapa igual, então reescrever o
    // motivo é seguro.
    if (!lead || !etapa || (etapa === lead.etapa_whatsapp && motivoPerda === null)) return;
    setMovendo(true);
    setAviso(null);
    const r = await acaoMoverLeadCrm({
      cliente,
      customer_id: lead.id,
      etapa,
      ...(motivoPerda === null ? {} : { motivo_perda: motivoPerda }),
    });
    setMovendo(false);
    if (r.ok) {
      const rotulo = lead.etapas_whatsapp.find((e) => e.valor === etapa)?.rotulo ?? etapa;
      setAviso({ tipo: 'ok', texto: r.sucesso });
      setEtapaPendente(null);
      setLead({
        ...lead,
        etapa_whatsapp: etapa,
        motivo_perda: ehEtapaDePerda(etapa) ? motivoPerda : null,
      });
      aoAtualizar({
        id: lead.id,
        etapa,
        etapa_rotulo: rotulo,
        chave_coluna: chaveColuna('whatsapp', etapa),
      });
    } else {
      setAviso({ tipo: 'erro', texto: r.erro });
    }
  }

  const origem = lead?.origem ?? cartao.origem;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={`Lead ${nome}`}>
        <header className="modal-head">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold">{nome}</h3>
            <p className="truncate text-body-small text-tertiary">
              <span className={`origem-tag ${CLASSE_ORIGEM[origem]}`}>{ROTULO_ORIGEM[origem]}</span>{' '}
              {lead?.phone ? `· ${telefoneParaExibir(lead.phone)}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="rounded-[var(--radius-control)] px-2 py-1 text-lg leading-none text-[var(--text-secondary)] hover:bg-[var(--bg-field)]"
          >
            ×
          </button>
        </header>

        <div className="modal-body">
          {erro ? (
            <p className="rounded-[var(--radius-control)] bg-[var(--red-50)] px-3 py-2 text-sm text-[var(--red-700)]">
              {erro}
            </p>
          ) : !lead ? (
            <p className="text-body-small text-tertiary">Carregando…</p>
          ) : (
            <>
              {aviso ? (
                <p
                  role="status"
                  className={
                    aviso.tipo === 'ok'
                      ? 'mb-3 rounded-[var(--radius-control)] bg-[var(--green-50)] px-3 py-2 text-sm text-[var(--green-700)]'
                      : 'mb-3 rounded-[var(--radius-control)] bg-[var(--red-50)] px-3 py-2 text-sm text-[var(--red-700)]'
                  }
                >
                  {aviso.texto}
                </p>
              ) : null}

              {lead.lacunas_de_esquema.length ? (
                <p className="mb-3 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  O banco deste cliente está atrás do template. Falta:{' '}
                  <strong>{lead.lacunas_de_esquema.join(', ')}</strong>. Os campos que dependem
                  dessas tabelas aparecem vazios.
                </p>
              ) : null}

              <Secao titulo="Origem">
                <dl className="rastreio-lista">
                  <Linha rotulo="Tipo de contato" valor={DESCRICAO_ORIGEM[origem]} />
                  <Linha rotulo="Entrou em" valor={fmtDataHora(lead.created_at)} />
                  <Linha rotulo="Campanha" valor={ouTraco(lead.campanha)} />
                  <Linha rotulo="Conjunto" valor={ouTraco(lead.conjunto)} />
                  <Linha rotulo="Anúncio" valor={ouTraco(lead.anuncio)} />
                  <Linha rotulo="utm_source" valor={ouTraco(lead.utm_source)} mono />
                  <Linha rotulo="utm_campaign" valor={ouTraco(lead.utm_campaign)} mono />
                  <Linha rotulo="meta_lead_id" valor={ouTraco(lead.meta_lead_id)} mono />
                  <Linha rotulo="ctwa_clid" valor={ouTraco(lead.ctwa_clid)} mono />
                </dl>
              </Secao>

              <Secao titulo="Etapa">
                {origem === 'whatsapp' ? (
                  <>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-tertiary)]" htmlFor="crm-etapa">
                      Etapa no funil de WhatsApp
                    </label>
                    <select
                      id="crm-etapa"
                      className="field"
                      value={etapaPendente ?? lead.etapa_whatsapp ?? ''}
                      disabled={movendo || lead.etapas_whatsapp.length === 0}
                      onChange={(e) => {
                        const destino = e.target.value;
                        if (ehEtapaDePerda(destino)) {
                          setEtapaPendente(destino);
                          setMotivo(lead.motivo_perda ?? '');
                          return;
                        }
                        setEtapaPendente(null);
                        void mudaEtapa(destino);
                      }}
                    >
                      <option value="">Sem etapa</option>
                      {lead.etapas_whatsapp.map((e) => (
                        <option key={e.valor} value={e.valor}>
                          {e.rotulo}
                        </option>
                      ))}
                    </select>
                    {etapaPendente ? (
                      <CampoMotivo
                        motivo={motivo}
                        sugestoes={lead.motivos_usados}
                        ocupado={movendo}
                        aoMudar={setMotivo}
                        aoConfirmar={() => void mudaEtapa(etapaPendente, motivo)}
                        aoCancelar={() => setEtapaPendente(null)}
                      />
                    ) : ehEtapaDePerda(lead.etapa_whatsapp) ? (
                      <p className="mt-2 text-body-small text-tertiary">
                        Motivo da perda: <strong>{lead.motivo_perda || 'não registrado'}</strong>{' '}
                        <button
                          type="button"
                          className="text-[var(--brand)] underline underline-offset-2"
                          onClick={() => {
                            setEtapaPendente(lead.etapa_whatsapp);
                            setMotivo(lead.motivo_perda ?? '');
                          }}
                        >
                          alterar
                        </button>
                      </p>
                    ) : null}

                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                      Mudar a etapa aqui vale o mesmo que arrastar o card: se a etapa tiver
                      evento cadastrado, ele é enviado à Meta.
                    </p>
                  </>
                ) : (
                  <dl className="rastreio-lista">
                    <Linha rotulo="Etapa no CRM" valor={ouTraco(lead.etapa_form)} />
                    <Linha
                      rotulo="Quem escreve"
                      valor="O CRM do cliente, pela automação. Por isso o card não arrasta e a etapa não é editável aqui."
                    />
                  </dl>
                )}
              </Secao>

              <Secao titulo="Valor do negócio">
                <label
                  className="mb-1 block text-xs font-medium text-[var(--text-tertiary)]"
                  htmlFor="crm-valor"
                >
                  Valor fechado (R$)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="crm-valor"
                    className="field max-w-[200px]"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={valor}
                    disabled={salvandoValor}
                    onChange={(e) => setValor(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void salvaValor();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={salvandoValor}
                    onClick={() => void salvaValor()}
                  >
                    {salvandoValor ? 'Salvando…' : 'Salvar valor'}
                  </button>
                  {lead.crm_value ? (
                    <span className="text-body-small text-tertiary">
                      Salvo: {fmtBRL(lead.crm_value)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                  A automação preenche isto com o valor do negócio no CRM. Editar aqui
                  substitui o número e entra na receita e no ROAS do painel. Nada é reenviado
                  à Meta: o que ela já recebeu foi contado lá.
                </p>
              </Secao>

              <Secao titulo="Dados do lead">
                <dl className="rastreio-lista">
                  <Linha rotulo="Nome" valor={ouTraco(lead.first_name)} />
                  <Linha rotulo="Sobrenome" valor={ouTraco(lead.last_name)} />
                  <Linha rotulo="E-mail" valor={ouTraco(lead.email)} />
                  <Linha
                    rotulo="Telefone"
                    valor={lead.phone ? telefoneParaExibir(lead.phone) : ''}
                  />
                  <Linha rotulo="Tags" valor={ouTraco(lead.tags)} />
                  <Linha rotulo="Notas" valor={ouTraco(lead.notes)} />
                </dl>
                <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                  Estes campos vêm do CRM e não são editáveis por aqui.
                </p>
              </Secao>

              <Secao titulo="Conversa">
                {lead.tem_conversa ? (
                  <>
                    <p className="mb-2 text-body-small text-tertiary">
                      Últimas mensagens · última em {fmtDataHora(lead.ultima_mensagem_em)}
                    </p>
                    <ul className="space-y-1">
                      {lead.mensagens.map((m) => (
                        <li
                          key={m.id}
                          className="rounded-[var(--radius-control)] bg-[var(--bg-field)] px-2 py-1 text-sm"
                        >
                          <span className="text-[var(--text-tertiary)]">
                            {m.direction === 'inbound' ? 'Lead' : 'Você'} ·{' '}
                            {fmtDataHora(m.created_at)}
                          </span>
                          <br />
                          {textoDaMensagem(m.message_type, m.message_text) || '-'}
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={`/app/${encodeURIComponent(cliente)}/whatsapp/conversas?lead=${lead.id}`}
                      className="mt-2 inline-block text-sm text-[var(--brand)] underline underline-offset-2"
                    >
                      Abrir na tela de Conversas para responder
                    </Link>
                  </>
                ) : (
                  <p className="text-body-small text-tertiary">
                    Este contato não tem conversa de WhatsApp registrada.
                  </p>
                )}
              </Secao>

              {podeExcluir ? (
                <Secao titulo="Área do administrador">
                  {confirmandoExclusao ? (
                    <div className="space-y-2">
                      <p className="text-body-small text-tertiary">
                        Apagar o lead inteiro? Saem as mensagens, os arquivos, o estado da
                        conversa, os eventos enviados à Meta e o próprio contato. O que já foi
                        recebido pela Meta continua lá: some daqui, não de lá. Não há como
                        desfazer.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={excluindo}
                          onClick={excluir}
                        >
                          {excluindo ? 'Excluindo...' : 'Confirmar exclusão do lead'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={excluindo}
                          onClick={() => setConfirmandoExclusao(false)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => setConfirmandoExclusao(true)}
                    >
                      Excluir lead
                    </button>
                  )}
                </Secao>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Campo de motivo da perda: lista fixa de sugestões mais o que este
 * cliente já usou, e texto livre por cima — o motivo real raramente cabe
 * numa lista fechada, e uma tabela de catálogo com tela de cadastro
 * seria configuração demais para um campo de uma linha.
 */
function CampoMotivo({
  motivo,
  sugestoes,
  ocupado,
  aoMudar,
  aoConfirmar,
  aoCancelar,
}: {
  motivo: string;
  sugestoes: string[];
  ocupado: boolean;
  aoMudar: (v: string) => void;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  const opcoes = Array.from(new Set([...sugestoes, ...MOTIVOS_PERDA_SUGERIDOS]));
  return (
    <div className="mt-2 rounded-[var(--radius-control)] border border-[var(--border)] p-3">
      <label
        className="mb-1 block text-xs font-medium text-[var(--text-tertiary)]"
        htmlFor="crm-motivo"
      >
        Por que este lead foi perdido?
      </label>
      <input
        id="crm-motivo"
        className="field"
        list="crm-motivos-sugeridos"
        placeholder="Escolha ou escreva"
        value={motivo}
        maxLength={TAMANHO_MOTIVO}
        autoFocus
        onChange={(e) => aoMudar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            aoConfirmar();
          }
        }}
      />
      <datalist id="crm-motivos-sugeridos">
        {opcoes.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={ocupado} onClick={aoConfirmar}>
          {ocupado ? 'Movendo…' : 'Marcar como perdido'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={ocupado} onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--text-tertiary)]">
        Pode ficar em branco, o funil conta como &ldquo;sem motivo registrado&rdquo;.
      </p>
    </div>
  );
}

