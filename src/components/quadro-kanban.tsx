'use client';

import { useState } from 'react';
import type { ColunaKanban } from '@/lib/db/kanban';
import type { Lead } from '@/lib/db/metricas';
import { fmtDataHora, fmtDecorrido, ouTraco } from '@/lib/format';

/**
 * Board do CRM.
 *
 * Componente de cliente por um motivo só: o "Carregar mais" de cada
 * coluna. Os leads já vêm todos do servidor (o board mostra o funil
 * inteiro, não é paginado) — o botão apenas revela mais 10 de uma lista
 * que já está na página, sem ida ao banco. Mesmo comportamento do painel
 * antigo, onde `kanbanShownByCol` fazia exatamente isto.
 */

const POR_PAGINA = 10;

export function QuadroKanban({ colunas }: { colunas: ColunaKanban[] }) {
  const [visiveis, setVisiveis] = useState<Record<string, number>>({});

  const quantos = (nome: string) => visiveis[nome] ?? POR_PAGINA;

  return (
    <div className="kanban-board">
      {colunas.map((coluna) => {
        const mostrando = quantos(coluna.nome);
        const restantes = coluna.leads.length - mostrando;
        return (
          <div key={coluna.nome} className="kanban-col">
            <div className="kanban-col-head">
              <span className="title" title={coluna.nome}>
                {coluna.nome}
              </span>
              <span className="count">{coluna.leads.length}</span>
            </div>

            <div className="kanban-col-body">
              {coluna.leads.length ? (
                <>
                  {coluna.leads.slice(0, mostrando).map((l) => (
                    <CartaoLead key={l.id} lead={l} />
                  ))}
                  {restantes > 0 ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        setVisiveis((atual) => ({
                          ...atual,
                          [coluna.nome]: mostrando + POR_PAGINA,
                        }))
                      }
                    >
                      Carregar mais ({restantes})
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="kanban-col-vazio">Vazio</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CartaoLead({ lead }: { lead: Lead }) {
  const nome = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim();
  return (
    <div className="lead-card">
      <div className="lead-name" title={nome || undefined}>
        {nome || 'Sem nome'}
      </div>
      <div className="lead-meta">
        {ouTraco(lead.email)}
        <br />
        {ouTraco(lead.phone)}
      </div>
      <div className="lead-meta">
        Gerado: {fmtDataHora(lead.created_at)}
        <br />
        {lead.last_moved_at ? (
          <>
            Moveu: {fmtDataHora(lead.last_moved_at)}{' '}
            <span className="text-tertiary">
              ({fmtDecorrido(lead.created_at, lead.last_moved_at)})
            </span>
          </>
        ) : (
          <span className="text-tertiary">Ainda não moveu</span>
        )}
      </div>
    </div>
  );
}
