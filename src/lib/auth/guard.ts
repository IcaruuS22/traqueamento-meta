import 'server-only';
import { cache } from 'react';
import { auth } from '@/auth';
import { notFound, redirect } from 'next/navigation';
import {
  naoAutenticado,
  semPermissao,
  naoEncontrado,
  entradaInvalida,
  HttpError,
} from '@/lib/http';
import { buscaAdAccount, BancoCliente, type AdAccount } from '@/lib/db/cliente';
import { temVinculo, listaVinculos } from '@/lib/auth/usuarios';

export type SessaoUsuario = {
  id: number;
  email: string;
  nome: string;
  papel: 'admin' | 'cliente';
};

/**
 * ESTE ARQUIVO É A BARREIRA ENTRE CLIENTES.
 *
 * Nenhuma rota ou página pode tocar em um banco `cliente_*` sem passar
 * por `requireClientAccess`. O sistema atual valida apenas se o cliente
 * EXISTE em `ad_accounts` — o que bastava quando havia um único usuário
 * Basic Auth. Com contas por pessoa, validar só a existência significa
 * que trocar `?client_db=` na URL dá acesso aos dados de outro cliente.
 *
 * Toda alteração aqui deve ser acompanhada de execução do teste de
 * autorização descrito na Fase 4 do PLANO_IMPLEMENTACAO.md.
 */

/** Exige sessão válida. Memoizada por request (chamada no layout do app,
 * no layout do cliente e nas páginas — sem o memo, `auth()` repetia a cada
 * uma). */
export const requireAuth = cache(async function requireAuth(): Promise<SessaoUsuario> {
  const sessao = await auth();
  if (!sessao?.user?.id) throw naoAutenticado();
  return {
    id: Number(sessao.user.id),
    email: sessao.user.email,
    nome: sessao.user.name,
    papel: sessao.user.role,
  };
});

/** Exige sessão com papel de administrador. */
export async function requireAdmin(): Promise<SessaoUsuario> {
  const usuario = await requireAuth();
  if (usuario.papel !== 'admin') throw semPermissao('Esta área é restrita a administradores');
  return usuario;
}

export type ContextoCliente = {
  usuario: SessaoUsuario;
  conta: AdAccount;
  /** Handle de acesso ao banco daquele cliente. */
  db: BancoCliente;
};

/**
 * Exige sessão E acesso ao cliente informado.
 *
 * Ordem das checagens, que importa:
 *  1. sessão válida;
 *  2. o cliente existe no catálogo (`ad_accounts`) — isto também é o que
 *     transforma um parâmetro vindo do usuário em um nome de banco
 *     confiável, já que o valor usado daqui em diante é o que veio do
 *     catálogo, não o que veio da URL;
 *  3. `admin` passa direto; `cliente` precisa de vínculo explícito em
 *     `app_user_clients`.
 *
 * O 403 é idêntico ao de "cliente existe mas não é seu" e ao de "cliente
 * não existe" seria diferente — por isso o passo 2 responde 404 apenas
 * para admin. Para usuário comum, cliente inexistente e cliente alheio
 * respondem os dois 403, senão a diferença de resposta permite descobrir
 * quais clientes existem no sistema.
 */
export const requireClientAccess = cache(async function requireClientAccess(
  clientDbBruto: unknown,
): Promise<ContextoCliente> {
  // `cache` (React) memoiza por request: o layout do cliente e a página
  // chamam este guard com o MESMO argumento (`decodeURIComponent(cliente)`),
  // e sem isso cada navegação fazia 2× as idas ao banco remoto de
  // `ad_accounts` (+ vínculo) — o grosso do "trava ao clicar na aba". Com
  // o memo, as duas renderizações compartilham uma única execução.
  const usuario = await requireAuth();

  const clientDb = String(clientDbBruto ?? '').trim();
  if (!clientDb) throw entradaInvalida('Parâmetro client_db é obrigatório');

  const conta = await buscaAdAccount(clientDb);

  if (!conta) {
    if (usuario.papel === 'admin') throw naoEncontrado('Cliente não encontrado');
    throw semPermissao('Sem acesso a este cliente');
  }

  if (usuario.papel !== 'admin') {
    const vinculado = await temVinculo(usuario.id, conta.client_db_name);
    if (!vinculado) throw semPermissao('Sem acesso a este cliente');
  }

  return { usuario, conta, db: new BancoCliente(conta.client_db_name) };
});

/**
 * Versão de `requireClientAccess` para PÁGINAS.
 *
 * Uma rota de API converte `HttpError` em resposta pelo invólucro
 * `rota()`. Uma página não tem esse invólucro: a exceção sobe até o Next
 * e vira 500 com a tela de erro genérica — foi o que o teste de
 * autorização da Fase 4 encontrou ao abrir a URL de um cliente alheio.
 *
 * Aqui a conversão é feita com os mecanismos do próprio Next: sessão
 * ausente volta para o login, e tanto "sem vínculo" quanto "não existe"
 * caem no mesmo `notFound()`. Respostas iguais de propósito — se cliente
 * alheio respondesse diferente de cliente inexistente, dava para varrer
 * nomes de banco pela URL.
 */
export async function requireClientAccessPagina(clientDbBruto: unknown): Promise<ContextoCliente> {
  try {
    return await requireClientAccess(clientDbBruto);
  } catch (erro) {
    if (erro instanceof HttpError) {
      if (erro.status === 401) redirect('/login');
      notFound();
    }
    throw erro;
  }
}

/**
 * Lista os clientes visíveis para o usuário da sessão.
 * `admin` vê todos; `cliente` vê apenas os vinculados.
 */
export async function clientesDoUsuario(usuario: SessaoUsuario): Promise<AdAccount[]> {
  const { listaAdAccounts } = await import('@/lib/db/cliente');
  const todos = await listaAdAccounts();
  if (usuario.papel === 'admin') return todos;

  const permitidos = new Set(await listaVinculos(usuario.id));
  return todos.filter((c) => permitidos.has(c.client_db_name));
}
