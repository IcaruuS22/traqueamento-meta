import type { ReactElement } from 'react';

/**
 * Ícones do painel, transcritos do objeto `ICONS` e do menu lateral de
 * `painel-admin.html`. São os mesmos traços (Feather, 1.5px) do painel
 * atual — trocá-los por outra família mudaria a cara da ferramenta, que
 * é justamente o que este porte quer evitar.
 *
 * Ficam em módulo de servidor (sem `'use client'`) porque são só JSX
 * estático: podem ser usados tanto de Server Components quanto de
 * componentes de cliente.
 */

export type PropsSvg = { className?: string; width?: number; height?: number };

function Svg({
  className = 'icon-16',
  width,
  height,
  strokeWidth = 1.5,
  children,
}: PropsSvg & { strokeWidth?: number; children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icones = {
  users: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M22.5 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16.5 3.13a4 4 0 0 1 0 7.75" />
    </Svg>
  ),
  check: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </Svg>
  ),
  clock: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </Svg>
  ),
  target: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  ),
  info: (p: PropsSvg = {}) => (
    <Svg className={p.className ?? ''} width={p.width} height={p.height} strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9.25" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <circle cx="12" cy="7.75" r="1" fill="currentColor" stroke="none" />
    </Svg>
  ),
  chevron: (p: PropsSvg = {}) => (
    <Svg {...p} strokeWidth={2}>
      <polyline points="9 6 15 12 9 18" />
    </Svg>
  ),
  chevronRight: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <polyline points="9 18 15 12 9 6" />
    </Svg>
  ),
  chevronLeft: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <polyline points="15 18 9 12 15 6" />
    </Svg>
  ),
  dollar: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </Svg>
  ),
  eye: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  broadcast: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="2" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M5.5 5.5a9 9 0 0 0 0 13" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </Svg>
  ),
  repeat: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </Svg>
  ),
  click: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M9 9 3 3" />
      <path d="M9 4V2" />
      <path d="M4 9H2" />
      <path d="m5.6 5.6-1.4-1.4" />
      <path d="M9 9l11 4-4.5 2L13 20Z" />
    </Svg>
  ),
  percent: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </Svg>
  ),
  trendUp: (p: PropsSvg = {}) => (
    <Svg className={p.className ?? ''} width={12} height={12} strokeWidth={2.5}>
      <polyline points="3 17 10 10 14 14 21 5" />
      <polyline points="21 11 21 5 15 5" />
    </Svg>
  ),
  trendDown: (p: PropsSvg = {}) => (
    <Svg className={p.className ?? ''} width={12} height={12} strokeWidth={2.5}>
      <polyline points="3 7 10 14 14 10 21 19" />
      <polyline points="21 13 21 19 15 19" />
    </Svg>
  ),
} satisfies Record<string, (p?: PropsSvg) => ReactElement>;

/** Ícones do menu lateral e da barra superior, na mesma ordem do painel. */
export const IconesNav = {
  clientes: Icones.users,
  tutorial: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </Svg>
  ),
  metricas: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </Svg>
  ),
  campanhas: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M3 11 20 3l-5 18-4-8-8-2Z" />
    </Svg>
  ),
  kanban: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <rect x="3" y="3" width="5" height="18" rx="1.2" />
      <rect x="10" y="3" width="5" height="11" rx="1.2" />
      <rect x="17" y="3" width="5" height="15" rx="1.2" />
    </Svg>
  ),
  configEventos: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </Svg>
  ),
  ultimosEventos: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M9 2h6a1 1 0 0 1 1 1v1H8V3a1 1 0 0 1 1-1Z" />
      <rect x="5" y="4" width="14" height="18" rx="2" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </Svg>
  ),
  ia: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-1.2 2.86A5 5 0 0 1 17 14v1a5 5 0 0 1-10 0v-1a5 5 0 0 1 2.2-4.14A4 4 0 0 1 8 7V6a4 4 0 0 1 4-4Z" />
      <line x1="9" y1="21" x2="15" y2="21" />
      <line x1="12" y1="18" x2="12" y2="21" />
    </Svg>
  ),
  whatsapp: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </Svg>
  ),
  conversas: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Svg>
  ),
  usuarios: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </Svg>
  ),
  novoCliente: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="12" y1="9" x2="12" y2="15" />
      <line x1="9" y1="12" x2="15" y2="12" />
    </Svg>
  ),
  busca: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Svg>
  ),
  menu: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </Svg>
  ),
  sol: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4" y1="12" x2="2" y2="12" />
      <line x1="22" y1="12" x2="20" y2="12" />
      <line x1="4.9" y1="4.9" x2="3.5" y2="3.5" />
      <line x1="20.5" y1="20.5" x2="19.1" y2="19.1" />
      <line x1="4.9" y1="19.1" x2="3.5" y2="20.5" />
      <line x1="20.5" y1="3.5" x2="19.1" y2="4.9" />
    </Svg>
  ),
  lua: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </Svg>
  ),
  sino: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </Svg>
  ),
  sair: (p: PropsSvg = {}) => (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </Svg>
  ),
  recolher: Icones.chevronLeft,
  crumbSep: Icones.chevronRight,
  logo: (p: PropsSvg = {}) => (
    <svg
      width={p.width ?? 22}
      height={p.height ?? 22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 17 10 11 14 15 20 7" />
      <path d="M15 7h5v5" />
    </svg>
  ),
} satisfies Record<string, (p?: PropsSvg) => ReactElement>;
