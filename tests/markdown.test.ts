import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { separaBlocos } from '../src/components/markdown';

/**
 * Teste do parser de Markdown da resposta da IA.
 *
 * O que a Groq devolve muda a cada chamada, então o parser não pode ser
 * conferido só olhando a tela: uma tabela que só aparece em uma resposta
 * a cada tantas passaria despercebida até a próxima vez. Aqui as formas
 * que o modelo já produziu ficam fixas.
 *
 * Só a separação em blocos é testada. A renderização em si é uma
 * transformação direta desses blocos em elementos React.
 */

describe('separaBlocos', () => {
  test('título, parágrafo e lista', () => {
    const blocos = separaBlocos(
      '## Diagnóstico\n\nO CPL subiu 12%.\n\n- Campanha A parou\n- Criativo saturado\n',
    );
    assert.deepEqual(blocos, [
      { tipo: 'titulo', nivel: 3, texto: 'Diagnóstico' },
      { tipo: 'paragrafo', texto: 'O CPL subiu 12%.' },
      { tipo: 'lista', ordenada: false, itens: ['Campanha A parou', 'Criativo saturado'] },
    ]);
  });

  test('lista numerada é separada da com marcador', () => {
    const blocos = separaBlocos('- um\n1. dois\n');
    assert.deepEqual(blocos, [
      { tipo: 'lista', ordenada: false, itens: ['um'] },
      { tipo: 'lista', ordenada: true, itens: ['dois'] },
    ]);
  });

  test('tabela com cabeçalho', () => {
    const blocos = separaBlocos(
      '| # | Ação |\n|---|------|\n| 1 | Instalar pixel |\n| 2 | Ampliar alcance |\n',
    );
    assert.deepEqual(blocos, [
      {
        tipo: 'tabela',
        cabecalho: ['#', 'Ação'],
        linhas: [
          ['1', 'Instalar pixel'],
          ['2', 'Ampliar alcance'],
        ],
      },
    ]);
  });

  test('tabela sem linha separadora não inventa cabeçalho', () => {
    const blocos = separaBlocos('| a | b |\n| c | d |\n');
    assert.deepEqual(blocos, [
      { tipo: 'tabela', cabecalho: null, linhas: [['a', 'b'], ['c', 'd']] },
    ]);
  });

  test('parágrafo depois da tabela não é engolido por ela', () => {
    const blocos = separaBlocos('| a |\n|---|\n| b |\nTexto solto.\n');
    assert.deepEqual(blocos, [
      { tipo: 'tabela', cabecalho: ['a'], linhas: [['b']] },
      { tipo: 'paragrafo', texto: 'Texto solto.' },
    ]);
  });
});
