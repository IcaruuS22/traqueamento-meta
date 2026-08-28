'use client';

import { useState, useTransition } from 'react';
import { acaoAnalisarIa } from '@/lib/acoes/ia';
import { Alerta } from '@/components/form';
import { Card } from '@/components/dados';
import { Markdown } from '@/components/markdown';
import type { Canal, Range } from '@/lib/periodo';

/**
 * Tela "Análise por IA" — porte da aba de mesmo nome do painel antigo.
 *
 * O período é o do seletor do topo da página, não um seletor próprio: no
 * painel antigo essa aba tinha o seu, e ele saía de sincronia com o resto
 * da tela. Trocar o período recarrega a página e limpa o resultado, o que
 * é intencional — uma análise dos últimos 7 dias mostrada ao lado do
 * seletor marcando "30 dias" seria pior do que nenhuma.
 */
export function AnaliseIa({
  cliente,
  canal,
  range,
  dateFrom,
  dateTo,
}: {
  cliente: string;
  canal: Canal;
  range: Range;
  dateFrom: string | null;
  dateTo: string | null;
}) {
  const [pergunta, setPergunta] = useState('');
  const [analise, setAnalise] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function analisar() {
    setErro(null);
    iniciar(async () => {
      const r = await acaoAnalisarIa({
        cliente,
        canal,
        range,
        date_from: dateFrom ?? undefined,
        date_to: dateTo ?? undefined,
        pergunta,
      });
      if (r.ok) {
        setAnalise(r.analise);
      } else {
        setAnalise(null);
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Card
        titulo="Pergunta para a IA (opcional)"
        descricao="Deixe em branco para uma análise geral do período, ou peça algo específico — ex.: “por que o CPL subiu?”, “quais campanhas focar mais?”."
      >
        <textarea
          rows={3}
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          placeholder="Ex.: A taxa de conversão caiu essa semana, o que pode ter causado isso?"
          className="field crm-textarea"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={analisar} disabled={pendente} className="btn btn-primary">
            {pendente ? 'Consultando a IA…' : 'Analisar com IA'}
          </button>
        </div>
      </Card>

      {erro ? (
        <div className="mt-4">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      ) : null}

      {pendente ? (
        <p className="mt-4 text-body-small text-tertiary">
          Consultando a IA, isso pode levar alguns segundos…
        </p>
      ) : null}

      {analise && !pendente ? (
        <Card titulo="Análise gerada" className="mt-4">
          <Markdown texto={analise} />
        </Card>
      ) : null}
    </>
  );
}
