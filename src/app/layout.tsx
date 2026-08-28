import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trakeamento — Meta Ads + Kommo + WhatsApp',
  description:
    'Painel de trakeamento de leads da Meta, conversões via CAPI e atendimento por WhatsApp.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Aplica o tema antes da primeira pintura, igual ao painel: sem isso a
 * tela pisca em claro antes do React montar. Mesma chave de storage
 * (`painel_theme`) e mesmo padrão escuro do painel atual.
 */
const SCRIPT_TEMA = `try{var t=localStorage.getItem('painel_theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
