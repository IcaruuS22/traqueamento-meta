import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAdminPagina } from '@/lib/auth/guard';
import { buscaAdAccount, buscaTestEventCode } from '@/lib/db/cliente';
import { listaSitesComToken, type SitePaginaComToken } from '@/lib/db/paginas-sites';
import { lacunaDeEsquema } from '@/lib/db/pool';
import { env } from '@/lib/env';
import { PLATAFORMAS, ROTULO_PLATAFORMA } from '@/lib/paginas-web';
import { rotuloRolagem } from '@/lib/paginas-rolagem';
import { PageHero } from '@/components/hero';
import { Alerta } from '@/components/form';
import { Copiavel, ExcluirSite, FormularioSite, TestEventCode, TrocarToken } from './formularios-site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Configuração (Página de vendas) | Trakeamento' };

/**
 * Configuração da Página de vendas: sites rastreados, a tag para colar na
 * página e as URLs de webhook para a plataforma de checkout.
 *
 * Só administrador — o menu nem mostra a aba para os outros. As URLs de
 * webhook carregam o token secreto do site; Métricas e Últimos Eventos
 * mostram os números, nunca estas URLs.
 */
export default async function PaginaConfigPaginas({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPagina();
  const banco = decodeURIComponent((await params).cliente);
  const excluido = (await searchParams).excluido === '1';

  const conta = await buscaAdAccount(banco);
  if (!conta) notFound();

  const testEventCode = await buscaTestEventCode(conta.client_db_name);

  let sites: SitePaginaComToken[] = [];
  let semTabela = false;
  try {
    sites = await listaSitesComToken(conta.client_db_name);
  } catch (erro) {
    if (!lacunaDeEsquema(erro)) throw erro;
    semTabela = true;
  }

  const base = env.appUrl.replace(/\/+$/, '');

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHero
        titulo="Configuração da Página de vendas"
        descricao="Uma tag por site para página, formulário e checkout; um webhook por plataforma para a compra."
      />

      {excluido ? <Alerta tipo="sucesso">Site excluído. Os eventos já gravados continuam no painel.</Alerta> : null}

      {semTabela ? (
        <Alerta tipo="erro">
          O banco central ainda não tem a tabela de sites. Rode{' '}
          <code>Banco de Dados/migracao_paginas_central.sql</code> e, em cada banco de cliente,{' '}
          <code>Banco de Dados/migracao_paginas_cliente.sql</code>.
        </Alerta>
      ) : null}

      {!conta.meta_pixel_dataset_id ? (
        <Alerta tipo="aviso">
          Este cliente não tem pixel cadastrado. Os eventos ficam registrados no painel, mas nada é
          enviado à Meta — nem pelo navegador, nem pela Conversions API.
        </Alerta>
      ) : null}

      {sites.map((site) => {
        const tag = `<script async src="${base}/t.js?k=${site.site_key}"></script>`;
        return (
          <div key={site.id} className="card space-y-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-medium">{site.nome}</h2>
              <span className={`status-badge ${site.ativo ? 'active' : 'inactive'}`}>
                {site.ativo ? 'ATIVO' : 'PAUSADO'}
              </span>
            </div>
            <p className="text-xs text-[var(--text-tertiary)]">Domínios: {site.dominios.join(', ')}</p>
            <p className="text-xs text-[var(--text-tertiary)]">
              Eventos automáticos: PageView, Lead, InitiateCheckout
              {site.viewcontent_rolagem
                ? `, ViewContent ${rotuloRolagem(site.viewcontent_rolagem)}`
                : ' — ViewContent por rolagem desligado (ligue em “Editar site”)'}
              . Purchase chega pelo webhook.
            </p>

            <Copiavel rotulo="Tag para colar no <head> de todas as páginas do site" texto={tag} />

            <div className="space-y-2">
              {PLATAFORMAS.map((p) => (
                <Copiavel
                  key={p}
                  segredo
                  rotulo={`Webhook de compra — ${ROTULO_PLATAFORMA[p]}`}
                  texto={`${base}/api/rastreio/compra/${p}?k=${site.site_key}&token=${site.webhook_token}`}
                />
              ))}
              <p className="text-xs text-[var(--text-tertiary)]">
                Na Hotmart: Ferramentas › Webhook, evento “Compra aprovada”, versão 2.0.0. Na Kiwify:
                Apps › Webhooks, evento “Compra aprovada”. Qualquer outro checkout: o webhook genérico
                aceita JSON com <code>order_id</code>, <code>value</code>, <code>email</code>,{' '}
                <code>phone</code>, <code>status</code> e <code>sck</code>. As URLs contêm um token
                secreto — não cole em lugar público.
              </p>
            </div>

            <details className="rounded-[var(--radius-control)] border border-[var(--border-default)] p-3">
              <summary className="cursor-pointer text-sm">Editar site</summary>
              <div className="pt-3">
                <FormularioSite
                  banco={conta.client_db_name}
                  site={{
                    id: site.id,
                    nome: site.nome,
                    dominios: site.dominios,
                    ativo: site.ativo,
                    viewcontent_rolagem: site.viewcontent_rolagem,
                  }}
                />
              </div>
            </details>

            <div className="flex flex-wrap items-start gap-3">
              <TrocarToken banco={conta.client_db_name} id={site.id} />
              <ExcluirSite banco={conta.client_db_name} id={site.id} nome={site.nome} />
            </div>
          </div>
        );
      })}

      {!semTabela ? (
        <div className="card space-y-3 p-5">
          <h2 className="text-base font-medium">{sites.length ? 'Adicionar outro site' : 'Adicionar site'}</h2>
          <FormularioSite banco={conta.client_db_name} />
        </div>
      ) : null}

      <div className="card space-y-3 p-5">
        <h2 className="text-base font-medium">Testar os eventos na Meta</h2>
        <TestEventCode banco={conta.client_db_name} codigo={testEventCode} />
      </div>

      <div className="card space-y-2 p-5 text-xs text-[var(--text-secondary)]">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">Como a página conversa com o script</h2>
        <p>
          Sem mexer em nada, a tag já manda PageView (inclusive em trocas de rota de SPA), captura
          como Lead todo formulário com e-mail ou telefone e marca como InitiateCheckout o clique em
          links da Hotmart, Kiwify, Eduzz e outros checkouts conhecidos. O ViewContent por rolagem
          é ligado por site, em “Editar site”, sem trocar a tag.
        </p>
        <p>
          Se o site já tem o pixel da Meta instalado, use <code>data-pixel=&quot;0&quot;</code> na tag
          ou remova o pixel antigo — com os dois, PageView e Lead contam em dobro.
        </p>
        <Copiavel
          rotulo="Chamadas manuais (opcional)"
          texto={[
            "window.trk=window.trk||function(){(trk.q=trk.q||[]).push(arguments)};",
            "trk('lead', { nome: 'Maria', email: 'maria@ex.com', telefone: '11999998888' });",
            "trk('checkout', { value: 497, produto: 'Curso' });",
            "trk('view_content', { produto: 'Curso' }); // substitui o automático nesta página",
            "trk('purchase', { order_id: 'PEDIDO123', value: 497 }); // página de obrigado",
          ].join('\n')}
        />
        <p>
          Atributos: <code>data-trk-checkout</code> num link marca checkout não reconhecido;{' '}
          <code>data-trk-valor</code>/<code>data-trk-produto</code> no link dão valor ao
          InitiateCheckout; <code>data-trk-ignore</code> num formulário o deixa de fora;{' '}
          <code>data-trk-campo=&quot;telefone&quot;</code> num campo força o tipo dele.
        </p>
      </div>
    </div>
  );
}
