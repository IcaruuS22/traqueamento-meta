'use client';

import { startTransition, useActionState } from 'react';
import { acaoAdicionarProduto } from '@/lib/acoes/clientes';
import type { EstadoFormulario } from '@/lib/auth/actions';
import { Alerta } from '@/components/form';
import { PRODUTOS, ROTULO_PRODUTO, type Produto } from '@/lib/produtos';
import { CamposDoProduto } from './campos-produto';

/**
 * Produtos do cliente na lista do administrador, com o "Adicionar" dos
 * que faltam.
 *
 * Um bloco por produto fica montado mesmo depois de o produto virar
 * ativo: a página revalida ao salvar, e se o bloco sumisse junto a
 * mensagem de sucesso (com o próximo passo) sumiria antes de ser lida.
 */
export function ProdutosCliente({
  banco,
  produtos,
  definidos,
}: {
  banco: string;
  produtos: Produto[];
  definidos: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--text-tertiary)]">Produtos:</span>
        {produtos.length ? (
          produtos.map((p) => (
            <span key={p} className="conexao-selo conexao-selo-ativo !mt-0">
              {ROTULO_PRODUTO[p]}
            </span>
          ))
        ) : (
          <span className="text-xs text-[var(--text-tertiary)]">nenhum</span>
        )}
      </div>
      {!definidos ? (
        <p className="text-xs text-[var(--text-tertiary)]">
          Lista deduzida do que está cadastrado (conta do Kommo, conexão de WhatsApp, sites).
          Adicionar um produto grava a lista.
        </p>
      ) : null}

      {PRODUTOS.map((p) => (
        <AdicionarProduto key={p} banco={banco} produto={p} ativo={produtos.includes(p)} />
      ))}
    </div>
  );
}

function AdicionarProduto({ banco, produto, ativo }: { banco: string; produto: Produto; ativo: boolean }) {
  const [estado, acao, pendente] = useActionState<EstadoFormulario, FormData>(acaoAdicionarProduto, {});

  // Envio manual em vez de `<form action>`: o React limpa o formulário
  // depois de uma action, e um erro de validação obrigaria a digitar os
  // tokens de novo.
  function envia(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    startTransition(() => acao(dados));
  }

  if (ativo) return estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null;

  return (
    <details className="rounded-[var(--radius-control)] border border-[var(--border-default)] p-3">
      <summary className="cursor-pointer text-sm">+ Adicionar {ROTULO_PRODUTO[produto]}</summary>
      <form onSubmit={envia} className="space-y-3 pt-3">
        <input type="hidden" name="client_db" value={banco} />
        <input type="hidden" name="produto" value={produto} />
        <CamposDoProduto produto={produto} />
        {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
        {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}
        <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={pendente}>
          {pendente ? 'Salvando…' : `Adicionar ${ROTULO_PRODUTO[produto]}`}
        </button>
      </form>
    </details>
  );
}
