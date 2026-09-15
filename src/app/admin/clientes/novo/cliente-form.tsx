'use client';

import { startTransition, useActionState, useState } from 'react';
import Link from 'next/link';
import { acaoCriarCliente } from '@/lib/acoes/clientes';
import type { EstadoFormulario } from '@/lib/auth/actions';
import { Alerta, Campo } from '@/components/form';
import { IconesNav } from '@/components/icones';
import {
  DESCRICAO_PRODUTO,
  PEDE_PRODUTO,
  PRODUTOS,
  ROTULO_PRODUTO,
  normalizaProdutos,
  type Produto,
} from '@/lib/produtos';
import { CamposDoProduto } from '../campos-produto';

const ICONE: Record<Produto, React.ReactNode> = {
  landing_page: <IconesNav.paginas />,
  formularios: <IconesNav.configEventos />,
  whatsapp: <IconesNav.whatsapp />,
};

/**
 * Formulário de cliente novo, em duas etapas: primeiro os produtos que o
 * cliente vai usar, depois os dados da Meta e só os dados iniciais dos
 * produtos escolhidos.
 *
 * As duas etapas vivem no mesmo `<form>` e a inativa só fica escondida:
 * voltar para trocar os produtos não apaga o que já foi digitado nos
 * campos da Meta.
 */
export function ClienteForm() {
  const [estado, acao, pendente] = useActionState<EstadoFormulario, FormData>(acaoCriarCliente, {});
  const [escolhidos, setEscolhidos] = useState<Produto[]>([]);
  const [etapa, setEtapa] = useState<'produtos' | 'dados'>('produtos');

  function alterna(produto: Produto) {
    setEscolhidos((atual) =>
      normalizaProdutos(atual.includes(produto) ? atual.filter((p) => p !== produto) : [...atual, produto]),
    );
  }

  // Envio manual em vez de `<form action>`: o React limpa o formulário
  // depois de uma action, e um erro de validação obrigaria a digitar os
  // três tokens de novo.
  function envia(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    startTransition(() => acao(dados));
  }

  return (
    <form onSubmit={envia} className="space-y-5">
      <section hidden={etapa !== 'produtos'} className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-base font-medium">Quais produtos este cliente vai usar?</h2>
          <p className="text-sm text-[var(--text-tertiary)]">
            Marque um ou mais. O cadastro pede só os dados dos produtos marcados, e outros podem ser
            adicionados depois na lista de clientes.
          </p>
        </div>

        <div className="conexao-grade" role="group" aria-label="Produtos">
          {PRODUTOS.map((p) => {
            const marcado = escolhidos.includes(p);
            return (
              <label
                key={p}
                className={`conexao-cartao cursor-pointer ${marcado ? 'conexao-cartao-ativo' : ''}`}
              >
                <div className="conexao-cabeca">
                  <span className="conexao-icone" aria-hidden>
                    {ICONE[p]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="conexao-titulo block">{ROTULO_PRODUTO[p]}</span>
                    <span className={`conexao-selo ${marcado ? 'conexao-selo-ativo' : 'conexao-selo-neutro'}`}>
                      {marcado ? 'Selecionado' : 'Não selecionado'}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    name="produtos"
                    value={p}
                    checked={marcado}
                    onChange={() => alterna(p)}
                    className="mt-1 h-4 w-4"
                  />
                </div>
                <p className="conexao-descricao">{DESCRICAO_PRODUTO[p]}</p>
                <ul className="conexao-requisitos">
                  {PEDE_PRODUTO[p].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </label>
            );
          })}
        </div>

        <p className="text-xs text-[var(--text-tertiary)]">
          Os dados da Meta (conta de anúncios, pixel e token) são pedidos para todo cliente.
        </p>

        <div className="sm:max-w-[220px]">
          <button
            type="button"
            className="btn-primary w-full"
            disabled={!escolhidos.length}
            onClick={() => setEtapa('dados')}
          >
            Continuar
          </button>
        </div>
      </section>

      {etapa === 'dados' ? (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--text-secondary)]">Produtos selecionados:</span>
            {escolhidos.map((p) => (
              <span key={p} className="conexao-selo conexao-selo-ativo !mt-0">
                {ROTULO_PRODUTO[p]}
              </span>
            ))}
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              disabled={pendente}
              onClick={() => setEtapa('produtos')}
            >
              Alterar produtos
            </button>
          </div>

          <fieldset className="space-y-4 rounded-[var(--radius-control)] border border-[var(--border-default)] p-4">
            <legend className="px-1 text-sm font-medium text-[var(--text-secondary)]">Meta</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                label="Nome do cliente"
                name="account_name"
                required
                maxLength={255}
                placeholder="ANRG Energia Solar"
                dica="Vira o nome do banco isolado do cliente."
              />
              <Campo
                label="ID da conta de anúncios"
                name="ad_account_id"
                required
                maxLength={255}
                placeholder="1234567890123456"
                dica="Só os números. O prefixo act_ é removido automaticamente."
              />
              <Campo
                label="ID do pixel / dataset"
                name="meta_pixel_dataset_id"
                required
                maxLength={255}
                placeholder="1234567890123456"
              />
              <Campo
                label="Categoria de conteúdo"
                name="content_category"
                maxLength={255}
                placeholder="energia_solar"
                dica="Opcional. Vai junto nos eventos enviados à Meta."
              />
            </div>
            <Campo
              label="Token de acesso da Meta"
              name="meta_access_token"
              type="password"
              required
              autoComplete="off"
              dica="Token de System User, com permissão na conta de anúncios e no dataset."
            />
          </fieldset>

          {escolhidos.map((p) => (
            <CamposDoProduto key={p} produto={p} />
          ))}

          {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
          {estado.sucesso ? (
            <div className="space-y-2">
              <Alerta tipo="sucesso">{estado.sucesso}</Alerta>
              <div className="flex flex-wrap gap-4 text-sm">
                <Link href="/admin/clientes" className="underline">
                  Ir para a lista de clientes
                </Link>
                <Link href="/app" className="underline">
                  Abrir o painel
                </Link>
              </div>
            </div>
          ) : null}

          <div className="sm:max-w-[220px]">
            <button type="submit" className="btn-primary w-full" disabled={pendente}>
              {pendente ? 'Criando…' : 'Criar cliente'}
            </button>
          </div>
        </section>
      ) : null}
    </form>
  );
}
