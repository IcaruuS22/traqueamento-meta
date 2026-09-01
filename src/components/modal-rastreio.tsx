'use client';

import { useEffect, useState } from 'react';
import type { RastreioContato } from '@/lib/db/rastreamento';
import {
  CLASSE_CONFIANCA,
  CLASSE_FONTE,
  DESCRICAO_FONTE,
  DICA_CONFIANCA,
  ROTULO_CONFIANCA,
  ROTULO_FONTE,
  linkAdsManager,
  metodoDeCaptura,
} from '@/lib/rastreamento';
import { fmtBRL, fmtDataHora, ouTraco } from '@/lib/format';
import { Dica } from './dica';
import { nomeParaExibir, telefoneParaExibir } from '@/lib/exibicao';

/**
 * Modal "Rastreio do contato" — tudo o que se sabe sobre a origem de um lead.
 *
 * O conteúdo é carregado ao abrir, não junto com a tabela: são três
 * consultas por lead e a tabela lista 30 por página. Enquanto carrega, o
 * modal já mostra o nome — o usuário clicou naquele contato e precisa
 * saber que abriu o certo.
 *
 * Campo vazio aparece como "—" e não some da lista: a ausência de
 * `ctwa_clid` num lead que deveria ter é justamente o que essa tela
 * existe para revelar.
 */

const PROVEDOR: Record<string, string> = {
  cloud: 'WhatsApp Cloud API (Meta)',
  evolution: 'Evolution API',
};

type Resposta = {
  contato: RastreioContato;
  conta: { waba_id: string | null; phone_number_id: string | null; provider: string | null };
};

function nomeDoLead(c: { first_name: string | null; last_name: string | null; email: string | null }) {
  const nome = nomeParaExibir(c.first_name, c.last_name);
  return nome || String(c.email ?? '').trim() || 'Contato sem nome';
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h4 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-tertiary)] uppercase">
        {titulo}
      </h4>
      <dl className="rastreio-lista">{children}</dl>
    </section>
  );
}

function Linha({
  rotulo,
  valor,
  mono = false,
  href,
}: {
  rotulo: string;
  valor: React.ReactNode;
  mono?: boolean;
  href?: string | null;
}) {
  const vazio = valor === null || valor === undefined || valor === '';
  return (
    <div className="rastreio-linha">
      <dt>{rotulo}</dt>
      <dd className={mono && !vazio ? 'font-mono text-[12px] break-all' : undefined}>
        {vazio ? (
          <span className="text-[var(--text-tertiary)]">—</span>
        ) : href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[var(--brand)] underline underline-offset-2"
          >
            {valor}
          </a>
        ) : (
          valor
        )}
      </dd>
    </div>
  );
}

function valorDoEvento(v: string | number | null, moeda: string | null): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  return moeda && moeda !== 'BRL'
    ? `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moeda}`
    : fmtBRL(n);
}

/**
 * Nome da etapa do CRM.
 *
 * O SQL já traduz o status_id do Kommo pelo `crm_meta_event_map`; o que
 * sobra sem tradução é o marcador que a ingestão do WhatsApp grava em
 * contatos que ainda não entraram no funil.
 */
function rotuloEtapa(valor: string | null): string {
  if (valor === 'whatsapp_contact') return 'Contato por WhatsApp (fora do funil)';
  return ouTraco(valor);
}

export function ModalRastreio({
  cliente,
  customerId,
  nomeInicial,
  aoFechar,
}: {
  cliente: string;
  customerId: number;
  nomeInicial: string;
  aoFechar: () => void;
}) {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

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
      customer_id: String(customerId),
    });
    fetch(`/api/rastreamento/contato?${params.toString()}`)
      .then(async (r) => {
        const corpo = await r.json();
        if (!r.ok || !corpo?.ok) throw new Error(corpo?.erro || 'Erro ao carregar o rastreio.');
        return corpo.data as Resposta;
      })
      .then((d) => {
        if (ativo) setDados(d);
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
      });
    return () => {
      ativo = false;
    };
  }, [cliente, customerId]);

  const c = dados?.contato;
  const nome = c ? nomeDoLead(c) : nomeInicial;
  const linkAnuncio = c
    ? linkAdsManager({
        adAccountId: c.ad_account_id,
        adId: c.ad_id,
        adsetId: c.adset_id,
        campaignId: c.campaign_id,
      })
    : null;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={`Rastreio de ${nome}`}>
        <header className="modal-head">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold">Rastreio do contato</h3>
            <p className="truncate text-body-small text-tertiary">
              {nome}
              {c?.phone ? ` · ${telefoneParaExibir(c.phone)}` : ''}
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
          ) : !c ? (
            <p className="text-body-small text-tertiary">Carregando rastreio...</p>
          ) : (
            <>
              {c.lacunas_de_esquema.length ? (
                <p className="mb-3 rounded-[var(--radius-control)] bg-[var(--amber-50)] px-3 py-2 text-xs text-[var(--amber-700)]">
                  Parte do rastreio não pôde ser lida neste banco — falta:{' '}
                  <strong>{c.lacunas_de_esquema.join(', ')}</strong>.
                </p>
              ) : null}

              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex h-6 items-center rounded-[var(--radius-pill)] px-2.5 text-[11px] font-medium ${CLASSE_FONTE[c.fonte]}`}
                >
                  {ROTULO_FONTE[c.fonte]}
                </span>
                <span
                  className={`inline-flex h-6 items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 text-[11px] font-medium ${CLASSE_CONFIANCA[c.confianca]}`}
                >
                  Confiança {ROTULO_CONFIANCA[c.confianca]}
                  <Dica texto={DICA_CONFIANCA[c.confianca]} />
                </span>
              </div>

              <p className="mb-4 text-body-small text-tertiary">{DESCRICAO_FONTE[c.fonte]}</p>

              <Secao titulo="Captura">
                <Linha rotulo="Canal de captura" valor={ROTULO_FONTE[c.fonte]} />
                <Linha
                  rotulo="Plataforma"
                  valor={
                    c.fonte === 'ctwa'
                      ? PROVEDOR[dados?.conta.provider ?? ''] || 'WhatsApp'
                      : c.fonte === 'meta_lead_ads'
                        ? 'Meta (Formulário Instantâneo)'
                        : c.fonte === 'lp_utm'
                          ? 'Página própria'
                          : null
                  }
                />
                <Linha rotulo="Data do lead" valor={fmtDataHora(c.created_at)} />
                <Linha
                  rotulo="Primeira mensagem"
                  valor={c.primeira_mensagem_em ? fmtDataHora(c.primeira_mensagem_em) : null}
                />
                <Linha
                  rotulo="Método"
                  valor={metodoDeCaptura({
                    fonte: c.fonte,
                    ctwa_clid: c.ctwa_clid,
                    fbclid: c.fbclid,
                    meta_lead_id: c.meta_lead_id,
                    ad_id: c.ad_id,
                    utm_source: c.utm_source,
                  })}
                />
                <Linha rotulo="Etapa atual" valor={rotuloEtapa(c.current_stage)} />
              </Secao>

              <Secao titulo="Anúncio">
                <Linha rotulo="Campanha" valor={c.campanha} />
                <Linha rotulo="ID da campanha" valor={c.campaign_id} mono />
                <Linha rotulo="Conjunto" valor={c.conjunto} />
                <Linha rotulo="ID do conjunto" valor={c.adset_id} mono />
                <Linha rotulo="Anúncio" valor={c.anuncio} />
                <Linha
                  rotulo="ID do anúncio"
                  valor={c.ad_id}
                  mono
                  href={c.ad_id ? linkAnuncio : null}
                />
                <Linha rotulo="Título do criativo" valor={c.titulo_anuncio} />
                <Linha
                  rotulo="URL de origem"
                  valor={c.url_origem}
                  mono
                  href={c.url_origem?.startsWith('http') ? c.url_origem : null}
                />
              </Secao>

              <Secao titulo="Identificadores">
                <Linha rotulo="ctwa_clid" valor={c.ctwa_clid} mono />
                <Linha rotulo="fbclid" valor={c.fbclid} mono />
                <Linha rotulo="lead_id (Meta)" valor={c.meta_lead_id} mono />
                <Linha rotulo="form_id" valor={c.meta_form_id} mono />
                <Linha rotulo="page_id" valor={c.meta_page_id} mono />
                <Linha rotulo="waba_id" valor={dados?.conta.waba_id ?? null} mono />
                <Linha rotulo="phone_number_id" valor={dados?.conta.phone_number_id ?? null} mono />
                <Linha rotulo="Conta de anúncios" valor={c.ad_account_id} mono />
              </Secao>

              <Secao titulo="Parâmetros de URL">
                <Linha rotulo="utm_source" valor={c.utm_source} mono />
                <Linha rotulo="utm_medium" valor={c.utm_medium} mono />
                <Linha rotulo="utm_campaign" valor={c.utm_campaign} mono />
                <Linha rotulo="utm_content" valor={c.utm_content} mono />
                <Linha rotulo="utm_term" valor={c.utm_term} mono />
                <Linha rotulo="IP" valor={c.ip_address} mono />
              </Secao>

              <section className="mt-5">
                <h4 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-tertiary)] uppercase">
                  Conversões enviadas à Meta
                </h4>
                {c.conversoes.length ? (
                  <div className="table-wrap">
                    <table className="tabela-painel">
                      <thead>
                        <tr>
                          {['Data', 'Evento', 'Status', 'Valor'].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {c.conversoes.map((e) => (
                          <tr key={e.id}>
                            <td className="whitespace-nowrap">{fmtDataHora(e.created_at)}</td>
                            <td>
                              {ouTraco(e.content_name || e.event_name)}
                              {e.error_message ? (
                                <span
                                  title={e.error_message}
                                  className="block text-[11px] text-[var(--red-700)] line-clamp-2"
                                >
                                  {e.error_message}
                                </span>
                              ) : null}
                            </td>
                            <td>
                              <span className={`status-tag ${e.status}`}>{e.status}</span>
                            </td>
                            <td className="tabular-nums whitespace-nowrap">
                              {valorDoEvento(e.value, e.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-body-small text-tertiary">
                    Nenhuma conversão enviada à Meta para este contato.
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
