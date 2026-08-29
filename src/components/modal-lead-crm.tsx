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
} from '@/lib/crm';
import { acaoMoverLeadCrm, acaoSalvarLeadCrm } from '@/lib/acoes/crm';
import { ehEtapaDePerda, MOTIVOS_PERDA_SUGERIDOS, TAMANHO_MOTIVO } from '@/lib/funil';
import { textoDaMensagem } from '@/lib/whatsapp-conversas';
import { fmtDataHora, ouTraco } from '@/lib/format';

/**
 * Modal do lead no CRM: ver tudo e editar o que é do painel.
 *
 * As duas edições não são a mesma coisa e por isso não compartilham
 * botão: mudar a etapa pode disparar evento para a Meta, salvar nome ou
 * nota nunca dispara. A etapa só é editável em contato de WhatsApp —
 * a do lead de formulário é espelho do CRM do cliente.
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
        {vazio ? <span className="text-[var(--text-tertiary)]">—</span> : valor}
      </dd>
    </div>
  );
}

export function ModalLeadCrm({
  cliente,
  cartao,
  aoFechar,
  aoAtualizar,
}: {
  cliente: string;
  cartao: CartaoCrm;
  aoFechar: () => void;
  /** Reflete no quadro o que foi editado aqui, sem recarregar a tela. */
  aoAtualizar: (mudanca: Partial<CartaoCrm> & { id: number }) => void;
}) {
  const [lead, setLead] = useState<DetalheLeadCrm | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [movendo, setMovendo] = useState(false);

  // Mandar para "perdido" não move na hora: primeiro pergunta o motivo.
  // Sem essa pausa o motivo nunca seria registrado — e é dele que sai o
  // ranking da tela de Funil.
  const [etapaPendente, setEtapaPendente] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    notes: '',
    tags: '',
  });

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
        setForm({
          first_name: d.first_name ?? '',
          last_name: d.last_name ?? '',
          email: d.email ?? '',
          notes: d.notes ?? '',
          tags: d.tags ?? '',
        });
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
      });
    return () => {
      ativo = false;
    };
  }, [cliente, cartao.id]);

  const nome = lead ? nomeDoCartao(lead) : nomeDoCartao(cartao);

  async function salvar() {
    if (!lead) return;
    setSalvando(true);
    setAviso(null);
    const r = await acaoSalvarLeadCrm({
      cliente,
      customer_id: lead.id,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      notes: form.notes,
      tags: form.tags.trim(),
      tem_conversa: lead.tem_conversa,
    });
    setSalvando(false);
    if (r.ok) {
      setAviso({ tipo: 'ok', texto: r.sucesso });
      setLead({
        ...lead,
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
        tags: form.tags.trim() || null,
      });
      aoAtualizar({
        id: lead.id,
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        email: form.email.trim() || null,
        tags: form.tags.trim() || null,
      });
    } else {
      setAviso({ tipo: 'erro', texto: r.erro });
    }
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
              {lead?.phone ? `· ${lead.phone}` : ''}
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
                  O banco deste cliente está atrás do template — falta:{' '}
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

              <Secao titulo="Dados do lead">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-tertiary)]" htmlFor="crm-nome">
                      Nome
                    </label>
                    <input
                      id="crm-nome"
                      className="field"
                      value={form.first_name}
                      maxLength={120}
                      onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-tertiary)]" htmlFor="crm-sobrenome">
                      Sobrenome
                    </label>
                    <input
                      id="crm-sobrenome"
                      className="field"
                      value={form.last_name}
                      maxLength={120}
                      onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-medium text-[var(--text-tertiary)]" htmlFor="crm-email">
                    E-mail
                  </label>
                  <input
                    id="crm-email"
                    className="field"
                    type="email"
                    value={form.email}
                    maxLength={190}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-medium text-[var(--text-tertiary)]" htmlFor="crm-tags">
                    Tags
                  </label>
                  <input
                    id="crm-tags"
                    className="field"
                    placeholder="separadas por vírgula"
                    value={form.tags}
                    maxLength={500}
                    onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  />
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-medium text-[var(--text-tertiary)]" htmlFor="crm-notas">
                    Notas
                  </label>
                  <textarea
                    id="crm-notas"
                    className="field"
                    rows={4}
                    value={form.notes}
                    maxLength={10000}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={salvando}
                    onClick={() => void salvar()}
                  >
                    {salvando ? 'Salvando…' : 'Salvar dados'}
                  </button>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    Salvar não envia evento para a Meta.
                  </span>
                </div>
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
                          {textoDaMensagem(m.message_type, m.message_text) || '—'}
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
        Pode ficar em branco — o funil conta como &ldquo;sem motivo registrado&rdquo;.
      </p>
    </div>
  );
}
