'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { Alerta } from '@/components/form';
import { type EstadoFormulario } from '@/lib/auth/actions';
import {
  acaoExcluirEventoForm,
  acaoExcluirEventoWhatsapp,
  acaoSalvarEventoForm,
  acaoSalvarEventoWhatsapp,
} from '@/lib/acoes/mapeamentos';
import { EVENTOS_META, ROTULO_TIPO_DE_VALOR, TIPOS_DE_VALOR } from '@/lib/meta-eventos';
import type { MapeamentoForm, MapeamentoWhatsapp } from '@/lib/db/mapeamentos';
import { Card } from '@/components/dados';

/**
 * Telas de Configuração de Eventos — porte das duas seções do painel
 * antigo (`addEventRow`/`saveEventRow`/`deleteEventRow` e as versões
 * `...WhatsappEventRow`).
 *
 * Cada linha é um `<form>` próprio, com seu próprio botão Salvar e sua
 * própria mensagem de resultado, como no painel antigo — salvar um
 * estágio nunca envia os outros junto.
 *
 * Excluir é outra ação, então é outro `<form>`. Como o HTML não permite
 * formulário aninhado, o formulário de exclusão é irmão do de salvar, e
 * os controles que aparecem na mesma linha dos dois botões (as caixas de
 * seleção e o próprio botão Salvar) ficam fora do `<form>` de salvar,
 * ligados a ele pelo atributo `form`. Aninhar os dois quebrava a
 * hidratação do React.
 *
 * Linhas novas existem só no navegador até serem salvas: `id` vazio
 * significa "ainda não está no banco". Depois do sucesso a linha some
 * daqui e reaparece vinda do servidor, já com id.
 */

const ID_DATALIST = 'eventos-meta';

const DESCRICAO_WHATSAPP =
  'Cadastre livremente os estágios do seu funil de Conversas WhatsApp (mesma lógica do ' +
  'mapeamento de eventos do formulário). Cada estágio pode ativar um Evento Meta disparado ' +
  'automaticamente sempre que um lead entrar nele. Os estágios cadastrados aqui também ' +
  'aparecem como filtros e opções de status na aba "Conversas".';


function ListaEventosMeta() {
  return (
    <datalist id={ID_DATALIST}>
      {EVENTOS_META.map((e) => (
        <option key={e} value={e} />
      ))}
    </datalist>
  );
}

function Rotulo({
  texto,
  className = '',
  children,
}: {
  texto: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-[var(--text-tertiary)]">{texto}</span>
      {children}
    </label>
  );
}

/**
 * Caixa não controlada por padrão (o navegador guarda o estado), e
 * controlada quando quem chama precisa reagir à marcação — é o caso da
 * etapa de perda, que muda o resto do formulário.
 */
function Caixa({
  nome,
  rotulo,
  padrao,
  dica,
  form,
  marcada,
  aoMudar,
  desabilitada = false,
}: {
  nome: string;
  rotulo: string;
  padrao: boolean;
  dica: string;
  form: string;
  marcada?: boolean;
  aoMudar?: (valor: boolean) => void;
  desabilitada?: boolean;
}) {
  const controlada = marcada !== undefined;
  return (
    <label
      className={`flex items-center gap-2 text-sm ${desabilitada ? 'opacity-50' : ''}`}
      title={dica}
    >
      <input
        type="checkbox"
        name={nome}
        form={form}
        disabled={desabilitada}
        {...(controlada
          ? { checked: marcada, onChange: (e) => aoMudar?.(e.target.checked) }
          : { defaultChecked: padrao })}
      />
      <span>{rotulo}</span>
    </label>
  );
}

function BotaoSalvar({ pendente, form }: { pendente: boolean; form: string }) {
  return (
    <button
      type="submit"
      form={form}
      disabled={pendente}
      className="btn btn-primary btn-sm"
    >
      {pendente ? 'Salvando…' : 'Salvar'}
    </button>
  );
}

/**
 * Exclusão é irreversível e o painel antigo pedia confirmação com este
 * texto exato — mantido para quem já usa o sistema reconhecer o aviso.
 */
function FormExcluir({
  cliente,
  id,
  acao,
  pergunta,
}: {
  cliente: string;
  id: number;
  acao: (form: FormData) => Promise<void>;
  pergunta: string;
}) {
  return (
    <form
      action={acao}
      onSubmit={(e) => {
        if (!window.confirm(pergunta)) e.preventDefault();
      }}
    >
      <input type="hidden" name="cliente" value={cliente} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn btn-danger btn-sm">
        Excluir
      </button>
    </form>
  );
}

function BotaoDescartar({ aoDescartar }: { aoDescartar: () => void }) {
  return (
    <button type="button" onClick={aoDescartar} className="btn btn-danger btn-sm">
      Remover
    </button>
  );
}

function TopoLinha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="event-row-top">
      <span className="tag">{rotulo}</span>
      <div className="row-actions">{children}</div>
    </div>
  );
}

// -------------------------------------------------------------------
// Formulário Instantâneo (crm_meta_event_map)
// -------------------------------------------------------------------

function LinhaEventoForm({
  cliente,
  item,
  aoSalvarNova,
  aoDescartar,
}: {
  cliente: string;
  item: MapeamentoForm | null;
  aoSalvarNova?: () => void;
  aoDescartar?: () => void;
}) {
  const [estado, acao, pendente] = useActionState<EstadoFormulario, FormData>(
    acaoSalvarEventoForm,
    {},
  );

  const idForm = useId();

  // Etapa de perda muda o resto da linha na hora: o Evento Meta deixa de
  // ser obrigatório (e de ser enviado), e as duas caixas de baixo perdem
  // o sentido. Por isso esta caixa é controlada e as outras não.
  const [perda, setPerda] = useState(item?.is_lost ?? false);

  useEffect(() => {
    if (estado.sucesso && aoSalvarNova) aoSalvarNova();
  }, [estado.sucesso, aoSalvarNova]);

  return (
    <div className="event-row">
      <TopoLinha rotulo={item ? `Evento #${item.id}` : 'Novo Evento'}>
        <BotaoSalvar form={idForm} pendente={pendente} />
        {item ? (
          <FormExcluir
            cliente={cliente}
            id={item.id}
            acao={acaoExcluirEventoForm}
            pergunta="Excluir este mapeamento de evento? Essa ação não pode ser desfeita."
          />
        ) : aoDescartar ? (
          <BotaoDescartar aoDescartar={aoDescartar} />
        ) : null}
      </TopoLinha>

      <form id={idForm} action={acao}>
        <input type="hidden" name="cliente" value={cliente} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Rotulo texto="ID do funil (pipeline_id)">
            <input
              name="pipeline_id"
              defaultValue={item?.pipeline_id ?? ''}
              required
              className="field font-mono"
              placeholder="1234567"
            />
          </Rotulo>
          <Rotulo texto="ID do estágio (status_id)">
            <input
              name="status_id"
              defaultValue={item?.status_id ?? ''}
              required
              className="field font-mono"
              placeholder="7654321"
            />
          </Rotulo>
          <Rotulo texto={perda ? 'Evento Meta (nenhum: etapa de perda)' : 'Evento Meta'}>
            <input
              name="meta_event"
              defaultValue={item?.meta_event ?? ''}
              required={!perda}
              disabled={perda}
              list={ID_DATALIST}
              className="field"
              placeholder={perda ? '—' : 'Lead'}
            />
          </Rotulo>
          <Rotulo texto="Nome do conteúdo (opcional)">
            <input
              name="content_name"
              defaultValue={item?.content_name ?? ''}
              className="field"
              placeholder="Simulação enviada"
            />
          </Rotulo>
          <Rotulo texto="Moeda">
            <input
              name="currency"
              defaultValue={item?.currency ?? 'BRL'}
              maxLength={3}
              className="field font-mono uppercase"
            />
          </Rotulo>
          <Rotulo texto="Origem do valor">
            <select name="value_type" defaultValue={item?.value_type ?? 'price'} className="field">
              {TIPOS_DE_VALOR.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_DE_VALOR[t]}
                </option>
              ))}
            </select>
          </Rotulo>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Caixa
          form={idForm}
          nome="ativo"
          rotulo="Ativo"
          padrao={item ? item.ativo : true}
          desabilitada={perda}
          dica="Desmarcado, o estágio não dispara evento para a Meta."
        />
        <Caixa
          form={idForm}
          nome="is_conversion"
          rotulo="Conta como conversão"
          padrao={item ? item.is_conversion : false}
          desabilitada={perda}
          dica="Usado no cálculo de CAC e taxa de conversão da aba Campanhas."
        />
        <Caixa
          form={idForm}
          nome="is_lost"
          rotulo="Etapa de perda"
          padrao={false}
          marcada={perda}
          aoMudar={setPerda}
          dica="A etapa em que o Kommo coloca o negócio perdido. Não envia evento nenhum."
        />
      </div>

      {perda ? (
        <p className="mt-2 text-body-small text-tertiary">
          Etapa de perda: o lead aparece nesta coluna do quadro com o motivo da perda, e nada é
          enviado à Meta. Quem move o lead até aqui e traz o motivo é a automação{' '}
          <strong>Kommo - Sincroniza Perdidos</strong>, no n8n.
        </p>
      ) : null}

      {item ? (
        <p className="mt-2 text-body-small text-tertiary">
          O mapeamento é identificado pelo par funil + estágio. Alterar um dos dois cria um
          mapeamento novo em vez de renomear este.
        </p>
      ) : null}

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      {estado.sucesso && item ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}
    </div>
  );
}

export function ConfigEventosForm({
  cliente,
  itens,
}: {
  cliente: string;
  itens: MapeamentoForm[];
}) {
  const [novas, setNovas] = useState<number[]>([]);

  return (
    <>
      <ListaEventosMeta />

      <Card
        titulo="Mapeamento de Eventos (Funil → Evento Meta)"
        descricao="Cada linha liga uma etapa do funil do Kommo (pipeline + status) a um evento enviado à Meta CAPI. Salvar reutiliza a combinação Pipeline+Status já existente (atualiza em vez de duplicar)."
      >
        {itens.length === 0 && novas.length === 0 ? (
          <p className="empty-msg text-body-small text-tertiary">
            Nenhum mapeamento cadastrado. Sem pelo menos um estágio mapeado, o fluxo não envia
            eventos para a Meta.
          </p>
        ) : null}

        {itens.map((item) => (
          <LinhaEventoForm key={item.id} cliente={cliente} item={item} />
        ))}

        {novas.map((chave) => (
          <LinhaEventoForm
            key={`nova-${chave}`}
            cliente={cliente}
            item={null}
            aoSalvarNova={() => setNovas((v) => v.filter((k) => k !== chave))}
            aoDescartar={() => setNovas((v) => v.filter((k) => k !== chave))}
          />
        ))}

        <button
          type="button"
          onClick={() => setNovas((v) => [...v, Date.now()])}
          className="btn btn-secondary"
        >
          + Adicionar evento
        </button>
      </Card>
    </>
  );
}

// -------------------------------------------------------------------
// WhatsApp (whatsapp_event_map)
// -------------------------------------------------------------------

function LinhaEventoWhatsapp({
  cliente,
  item,
  aoSalvarNova,
  aoDescartar,
}: {
  cliente: string;
  item: MapeamentoWhatsapp | null;
  aoSalvarNova?: () => void;
  aoDescartar?: () => void;
}) {
  const [estado, acao, pendente] = useActionState<EstadoFormulario, FormData>(
    acaoSalvarEventoWhatsapp,
    {},
  );

  const idForm = useId();

  useEffect(() => {
    if (estado.sucesso && aoSalvarNova) aoSalvarNova();
  }, [estado.sucesso, aoSalvarNova]);

  return (
    <div className="event-row">
      <TopoLinha rotulo={item ? item.estagio : 'Novo Estágio'}>
        <BotaoSalvar form={idForm} pendente={pendente} />
        {item ? (
          <FormExcluir
            cliente={cliente}
            id={item.id}
            acao={acaoExcluirEventoWhatsapp}
            pergunta="Excluir este estágio do funil de Conversas? Essa ação não pode ser desfeita."
          />
        ) : aoDescartar ? (
          <BotaoDescartar aoDescartar={aoDescartar} />
        ) : null}
      </TopoLinha>

      <form id={idForm} action={acao}>
        <input type="hidden" name="cliente" value={cliente} />
        <input type="hidden" name="id" value={item?.id ?? ''} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Rotulo texto="Estágio do funil">
            <input
              name="estagio"
              defaultValue={item?.estagio ?? ''}
              required
              maxLength={60}
              className="field"
              placeholder="Em atendimento"
            />
          </Rotulo>
          <Rotulo texto="Evento Meta (opcional)">
            <input
              name="meta_event"
              defaultValue={item?.meta_event ?? ''}
              list={ID_DATALIST}
              className="field"
              placeholder="Contact"
            />
          </Rotulo>
          <Rotulo texto="Nome do conteúdo (opcional)">
            <input
              name="content_name"
              defaultValue={item?.content_name ?? ''}
              className="field"
              placeholder="Conversa iniciada"
            />
          </Rotulo>
          <Rotulo texto="Moeda">
            <input
              name="currency"
              defaultValue={item?.currency ?? 'BRL'}
              maxLength={3}
              className="field font-mono uppercase"
            />
          </Rotulo>
          <Rotulo texto="Valor do evento">
            <input
              name="value"
              type="number"
              step="0.01"
              min="0"
              defaultValue={item ? item.value.toFixed(2) : '0.00'}
              className="field font-mono"
            />
          </Rotulo>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Caixa
          form={idForm}
          nome="ativo"
          rotulo="Ativo"
          padrao={item ? item.ativo : false}
          dica="Só estágios ativos disparam evento para a Meta. Exige um Evento Meta preenchido."
        />
        <Caixa
          form={idForm}
          nome="is_conversion"
          rotulo="Conta como conversão"
          padrao={item ? item.is_conversion : false}
          dica="Usado no cálculo de CAC e taxa de conversão da aba Campanhas."
        />
      </div>

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      {estado.sucesso && item ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}
    </div>
  );
}

export function ConfigEventosWhatsapp({
  cliente,
  itens,
}: {
  cliente: string;
  itens: MapeamentoWhatsapp[];
}) {
  const [novas, setNovas] = useState<number[]>([]);

  return (
    <>
      <ListaEventosMeta />

      <Card
        titulo="Mapeamento de Eventos (Conversas WhatsApp → Evento Meta)"
        descricao={DESCRICAO_WHATSAPP}
      >
        {itens.length === 0 && novas.length === 0 ? (
          <p className="empty-msg text-body-small text-tertiary">
            Nenhum estágio cadastrado para este cliente.
          </p>
        ) : null}

        {itens.map((item) => (
          <LinhaEventoWhatsapp key={item.id} cliente={cliente} item={item} />
        ))}

        {novas.map((chave) => (
          <LinhaEventoWhatsapp
            key={`nova-${chave}`}
            cliente={cliente}
            item={null}
            aoSalvarNova={() => setNovas((v) => v.filter((k) => k !== chave))}
            aoDescartar={() => setNovas((v) => v.filter((k) => k !== chave))}
          />
        ))}

        <button
          type="button"
          onClick={() => setNovas((v) => [...v, Date.now()])}
          className="btn btn-secondary"
        >
          + Adicionar estágio
        </button>
      </Card>
    </>
  );
}
