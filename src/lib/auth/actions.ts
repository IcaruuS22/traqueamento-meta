'use server';

import { z } from 'zod';
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { signIn, signOut } from '@/auth';
import { ACOES, registraAuditoria } from '@/lib/audit';
import {
  buscaConviteValido,
  buscaUsuarioPorEmail,
  concluiRedefinicaoSenha,
  consomeConvite,
  criaUsuario,
  iniciaRedefinicaoSenha,
} from '@/lib/auth/usuarios';
import { enviaEmailRedefinicao } from '@/lib/email';

export type EstadoFormulario = {
  erro?: string;
  sucesso?: string;
};

const SENHA_MIN = 10;

const senhaSchema = z
  .string()
  .min(SENHA_MIN, `A senha precisa ter pelo menos ${SENHA_MIN} caracteres`);

// -------------------------------------------------------------------
// Login
// -------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  senha: z.string().min(1, 'Informe a senha'),
  next: z.string().optional(),
});

export async function acaoLogin(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const parsed = loginSchema.safeParse({
    email: form.get('email'),
    senha: form.get('senha'),
    next: form.get('next') ?? undefined,
  });
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  // `next` vem da URL, então poderia apontar para outro domínio. Só é
  // aceito se for um caminho interno.
  const destinoBruto = parsed.data.next ?? '/app';
  const destino =
    destinoBruto.startsWith('/') && !destinoBruto.startsWith('//') ? destinoBruto : '/app';

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      senha: parsed.data.senha,
      redirect: false,
    });
  } catch (erro) {
    if (erro instanceof AuthError) {
      // Mensagem única para credencial errada, conta pendente e conta
      // bloqueada. Distinguir permitiria descobrir quais e-mails existem.
      return { erro: 'E-mail ou senha incorretos, ou a conta ainda não foi liberada.' };
    }
    throw erro;
  }

  const usuario = await buscaUsuarioPorEmail(parsed.data.email);
  if (usuario) {
    await registraAuditoria({
      userId: usuario.id,
      userEmail: usuario.email,
      acao: ACOES.LOGIN,
    });
  }

  redirect(destino);
}

export async function acaoLogout(): Promise<void> {
  // `signOut({ redirectTo })` resolve o destino contra `AUTH_URL`, não
  // contra a origem de onde veio o clique: sair de um endereço diferente
  // do configurado mandava o navegador para a origem do ambiente e a
  // página não abria. Encerrar a sessão e redirecionar aqui mantém o
  // caminho relativo, que o navegador resolve na origem certa qualquer
  // que seja a porta ou o domínio.
  await signOut({ redirect: false });
  redirect('/login');
}

// -------------------------------------------------------------------
// Cadastro por convite
// -------------------------------------------------------------------

const cadastroConviteSchema = z
  .object({
    token: z.string().min(10, 'Convite inválido'),
    nome: z.string().min(2, 'Informe seu nome'),
    senha: senhaSchema,
    confirmacao: z.string(),
  })
  .refine((d) => d.senha === d.confirmacao, {
    message: 'As senhas não coincidem',
    path: ['confirmacao'],
  });

export async function acaoCadastroPorConvite(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const parsed = cadastroConviteSchema.safeParse({
    token: form.get('token'),
    nome: form.get('nome'),
    senha: form.get('senha'),
    confirmacao: form.get('confirmacao'),
  });
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  let email: string;
  try {
    const usuario = await consomeConvite(parsed.data.token, {
      nome: parsed.data.nome,
      senha: parsed.data.senha,
    });
    email = usuario.email;
    await registraAuditoria({
      userId: usuario.id,
      userEmail: usuario.email,
      acao: ACOES.CONTA_CRIADA,
      detalhe: { via: 'convite' },
    });
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : 'Falha ao criar a conta' };
  }

  await signIn('credentials', { email, senha: parsed.data.senha, redirect: false });
  redirect('/app');
}

/** Lê o convite para mostrar o e-mail na tela antes do cadastro. */
export async function consultaConvite(token: string) {
  if (!token) return null;
  const convite = await buscaConviteValido(token);
  if (!convite) return null;
  return { email: convite.email, papel: convite.role, clientes: convite.client_db_names ?? [] };
}

// -------------------------------------------------------------------
// Solicitação de acesso (cadastro sem convite)
// -------------------------------------------------------------------

const solicitacaoSchema = z
  .object({
    nome: z.string().min(2, 'Informe seu nome'),
    email: z.string().email('E-mail inválido'),
    senha: senhaSchema,
    confirmacao: z.string(),
  })
  .refine((d) => d.senha === d.confirmacao, {
    message: 'As senhas não coincidem',
    path: ['confirmacao'],
  });

/**
 * Cria uma conta `pendente`, sem vínculo com nenhum cliente.
 *
 * A pessoa não consegue entrar até um administrador aprovar em
 * /admin/usuarios. É assim de propósito: um cadastro aberto que já
 * concedesse acesso seria uma porta para qualquer um ver dados de
 * clientes reais.
 */
export async function acaoSolicitarAcesso(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const parsed = solicitacaoSchema.safeParse({
    nome: form.get('nome'),
    email: form.get('email'),
    senha: form.get('senha'),
    confirmacao: form.get('confirmacao'),
  });
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const mensagemSucesso =
    'Solicitação registrada. Seu acesso precisa ser liberado por um administrador — você será avisado por e-mail.';

  try {
    const id = await criaUsuario({
      email: parsed.data.email,
      senha: parsed.data.senha,
      nome: parsed.data.nome,
      papel: 'cliente',
      status: 'pendente',
    });
    await registraAuditoria({
      userId: id,
      userEmail: parsed.data.email,
      acao: ACOES.CONTA_CRIADA,
      detalhe: { via: 'solicitacao' },
    });
  } catch {
    // Mesma mensagem quando o e-mail já existe: senão a tela vira um
    // verificador de quais e-mails estão cadastrados.
    return { sucesso: mensagemSucesso };
  }

  return { sucesso: mensagemSucesso };
}

// -------------------------------------------------------------------
// Redefinição de senha
// -------------------------------------------------------------------

export async function acaoRecuperarSenha(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const email = String(form.get('email') ?? '').trim();
  if (!z.string().email().safeParse(email).success) {
    return { erro: 'E-mail inválido' };
  }

  const token = await iniciaRedefinicaoSenha(email);
  if (token) {
    await enviaEmailRedefinicao(email, token);
  }

  // Resposta idêntica exista ou não a conta.
  return {
    sucesso: 'Se existir uma conta com este e-mail, o link de redefinição foi enviado.',
  };
}

const redefinirSchema = z
  .object({
    token: z.string().min(10, 'Link inválido'),
    senha: senhaSchema,
    confirmacao: z.string(),
  })
  .refine((d) => d.senha === d.confirmacao, {
    message: 'As senhas não coincidem',
    path: ['confirmacao'],
  });

export async function acaoRedefinirSenha(
  _estado: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const parsed = redefinirSchema.safeParse({
    token: form.get('token'),
    senha: form.get('senha'),
    confirmacao: form.get('confirmacao'),
  });
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const ok = await concluiRedefinicaoSenha(parsed.data.token, parsed.data.senha);
  if (!ok) {
    return { erro: 'Link inválido ou expirado. Solicite uma nova redefinição.' };
  }

  await registraAuditoria({ acao: ACOES.SENHA_REDEFINIDA });
  redirect('/login?redefinida=1');
}
