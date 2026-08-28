import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Prova de vida da conexão com o MySQL do VPS.
 *
 * Existe desde a Fase 0 e continua útil depois: é o endpoint usado para
 * o teste de carga leve da Fase 4 (requisições simultâneas observando
 * `Threads_connected` no MySQL).
 *
 * Não exige sessão de propósito — precisa funcionar antes de a
 * autenticação existir, e não expõe nada além de uma contagem.
 */
export async function GET() {
  const inicio = Date.now();
  try {
    const linha = await queryOne<{ total: number }>(
      'SELECT COUNT(*) AS total FROM trakeamento_controle.ad_accounts',
    );
    return NextResponse.json({
      ok: true,
      clientes: Number(linha?.total ?? 0),
      latencia_ms: Date.now() - inicio,
    });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return NextResponse.json(
      { ok: false, erro: mensagem, latencia_ms: Date.now() - inicio },
      { status: 503 },
    );
  }
}
