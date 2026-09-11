'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { buscaAdAccount } from '@/lib/db/cliente';
import { atualizaSite, criaSite, removeSite, trocaTokenSite } from '@/lib/db/paginas-sites';
import { lacunaDeEsquema } from '@/lib/db/pool';
import { normalizaDominios } from '@/lib/paginas-web';
import type { EstadoFormulario } from '@/lib/auth/actions';

/**
 * Cadastro dos sites rastreados — só o administrador mexe.
 *
 * O cliente vê o resultado (a tela de Páginas de vendas), mas não o
 * cadastro: é aqui que mora o token do webhook de compra, e quem tem o
 * token consegue lançar Purchase no pixel do cliente.
 */

const MSG_SEM_TABELA =
  'O banco central ainda não tem a tabela de sites. Rode "Banco de Dados/migracao_paginas_central.sql" e tente de novo.';

const idKommo = z
  .string()
  .trim()
  .max(20)
  .refine((v) => v === '' || /^\d+$/.test(v), 'Use só o número do ID.')
  .transform((v) => (v === '' ? null : v));

const schemaSite = z.object({
  client_db: z.string().trim().min(1).max(64),
  id: z.coerce.number().int().positive().optional(),
  nome: z.string().trim().min(2, 'Dê um nome ao site.').max(120),
  dominios: z.string().max(2000),
  kommo_pipeline_id: idKommo,
  kommo_status_id: idKommo,
  envia_kommo: z.boolean(),
  ativo: z.boolean(),
});

function caminhoDaTela(clientDb: string): string {
  return `/admin/clientes/${encodeURIComponent(clientDb)}/sites`;
}

export async function acaoSalvarSite(_estado: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const admin = await requireAdmin();

  const idBruto = String(form.get('id') ?? '').trim();
  const parsed = schemaSite.safeParse({
    client_db: form.get('client_db'),
    id: idBruto === '' ? undefined : idBruto,
    nome: form.get('nome') ?? '',
    dominios: form.get('dominios') ?? '',
    kommo_pipeline_id: form.get('kommo_pipeline_id') ?? '',
    kommo_status_id: form.get('kommo_status_id') ?? '',
    envia_kommo: form.get('envia_kommo') === 'on',
    ativo: form.get('ativo') === 'on',
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
  if (d.kommo_status_id && !d.kommo_pipeline_id) {
    return { erro: 'A etapa do Kommo só vale junto com o funil. Preencha o ID do funil também.' };
  }

  const dados = {
    nome: d.nome,
    dominios,
    kommo_pipeline_id: d.kommo_pipeline_id,
    kommo_status_id: d.kommo_status_id,
    envia_kommo: d.envia_kommo,
    ativo: d.ativo,
  };

  let id = d.id ?? null;
  try {
    if (id) {
      const ok = await atualizaSite(conta.client_db_name, id, dados);
      if (!ok) return { erro: 'Site não encontrado para este cliente.' };
    } else {
      id = await criaSite(conta.client_db_name, dados);
    }
  } catch (erro) {
    if (lacunaDeEsquema(erro)) return { erro: MSG_SEM_TABELA };
    console.error('[paginas] falha ao salvar o site', conta.client_db_name, erro);
    return { erro: 'Não foi possível salvar o site.' };
  }

  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.PAGINA_SITE_SALVO,
    clientDb: conta.client_db_name,
    detalhe: { site_id: id, novo: !d.id, nome: d.nome, dominios, envia_kommo: d.envia_kommo, ativo: d.ativo },
  });

  revalidatePath(caminhoDaTela(conta.client_db_name));
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

  revalidatePath(caminhoDaTela(conta.client_db_name));
  return { sucesso: 'Site excluído. Os eventos já gravados continuam no painel.' };
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

  revalidatePath(caminhoDaTela(conta.client_db_name));
  return { sucesso: 'Token trocado. Atualize a URL do webhook na plataforma de checkout.' };
}
