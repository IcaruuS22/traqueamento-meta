'use client';

import { useState, useTransition } from 'react';
import { Alerta } from '@/components/form';

/**
 * Botão "Exportar PDF" da tela de Métricas Gerais.
 *
 * Podia ser um `<a href download>`, mas então um erro do servidor abriria
 * um JSON na cara do usuário e a espera pela geração (que passa pelo
 * banco) não teria retorno visual nenhum. Com `fetch` + blob dá para
 * mostrar "Gerando…", tratar a falha como aviso na tela e ainda respeitar
 * o nome de arquivo que a rota manda em `Content-Disposition`.
 *
 * Os filtros vêm de `window.location.search` no momento do clique, e não
 * de props: o seletor de período navega o próprio navegador, então a URL
 * é sempre a fonte da verdade do que está sendo exibido.
 */

/** Extrai o `filename="..."` do cabeçalho, com um padrão de reserva. */
function nomeDoCabecalho(cabecalho: string | null): string {
  const m = cabecalho?.match(/filename="([^"]+)"/);
  return m?.[1] || 'metricas.pdf';
}

export function ExportarPdf({ cliente }: { cliente: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function exporta() {
    setErro(null);
    iniciar(async () => {
      const atual = new URLSearchParams(window.location.search);
      const qs = new URLSearchParams({ client_db: cliente });
      for (const chave of ['range', 'date_from', 'date_to', 'channel'] as const) {
        const v = atual.get(chave);
        if (v) qs.set(chave, v);
      }

      let url: string | null = null;
      try {
        const r = await fetch(`/api/relatorio/metricas?${qs}`);
        if (!r.ok) {
          const corpo = (await r.json().catch(() => ({}))) as { erro?: string };
          setErro(corpo.erro || 'Não foi possível gerar o PDF.');
          return;
        }
        const blob = await r.blob();
        url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nomeDoCabecalho(r.headers.get('Content-Disposition'));
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch {
        setErro('Falha de conexão com o app.');
      } finally {
        // Revogar na hora cancelaria o download em alguns navegadores; o
        // atraso curto dá tempo de o clique ser processado.
        const criada = url;
        if (criada) setTimeout(() => URL.revokeObjectURL(criada), 30_000);
      }
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={exporta}
        disabled={pendente}
        className="btn-ghost disabled:opacity-50"
      >
        {pendente ? 'Gerando PDF…' : 'Exportar PDF'}
      </button>
      {erro ? <Alerta tipo="erro">{erro}</Alerta> : null}
    </div>
  );
}
