'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import {
  alteraPapel,
  alteraStatus,
  buscaUsuarioPorId,
  criaConvite,
  defineVinculos,
} from '@/lib/auth/usuarios';
import { enviaEmailContaAprovada, enviaEmailConvite } from '@/lib/email';
import { env } from '@/lib/env';
import type { EstadoFormulario } from '@/lib/auth/actions';

/**
 * Ações da tela /admin/usuarios.
 *
 * Toda função aqui começa com `requireAdmin()`. Server Action é um
 * endpoint HTTP como outro qualquer: sem a checagem, bastaria a
 * requisição certa para promover alguém a administrador.
 */

const ROTA = '/admin/usuarios';

const convidarSchema = z.object({
  email: z.string().email('E-mail inválido'),
  papel: z.enum(['admin', 'cliente']),
  clientes: z.array(z.string()),
});

export async function acaoConvidar(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const admin = await requireAdmin();

  const parsed = convidarSchema.safeParse({
    email: form.get('email'),
    papel: form.get('papel') ?? 'cliente',
    clientes: form.getAll('clientes').map(String),
  });
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const { token } = await criaConvite({
    email: parsed.data.email,
    papel: parsed.data.papel,
    clientes: parsed.data.clientes,
    convidadoPor: admin.id,
  });

  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.CONVITE_CRIADO,
    detalhe: { email: parsed.data.email, papel: parsed.data.papel, clientes: parsed.data.clientes },
  });

  const enviado = await enviaEmailConvite(parsed.data.email, token);
  revalidatePath(ROTA);

  if (enviado) {
    return { sucesso: `Convite enviado para ${parsed.data.email}.` };
  }
  // Sem SMTP o convite existe do mesmo jeito — o administrador entrega o
  // link pelo canal que preferir.
  return {
    sucesso: `Convite criado. Envio por e-mail indisponível; entregue este link: ${env.appUrl}/signup?convite=${token}`,
  };
}

const idSchema = z.coerce.number().int().positive();

export async function acaoAprovar(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = idSchema.parse(form.get('userId'));

  const usuario = await buscaUsuarioPorId(userId);
  if (!usuario) return;

  await alteraStatus(userId, 'ativo');
  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.CONTA_APROVADA,
    detalhe: { alvo: usuario.email },
  });
  await enviaEmailContaAprovada(usuario.email);
  revalidatePath(ROTA);
}

export async function acaoBloquear(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = idSchema.parse(form.get('userId'));

  // Um administrador não bloqueia a própria conta: com um único admin no
  // sistema, isso tranca todo mundo do lado de fora.
  if (userId === admin.id) return;

  const usuario = await buscaUsuarioPorId(userId);
  if (!usuario) return;

  await alteraStatus(userId, 'bloqueado');
  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.CONTA_BLOQUEADA,
    detalhe: { alvo: usuario.email },
  });
  revalidatePath(ROTA);
}

export async function acaoDefinirVinculos(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = idSchema.parse(form.get('userId'));
  const clientes = form.getAll('clientes').map(String);

  const usuario = await buscaUsuarioPorId(userId);
  if (!usuario) return;

  await defineVinculos(userId, clientes);
  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.VINCULO_ALTERADO,
    detalhe: { alvo: usuario.email, clientes },
  });
  revalidatePath(ROTA);
}

export async function acaoDefinirPapel(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = idSchema.parse(form.get('userId'));
  const papel = z.enum(['admin', 'cliente']).parse(form.get('papel'));

  // Mesmo motivo do bloqueio: rebaixar a si mesmo pode deixar o sistema
  // sem nenhum administrador.
  if (userId === admin.id) return;

  const usuario = await buscaUsuarioPorId(userId);
  if (!usuario) return;

  await alteraPapel(userId, papel);
  await registraAuditoria({
    userId: admin.id,
    userEmail: admin.email,
    acao: ACOES.VINCULO_ALTERADO,
    detalhe: { alvo: usuario.email, papel },
  });
  revalidatePath(ROTA);
}
