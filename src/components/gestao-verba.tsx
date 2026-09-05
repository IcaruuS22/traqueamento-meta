'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CampanhaClassificavel } from '@/lib/db/orcamento';
import type { CategoriaVerba } from '@/lib/orcamento-categorias';
import { chaveObjetivo, rotuloObjetivo } from '@/lib/objetivos-meta';
import {
  acaoClassificarCampanhas,
  acaoExcluirCategoriaVerba,
  acaoSalvarCategoriaVerba,
  type ResultadoVerba,
} from '@/lib/acoes/verbas';
import { Card, Vazio } from '@/components/dados';
import { Alerta } from '@/components/form';
import { DialogoConfirma } from '@/components/dialogo-confirma';
import { fmtBRL } from '@/lib/format';

/**
 * Cadastro das categorias de verba e classificação das campanhas.
 *
 * Componente de cliente porque a tela é toda edição: marcar campanhas,
 * atribuir em lote, renomear categoria. Os dados chegam prontos do
 * servidor e cada ação revalida a rota — depois de salvar, o que está na
 * tela é o que está no banco, sem estado paralelo para desencontrar.
 *
 * A classificação em lote é o centro da tela, não um extra. Uma conta com
 * quarenta campanhas não é classificada uma a uma por ninguém, e uma
 * classificação pela metade é pior do que nenhuma: a categoria mostra
 * verba cheia e gasto pela metade, e o card da Visão geral diz que sobra
 * dinheiro onde não sobra.
 *
 * O filtro por objetivo da Meta existe para isso. O objetivo não é a
 * categoria — ele diz o que a campanha pede à Meta, não a que frente do
 * contrato ela pertence — mas quase sempre separa bem o primeiro corte.
 */

const SEM_CATEGORIA = '__sem__';
const TODOS = '__todos__';

/** Campanha que não entrega: pausada, arquivada, excluída. */
function pausada(status: string | null): boolean {
  const s = (status ?? '').trim().toUpperCase();
  return s !== '' && s !== 'ACTIVE';
}

export function GestaoVerba({
  cliente,
  categorias,
  campanhas,
  podeEditarVerba,
}: {
  cliente: string;
  categorias: CategoriaVerba[];
  campanhas: CampanhaClassificavel[];
  podeEditarVerba: boolean;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [aviso, setAviso] = useState<ResultadoVerba | null>(null);

  // Formulário de categoria: `null` = fechado, 0 = criando, id = editando.
  const [editando, setEditando] = useState<number | null>(null);
  const [criando, setCriando] = useState(false);
  const [excluindo, setExcluindo] = useState<CategoriaVerba | null>(null);

  const [filtroObjetivo, setFiltroObjetivo] = useState(TODOS);
  const [filtroCategoria, setFiltroCategoria] = useState(TODOS);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState<string>(SEM_CATEGORIA);

  const nomePorId = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of categorias) m.set(c.id, c.nome);
    return m;
  }, [categorias]);

  /** Objetivos presentes na conta, com quantas campanhas cada um tem. */
  const objetivos = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const c of campanhas) {
      const k = chaveObjetivo(c.objetivo);
      contagem.set(k, (contagem.get(k) ?? 0) + 1);
    }
    return [...contagem.entries()]
      .map(([chave, total]) => ({ chave, rotulo: rotuloObjetivo(chave), total }))
      .sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  }, [campanhas]);

  const visiveis = useMemo(
    () =>
      campanhas.filter((c) => {
        if (filtroObjetivo !== TODOS && chaveObjetivo(c.objetivo) !== filtroObjetivo) return false;
        if (filtroCategoria === TODOS) return true;
        if (filtroCategoria === SEM_CATEGORIA) return c.categoria_id === null;
        return c.categoria_id === Number(filtroCategoria);
      }),
    [campanhas, filtroObjetivo, filtroCategoria],
  );

  const semCategoria = campanhas.filter((c) => c.categoria_id === null).length;
  const todasMarcadas = visiveis.length > 0 && visiveis.every((c) => marcadas.has(c.campaign_id));

  function alterna(id: string) {
    setMarcadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function marcaVisiveis(marcar: boolean) {
    setMarcadas((atual) => {
      const proximo = new Set(atual);
      for (const c of visiveis) {
        if (marcar) proximo.add(c.campaign_id);
        else proximo.delete(c.campaign_id);
      }
      return proximo;
    });
  }

  function roda(promessa: Promise<ResultadoVerba>, aoDarCerto?: () => void) {
    iniciar(async () => {
      const r = await promessa;
      setAviso(r);
      if (r.ok) {
        aoDarCerto?.();
        router.refresh();
      }
    });
  }

  function aplicaClassificacao() {
    const ids = [...marcadas];
    if (ids.length === 0) return;
    roda(
      acaoClassificarCampanhas({
        cliente,
        campanhas: ids,
        categoria_id: destino === SEM_CATEGORIA ? null : Number(destino),
      }),
      () => setMarcadas(new Set()),
    );
  }

  return (
    <>
      {aviso ? (
        <div className="mb-4">
          <Alerta tipo={aviso.ok ? 'sucesso' : 'erro'}>
            {aviso.ok ? aviso.sucesso : aviso.erro}
          </Alerta>
        </div>
      ) : null}

      <Card
        titulo="Categorias de verba"
        descricao="Cada frente de campanha com o valor combinado para o mês. Deixar a verba em branco separa o gasto sem cobrar teto."
        acessorio={
          podeEditarVerba && !criando ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setCriando(true);
                setEditando(null);
              }}
            >
              + Nova categoria
            </button>
          ) : null
        }
      >
        {criando ? (
          <FormCategoria
            cliente={cliente}
            categoria={null}
            pendente={pendente}
            aoCancelar={() => setCriando(false)}
            aoEnviar={(p) => roda(p, () => setCriando(false))}
          />
        ) : null}

        {categorias.length === 0 && !criando ? (
          <Vazio>
            {podeEditarVerba
              ? 'Nenhuma categoria ainda. Crie uma para cada frente de campanha — captação, remarketing, institucional — e divida o investimento entre elas.'
              : 'Nenhuma categoria cadastrada. Um administrador precisa criá-las.'}
          </Vazio>
        ) : (
          <ul className="mt-2 flex flex-col divide-y">
            {categorias.map((c) => {
              const quantas = campanhas.filter((x) => x.categoria_id === c.id).length;

              return (
                <li key={c.id} className="py-2">
                  {editando === c.id ? (
                    <FormCategoria
                      cliente={cliente}
                      categoria={c}
                      pendente={pendente}
                      aoCancelar={() => setEditando(null)}
                      aoEnviar={(p) => roda(p, () => setEditando(null))}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-sm font-medium">{c.nome}</span>
                        <span className="ml-2 text-xs text-[var(--text-tertiary)] tabular-nums">
                          {c.verba === null ? 'sem verba própria' : fmtBRL(c.verba)} ·{' '}
                          {quantas === 1 ? '1 campanha' : `${quantas} campanhas`}
                        </span>
                      </div>

                      {podeEditarVerba ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setEditando(c.id);
                              setCriando(false);
                            }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm text-red-600"
                            onClick={() => setExcluindo(c)}
                          >
                            Excluir
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        titulo="Campanhas"
        descricao="A qual frente cada campanha pertence. Filtre pelo objetivo da Meta para classificar várias de uma vez."
        className="mt-4"
      >
        {campanhas.length === 0 ? (
          <Vazio>
            Nenhuma campanha sincronizada. Se este cliente nunca importou o Meta Ads, rode a
            importação de histórico na tela de Campanhas.
          </Vazio>
        ) : (
          <>
            {semCategoria > 0 ? (
              <p className="mb-3 text-xs text-amber-600">
                {semCategoria === 1
                  ? '1 campanha ainda sem categoria: o gasto dela aparece solto no card da Visão geral.'
                  : `${semCategoria} campanhas ainda sem categoria: o gasto delas aparece solto no card da Visão geral.`}
              </p>
            ) : null}

            <div className="mb-3 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]">
                  Objetivo da Meta
                </span>
                <select
                  className="field !w-56"
                  value={filtroObjetivo}
                  onChange={(e) => setFiltroObjetivo(e.target.value)}
                >
                  <option value={TODOS}>Todos os objetivos</option>
                  {objetivos.map((o) => (
                    <option key={o.chave} value={o.chave}>
                      {o.rotulo} ({o.total})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]">
                  Categoria
                </span>
                <select
                  className="field !w-56"
                  value={filtroCategoria}
                  onChange={(e) => setFiltroCategoria(e.target.value)}
                >
                  <option value={TODOS}>Todas</option>
                  <option value={SEM_CATEGORIA}>Sem categoria ({semCategoria})</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* A barra de lote só aparece com algo marcado: vazia, ela
                ocuparia espaço dizendo o que fazer com nada. */}
            {marcadas.size > 0 ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] bg-[var(--bg-field)] px-3 py-2">
                <span className="text-sm">
                  {marcadas.size === 1 ? '1 campanha marcada' : `${marcadas.size} campanhas marcadas`}
                </span>
                <select
                  className="field !w-48"
                  value={destino}
                  onChange={(e) => setDestino(e.target.value)}
                >
                  <option value={SEM_CATEGORIA}>Sem categoria</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.nome}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={pendente}
                  onClick={aplicaClassificacao}
                >
                  {pendente ? 'Salvando…' : 'Aplicar'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setMarcadas(new Set())}
                >
                  Limpar seleção
                </button>
              </div>
            ) : null}

            <div className="table-wrap">
              <table className="tabela-painel">
                <thead>
                  <tr>
                    <th className="w-8">
                      <input
                        type="checkbox"
                        aria-label="Marcar todas as campanhas da lista"
                        checked={todasMarcadas}
                        onChange={(e) => marcaVisiveis(e.target.checked)}
                      />
                    </th>
                    <th>Campanha</th>
                    <th>Objetivo da Meta</th>
                    <th>Categoria</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((c) => (
                    <tr key={c.campaign_id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Marcar ${c.nome ?? c.campaign_id}`}
                          checked={marcadas.has(c.campaign_id)}
                          onChange={() => alterna(c.campaign_id)}
                        />
                      </td>
                      <td>
                        {c.nome ?? c.campaign_id}
                        {pausada(c.status) ? (
                          <span className="ml-2 text-xs text-[var(--text-tertiary)]">
                            (não entrega)
                          </span>
                        ) : null}
                      </td>
                      <td className="text-[var(--text-secondary)]">{rotuloObjetivo(c.objetivo)}</td>
                      <td>
                        {/* O seletor por linha existe para a exceção: o
                            lote resolve o grosso, e sobra sempre uma
                            campanha que não segue o objetivo dela. */}
                        <select
                          className="field !w-44"
                          aria-label={`Categoria de ${c.nome ?? c.campaign_id}`}
                          value={c.categoria_id === null ? SEM_CATEGORIA : String(c.categoria_id)}
                          disabled={pendente}
                          onChange={(e) =>
                            roda(
                              acaoClassificarCampanhas({
                                cliente,
                                campanhas: [c.campaign_id],
                                categoria_id:
                                  e.target.value === SEM_CATEGORIA ? null : Number(e.target.value),
                              }),
                            )
                          }
                        >
                          <option value={SEM_CATEGORIA}>Sem categoria</option>
                          {categorias.map((cat) => (
                            <option key={cat.id} value={String(cat.id)}>
                              {cat.nome}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {visiveis.length === 0 ? <Vazio>Nenhuma campanha com esses filtros.</Vazio> : null}
          </>
        )}
      </Card>

      <DialogoConfirma
        aberto={excluindo !== null}
        titulo="Excluir categoria"
        texto={
          excluindo
            ? `"${excluindo.nome}" deixa de existir e as campanhas dela ficam sem categoria. O gasto não some: ele volta a contar só no total do mês.`
            : ''
        }
        rotuloConfirma="Excluir"
        perigo
        onConfirma={() => {
          const alvo = excluindo;
          setExcluindo(null);
          if (alvo) roda(acaoExcluirCategoriaVerba({ cliente, id: alvo.id }));
        }}
        onCancela={() => setExcluindo(null)}
      />
    </>
  );
}

/**
 * Formulário de uma categoria, usado para criar e para editar.
 *
 * É o mesmo formulário nos dois casos porque os campos são os mesmos —
 * separá-los só criaria duas telas para divergir na primeira mudança.
 */
function FormCategoria({
  cliente,
  categoria,
  pendente,
  aoEnviar,
  aoCancelar,
}: {
  cliente: string;
  /** `null` ao criar. */
  categoria: CategoriaVerba | null;
  pendente: boolean;
  aoEnviar: (promessa: Promise<ResultadoVerba>) => void;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState(categoria?.nome ?? '');
  const [verba, setVerba] = useState(categoria?.verba === null || categoria === null ? '' : String(categoria.verba));

  return (
    <form
      className="flex flex-wrap items-end gap-2 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        aoEnviar(
          acaoSalvarCategoriaVerba({ cliente, id: categoria?.id ?? null, nome, verba }),
        );
      }}
    >
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]">Nome</span>
        <input
          className="field !w-56"
          value={nome}
          maxLength={60}
          autoComplete="off"
          placeholder="ex.: Captação"
          onChange={(e) => setNome(e.target.value)}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]">
          Verba mensal
        </span>
        <input
          className="field !w-40"
          value={verba}
          maxLength={20}
          inputMode="decimal"
          autoComplete="off"
          placeholder="ex.: 1500,00"
          onChange={(e) => setVerba(e.target.value)}
        />
      </label>

      <button type="submit" className="btn btn-primary btn-sm" disabled={pendente}>
        {pendente ? 'Salvando…' : 'Salvar'}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={aoCancelar}>
        Cancelar
      </button>
    </form>
  );
}
