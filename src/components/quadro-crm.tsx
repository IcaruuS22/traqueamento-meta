'use client';

import { useEffect, useState } from 'react';
import type { CartaoCrm, ColunaCrm } from '@/lib/crm';
import {
  CLASSE_ORIGEM,
  CLASSE_PLATAFORMA_ANUNCIO,
  PLATAFORMA_ANUNCIO,
  ROTULO_ORIGEM,
  iniciaisDoNome,
  nomeDoCartao,
} from '@/lib/crm';
import { acaoMoverLeadCrm } from '@/lib/acoes/crm';
import { ehEtapaDePerda, MOTIVOS_PERDA_SUGERIDOS, TAMANHO_MOTIVO } from '@/lib/funil';
import { ModalLeadCrm } from '@/components/modal-lead-crm';
import { fmtDataHora, ouTraco } from '@/lib/format';

/**
 * Quadro do CRM.
 *
 * O mesmo componente serve às duas telas — CRM de Formulários e CRM de
 * WhatsApp —, cada uma passando as colunas e os cards do seu funil (ver
 * `tela-crm.tsx`). O card continua marcado com a origem porque um lead
 * de formulário pode ter conversa, e porque a regra de arrastar depende
 * dela.
 *
 * Só card de WhatsApp arrasta. A etapa do lead de formulário é espelho
 * do Kommo — quem a escreve é a automação do n8n, e mudá-la aqui
 * dessincronizaria o funil e ainda inflaria a contagem de conversões,
 * que sai de `current_stage` cruzado com `crm_meta_event_map`.
 *
 * A movimentação é otimista: o card muda de coluna na hora e volta ao
 * lugar se o servidor recusar. Arrastar e ver o card só se mexer um
 * segundo depois é pior do que ver o card voltar de vez em quando.
 */

const POR_PAGINA = 10;

type Aviso = { tipo: 'ok' | 'erro'; texto: string };

export function QuadroCrm({
  cliente,
  colunas,
  cartoes,
  leadInicial = null,
  podeExcluir = false,
}: {
  cliente: string;
  colunas: ColunaCrm[];
  cartoes: CartaoCrm[];
  /**
   * Sessão de administrador. Só controla o que o modal do lead mostra —
   * quem recusa a exclusão de fato é `acaoExcluirLead`, no servidor.
   */
  podeExcluir?: boolean;
  /**
   * Contato a abrir de saída, vindo de `?lead=` — é assim que a tela de
   * Conversas chega aqui. Se ele não estiver no período ou no filtro em
   * vigor, o quadro avisa em vez de abrir modal de um card que ninguém vê.
   */
  leadInicial?: number | null;
}) {
  const [lista, setLista] = useState<CartaoCrm[]>(cartoes);
  const [visiveis, setVisiveis] = useState<Record<string, number>>({});
  const [arrastando, setArrastando] = useState<CartaoCrm | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [aberto, setAberto] = useState<CartaoCrm | null>(null);

  // Soltar na coluna de perda pergunta o motivo antes de mover. É a
  // única movimentação que não é otimista: perguntar depois de já ter
  // movido daria um card na coluna certa e um motivo em branco na
  // metade das vezes.
  const [perda, setPerda] = useState<{ cartao: CartaoCrm; coluna: ColunaCrm } | null>(null);
  const [motivo, setMotivo] = useState('');

  // Trocar período ou filtro é navegação: o servidor manda outra lista e
  // o estado local precisa acompanhar, senão o quadro congela na anterior.
  useEffect(() => {
    setLista(cartoes);
    setVisiveis({});
  }, [cartoes]);

  useEffect(() => {
    if (!leadInicial) return;
    const cartao = cartoes.find((c) => c.id === leadInicial);
    if (cartao) setAberto(cartao);
    else
      setAviso({
        tipo: 'erro',
        texto:
          'O contato do link não está no período ou no filtro selecionado. Amplie o período para vê-lo.',
      });
  }, [leadInicial, cartoes]);

  const quantos = (chave: string) => visiveis[chave] ?? POR_PAGINA;

  function podeSoltar(coluna: ColunaCrm): boolean {
    return Boolean(arrastando) && coluna.aceita_solta && arrastando!.origem === coluna.origem;
  }

  function solta(cartao: CartaoCrm, coluna: ColunaCrm) {
    if (!coluna.valor || cartao.chave_coluna === coluna.chave) return;
    if (ehEtapaDePerda(coluna.valor)) {
      setMotivo('');
      setPerda({ cartao, coluna });
      return;
    }
    void mover(cartao, coluna);
  }

  async function mover(cartao: CartaoCrm, coluna: ColunaCrm, motivoPerda: string | null = null) {
    if (!coluna.valor || cartao.chave_coluna === coluna.chave) return;
    const anterior = lista;
    setPerda(null);
    setAviso(null);
    setLista((atual) =>
      atual.map((c) =>
        c.id === cartao.id
          ? { ...c, etapa: coluna.valor, etapa_rotulo: coluna.rotulo, chave_coluna: coluna.chave }
          : c,
      ),
    );

    const r = await acaoMoverLeadCrm({
      cliente,
      customer_id: cartao.id,
      etapa: coluna.valor,
      ...(motivoPerda === null ? {} : { motivo_perda: motivoPerda }),
    });
    if (r.ok) {
      setAviso({ tipo: 'ok', texto: `${nomeDoCartao(cartao)}: ${r.sucesso}` });
    } else {
      setLista(anterior);
      setAviso({ tipo: 'erro', texto: r.erro });
    }
  }

  return (
    <div className="space-y-3">
      {aviso ? (
        <p
          role="status"
          className={
            aviso.tipo === 'ok'
              ? 'rounded-[var(--radius-control)] bg-[var(--green-50)] px-3 py-2 text-sm text-[var(--green-700)]'
              : 'rounded-[var(--radius-control)] bg-[var(--red-50)] px-3 py-2 text-sm text-[var(--red-700)]'
          }
        >
          {aviso.texto}
        </p>
      ) : null}

      {perda ? (
        <form
          className="rounded-[var(--radius-control)] border border-[var(--border)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void mover(perda.cartao, perda.coluna, motivo);
          }}
        >
          <label
            className="mb-1 block text-xs font-medium text-[var(--text-tertiary)]"
            htmlFor="quadro-motivo"
          >
            Por que <strong>{nomeDoCartao(perda.cartao)}</strong> foi perdido?
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="quadro-motivo"
              className="field filtro-campo min-w-[220px]"
              list="quadro-motivos-sugeridos"
              placeholder="Escolha ou escreva"
              value={motivo}
              maxLength={TAMANHO_MOTIVO}
              autoFocus
              onChange={(e) => setMotivo(e.target.value)}
            />
            <datalist id="quadro-motivos-sugeridos">
              {MOTIVOS_PERDA_SUGERIDOS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button type="submit" className="btn btn-primary">
              Mover para {perda.coluna.rotulo}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setPerda(null)}>
              Cancelar
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">
            Pode ficar em branco — o funil conta como &ldquo;sem motivo registrado&rdquo;.
          </p>
        </form>
      ) : null}

      <div className="kanban-board">
        {colunas.map((coluna) => {
          const daColuna = lista.filter((c) => c.chave_coluna === coluna.chave);
          const mostrando = quantos(coluna.chave);
          const restantes = daColuna.length - mostrando;
          const soltavel = podeSoltar(coluna);

          return (
            <div
              key={coluna.chave}
              className="kanban-col"
              data-solta={soltavel || undefined}
              data-alvo={soltavel && alvo === coluna.chave ? '' : undefined}
              onDragOver={(e) => {
                if (!soltavel) return;
                // Sem o preventDefault o navegador não considera a área
                // um destino válido e o drop nunca dispara.
                e.preventDefault();
                if (alvo !== coluna.chave) setAlvo(coluna.chave);
              }}
              onDragLeave={() => setAlvo((a) => (a === coluna.chave ? null : a))}
              onDrop={(e) => {
                e.preventDefault();
                const cartao = arrastando;
                setAlvo(null);
                setArrastando(null);
                if (cartao && soltavel) solta(cartao, coluna);
              }}
            >
              <div className="kanban-col-head">
                <span className="title" title={coluna.rotulo}>
                  {coluna.rotulo}
                </span>
                <span className="count">{daColuna.length}</span>
              </div>

              {coluna.origem ? (
                <p className="kanban-col-origem">
                  <span className={`origem-tag ${CLASSE_ORIGEM[coluna.origem]}`}>
                    {ROTULO_ORIGEM[coluna.origem]}
                  </span>
                  {coluna.aceita_solta ? null : (
                    <span className="text-[var(--text-tertiary)]"> · etapa vem do CRM</span>
                  )}
                </p>
              ) : null}

              <div className="kanban-col-body">
                {daColuna.length ? (
                  <>
                    {daColuna.slice(0, mostrando).map((c) => (
                      <CartaoLeadCrm
                        key={c.id}
                        cartao={c}
                        arrastavel={c.origem === 'whatsapp'}
                        aoArrastar={setArrastando}
                        aoSoltarFora={() => {
                          setArrastando(null);
                          setAlvo(null);
                        }}
                        aoAbrir={() => setAberto(c)}
                      />
                    ))}
                    {restantes > 0 ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() =>
                          setVisiveis((atual) => ({
                            ...atual,
                            [coluna.chave]: mostrando + POR_PAGINA,
                          }))
                        }
                      >
                        Carregar mais ({restantes})
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="kanban-col-vazio">Vazio</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {aberto ? (
        <ModalLeadCrm
          cliente={cliente}
          cartao={aberto}
          aoFechar={() => setAberto(null)}
          aoAtualizar={(mudanca) =>
            setLista((atual) =>
              atual.map((c) => (c.id === mudanca.id ? { ...c, ...mudanca } : c)),
            )
          }
          aoExcluir={(id) => setLista((atual) => atual.filter((c) => c.id !== id))}
          podeExcluir={podeExcluir}
        />
      ) : null}
    </div>
  );
}

function CartaoLeadCrm({
  cartao,
  arrastavel,
  aoArrastar,
  aoSoltarFora,
  aoAbrir,
}: {
  cartao: CartaoCrm;
  arrastavel: boolean;
  aoArrastar: (c: CartaoCrm) => void;
  aoSoltarFora: () => void;
  aoAbrir: () => void;
}) {
  const nome = nomeDoCartao(cartao);
  return (
    <div
      className="lead-card lead-card-crm"
      role="button"
      tabIndex={0}
      aria-label={`Abrir ${nome}`}
      title={arrastavel ? 'Arraste para mudar a etapa, ou clique para abrir' : 'Clique para abrir'}
      draggable={arrastavel}
      onDragStart={(e) => {
        aoArrastar(cartao);
        e.dataTransfer.effectAllowed = 'move';
        // Alguns navegadores só iniciam o arraste com algum dado no
        // dataTransfer; o card em si vem do estado.
        e.dataTransfer.setData('text/plain', String(cartao.id));
      }}
      onDragEnd={aoSoltarFora}
      onClick={aoAbrir}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          aoAbrir();
        }
      }}
    >
      <div className="flex items-start gap-2">
        <span className="avatar-circle shrink-0">{iniciaisDoNome(nome)}</span>
        <div className="min-w-0 flex-1">
          <div className="lead-name" title={nome}>
            {nome}
          </div>
          <div className="lead-meta">{ouTraco(cartao.phone ?? cartao.email)}</div>
        </div>
        {cartao.mensagens_nao_lidas > 0 ? (
          <span className="badge-nao-lidas" title="Mensagens não lidas">
            {cartao.mensagens_nao_lidas}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {cartao.de_anuncio ? (
          <span
            className={`origem-tag ${CLASSE_PLATAFORMA_ANUNCIO}`}
            title="Contato com identificador de anúncio da Meta."
          >
            {PLATAFORMA_ANUNCIO}
          </span>
        ) : null}
        <span className={`origem-tag ${CLASSE_ORIGEM[cartao.origem]}`}>
          {ROTULO_ORIGEM[cartao.origem]}
        </span>
        {cartao.origem === 'form' && cartao.tem_conversa ? (
          <span className="origem-tag bg-[var(--bg-field)] text-[var(--text-secondary)]">
            + conversa
          </span>
        ) : null}
      </div>

      <div className="lead-meta mt-2">Entrou: {fmtDataHora(cartao.created_at)}</div>
    </div>
  );
}
