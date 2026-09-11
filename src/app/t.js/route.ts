import { buscaSitePorChave } from '@/lib/db/paginas-sites';
import { env } from '@/lib/env';
import { montaScript, scriptVazio } from '@/lib/paginas-script';

/**
 * `GET /t.js?k=CHAVE` — o script de rastreio que o dono da página cola
 * no site.
 *
 * Fica fora de `/api` de propósito: a regra de `next.config.ts` que
 * proíbe cache vale para `/api/*`, e este arquivo é o mesmo para todo
 * visitante do site. Cinco minutos de cache no navegador e na CDN seguram
 * o volume sem deixar uma troca de pixel esperando muito.
 *
 * Chave desconhecida ou site desativado devolvem um script vazio que só
 * define `trk` como função muda — um `trk('lead')` no código da página
 * não pode virar erro de JavaScript só porque o rastreio foi desligado.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CABECALHOS = {
  'Content-Type': 'application/javascript; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
};

export async function GET(req: Request) {
  const chave = new URL(req.url).searchParams.get('k') ?? '';

  let site: Awaited<ReturnType<typeof buscaSitePorChave>> = null;
  try {
    site = await buscaSitePorChave(chave);
  } catch (e) {
    console.error('[t.js] falha ao buscar o site', e);
    return new Response(scriptVazio('indisponível'), {
      headers: { ...CABECALHOS, 'Cache-Control': 'no-store' },
    });
  }

  if (!site || !site.ativo) {
    return new Response(scriptVazio(site ? 'site desativado' : 'chave desconhecida'), {
      headers: { ...CABECALHOS, 'Cache-Control': 'public, max-age=60' },
    });
  }

  // Com AUTH_URL definido, o endereço público é ele; sem, a própria
  // origem da requisição — que é o que funciona numa prévia da Vercel.
  const base = (process.env.AUTH_URL ? env.appUrl : new URL(req.url).origin).replace(/\/+$/, '');

  return new Response(
    montaScript({
      endpoint: `${base}/api/rastreio/coleta`,
      chave: site.site_key,
      pixel: site.meta_pixel_dataset_id,
    }),
    { headers: { ...CABECALHOS, 'Cache-Control': 'public, max-age=300' } },
  );
}
