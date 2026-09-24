'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { buscaAdAccount, salvaTestEventCode } from '@/lib/db/cliente';
import { atualizaSite, criaSite, faltaColunaRolagem, removeSite, trocaTokenSite } from '@/lib/db/paginas-sites';
import { lacunaDeEsquema } from '@/lib/db/pool';
import { normalizaDominios } from '@/lib/paginas-web';
import { ehOpcaoRolagem } from '@/lib/paginas-rolagem';
import type { EstadoFormulario } from '@/lib/auth/actions';

/**
 * Cadastro dos sites rastreados — só o administrador mexe.
 *
 * A tela fica dentro do painel do cliente (Página de vendas ›
 * Configuração), mas só aparece para o administrador: é aqui que mora o
 * token do webhook de compra, e quem tem o token consegue lançar
 * Purchase no pixel do cliente.
 *
 * O site não tem nada do Kommo. Página de vendas é um produto separado
 * dos Formulários Instantâneos e funciona em cliente sem CRM.
 */

const MSG_SEM_TABELA =
  'O banco central ainda não tem a tabela de sites. Rode "Banco de Dados/migracao_paginas_central.sql" e tente de novo.';

const MSG_SEM_COLUNA_ROLAGEM =
  'O banco central ainda não tem a coluna do ViewContent por rolagem. Rode "Banco de Dados/migracao_paginas_viewcontent.sql" — ou deixe o ViewContent desligado por enquanto.';

const schemaSite = z.object({
  client_db: z.string().trim().min(1).max(64),
  id: z.coerce.number().int().positive().optional(),
  nome: z.string().trim().min(2, 'Dê um nome ao site.').max(120),
  dominios: z.string().max(2000),
  ativo: z.boolean(),
  viewcontent_rolagem: z.coerce
    .number()
    .int()
    .refine(ehOpcaoRolagem, 'Escolha uma porcentagem da lista para o ViewContent.'),
});

/** Configuração e métricas mostram o cadastro: as duas revalidam. */
function revalidaTelas(clientDb: string): void {
  const base = `/app/${encodeURIComponent(clientDb)}/paginas`;
  revalidatePath(base);
  revalidatePath(`${base}/config`);
}

export async function acaoSalvarSite(_estado: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const admin = await requireAdmin();

  const idBruto = String(form.get('id') ?? '').trim();
  const parsed = schemaSite.safeParse({
    client_db: form.get('client_db'),
    id: idBruto === '' ? undefined : idBruto,
    nome: form.get('nome') ?? '',
    dominios: form.get('dominios') ?? '',
    ativo: form.get('ativo') === 'on',
    viewcontent_rolagem: form.get('viewcontent_rolagem') ?? 0,
  });
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  const d = parsed.data;

  const conta = await buscaAdAccount(d.client_db);
  if (!conta) return { erro: 'Cliente não encontrado no catálogo.' };

  const { dominios, invalidos } = normalizaDominios(d.dominios);
  if (invalidos.length) return { erro: `Domínio inválido: ${invalidos.slice(0, 3).join(', ')}` };
  if (!dominios.length) {
    return { erro: 'Cadastre ao menos um domínio. Sem domínio, o site não aceita evento de página nenhuma.' };
  }

  const dados = { nome: d.nome, dominios, ativo: d.ativo, viewcontent_rolagem: d.viewcontent_rolagem };

  let id = d.id ?? null;
  try {
    if (id) {
      const ok = await atualizaSite(conta.client_db_name, id, dados);
      if (!ok) return { erro: 'Site não encontrado para este cliente.' };
    } else {
      id = await criaSite(conta.client_db_name, dados);
    }
  } catch (erro) {
    if (faltaColunaRolagem(erro)) return { erro: MSG_SEM_COLUNA_ROLAGEM };
    if (lacunaDeEsquema(erro)) return { erro: MSG_SEM_TABELA };
    console.error('[paginas] falha ao salvar o site', conta.client_db_name, erro);
    return { erro: 'Não foi possível salvar o site.' };
  }

  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.PAGINA_SITE_SALVO,
    clientDb: conta.client_db_name,
    detalhe: {
      site_id: id,
      novo: !d.id,
      nome: d.nome,
      dominios,
      ativo: d.ativo,
      viewcontent_rolagem: d.viewcontent_rolagem,
    },
  });

  revalidaTelas(conta.client_db_name);
  return { sucesso: d.id ? 'Site atualizado.' : 'Site criado. Copie a tag abaixo para a página.' };
}

const schemaId = z.object({
  client_db: z.string().trim().min(1).max(64),
  id: z.coerce.number().int().positive(),
});

export async function acaoExcluirSite(_estado: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const admin = await requireAdmin();
  const parsed = schemaId.safeParse({ client_db: form.get('client_db'), id: form.get('id') });
  if (!parsed.success) return { erro: 'Dados inválidos' };

  const conta = await buscaAdAccount(parsed.data.client_db);
  if (!conta) return { erro: 'Cliente não encontrado no catálogo.' };

  try {
    if (!(await removeSite(conta.client_db_name, parsed.data.id))) {
      return { erro: 'Site não encontrado para este cliente.' };
    }
  } catch (erro) {
    if (lacunaDeEsquema(erro)) return { erro: MSG_SEM_TABELA };
    console.error('[paginas] falha ao excluir o site', conta.client_db_name, erro);
    return { erro: 'Não foi possível excluir o site.' };
  }

  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.PAGINA_SITE_EXCLUIDO,
    clientDb: conta.client_db_name,
    detalhe: { site_id: parsed.data.id },
  });

  revalidaTelas(conta.client_db_name);
  // O cartão do site some com a revalidação, levando junto qualquer aviso
  // que o formulário mostrasse; a página lê `excluido=1` e avisa por ela.
  // Fora de try: `redirect` funciona lançando um erro próprio do Next.
  redirect(`/app/${encodeURIComponent(conta.client_db_name)}/paginas/config?excluido=1`);
}

export async function acaoTrocarTokenSite(_estado: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const admin = await requireAdmin();
  const parsed = schemaId.safeParse({ client_db: form.get('client_db'), id: form.get('id') });
  if (!parsed.success) return { erro: 'Dados inválidos' };

  const conta = await buscaAdAccount(parsed.data.client_db);
  if (!conta) return { erro: 'Cliente não encontrado no catálogo.' };

  try {
    if (!(await trocaTokenSite(conta.client_db_name, parsed.data.id))) {
      return { erro: 'Site não encontrado para este cliente.' };
    }
  } catch (erro) {
    if (lacunaDeEsquema(erro)) return { erro: MSG_SEM_TABELA };
    console.error('[paginas] falha ao trocar o token', conta.client_db_name, erro);
    return { erro: 'Não foi possível trocar o token.' };
  }

  // O token em si não vai para a auditoria: o log é lido por mais gente
  // do que quem deveria poder lançar compra no pixel do cliente.
  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.PAGINA_TOKEN_TROCADO,
    clientDb: conta.client_db_name,
    detalhe: { site_id: parsed.data.id },
  });

  revalidaTelas(conta.client_db_name);
  return { sucesso: 'Token trocado. Atualize a URL do webhook na plataforma de checkout.' };
}

/**
 * Test Event Code da conta.
 *
 * O campo já existia na tela de WhatsApp, mas ele vale para toda a CAPI
 * do cliente — inclusive os eventos da Página de vendas. Cliente que não
 * usa WhatsApp não tem aquela aba no menu e ficava sem lugar nenhum para
 * informar o código; daí a cópia aqui, gravando na mesma coluna.
 */
const schemaTestEvent = z.object({
  client_db: z.string().trim().min(1).max(64),
  // A Meta gera algo como `TEST12345`; o limite é o da coluna.
  codigo: z.string().trim().max(64),
});

export async function acaoSalvarTestEventCode(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const admin = await requireAdmin();
  const parsed = schemaTestEvent.safeParse({
    client_db: form.get('client_db'),
    codigo: form.get('codigo') ?? '',
  });
  if (!parsed.success) return { erro: 'Dados inválidos' };

  const conta = await buscaAdAccount(parsed.data.client_db);
  if (!conta) return { erro: 'Cliente não encontrado no catálogo.' };

  const codigo = parsed.data.codigo || null;
  try {
    if (!(await salvaTestEventCode(conta.client_db_name, codigo))) {
      return { erro: 'Cliente não encontrado no catálogo.' };
    }
  } catch (erro) {
    console.error('[paginas] falha ao salvar o test event code', conta.client_db_name, erro);
    return { erro: 'Não foi possível salvar o código.' };
  }

  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.PAGINA_TEST_EVENT_CODE,
    clientDb: conta.client_db_name,
    // O código em si entra: não é segredo e saber qual estava valendo é o
    // que explica um evento que apareceu só em "Testar eventos".
    detalhe: { codigo },
  });

  revalidaTelas(conta.client_db_name);
  revalidatePath(`/app/${encodeURIComponent(conta.client_db_name)}/whatsapp`);
  return {
    sucesso: codigo
      ? 'Código salvo. Os eventos passam a chegar em “Testar eventos” até você limpar o campo.'
      : 'Código removido. Os eventos voltam a contar normalmente.',
  };
}
