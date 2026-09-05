'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireClientAccess } from '@/lib/auth/guard';
import { ACOES, registraAuditoria } from '@/lib/audit';
import { lacunaDeEsquema } from '@/lib/db/pool';
import {
  atualizaCategoriaVerba,
  criaCategoriaVerba,
  defineCategoriaDeCampanhas,
  proximaOrdemCategoria,
  removeCategoriaVerba,
} from '@/lib/db/orcamento';

/**
 * Categorias de verba e classificação das campanhas.
 *
 * Duas permissões diferentes, pelo mesmo critério do resto do app:
 *
 *  - Criar, renomear, mudar a verba e apagar categoria é de
 *    administrador. É dado comercial, vizinho de `monthly_fee`: quanto se
 *    combinou de gastar em cada frente é decisão de contrato.
 *  - Atribuir campanha a categoria é de quem tem acesso ao cliente. É
 *    operação de rotina, tem volta pelo mesmo seletor, e é ela que
 *    precisa acontecer toda vez que uma campanha nova entra na conta.
 *    Quem fez fica na auditoria.
 *
 * Nenhuma delas toca a Meta: categoria é conceito do painel, e a conta de
 * anúncio nem fica sabendo.
 */

export type ResultadoVerba = { ok: true; sucesso: string } | { ok: false; erro: string };

/** Mensagem única para quando a migração ainda não rodou no banco central. */
const FALTA_MIGRACAO =
  'O banco central ainda não tem as tabelas de categoria de verba. ' +
  'Rode "Banco de Dados/migracao_verba_por_categoria.sql" e tente de novo.';

/**
 * Converte o valor digitado em número.
 *
 * Aceita "1.500,00" e "1500.00" pelo mesmo motivo do investimento mensal: o
 * separador varia com o teclado e com o hábito de quem digita. Vazio vira
 * `null` — categoria sem verba própria, que separa gasto sem cobrar teto.
 */
function leValor(bruto: string): number | null | 'invalido' {
  const limpo = bruto
    .trim()
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  if (limpo === '') return null;

  const numero = Number(limpo);
  if (!Number.isFinite(numero) || numero < 0) return 'invalido';
  return numero > 0 ? Math.round(numero * 100) / 100 : null;
}

const SchemaCategoria = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  /** Ausente = criar. Presente = editar a categoria com este id. */
  id: z.number().int().positive().nullable(),
  nome: z.string().trim().min(1, 'Dê um nome à categoria').max(60),
  verba: z.string().max(20),
});

/** Cria ou edita uma categoria com a sua verba mensal. */
export async function acaoSalvarCategoriaVerba(
  entrada: z.input<typeof SchemaCategoria>,
): Promise<ResultadoVerba> {
  const analise = SchemaCategoria.safeParse(entrada);
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = analise.data;

  const { usuario, conta } = await requireClientAccess(dados.cliente);
  if (usuario.papel !== 'admin') {
    return { ok: false, erro: 'Só um administrador altera a verba combinada.' };
  }

  const verba = leValor(dados.verba);
  if (verba === 'invalido') {
    return { ok: false, erro: 'Informe a verba em números, como 1500 ou 1500,00.' };
  }

  try {
    if (dados.id === null) {
      const ordem = await proximaOrdemCategoria(conta.client_db_name);
      await criaCategoriaVerba(conta.client_db_name, dados.nome, verba, ordem);
    } else {
      const linhas = await atualizaCategoriaVerba(
        conta.client_db_name,
        dados.id,
        dados.nome,
        verba,
      );
      if (linhas === 0) return { ok: false, erro: 'Categoria não encontrada.' };
    }
  } catch (erro) {
    if (lacunaDeEsquema(erro)) return { ok: false, erro: FALTA_MIGRACAO };
    // O índice único é (cliente, nome): dois "Remarketing" virariam duas
    // barras iguais no card, e ninguém saberia em qual mexer.
    if ((erro as { code?: string })?.code === 'ER_DUP_ENTRY') {
      return { ok: false, erro: `Já existe uma categoria chamada "${dados.nome}".` };
    }
    console.error('[verbas] falha ao salvar categoria', conta.client_db_name, erro);
    return { ok: false, erro: 'Não foi possível salvar a categoria.' };
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.VERBA_CATEGORIA_SALVA,
    clientDb: conta.client_db_name,
    detalhe: { id: dados.id, nome: dados.nome, verba },
  });

  revalidaTelas(conta.client_db_name);
  return { ok: true, sucesso: `Categoria "${dados.nome}" salva.` };
}

const SchemaExcluir = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  id: z.number().int().positive(),
});

/**
 * Apaga a categoria. As campanhas dela voltam a ficar sem categoria — o
 * gasto continua inteiro no card geral, só deixa de estar separado.
 */
export async function acaoExcluirCategoriaVerba(
  entrada: z.input<typeof SchemaExcluir>,
): Promise<ResultadoVerba> {
  const analise = SchemaExcluir.safeParse(entrada);
  if (!analise.success) return { ok: false, erro: 'Dados inválidos' };

  const { usuario, conta } = await requireClientAccess(analise.data.cliente);
  if (usuario.papel !== 'admin') {
    return { ok: false, erro: 'Só um administrador exclui categoria de verba.' };
  }

  try {
    const linhas = await removeCategoriaVerba(conta.client_db_name, analise.data.id);
    if (linhas === 0) return { ok: false, erro: 'Categoria não encontrada.' };
  } catch (erro) {
    if (lacunaDeEsquema(erro)) return { ok: false, erro: FALTA_MIGRACAO };
    console.error('[verbas] falha ao excluir categoria', conta.client_db_name, erro);
    return { ok: false, erro: 'Não foi possível excluir a categoria.' };
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.VERBA_CATEGORIA_EXCLUIDA,
    clientDb: conta.client_db_name,
    detalhe: { id: analise.data.id },
  });

  revalidaTelas(conta.client_db_name);
  return { ok: true, sucesso: 'Categoria excluída. As campanhas dela ficaram sem categoria.' };
}

const SchemaClassificar = z.object({
  cliente: z.string().trim().min(1, 'Cliente não informado'),
  // Ids da Meta são numéricos. O limite de 500 é o tamanho do lote que a
  // tela consegue selecionar de uma vez — conta grande tem centenas de
  // campanhas, e o atalho por objetivo marca todas de um golpe só.
  campanhas: z
    .array(z.string().trim().regex(/^\d{1,25}$/))
    .min(1)
    .max(500),
  /** `null` desclassifica as campanhas escolhidas. */
  categoria_id: z.number().int().positive().nullable(),
});

/** Põe (ou tira) campanhas de uma categoria. */
export async function acaoClassificarCampanhas(
  entrada: z.input<typeof SchemaClassificar>,
): Promise<ResultadoVerba> {
  const analise = SchemaClassificar.safeParse(entrada);
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const dados = analise.data;

  const { usuario, conta } = await requireClientAccess(dados.cliente);

  try {
    await defineCategoriaDeCampanhas(conta.client_db_name, dados.campanhas, dados.categoria_id);
  } catch (erro) {
    if (lacunaDeEsquema(erro)) return { ok: false, erro: FALTA_MIGRACAO };
    // Categoria apagada por outra pessoa entre carregar a tela e clicar.
    if ((erro as { code?: string })?.code === 'ER_NO_REFERENCED_ROW_2') {
      return { ok: false, erro: 'Essa categoria não existe mais. Recarregue a página.' };
    }
    console.error('[verbas] falha ao classificar campanhas', conta.client_db_name, erro);
    return { ok: false, erro: 'Não foi possível salvar a classificação.' };
  }

  await registraAuditoria({
    userId: usuario.id,
    userEmail: usuario.email,
    acao: ACOES.VERBA_CAMPANHAS_CLASSIFICADAS,
    clientDb: conta.client_db_name,
    detalhe: { total: dados.campanhas.length, categoria_id: dados.categoria_id },
  });

  revalidaTelas(conta.client_db_name);
  const uma = dados.campanhas.length === 1;
  const quantas = uma ? '1 campanha' : `${dados.campanhas.length} campanhas`;
  return {
    ok: true,
    sucesso:
      dados.categoria_id === null
        ? `${quantas} sem categoria.`
        : `${quantas} classificada${uma ? '' : 's'}.`,
  };
}

/**
 * A verba aparece em dois lugares: na tela de gestão e no card da Visão
 * geral. Mudar a categoria sem revalidar as duas deixaria o card mostrando
 * a divisão antiga até o próximo F5.
 */
function revalidaTelas(clientDb: string) {
  const base = `/app/${clientDb}`;
  revalidatePath(`${base}/campanhas/verba`);
  revalidatePath(`${base}/visao-geral`);
}
