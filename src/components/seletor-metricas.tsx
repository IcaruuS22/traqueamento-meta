'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { acaoSalvarPreferenciaMetrica } from '@/lib/acoes/prefs';
import { metricasDoGrupo } from '@/lib/metricas-catalogo';

/**
 * Seletor de quais métricas aparecem — porte do botão "Personalizar" do
 * painel antigo (`renderMetricasPrefsList` / `renderCampanhasPrefsList`).
 *
 * Continua salvando a cada clique, sem botão de confirmar: a preferência
 * é reversível com outro clique e um botão "Salvar" aqui só adicionaria
 * um passo. A marcação vira otimista na hora e volta atrás se a gravação
 * falhar — sem isso, a caixa ficaria marcada mostrando um estado que o
 * banco não tem.
 *
 * Métricas com `porCliente` gravam a preferência só deste cliente; as
 * demais são globais e valem para todos, o que o rodapé explica — no
 * painel antigo essa diferença não aparecia em lugar nenhum.
 */
export function SeletorMetricas({
  cliente,
  grupo,
  visiveis,
}: {
  cliente: string;
  grupo: 'kpi' | 'campanhas';
  visiveis: Record<string, boolean>;
}) {
  const metricas = metricasDoGrupo(grupo);
  const [aberto, setAberto] = useState(false);
  const [local, setLocal] = useState(visiveis);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const caixa = useRef<HTMLDivElement>(null);

  // O servidor é a fonte da verdade: quando a revalidação traz o estado
  // novo, ele substitui o otimista (e conserta a tela se outra aba mudou
  // uma preferência global).
  useEffect(() => setLocal(visiveis), [visiveis]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  const alterna = (key: string, marcada: boolean) => {
    setErro(null);
    setLocal((atual) => ({ ...atual, [key]: marcada }));
    startTransition(async () => {
      const r = await acaoSalvarPreferenciaMetrica({
        cliente,
        metric_key: key,
        visible: marcada ? '1' : '0',
      });
      if (!r.ok) {
        setLocal((atual) => ({ ...atual, [key]: !marcada }));
        setErro(r.erro);
      }
    });
  };

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        className="btn-ghost px-3 py-1.5 text-xs"
        aria-expanded={aberto}
        aria-haspopup="true"
        onClick={() => setAberto((v) => !v)}
      >
        Personalizar
      </button>

      {aberto ? (
        <div className="card absolute right-0 z-20 mt-1 w-64 p-3 shadow-lg">
          <p className="mb-2 text-xs font-semibold text-[var(--text-tertiary)]">
            {grupo === 'campanhas' ? 'Colunas da tabela' : 'Métricas visíveis'}
          </p>

          <div
            className="max-h-[60vh] space-y-2 overflow-y-auto"
            data-pendente={pendente || undefined}
          >
            {metricas.map((m) => (
              <label key={m.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={local[m.key] !== false}
                  onChange={(e) => alterna(m.key, e.target.checked)}
                />
                <span>{m.label}</span>
                {m.porCliente ? (
                  <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">
                    só este cliente
                  </span>
                ) : null}
              </label>
            ))}
          </div>

          {erro ? (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {erro}
            </p>
          ) : null}

          <p className="mt-3 border-t pt-2 text-[11px] text-[var(--text-tertiary)]">
            Sem a marca &quot;só este cliente&quot;, a escolha vale para todos os clientes.
          </p>
        </div>
      ) : null}
    </div>
  );
}
