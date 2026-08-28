import { NextResponse } from 'next/server';

/**
 * Erro com status HTTP. Lançado pelas camadas de guarda e de dados, e
 * convertido em resposta por `rota()`.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detalhe?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const naoAutenticado = (msg = 'Não autenticado') => new HttpError(401, msg);
export const semPermissao = (msg = 'Sem permissão') => new HttpError(403, msg);
export const naoEncontrado = (msg = 'Não encontrado') => new HttpError(404, msg);
export const entradaInvalida = (msg = 'Dados inválidos', detalhe?: unknown) =>
  new HttpError(400, msg, detalhe);

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<unknown>;

/**
 * Invólucro padrão das rotas da API.
 *
 * Centraliza a conversão de erro em resposta para que nenhuma rota
 * precise repetir try/catch — e, mais importante, para que uma exceção
 * inesperada nunca vaze `stack trace` ou mensagem do MySQL (que pode
 * conter nome de banco e estrutura de tabela) para o navegador. Só
 * `HttpError`, que é sempre construído por nós, tem sua mensagem
 * repassada; o resto vira 500 genérico com o detalhe apenas no log.
 */
export function rota<Ctx = unknown>(handler: Handler<Ctx>) {
  return async (req: Request, ctx: Ctx): Promise<NextResponse> => {
    try {
      const dados = await handler(req, ctx);
      // `Response` e não `NextResponse`: a rota de mídia devolve bytes
      // com cabeçalho próprio, e um `Response` cru passando por aqui
      // viraria JSON de objeto vazio.
      if (dados instanceof Response) return dados as NextResponse;
      return NextResponse.json({ ok: true, data: dados });
    } catch (erro) {
      if (erro instanceof HttpError) {
        return NextResponse.json(
          { ok: false, erro: erro.message, detalhe: erro.detalhe },
          { status: erro.status },
        );
      }
      console.error('[rota] erro inesperado:', erro);
      return NextResponse.json(
        { ok: false, erro: 'Erro interno. Tente novamente.' },
        { status: 500 },
      );
    }
  };
}

/** Lê os parâmetros de query de uma requisição como objeto simples. */
export function queryParams(req: Request): Record<string, string> {
  const url = new URL(req.url);
  const out: Record<string, string> = {};
  url.searchParams.forEach((valor, chave) => {
    out[chave] = valor;
  });
  return out;
}

/** Lê e valida o corpo JSON com um schema Zod. */
export async function corpoJson<T>(
  req: Request,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
): Promise<T> {
  let bruto: unknown;
  try {
    bruto = await req.json();
  } catch {
    throw entradaInvalida('Corpo da requisição não é um JSON válido');
  }
  const resultado = schema.safeParse(bruto);
  if (!resultado.success) {
    throw entradaInvalida('Dados inválidos', resultado.error);
  }
  return resultado.data as T;
}
