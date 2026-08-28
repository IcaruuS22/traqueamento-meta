import type { ReactNode } from 'react';

/**
 * Renderizador de Markdown mínimo, para o texto que volta da Groq.
 *
 * O painel antigo mostrava a resposta com `.textContent`, então títulos,
 * negrito e listas apareciam como `###`, `**` e `-` na tela — foi
 * exatamente essa a reclamação que originou este porte.
 *
 * Não existe conversão para HTML aqui: o texto vira elementos React,
 * nunca `dangerouslySetInnerHTML`. Um modelo de linguagem é uma fonte
 * externa como qualquer outra, e "confiar no HTML que a IA devolveu" é o
 * caminho curto para injetar script na tela de quem só queria ler uma
 * análise. O que não for reconhecido fica como texto puro, visível.
 *
 * O subconjunto coberto é o que o modelo de fato devolve: títulos,
 * listas, tabelas simples, negrito, itálico e código. A tabela entrou
 * depois da primeira análise real, em que o modelo respondeu as
 * recomendações em tabela e o texto saía como uma linha só de pipes.
 */

export type Bloco =
  | { tipo: 'titulo'; nivel: 2 | 3 | 4; texto: string }
  | { tipo: 'lista'; ordenada: boolean; itens: string[] }
  | { tipo: 'tabela'; cabecalho: string[] | null; linhas: string[][] }
  | { tipo: 'paragrafo'; texto: string };

const RE_TITULO = /^(#{1,6})\s+(.*)$/;
const RE_ITEM = /^\s*[-*+]\s+(.*)$/;
const RE_ITEM_NUM = /^\s*\d+[.)]\s+(.*)$/;
const RE_LINHA_TABELA = /^\s*\|(.*)\|\s*$/;
/** Linha separadora do cabeçalho: `|---|:--:|`, sem conteúdo próprio. */
const RE_SEPARADOR = /^[\s|:-]+$/;

/** Quebra `| a | b |` nas células, já sem as barras das pontas. */
function celulas(linha: string): string[] {
  const miolo = RE_LINHA_TABELA.exec(linha)![1];
  return miolo.split('|').map((c) => c.trim());
}

export function separaBlocos(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  const linhas = texto.replace(/\r\n?/g, '\n').split('\n');

  let paragrafo: string[] = [];
  let lista: { ordenada: boolean; itens: string[] } | null = null;
  let tabela: string[][] | null = null;

  const fechaParagrafo = () => {
    if (paragrafo.length) {
      blocos.push({ tipo: 'paragrafo', texto: paragrafo.join(' ') });
      paragrafo = [];
    }
  };
  const fechaLista = () => {
    if (lista) {
      blocos.push({ tipo: 'lista', ...lista });
      lista = null;
    }
  };
  const fechaTabela = () => {
    if (!tabela) return;
    // Cabeçalho só existe quando o modelo mandou a linha separadora —
    // sem ela, tratar a primeira linha como título inventaria um dado.
    const temCabecalho = tabela.length >= 2 && tabela[1].every((c) => RE_SEPARADOR.test(c) && c.includes('-'));
    const cabecalho = temCabecalho ? tabela[0] : null;
    const linhas = temCabecalho ? tabela.slice(2) : tabela;
    if (cabecalho || linhas.length) blocos.push({ tipo: 'tabela', cabecalho, linhas });
    tabela = null;
  };

  for (const linha of linhas) {
    if (!linha.trim()) {
      fechaParagrafo();
      fechaLista();
      fechaTabela();
      continue;
    }

    if (RE_LINHA_TABELA.test(linha)) {
      fechaParagrafo();
      fechaLista();
      (tabela ??= []).push(celulas(linha));
      continue;
    }
    fechaTabela();

    const titulo = RE_TITULO.exec(linha);
    if (titulo) {
      fechaParagrafo();
      fechaLista();
      // `#` e `##` viram h3 e o resto h4: o título da seção da página já
      // é o h1/h2 da tela, e a resposta da IA não pode competir com ele.
      const nivel = titulo[1].length <= 2 ? 3 : 4;
      blocos.push({ tipo: 'titulo', nivel: nivel as 3 | 4, texto: titulo[2].trim() });
      continue;
    }

    const item = RE_ITEM.exec(linha);
    const itemNum = item ? null : RE_ITEM_NUM.exec(linha);
    if (item || itemNum) {
      fechaParagrafo();
      const ordenada = Boolean(itemNum);
      if (!lista || lista.ordenada !== ordenada) {
        fechaLista();
        lista = { ordenada, itens: [] };
      }
      lista.itens.push(((item ?? itemNum) as RegExpExecArray)[1].trim());
      continue;
    }

    fechaLista();
    paragrafo.push(linha.trim());
  }

  fechaParagrafo();
  fechaLista();
  fechaTabela();
  return blocos;
}

/**
 * Marcações de trecho: `**negrito**`, `*itálico*` e `` `código` ``.
 *
 * Um `**` sem fechamento não vira nada: fica o texto como está, que é
 * melhor do que engolir o resto do parágrafo dentro de um `<strong>`.
 */
function inline(texto: string, chaveBase: string): ReactNode[] {
  const partes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  let n = 0;

  while ((m = re.exec(texto)) !== null) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
    const trecho = m[0];
    const chave = `${chaveBase}-${n++}`;
    if (trecho.startsWith('**')) {
      partes.push(<strong key={chave}>{trecho.slice(2, -2)}</strong>);
    } else if (trecho.startsWith('`')) {
      partes.push(
        <code
          key={chave}
          className="rounded bg-[var(--bg-field)] px-1 py-0.5 font-mono text-[0.85em]"
        >
          {trecho.slice(1, -1)}
        </code>,
      );
    } else {
      partes.push(<em key={chave}>{trecho.slice(1, -1)}</em>);
    }
    ultimo = m.index + trecho.length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

export function Markdown({ texto }: { texto: string }) {
  const blocos = separaBlocos(texto);

  return (
    <div className="ia-rendered">
      {blocos.map((bloco, i) => {
        if (bloco.tipo === 'titulo') {
          const Tag = bloco.nivel === 3 ? 'h3' : 'h4';
          return (
            <Tag key={i}>
              {inline(bloco.texto, `t${i}`)}
            </Tag>
          );
        }
        if (bloco.tipo === 'lista') {
          const Tag = bloco.ordenada ? 'ol' : 'ul';
          return (
            <Tag key={i}>
              {bloco.itens.map((item, j) => (
                <li key={j}>{inline(item, `l${i}-${j}`)}</li>
              ))}
            </Tag>
          );
        }
        if (bloco.tipo === 'tabela') {
          return (
            <div key={i} className="table-wrap">
              <table className="tabela-painel">
                {bloco.cabecalho ? (
                  <thead>
                    <tr>
                      {bloco.cabecalho.map((c, j) => (
                        <th key={j}>{inline(c, `th${i}-${j}`)}</th>
                      ))}
                    </tr>
                  </thead>
                ) : null}
                <tbody>
                  {bloco.linhas.map((linha, j) => (
                    <tr key={j}>
                      {linha.map((c, k) => (
                        <td key={k}>{inline(c, `td${i}-${j}-${k}`)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={i}>{inline(bloco.texto, `p${i}`)}</p>;
      })}
    </div>
  );
}
