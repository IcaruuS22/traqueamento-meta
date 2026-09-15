import 'server-only';
import { headers } from 'next/headers';

/**
 * Limitador de tentativas para as ações de autenticação.
 *
 * Existe porque `acaoLogin`, `acaoRecuperarSenha` e `acaoSolicitarAcesso`
 * aceitavam chamadas ilimitadas. O bcrypt de custo 12 encarece cada
 * tentativa, mas encarecer não é impedir: sem contador, testar senha em
 * cima de um e-mail conhecido é só uma questão de deixar o script
 * rodando, e a tela de recuperação vira uma máquina de disparar e-mail.
 *
 * Janela deslizante em memória do processo, sem tabela e sem Redis. É
 * uma escolha, não um esquecimento:
 *
 *  - o estado é pequeno, descartável e não precisa sobreviver a deploy;
 *  - gravar cada tentativa no banco central transformaria a tela de
 *    login no caminho mais barato para derrubar o banco de todo mundo.
 *
 * O preço é conhecido: com mais de uma instância do servidor, cada uma
 * conta o seu — o teto real vira N × o configurado. Continua sendo
 * ordens de grandeza melhor que teto nenhum. Se um dia houver Redis no
 * projeto, é `bateu()` que muda, não quem chama.
 */

type Janela = { inicio: number; contagem: number };

// Mesma razão do pool: em desenvolvimento o Next recarrega o módulo a
// cada alteração, e um Map de módulo seria zerado a cada hot reload —
// o que é o mesmo que não ter limitador enquanto se mexe no código.
const CHAVE = Symbol.for('trakeamento.auth.limite');
const global = globalThis as unknown as { [CHAVE]?: Map<string, Janela> };
const janelas: Map<string, Janela> = (global[CHAVE] ??= new Map());

/** Acima disso o Map é varrido antes de crescer mais. */
const TETO_ENTRADAS = 10_000;

export type Regra = {
  /** Tentativas permitidas dentro da janela. */
  max: number;
  /** Tamanho da janela, em segundos. */
  janelaSeg: number;
};

/**
 * Regras por ação. Os números do login são separados de propósito:
 *
 *  - por e-mail o teto é baixo, porque adivinhar senha exige insistir no
 *    MESMO e-mail;
 *  - por IP o teto é mais alto, porque um escritório inteiro atrás de um
 *    NAT compartilha endereço e não pode ser trancado pelo vizinho.
 *
 * O contador por e-mail só sobe em tentativa que FALHOU, e zera quando a
 * senha acerta (ver `limpa`). Sem isso, qualquer um trancaria a conta de
 * qualquer um só errando a senha alheia de propósito.
 */
export const REGRAS = {
  loginPorEmail: { max: 8, janelaSeg: 600 },
  loginPorIp: { max: 30, janelaSeg: 600 },
  recuperarPorEmail: { max: 3, janelaSeg: 900 },
  recuperarPorIp: { max: 10, janelaSeg: 900 },
  solicitarPorIp: { max: 5, janelaSeg: 3600 },
  // Rastreio de páginas de vendas (rotas públicas, sem sessão). O teto
  // da coleta é alto porque uma navegação normal manda PageView a cada
  // troca de página, e um escritório inteiro pode estar atrás do mesmo
  // IP. O de lead é baixo porque cada lead grava uma linha no banco do
  // cliente e dispara um evento na CAPI: é ali que um robô enchendo
  // formulário sujaria o relatório e a otimização da Meta.
  coletaPorIp: { max: 120, janelaSeg: 60 },
  leadPorIp: { max: 10, janelaSeg: 600 },
  compraPorIp: { max: 120, janelaSeg: 60 },
} as const satisfies Record<string, Regra>;

export type NomeRegra = keyof typeof REGRAS;

/**
 * IP de quem chamou, para uso como chave de contagem.
 *
 * `x-forwarded-for` é cabeçalho, portanto forjável — quem quiser furar o
 * teto por IP troca o valor a cada requisição. Não tem como resolver
 * isso na aplicação: só o proxy da borda sabe qual é o IP real. Por isso
 * o limite por IP é a segunda linha, e o limite por e-mail (que não dá
 * para trocar, porque é o alvo do ataque) é a primeira.
 */
async function identificaOrigem(): Promise<string> {
  const h = await headers();
  const encaminhado = h.get('x-forwarded-for');
  if (encaminhado) return encaminhado.split(',')[0]!.trim();
  return h.get('x-real-ip') ?? 'desconhecido';
}

/** Remove janelas já expiradas. Chamado só quando o Map fica grande. */
function varre(agora: number): void {
  for (const [chave, janela] of janelas) {
    const regra = REGRAS[chave.split(':', 1)[0] as NomeRegra];
    if (!regra || agora - janela.inicio >= regra.janelaSeg * 1000) janelas.delete(chave);
  }
}

export type Resultado = { bloqueado: boolean; esperaSeg: number };

/**
 * Registra uma tentativa e diz se estourou o teto.
 *
 * Contabiliza SEMPRE, inclusive na chamada que já vem bloqueada: quem
 * insiste durante o bloqueio empurra a janela para frente em vez de
 * ficar tentando de graça na borda dela.
 */
export function bateu(regra: NomeRegra, identificador: string): Resultado {
  const { max, janelaSeg } = REGRAS[regra];
  const chave = `${regra}:${identificador.toLowerCase()}`;
  const agora = Date.now();

  if (janelas.size > TETO_ENTRADAS) varre(agora);

  const atual = janelas.get(chave);
  if (!atual || agora - atual.inicio >= janelaSeg * 1000) {
    janelas.set(chave, { inicio: agora, contagem: 1 });
    return { bloqueado: false, esperaSeg: 0 };
  }

  atual.contagem += 1;
  if (atual.contagem <= max) return { bloqueado: false, esperaSeg: 0 };

  const restanteMs = atual.inicio + janelaSeg * 1000 - agora;
  return { bloqueado: true, esperaSeg: Math.max(1, Math.ceil(restanteMs / 1000)) };
}

/** Zera a contagem. Usado depois de um login bem-sucedido. */
export function limpa(regra: NomeRegra, identificador: string): void {
  janelas.delete(`${regra}:${identificador.toLowerCase()}`);
}

/**
 * Checa as regras de uma ação e devolve a mensagem pronta, ou `null` se
 * está liberado. Contabiliza TODAS as regras antes de decidir — parar na
 * primeira que passou deixaria a segunda sem contagem.
 */
export async function verificaLimite(
  regras: readonly { regra: NomeRegra; identificador?: string }[],
): Promise<string | null> {
  const ip = await identificaOrigem();
  let pior = 0;
  for (const { regra, identificador } of regras) {
    const r = bateu(regra, identificador ?? ip);
    if (r.bloqueado) pior = Math.max(pior, r.esperaSeg);
  }
  if (!pior) return null;

  const minutos = Math.ceil(pior / 60);
  return `Muitas tentativas. Tente novamente em ${
    minutos <= 1 ? 'cerca de 1 minuto' : `cerca de ${minutos} minutos`
  }.`;
}
