/**
 * Vocabulário do CRM unificado, usado nos dois lados.
 *
 * Fica fora de `lib/db/crm.ts` porque aquele módulo é `server-only` e o
 * quadro é um componente de cliente — mesmo motivo de
 * `lib/rastreamento.ts` e `lib/whatsapp-conversas.ts`.
 *
 * O CRM é um só, mas os funis não: o de Formulários vive no Kommo
 * (`crm_meta_event_map`, etapa gravada em `customers.current_stage`) e o
 * de WhatsApp vive aqui no painel (`whatsapp_event_map`, etapa gravada em
 * `whatsapp_conversations.status`). Por isso cada coluna carrega a origem
 * a que pertence: é ela que decide qual card pode ser solto ali.
 *
 * Aqui mora também `montaQuadro`, a regra que transforma as etapas
 * cadastradas e as linhas do banco em colunas e cards: é lógica pura,
 * vale mais testada do que perto do SQL.
 */

import { rotuloEstagio } from '@/lib/whatsapp-conversas';
import { ehEtapaDePerda } from '@/lib/funil';
import { nomeParaExibir, telefoneParaExibir } from '@/lib/exibicao';

export const ORIGENS = ['form', 'whatsapp'] as const;
export type OrigemLead = (typeof ORIGENS)[number];

export const ROTULO_ORIGEM: Record<OrigemLead, string> = {
  form: 'Formulário',
  whatsapp: 'WhatsApp',
};

export const DESCRICAO_ORIGEM: Record<OrigemLead, string> = {
  form: 'Lead de Formulário Instantâneo. A etapa é a do funil do Kommo.',
  whatsapp: 'Contato que chegou por conversa de WhatsApp. A etapa é a do funil do painel.',
};

export const CLASSE_ORIGEM: Record<OrigemLead, string> = {
  form: 'bg-[var(--blue-50)] text-[var(--blue-700)]',
  whatsapp: 'bg-[var(--green-50)] text-[var(--green-700)]',
};

/**
 * Plataforma que trouxe o contato, quando ele tem identificador de
 * anúncio. Hoje só existe uma: tudo que este painel rastreia entra pela
 * Meta — formulário instantâneo ou clique-para-WhatsApp. O rótulo é
 * constante de propósito, para o dia em que houver outra origem o card
 * não precisar mudar de forma, só de valor.
 */
export const PLATAFORMA_ANUNCIO = 'Meta Ads';

/** Azul da marca Meta, cheio; ver `.tag-meta` em globals.css. */
export const CLASSE_PLATAFORMA_ANUNCIO = 'tag-meta';

export function ehOrigem(valor: unknown): valor is OrigemLead {
  return valor === 'form' || valor === 'whatsapp';
}

/**
 * Marcador que a ingestão do WhatsApp grava em `customers.current_stage`
 * ao criar o contato (ver `lib/db/evolution-ingestao.ts` e o workflow da
 * Cloud API). Não é etapa de funil: é o que identifica o contato como de
 * WhatsApp antes mesmo de existir linha em `whatsapp_conversations`.
 */
export const ETAPA_CONTATO_WHATSAPP = 'whatsapp_contact';

/** Coluna dos leads sem etapa reconhecida em nenhum dos dois funis. */
export const CHAVE_SEM_ETAPA = 'sem-etapa';

export type ColunaCrm = {
  /** Identidade da coluna na tela e no arrastar/soltar. */
  chave: string;
  rotulo: string;
  /**
   * Funil a que a coluna pertence. `null` é coluna extra: etapa que
   * aparece em algum lead mas não está cadastrada como ativa, mais a
   * coluna "Sem etapa". Coluna extra nunca aceita card.
   */
  origem: OrigemLead | null;
  /** Valor gravado no banco (`status_id` do Kommo, ou estágio do painel). */
  valor: string | null;
  /**
   * Se o card pode ser solto aqui. Só o funil do WhatsApp é do painel;
   * a etapa do Kommo é espelho do CRM do cliente e mudá-la aqui
   * dessincronizaria o funil e ainda contaria conversão que não houve.
   */
  aceita_solta: boolean;
  /**
   * Coluna de negócio perdido. Só existe no funil de formulários, onde
   * é marcada na aba Eventos (`crm_meta_event_map.is_lost`); no funil de
   * WhatsApp a perda é reconhecida pelo nome do estágio, por
   * `ehEtapaDePerda`. Coluna de perda não envia evento nenhum.
   */
  perda: boolean;
};

export type CartaoCrm = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  origem: OrigemLead;
  /** Etapa crua, do funil da origem. */
  etapa: string | null;
  /** Etapa como aparece na tela. */
  etapa_rotulo: string | null;
  chave_coluna: string;
  /** Lead de formulário que também tem conversa de WhatsApp. */
  tem_conversa: boolean;
  mensagens_nao_lidas: number;
  ultima_mensagem_em: string | null;
  campanha: string | null;
  tags: string | null;
  /** Tem identificador de anúncio da Meta (lead ad ou clique-para-WhatsApp). */
  de_anuncio: boolean;
  /** Está numa etapa de perda. */
  perdido: boolean;
  /** Por que o negócio caiu, quando o CRM informou. */
  motivo_perda: string | null;
  /**
   * Quando o lead chegou na etapa em que está. `null` quando ele nunca
   * saiu da etapa de entrada, ou quando não há registro da passagem — aí
   * o card mostra a data de entrada.
   */
  movido_em: string | null;
};

export function nomeDoCartao(c: {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}): string {
  const nome = nomeParaExibir(c.first_name, c.last_name);
  return nome || (c.email ?? '').trim() || telefoneParaExibir(c.phone) || 'Contato sem nome';
}

/** Chave de coluna a partir do funil e do valor gravado. */
export function chaveColuna(origem: OrigemLead | null, valor: string | null): string {
  if (!origem || !valor) return CHAVE_SEM_ETAPA;
  return `${origem}:${valor}`;
}

export type LinhaEtapaForm = {
  status_id: string | null;
  content_name: string | null;
  /** `crm_meta_event_map.is_lost`; ausente em banco sem a migração. */
  is_lost?: number | boolean | null;
};
export type LinhaEtapaWhatsapp = { estagio: string | null; content_name: string | null };

export type LinhaCartao = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  current_stage: string | null;
  meta_lead_id: string | null;
  status_conversa: string | null;
  tags: string | null;
  unread_count: number | string | null;
  last_message_at: string | null;
  tem_conversa: number | string;
  campanha: string | null;
  de_anuncio: number | string | null;
  /** `customers.lost_reason`; `null` em banco sem a migração. */
  lost_reason: string | null;
  /** Quando o lead chegou na etapa atual do funil do Kommo. */
  movido_em?: string | null;
  /** Última mexida na conversa — a etapa do funil do WhatsApp. */
  movido_conversa_em?: string | null;
};

/**
 * De qual funil é o contato.
 *
 * Vale por onde ele entrou, não onde está agora: lead de formulário que
 * depois puxou conversa continua sendo de formulário — o que ele ganha é
 * a marca `tem_conversa`. Do outro lado, o contato criado pela ingestão
 * do WhatsApp é de WhatsApp já no primeiro instante, antes de existir
 * linha de conversa: é para isso que serve o marcador em `current_stage`.
 */
export function ehContatoDeWhatsapp(
  metaLeadId: string | null,
  currentStage: string | null,
  temConversa: boolean,
): boolean {
  if (metaLeadId) return false;
  return temConversa || (currentStage ?? '').trim() === ETAPA_CONTATO_WHATSAPP;
}

/** Etapa do Kommo, sem o marcador da ingestão do WhatsApp. */
export function etapaDoFunilForm(currentStage: string | null): string | null {
  const valor = (currentStage ?? '').trim();
  return !valor || valor === ETAPA_CONTATO_WHATSAPP ? null : valor;
}

/**
 * Regra do quadro, separada da consulta porque é o que vale testar:
 * ordem das colunas, origem de cada lead, etapa não cadastrada e lead sem
 * etapa nenhuma.
 */
export function montaQuadro(
  etapasForm: LinhaEtapaForm[],
  etapasWhatsapp: LinhaEtapaWhatsapp[],
  linhas: LinhaCartao[],
  origemFiltrada: OrigemLead | null,
): { colunas: ColunaCrm[]; cartoes: CartaoCrm[]; total: number; tem_etapas: boolean } {
  const colunas: ColunaCrm[] = [];
  const rotuloPorChave = new Map<string, string>();
  // Etapas de perda do funil do Kommo, pelo valor cru gravado em
  // `customers.current_stage`. É o que marca o card como perdido — o
  // nome da etapa não serve, porque é texto que o cliente escolheu.
  const perdaForm = new Set<string>();

  // Primeira coluna cadastrada de cada funil — a etapa de entrada. É a
  // ordem do cadastro (`ORDER BY id`), a mesma que o quadro desenha, não
  // um nome de etapa: cada cliente batiza a primeira do jeito dele.
  const primeiraChave = new Map<OrigemLead, string>();

  const registra = (coluna: ColunaCrm) => {
    if (rotuloPorChave.has(coluna.chave)) return;
    rotuloPorChave.set(coluna.chave, coluna.rotulo);
    if (coluna.origem && !primeiraChave.has(coluna.origem)) {
      primeiraChave.set(coluna.origem, coluna.chave);
    }
    colunas.push(coluna);
  };

  // `origemFiltrada` corta coluna, não só card: com um quadro por funil,
  // deixar as colunas do outro funil de pé encheria a tela de coluna
  // vazia que nunca vai receber nada — e, pior, de coluna com a regra de
  // arrastar do outro funil.
  for (const e of origemFiltrada === 'whatsapp' ? [] : etapasForm) {
    const valor = (e.status_id ?? '').trim();
    if (!valor) continue;
    const perda = Boolean(e.is_lost);
    if (perda) perdaForm.add(valor);
    registra({
      chave: chaveColuna('form', valor),
      rotulo: (e.content_name ?? '').trim() || valor,
      origem: 'form',
      valor,
      // Etapa do Kommo é espelho: o quadro mostra, o CRM do cliente move.
      aceita_solta: false,
      perda,
    });
  }

  for (const e of origemFiltrada === 'form' ? [] : etapasWhatsapp) {
    const valor = (e.estagio ?? '').trim();
    if (!valor) continue;
    registra({
      chave: chaveColuna('whatsapp', valor),
      rotulo: (e.content_name ?? '').trim() || rotuloEstagio(valor),
      origem: 'whatsapp',
      valor,
      aceita_solta: true,
      perda: ehEtapaDePerda(valor),
    });
  }

  const temEtapas = colunas.length > 0;

  const cartoes: CartaoCrm[] = [];
  const extras: ColunaCrm[] = [];
  const chavesExtras = new Set<string>();

  for (const l of linhas) {
    // Origem = por onde o lead entrou, não onde ele está agora. Um lead
    // de formulário que depois puxou conversa continua sendo de
    // formulário; o que ele ganha é a marca `tem_conversa`.
    const temConversa = Number(l.tem_conversa) === 1;
    const origem: OrigemLead = ehContatoDeWhatsapp(l.meta_lead_id, l.current_stage, temConversa)
      ? 'whatsapp'
      : 'form';
    if (origemFiltrada && origem !== origemFiltrada) continue;

    const etapa =
      origem === 'whatsapp'
        ? (l.status_conversa ?? '').trim() || null
        : etapaDoFunilForm(l.current_stage);

    let chave = chaveColuna(origem, etapa);
    if (!etapa) {
      chave = CHAVE_SEM_ETAPA;
    } else if (!rotuloPorChave.has(chave) && !chavesExtras.has(chave)) {
      // Etapa que existe no lead mas não está cadastrada como ativa: vira
      // coluna extra no fim, com o valor cru. Melhor uma coluna estranha
      // do que um lead sumindo da tela.
      chavesExtras.add(chave);
      extras.push({
        chave,
        rotulo: origem === 'whatsapp' ? rotuloEstagio(etapa) : etapa,
        origem: null,
        valor: etapa,
        aceita_solta: false,
        perda: origem === 'whatsapp' && ehEtapaDePerda(etapa),
      });
    }

    cartoes.push({
      id: l.id,
      first_name: l.first_name,
      last_name: l.last_name,
      email: l.email,
      phone: l.phone,
      created_at: l.created_at,
      origem,
      etapa,
      etapa_rotulo: null,
      chave_coluna: chave,
      tem_conversa: temConversa,
      mensagens_nao_lidas: Number(l.unread_count) || 0,
      ultima_mensagem_em: l.last_message_at,
      campanha: l.campanha,
      tags: l.tags,
      de_anuncio: Number(l.de_anuncio) === 1,
      perdido: etapa
        ? origem === 'whatsapp'
          ? ehEtapaDePerda(etapa)
          : perdaForm.has(etapa)
        : false,
      motivo_perda: (l.lost_reason ?? '').trim() || null,
      // Lead parado na primeira etapa do funil não "moveu": ele entrou.
      // Por isso a data de movimentação só existe da segunda coluna em
      // diante — e some se a passagem não deixou registro, em vez de
      // inventar uma data.
      movido_em:
        chave === primeiraChave.get(origem)
          ? null
          : (origem === 'whatsapp' ? l.movido_conversa_em : l.movido_em) ?? null,
    });
  }

  for (const extra of extras) registra(extra);
  registra({
    chave: CHAVE_SEM_ETAPA,
    rotulo: 'Sem etapa',
    origem: null,
    valor: null,
    aceita_solta: false,
    perda: false,
  });

  // O rótulo do card só é conhecido depois que as colunas extras entram.
  for (const c of cartoes) {
    if (c.etapa) c.etapa_rotulo = rotuloPorChave.get(c.chave_coluna) ?? c.etapa;
  }

  return { colunas, cartoes, total: cartoes.length, tem_etapas: temEtapas };
}

export function iniciaisDoNome(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * Valor digitado, em número.
 *
 * Aceita o jeito brasileiro de escrever ("11.210,00") e o do teclado
 * numérico ("11210.00"), porque quem digita não vai lembrar de qual o
 * campo quer. Campo vazio vale zero: é como se apaga um valor errado.
 * Devolve `null` quando o texto não é número, e aí a tela recusa.
 */
export function valorDigitado(texto: string): number | null {
  const limpo = texto.trim().replace(/[R$\s]/g, '');
  if (!limpo) return 0;
  const normalizado = limpo.includes(',')
    ? limpo.split('.').join('').replace(',', '.')
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
