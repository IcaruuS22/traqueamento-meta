'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RANGES, type Range } from '@/lib/periodo';

/**
 * Seletor de período.
 *
 * O estado mora na URL, não em React state: assim um período escolhido
 * sobrevive ao F5, pode ser compartilhado por link e continua valendo ao
 * trocar de seção pela navegação lateral. É também o que permite que as
 * telas sejam Server Components — a mudança de filtro é uma navegação,
 * e o servidor refaz as consultas.
 *
 * A navegação é do próprio navegador (`location.assign`), não do roteador
 * do App Router. A versão anterior usava `router.replace` dentro de um
 * `startTransition` e, na Visão geral, a transição nunca terminava: o
 * payload RSC chegava inteiro e com status 200, mas o React não commitava,
 * então a URL não mudava e o `<select>`, sendo controlado pela URL, voltava
 * sozinho ao valor antigo. Como todas estas telas são `force-dynamic` e
 * refazem as consultas no servidor a cada troca de período, a navegação
 * cheia entrega exatamente o mesmo resultado sem depender do commit.
 */

const ROTULOS: Record<Range, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  ano: 'Este ano',
  max: 'Máximo',
  custom: 'Personalizado',
};

export function SeletorPeriodo({
  minimo,
}: {
  /** Data do primeiro lead: não faz sentido oferecer datas anteriores. */
  minimo: string | null;
}) {
  const searchParams = useSearchParams();
  const [navegando, setNavegando] = useState(false);
  // Enquanto a página nova não chega, o `<select>` mostra o que foi
  // escolhido — sem isso ele piscaria de volta ao valor da URL antiga.
  const [escolhido, setEscolhido] = useState<Range | null>(null);
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // O layout não recebe searchParams no Next 15 (só as páginas recebem),
  // então o estado do seletor vem da própria URL, aqui no cliente. A
  // normalização é a mesma de `resolvePeriodo`, só que sem o cálculo de
  // datas: o que a tela mostra e o que o servidor consulta partem do
  // mesmo valor de URL.
  const bruto = String(searchParams.get('range') ?? '7d').toLowerCase() as Range;
  const range: Range = (RANGES as readonly string[]).includes(bruto) ? bruto : '7d';
  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');

  const atualiza = (mudancas: Record<string, string | null>) => {
    // Parte da URL viva do navegador, não de `pathname`/`searchParams`: é a
    // mesma coisa em condições normais e continua certa se algo já tiver
    // mexido na URL fora do React.
    const url = new URL(window.location.href);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === '') url.searchParams.delete(chave);
      else url.searchParams.set(chave, valor);
    }
    setNavegando(true);
    window.location.assign(url.toString());
  };

  // As datas do período personalizado não navegam a cada tecla.
  //
  // `input[type=date]` dispara `change` a cada segmento preenchido, e os
  // valores intermediários são válidos — ao digitar o ano de 2026 o campo
  // passa por 0002, 0020 e 0202 antes de chegar lá. Como cada navegação
  // agora recarrega a página, navegar no `change` recarregaria a tela a
  // cada dígito. Então o campo guarda o valor localmente e a navegação só
  // sai quando o par para de mudar por 700ms e faz sentido como intervalo.
  const [dataIni, setDataIni] = useState(dateFrom ?? '');
  const [dataFim, setDataFim] = useState(dateTo ?? '');
  // Só o "até" dispara a consulta. Preencher o intervalo é escolher duas
  // datas, e o "de" é a primeira: recarregar assim que ele fica pronto
  // interromperia o preenchimento no meio, além de mostrar por um
  // momento um intervalo que ninguém pediu.
  const [fimTocado, setFimTocado] = useState(false);

  const limiteMin = minimo ?? '2000-01-01';
  const parValido =
    dataIni !== '' &&
    dataFim !== '' &&
    dataIni >= limiteMin &&
    dataFim <= hoje &&
    dataIni <= dataFim;
  const parMudou = dataIni !== (dateFrom ?? '') || dataFim !== (dateTo ?? '');
  const podeAplicar = parValido && parMudou && !navegando;

  useEffect(() => {
    if ((escolhido ?? range) !== 'custom' || !podeAplicar || !fimTocado) return;
    const t = setTimeout(() => atualiza({ date_from: dataIni, date_to: dataFim }), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataIni, dataFim, podeAplicar, fimTocado]);

  // Enter aplica na hora, e sem exigir o "até": é a saída para quem quer
  // mexer só na data inicial e manter a final que já estava valendo.
  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && podeAplicar) {
      e.preventDefault();
      atualiza({ date_from: dataIni, date_to: dataFim });
    }
  };

  return (
    <div className="page-hero-actions">
      <select
        aria-label="Período"
        className="select-inline"
        value={escolhido ?? range}
        disabled={navegando}
        onChange={(e) => {
          const novo = e.target.value as Range;
          setEscolhido(novo);
          // Ao entrar em "personalizado" sem datas ainda escolhidas, a
          // tela cairia de volta no padrão (ver resolvePeriodo). Semear
          // com o dia de hoje evita esse pisca-pisca.
          if (novo === 'custom') {
            atualiza({
              range: novo,
              date_from: dateFrom ?? minimo ?? hoje,
              date_to: dateTo ?? hoje,
            });
          } else {
            atualiza({ range: novo, date_from: null, date_to: null });
          }
        }}
      >
        {RANGES.map((r) => (
          <option key={r} value={r}>
            {ROTULOS[r]}
          </option>
        ))}
      </select>

      {(escolhido ?? range) === 'custom' ? (
        <>
          <input
            type="date"
            aria-label="Data inicial"
            className="date-inline"
            value={dataIni}
            min={minimo ?? undefined}
            max={dataFim || hoje}
            disabled={navegando}
            onChange={(e) => setDataIni(e.target.value)}
            onKeyDown={aoTeclar}
          />
          <span className="text-body-small text-tertiary">até</span>
          <input
            type="date"
            aria-label="Data final"
            className="date-inline"
            value={dataFim}
            min={dataIni || minimo || undefined}
            max={hoje}
            disabled={navegando}
            onChange={(e) => {
              setDataFim(e.target.value);
              setFimTocado(true);
            }}
            onKeyDown={aoTeclar}
          />
        </>
      ) : null}
    </div>
  );
}
