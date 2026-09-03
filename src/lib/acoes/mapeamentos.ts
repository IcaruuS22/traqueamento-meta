'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { TIPOS_DE_VALOR } from '@/lib/meta-eventos';
import {
  excluiMapeamentoForm,
  excluiMapeamentoWhatsapp,
  salvaMapeamentoForm,
  salvaMapeamentoWhatsapp,
} from '@/lib/db/mapeamentos';
import type { EstadoFormulario } from '@/lib/auth/actions';

/**
 * Ações das telas de Configuração de Eventos (Formulários e WhatsApp).
 *
 * Porte de `eventos-salvar`, `eventos-excluir`, `whatsapp-eventos-salvar`
 * e `whatsapp-eventos-excluir`. Três diferenças em relação ao painel
 * antigo, todas deliberadas:
 *
 *  1. toda ação começa por `requireClientAccess`. Server Action é um
 *     endpoint HTTP como outro qualquer; sem a checagem, bastaria enviar
 *     outro `cliente` no FormData para escrever no banco de outra conta.
 *     O `client_db_name` usado daqui em diante é o que voltou do
 *     catálogo, nunca o texto que veio do formulário;
 *  2. toda escrita é auditada. No painel antigo o log de quem alterou o
 *     mapeamento não existia — havia um único usuário de Basic Auth;
 *  3. o padrão dos booleanos vem da caixa de seleção, não do corpo da
 *     requisição. O endpoint antigo assumia `ativo = 1` quando o campo
 *     vinha ausente (formulário) ou `ativo = 0` (WhatsApp), porque um
 *     cliente HTTP pode simplesmente omitir a chave. Aqui a caixa é
 *     sempre renderizada e desmarcada significa desmarcada nos dois
 *     casos — o que a pessoa vê na tela é o que é gravado.
 */

const clienteSchema = z.string().trim().min(1, 'Cliente não informado');
const idSchema = z.coerce.number().int().positive();

/** Caixa de seleção não marcada não é enviada pelo navegador. */
function marcada(form: FormData, campo: string): boolean {
  return form.get(campo) !== null;
}

function ouNulo(valor: string | undefined): string | null {
  const t = (valor ?? '').trim();
  return t === '' ? null : t;
}

/**
 * Converte a falha em mensagem para a tela.
 *
 * Só violação de chave única vira texto específico; qualquer outro erro
 * do MySQL fica no log do servidor e chega ao navegador como mensagem
 * genérica — mensagem de erro do banco carrega nome de banco e estrutura
 * de tabela (mesmo raciocínio de `rota()` em lib/http.ts).
 */
function falha(erro: unknown, duplicado: string): EstadoFormulario {
  const e = erro as { code?: string } | null;
  if (e?.code === 'ER_DUP_ENTRY') return { erro: duplicado };
  console.error('[mapeamentos] falha ao gravar:', erro);
  return { erro: 'Não foi possível salvar. Tente novamente.' };
}

// -------------------------------------------------------------------
// Formulário Instantâneo
// -------------------------------------------------------------------

const salvarFormSchema = z.object({
  cliente: clienteSchema,
  pipeline_id: z.string().trim().max(255),
  status_id: z.string().trim().max(255),
  // Opcional no schema, obrigatório na regra: etapa de perda envia o
  // campo desabilitado, e campo desabilitado não é enviado pelo
  // navegador. A exigência real está logo abaixo, junto do resto.
  meta_event: z.string().trim().max(255).optional(),
  content_name: z.string().trim().max(255).optional(),
  currency: z.string().trim().max(3).optional(),
  value_type: z.enum(TIPOS_DE_VALOR).optional(),
});

export async function acaoSalvarEventoForm(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const parsed = salvarFormSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = parsed.data;

  const { usuario, conta, db } = await requireClientAccess(dados.cliente);

  // Etapa de perda é o único caso em que a linha existe sem evento: ela
  // não manda nada para a Meta, só dá lugar ao lead perdido no quadro e
  // ao motivo da perda. Fora dela, a exigência e o texto continuam os
  // do endpoint antigo.
  const perda = marcada(form, 'is_lost');
  if (!dados.pipeline_id || !dados.status_id || (!perda && !dados.meta_event)) {
    return {
      erro: 'Campos obrigatórios ausentes: pipeline_id, status_id e evento Meta são obrigatórios.',
    };
  }

  const entrada = {
    pipeline_id: dados.pipeline_id,
    status_id: dados.status_id,
    // Evento digitado antes de marcar a etapa como de perda é apagado
    // aqui: guardá-lo deixaria a linha parecendo que dispara algo.
    meta_event: perda ? '' : (dados.meta_event ?? ''),
    content_name: ouNulo(dados.content_name),
    currency: (dados.currency || 'BRL').toUpperCase(),
    value_type: dados.value_type ?? ('price' as const),
    ativo: marcada(form, 'ativo'),
    is_conversion: marcada(form, 'is_conversion'),
    is_lost: perda,
  };

  let perdaGravada = true;
  try {
    ({ perda_gravada: perdaGravada } = await salvaMapeamentoForm(db, entrada));
  } catch (erro) {
    return falha(erro, 'Já existe um mapeamento para este funil e estágio.');
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.EVENTO_MAPEAMENTO_SALVO,
    clientDb: conta.client_db_name,
    detalhe: { origem: 'formulario', ...entrada },
  });

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/formularios/config`);
  if (perda && !perdaGravada) {
    return {
      erro:
        'O mapeamento foi salvo, mas a marcação de etapa de perda não: o banco deste cliente ' +
        'ainda não tem a coluna. Rode "Banco de Dados/migracao_etapa_perdido_form.sql" e salve ' +
        'de novo.',
    };
  }
  return {
    sucesso: perda
      ? 'Etapa de perda salva. Ela não envia evento nenhum para a Meta.'
      : 'Evento salvo com sucesso.',
  };
}

export async function acaoExcluirEventoForm(form: FormData): Promise<void> {
  const cliente = clienteSchema.parse(form.get('cliente'));
  const id = idSchema.parse(form.get('id'));

  const { usuario, conta, db } = await requireClientAccess(cliente);

  const removido = await excluiMapeamentoForm(db, id);
  if (removido) {
    await registraAuditoria({
      userId: usuario.id,
      userEmail: usuario.email,
      acao: ACOES.EVENTO_MAPEAMENTO_EXCLUIDO,
      clientDb: conta.client_db_name,
      detalhe: { origem: 'formulario', id },
    });
  }

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/formularios/config`);
}

// -------------------------------------------------------------------
// WhatsApp
// -------------------------------------------------------------------

const salvarWhatsappSchema = z.object({
  cliente: clienteSchema,
  id: z.coerce.number().int().positive().optional(),
  estagio: z.string().trim().max(60),
  meta_event: z.string().trim().max(255).optional(),
  content_name: z.string().trim().max(255).optional(),
  currency: z.string().trim().max(3).optional(),
  value: z.coerce.number().optional(),
});

export async function acaoSalvarEventoWhatsapp(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const bruto = Object.fromEntries(form);
  // Linha nova manda `id` vazio; `z.coerce.number()` transformaria '' em 0.
  if (bruto.id === '') delete bruto.id;

  const parsed = salvarWhatsappSchema.safeParse(bruto);
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = parsed.data;

  const { usuario, conta, db } = await requireClientAccess(dados.cliente);

  if (!dados.estagio) return { erro: 'Nome do estágio é obrigatório.' };

  const ativo = marcada(form, 'ativo');
  const metaEvent = ouNulo(dados.meta_event);
  // Estágio ativo sem evento dispararia uma chamada à Meta sem nome de
  // evento — o endpoint antigo barrava com este mesmo texto.
  if (ativo && !metaEvent) {
    return { erro: 'Escolha o Evento Meta antes de ativar o disparo para este estágio.' };
  }

  const entrada = {
    id: dados.id ?? null,
    estagio: dados.estagio,
    meta_event: metaEvent,
    content_name: ouNulo(dados.content_name),
    currency: (dados.currency || 'BRL').toUpperCase(),
    value: Number(dados.value) || 0,
    ativo,
    is_conversion: marcada(form, 'is_conversion'),
  };

  try {
    await salvaMapeamentoWhatsapp(db, entrada);
  } catch (erro) {
    return falha(erro, 'Já existe um estágio com esse nome.');
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.EVENTO_MAPEAMENTO_SALVO,
    clientDb: conta.client_db_name,
    detalhe: { origem: 'whatsapp', ...entrada },
  });

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/whatsapp/estagios`);
  return { sucesso: 'Mapeamento salvo com sucesso.' };
}

export async function acaoExcluirEventoWhatsapp(form: FormData): Promise<void> {
  const cliente = clienteSchema.parse(form.get('cliente'));
  const id = idSchema.parse(form.get('id'));

  const { usuario, conta, db } = await requireClientAccess(cliente);

  const removido = await excluiMapeamentoWhatsapp(db, id);
  if (removido) {
    await registraAuditoria({
      userId: usuario.id,
      userEmail: usuario.email,
      acao: ACOES.EVENTO_MAPEAMENTO_EXCLUIDO,
      clientDb: conta.client_db_name,
      detalhe: { origem: 'whatsapp', id },
    });
  }

  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/whatsapp/estagios`);
}
