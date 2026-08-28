/**
 * Esqueletos de carregamento das rotas.
 *
 * O Next mostra o `loading.tsx` mais próximo assim que um link é clicado,
 * antes do Server Component terminar de consultar o MySQL remoto. Sem isso
 * a tela antiga congela até a query voltar e o clique parece "não ir".
 *
 * Tudo aqui usa os mesmos tokens/estruturas do conteúdo real (`page-hero`,
 * `kpi-grid`, `panel-grid`, `Card`) para o esqueleto ocupar o mesmo espaço
 * e a troca para o conteúdo não dar salto de layout.
 */

function Barra({ w, h = 14 }: { w: string; h?: number }) {
  return <span className="skeleton-bar" style={{ width: w, height: h }} aria-hidden />;
}

function CabecalhoEsqueleto({ acao = true }: { acao?: boolean }) {
  return (
    <div className="page-hero">
      <div className="page-hero-top">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Barra w="240px" h={26} />
          <Barra w="360px" h={14} />
        </div>
        {acao ? (
          <div className="page-hero-actions">
            <Barra w="150px" h={38} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CartaoEsqueleto({ altura = 160 }: { altura?: number }) {
  return (
    <div className="card" aria-hidden>
      <Barra w="45%" h={16} />
      <div style={{ marginTop: 16 }}>
        <Barra w="100%" h={altura} />
      </div>
    </div>
  );
}

/** Esqueleto genérico: cabeçalho + um cartão largo. Serve a quase todas as telas. */
export function EsqueletoPagina() {
  return (
    <div className="skeleton-root" role="status" aria-label="Carregando" aria-busy>
      <CabecalhoEsqueleto />
      <div className="card" style={{ marginTop: 4 }} aria-hidden>
        <Barra w="30%" h={16} />
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Barra w="100%" />
          <Barra w="92%" />
          <Barra w="96%" />
          <Barra w="70%" />
        </div>
      </div>
    </div>
  );
}

/** Esqueleto da visão geral: KPIs + painéis, casa com o layout de métricas. */
export function EsqueletoMetricas() {
  return (
    <div className="skeleton-root" role="status" aria-label="Carregando" aria-busy>
      <CabecalhoEsqueleto />
      <div className="kpi-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card" aria-hidden>
            <Barra w="55%" h={13} />
            <div style={{ marginTop: 14 }}>
              <Barra w="70%" h={26} />
            </div>
          </div>
        ))}
      </div>
      <div className="panel-grid" style={{ marginTop: 4 }}>
        <CartaoEsqueleto altura={220} />
        <CartaoEsqueleto altura={220} />
      </div>
      <div style={{ marginTop: 16 }}>
        <CartaoEsqueleto altura={140} />
      </div>
    </div>
  );
}

/**
 * Esqueleto só do corpo da visão geral (KPIs + painéis), sem o cabeçalho.
 *
 * Serve de fallback do `<Suspense>` interno da página de métricas, onde o
 * hero (título + seletor de período) já renderiza de imediato acima e só
 * o corpo, que depende da consulta pesada de métricas, chega por streaming.
 * Assim a tela pinta sem esperar as ~14 consultas ao banco remoto.
 */
export function EsqueletoCorpoMetricas() {
  return (
    <div className="skeleton-root" role="status" aria-label="Carregando métricas" aria-busy>
      <div className="kpi-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card" aria-hidden>
            <Barra w="55%" h={13} />
            <div style={{ marginTop: 14 }}>
              <Barra w="70%" h={26} />
            </div>
          </div>
        ))}
      </div>
      <div className="panel-grid" style={{ marginTop: 4 }}>
        <CartaoEsqueleto altura={220} />
        <CartaoEsqueleto altura={220} />
      </div>
      <div style={{ marginTop: 16 }}>
        <CartaoEsqueleto altura={140} />
      </div>
    </div>
  );
}

/** Esqueleto das Conversas: três colunas do CRM. */
export function EsqueletoConversas() {
  return (
    <div className="skeleton-root" role="status" aria-label="Carregando" aria-busy>
      <CabecalhoEsqueleto acao={false} />
      <div className="crm-shell" aria-hidden>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Barra w="100%" h={34} />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className="skeleton-bar" style={{ width: 36, height: 36, borderRadius: 999 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <Barra w="60%" h={13} />
                <Barra w="85%" h={11} />
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <Barra w="40%" h={16} />
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Barra w="55%" h={40} />
            <div style={{ alignSelf: 'flex-end' }}>
              <Barra w="45%" h={40} />
            </div>
            <Barra w="50%" h={40} />
          </div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Barra w="70%" h={16} />
          <Barra w="100%" h={12} />
          <Barra w="90%" h={12} />
          <Barra w="100%" h={60} />
        </div>
      </div>
    </div>
  );
}
