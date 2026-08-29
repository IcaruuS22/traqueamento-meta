'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { acaoLogout } from '@/lib/auth/actions';
import type { SessaoUsuario } from '@/lib/auth/guard';
import { Icones, IconesNav } from '@/components/icones';

/**
 * Casca do app: menu lateral, barra superior e trilha de navegação.
 *
 * É a transcrição da casca de `painel-admin.html` — mesmas seções, mesmos
 * rótulos, mesmas medidas. O painel era uma página só que trocava de aba;
 * aqui cada aba virou rota, então o "estado da aba" vem do pathname em vez
 * de uma variável.
 */

export type ClienteMenu = {
  client_db_name: string;
  account_name: string;
};

type ItemNav = {
  href: string;
  rotulo: string;
  icone: (p?: { className?: string }) => React.ReactElement;
  /** Só marca ativo quando o pathname E o canal batem (abas de métricas). */
  canal?: 'form' | 'whatsapp' | 'geral';
};
type SecaoNav = {
  titulo: string;
  itens: ItemNav[];
  /** Seção que abre e fecha ao clicar no título (Formulários, WhatsApp). */
  sanfona?: boolean;
};

const TEMA_KEY = 'painel_theme';
const CLIENTE_KEY = 'painel_ultimo_cliente';

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * Seções do cliente, na mesma ordem e com os mesmos rótulos do menu do
 * painel. As três abas de métricas do painel (Geral / Formulários /
 * WhatsApp) apontam para a mesma rota com `channel` diferente, que é como
 * o app já separa os canais.
 */
function secoesDoCliente(cliente: string): SecaoNav[] {
  const base = `/app/${encodeURIComponent(cliente)}`;
  return [
    {
      titulo: 'Geral',
      itens: [
        {
          href: `${base}/visao-geral`,
          rotulo: 'Métricas Gerais',
          icone: IconesNav.metricas,
          canal: 'geral',
        },
        // O CRM é um só e vive aqui, não dentro de Formulários: ele
        // junta lead de formulário e contato de WhatsApp no mesmo quadro.
        { href: `${base}/crm`, rotulo: 'CRM', icone: IconesNav.kanban },
        { href: `${base}/campanhas`, rotulo: 'Campanhas', icone: IconesNav.campanhas },
        {
          href: `${base}/rastreamento`,
          rotulo: 'Rastreamento',
          icone: IconesNav.rastreamento,
        },
      ],
    },
    {
      titulo: 'Formulários',
      sanfona: true,
      itens: [
        {
          href: `${base}/visao-geral?channel=form`,
          rotulo: 'Métricas',
          icone: IconesNav.metricas,
          canal: 'form',
        },
        {
          href: `${base}/formularios/config`,
          rotulo: 'Configuração de Eventos',
          icone: IconesNav.configEventos,
        },
        {
          href: `${base}/formularios/eventos`,
          rotulo: 'Últimos Eventos',
          icone: IconesNav.ultimosEventos,
        },
        { href: `${base}/formularios/ia`, rotulo: 'Análise por IA', icone: IconesNav.ia },
      ],
    },
    {
      titulo: 'WhatsApp',
      sanfona: true,
      itens: [
        // Ordem pedida: o dia a dia é a conversa, então ela vem primeiro.
        // Conexão e cadastro de eventos são configuração, feita uma vez.
        { href: `${base}/whatsapp/conversas`, rotulo: 'Conversas', icone: IconesNav.conversas },
        {
          href: `${base}/visao-geral?channel=whatsapp`,
          rotulo: 'Métricas',
          icone: IconesNav.metricas,
          canal: 'whatsapp',
        },
        { href: `${base}/whatsapp`, rotulo: 'Conexão', icone: IconesNav.whatsapp },
        { href: `${base}/whatsapp/ia`, rotulo: 'Análise por IA', icone: IconesNav.ia },
        {
          href: `${base}/whatsapp/estagios`,
          rotulo: 'Configuração de Eventos',
          icone: IconesNav.configEventos,
        },
        {
          href: `${base}/whatsapp/eventos`,
          rotulo: 'Últimos Eventos',
          icone: IconesNav.ultimosEventos,
        },
      ],
    },
  ];
}

/** Rótulo da última migalha, equivalente ao `TAB_LABELS` do painel. */
function rotuloDaTela(resto: string, canal: string): string {
  switch (resto) {
    case '':
    case 'visao-geral':
      if (canal === 'form') return 'Métricas (Formulários)';
      if (canal === 'whatsapp') return 'Métricas (WhatsApp)';
      return 'Métricas Gerais';
    case 'campanhas':
      return 'Campanhas';
    case 'rastreamento':
      return 'Rastreamento';
    case 'crm':
      return 'CRM';
    case 'formularios/config':
      return 'Configuração de Eventos';
    case 'formularios/eventos':
      return 'Últimos Eventos (Formulários)';
    case 'formularios/ia':
      return 'Análise por IA (Formulários)';
    case 'whatsapp':
      return 'Conexão';
    case 'whatsapp/estagios':
      return 'Configuração de Eventos (WhatsApp)';
    case 'whatsapp/conversas':
      return 'Conversas';
    case 'whatsapp/eventos':
      return 'Últimos Eventos (WhatsApp)';
    case 'whatsapp/ia':
      return 'Análise por IA (WhatsApp)';
    default:
      return 'Métricas Gerais';
  }
}

export function CascaPainel({
  usuario,
  clientes,
  children,
}: {
  usuario: SessaoUsuario;
  clientes: ClienteMenu[];
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '/app';
  const params = useSearchParams();
  const router = useRouter();
  const canal = params.get('channel') ?? 'geral';

  const [recolhido, setRecolhido] = useState(false);
  const [gaveta, setGaveta] = useState(false);
  const [tema, setTema] = useState<'dark' | 'light'>('dark');
  const [sino, setSino] = useState(false);
  // Sanfonas das seções do cliente. Chave ausente = ninguém mexeu nesta
  // seção ainda, e aí vale o padrão: aberta se a tela atual está dentro dela.
  const [sanfonas, setSanfonas] = useState<Record<string, boolean>>({});
  // Último cliente aberto. Administração e Ajuda não vivem dentro de um
  // cliente, e sem isto a barra ficava só com esses dois itens: nenhuma
  // seção do cliente e nenhum botão "Trocar" — ou seja, sem saída.
  const [ultimoCliente, setUltimoCliente] = useState<string | null>(null);
  const campoBusca = useRef<HTMLInputElement>(null);

  // O tema já foi aplicado antes da pintura pelo script do layout raiz;
  // aqui só espelhamos o valor para o ícone sair certo.
  useEffect(() => {
    const salvo = document.documentElement.getAttribute('data-theme');
    setTema(salvo === 'light' ? 'light' : 'dark');
  }, []);

  const trocaTema = useCallback(() => {
    const novo = tema === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', novo);
    try {
      window.localStorage.setItem(TEMA_KEY, novo);
    } catch {
      // Navegação anônima com storage bloqueado: o tema vale só nesta aba.
    }
    setTema(novo);
  }, [tema]);

  // Fecha a gaveta ao trocar de rota — sem isso ela fica aberta por cima
  // da tela nova no celular.
  useEffect(() => {
    setGaveta(false);
  }, [pathname]);

  // ⌘K / Ctrl+K foca a busca, igual ao painel.
  useEffect(() => {
    function aoTeclar(ev: KeyboardEvent) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        campoBusca.current?.focus();
      }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  // Qual cliente está aberto: o segmento depois de `/app` é o nome do banco.
  const segmentos = pathname.split('/').filter(Boolean);
  const segCliente =
    segmentos[0] === 'app' && segmentos[1] && segmentos[1] !== 'tutorial'
      ? decodeURIComponent(segmentos[1])
      : null;
  const clienteAtivo = segCliente
    ? (clientes.find((c) => c.client_db_name === segCliente) ?? {
        client_db_name: segCliente,
        account_name: segCliente,
      })
    : null;

  useEffect(() => {
    if (segCliente) {
      setUltimoCliente(segCliente);
      try {
        localStorage.setItem(CLIENTE_KEY, segCliente);
      } catch {
        // Navegador sem storage: a barra cai no primeiro cliente da lista.
      }
      return;
    }
    try {
      const salvo = localStorage.getItem(CLIENTE_KEY);
      if (salvo) setUltimoCliente(salvo);
    } catch {
      // idem
    }
  }, [segCliente]);

  // De qual cliente são as seções da barra: o da URL quando existe, senão
  // o último visitado, senão o primeiro da lista. Só entra o que ainda
  // está na lista de clientes do usuário — acesso revogado não deve
  // sobreviver no localStorage. Fica separado de `clienteAtivo` de
  // propósito: quem manda nas migalhas e no item destacado continua sendo
  // a URL, e em /admin não há cliente nenhum aberto.
  const clienteExibido = useMemo(() => {
    if (clienteAtivo) return clienteAtivo;
    const alvo = ultimoCliente ?? clientes[0]?.client_db_name;
    return clientes.find((c) => c.client_db_name === alvo) ?? null;
  }, [clienteAtivo, ultimoCliente, clientes]);

  const secoes = useMemo(
    () => (clienteExibido ? secoesDoCliente(clienteExibido.client_db_name) : []),
    [clienteExibido],
  );

  const restoDaRota = clienteAtivo ? segmentos.slice(2).join('/') : '';
  const rotuloTela = clienteAtivo
    ? rotuloDaTela(restoDaRota, canal)
    : pathname.startsWith('/admin/usuarios')
      ? 'Usuários'
      : pathname.startsWith('/admin/clientes/novo')
        ? 'Novo Cliente'
        : pathname.startsWith('/admin')
          ? 'Administração'
          : pathname.startsWith('/app/tutorial')
            ? 'Ajuda'
            : 'Selecionar cliente';

  const emClientes = pathname === '/app';
  const buscaAtual = params.get('q') ?? '';

  const aoBuscar = (valor: string) => {
    const busca = new URLSearchParams(emClientes ? params.toString() : '');
    if (valor) busca.set('q', valor);
    else busca.delete('q');
    const qs = busca.toString();
    router.replace(`/app${qs ? `?${qs}` : ''}`);
  };

  // Período escolhido acompanha a troca de seção — sem isso, sair de
  // "Métricas Gerais" para "Campanhas" jogaria a pessoa no padrão.
  const filtros = new URLSearchParams();
  for (const chave of ['range', 'date_from', 'date_to'] as const) {
    const v = params.get(chave);
    if (v) filtros.set(chave, v);
  }
  const hrefComFiltros = (item: ItemNav) => {
    const [caminho, query] = item.href.split('?');
    const busca = new URLSearchParams(query ?? '');
    filtros.forEach((v, k) => busca.set(k, v));
    const qs = busca.toString();
    return `${caminho}${qs ? `?${qs}` : ''}`;
  };
  const ehAtivo = (item: ItemNav) => {
    const caminho = item.href.split('?')[0];
    if (pathname !== caminho) return false;
    return item.canal ? canal === item.canal : true;
  };

  const itemPrincipal = (
    href: string,
    rotulo: string,
    Icone: (p?: { className?: string }) => React.ReactElement,
    ativo: boolean,
  ) => (
    <Link key={href} href={href} className={`nav-item${ativo ? ' active' : ''}`}>
      <Icone />
      <span>{rotulo}</span>
    </Link>
  );

  return (
    <div className="app-shell">
      <aside
        className={`sidebar${recolhido ? ' sidebar-collapsed' : ''}${gaveta ? ' drawer-open' : ''}`}
      >
        <div className="sidebar-inner">
          <div className="brand-block">
            <div className="logo-mark">
              <IconesNav.logo />
            </div>
            <div className="brand-text">
              <span className="text-heading-brand">Trakeamento</span>
              <span className="text-body-regular">
                {usuario.papel === 'admin' ? 'Painel Admin' : 'Painel'}
              </span>
            </div>
          </div>

          <nav className="nav-list">
            {clienteExibido ? (
              <>
                <div className="nav-client-divider">
                  <span className="nav-client-label">Cliente</span>
                  <span className="nav-client-name" title={clienteExibido.account_name}>
                    {clienteExibido.account_name}
                  </span>
                </div>
                {secoes.map((secao) => {
                  const temAtivo = secao.itens.some(ehAtivo);
                  // Recolhida, a barra esconde os títulos de seção — e sem
                  // título não há onde clicar para abrir a sanfona. Nesse
                  // estado tudo fica aberto, senão os ícones das seções
                  // fechadas ficariam inalcançáveis.
                  const aberta =
                    !secao.sanfona || recolhido || (sanfonas[secao.titulo] ?? temAtivo);
                  return (
                    <div key={secao.titulo}>
                      {secao.sanfona ? (
                        <button
                          type="button"
                          className={`nav-section-toggle${aberta ? ' aberta' : ''}`}
                          aria-expanded={aberta}
                          onClick={() => setSanfonas((s) => ({ ...s, [secao.titulo]: !aberta }))}
                        >
                          <span>{secao.titulo}</span>
                          <Icones.chevron className="nav-section-chevron" />
                        </button>
                      ) : (
                        <div className="nav-section-label">{secao.titulo}</div>
                      )}
                      {aberta
                        ? secao.itens.map((item) => {
                            const Icone = item.icone;
                            return (
                              <Link
                                key={`${item.href}-${item.rotulo}`}
                                href={hrefComFiltros(item)}
                                aria-current={ehAtivo(item) ? 'page' : undefined}
                                className={`nav-item${ehAtivo(item) ? ' active' : ''}`}
                              >
                                <Icone />
                                <span>{item.rotulo}</span>
                              </Link>
                            );
                          })
                        : null}
                    </div>
                  );
                })}
              </>
            ) : null}
          </nav>

          {/* Administração e Ajuda ficam presas ao pé da barra: são destinos
              ocasionais, e no meio do menu disputavam espaço com a navegação
              do cliente, que é a que se usa o dia inteiro. A lista de
              clientes saiu daqui — chega-se a ela pelo botão "Trocar". */}
          <div className="nav-bottom">
            {usuario.papel === 'admin'
              ? itemPrincipal(
                  '/admin',
                  'Administração',
                  IconesNav.usuarios,
                  pathname.startsWith('/admin'),
                )
              : null}
            {itemPrincipal(
              '/app/tutorial',
              'Ajuda',
              IconesNav.tutorial,
              pathname === '/app/tutorial',
            )}
          </div>

          <div className="sidebar-footer">
            <div className="profile-pill">
              <div className="avatar-circle">{iniciais(usuario.nome)}</div>
              <div className="profile-text">
                <span className="text-heading-brand">{usuario.nome}</span>
                <span className="text-body-regular">
                  {usuario.papel === 'admin' ? 'Administração' : 'Acesso de cliente'}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="icon-btn btn-collapse"
              onClick={() => setRecolhido((v) => !v)}
              aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'}
            >
              <IconesNav.recolher />
            </button>
          </div>
        </div>
      </aside>

      <div
        className={`mobile-overlay${gaveta ? ' drawer-open' : ''}`}
        onClick={() => setGaveta(false)}
        aria-hidden="true"
      />

      <div className="main-col">
        <header className="topheader">
          <button
            type="button"
            className="icon-btn mobile-only"
            onClick={() => setGaveta((v) => !v)}
            aria-label="Abrir menu"
            aria-expanded={gaveta}
          >
            <IconesNav.menu />
          </button>

          <div className="header-search">
            <IconesNav.busca />
            <input
              ref={campoBusca}
              type="text"
              defaultValue={buscaAtual}
              onChange={(ev) => aoBuscar(ev.target.value)}
              placeholder="Buscar cliente por nome, Ad Account ou CRM Account..."
              aria-label="Buscar cliente"
            />
            <span className="kbd-chip text-body-small">⌘K</span>
          </div>

          <div className="header-spacer" />

          <div className="header-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={trocaTema}
              aria-label="Alternar tema claro/escuro"
            >
              {tema === 'dark' ? <IconesNav.lua /> : <IconesNav.sol />}
            </button>

            <div className="dropdown-wrap">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSino((v) => !v)}
                aria-label="Notificações"
                aria-expanded={sino}
              >
                <IconesNav.sino />
              </button>
              {sino ? (
                <div className="dropdown-panel text-body-regular">
                  Nenhuma notificação no momento.
                </div>
              ) : null}
            </div>

            <form action={acaoLogout}>
              <button type="submit" className="icon-btn" aria-label="Sair">
                <IconesNav.sair />
              </button>
            </form>

            {clienteExibido ? (
              <div className="profile-chip">
                <div
                  className="avatar-circle"
                  style={{ width: 28, height: 28, fontSize: 11 }}
                  aria-hidden="true"
                >
                  {clienteExibido.account_name.slice(0, 1).toUpperCase()}
                </div>
                <div className="profile-chip-text">
                  <span className="text-body-medium">{clienteExibido.account_name}</span>
                  <span className="text-body-small">
                    {clienteAtivo ? 'Cliente ativo' : 'Último aberto'}
                  </span>
                </div>
                <Link href="/app" className="btn btn-secondary btn-sm">
                  Trocar
                </Link>
              </div>
            ) : null}
          </div>
        </header>

        <div className="breadcrumb-bar">
          <Link href="/app" className="crumb-link">
            Painel
          </Link>
          <span className="crumb-sep">
            <IconesNav.crumbSep />
          </span>
          {clienteAtivo ? (
            <>
              <span className="crumb-current">{clienteAtivo.account_name}</span>
              <span className="crumb-sep">
                <IconesNav.crumbSep />
              </span>
            </>
          ) : null}
          <span className="crumb-current">{rotuloTela}</span>
        </div>

        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
