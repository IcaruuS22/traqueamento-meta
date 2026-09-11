import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

/**
 * Configuração do ESLint.
 *
 * Este arquivo não existia. O projeto tinha `eslint` 9 e
 * `eslint-config-next` instalados e um script `lint` no package.json,
 * mas nenhum arquivo de configuração — e o ESLint 9 só procura pelo
 * formato "flat" (`eslint.config.*`). Resultado: `npm run lint` sempre
 * falhou com "couldn't find an eslint.config file", e a checagem nunca
 * rodou uma única vez sobre este código.
 *
 * `eslint-config-next` ainda é distribuído no formato antigo
 * (`.eslintrc`), sem ponto de entrada flat. `FlatCompat` é a ponte
 * oficial entre os dois: traduz o preset antigo para o formato novo.
 * Quando o pacote passar a exportar configuração flat, isto vira um
 * import direto e o compat sai.
 */
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    // Saída de build, dependências e artefatos. `.next` sozinho já é
    // maior que o código-fonte inteiro.
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'coverage/**',
      // Geradores dos workflows do n8n. São scripts CommonJS de linha de
      // comando que vivem ao lado da aplicação mas não fazem parte dela:
      // não passam pelo bundler, não têm TypeScript e usam `require` de
      // propósito. Aplicar as regras do app aqui só produziria ruído.
      '**/build_*_workflow.js',
    ],
  },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  {
    rules: {
      // Variável não usada é erro, com uma exceção deliberada: prefixo
      // `_`. É o que permite `(_estado, form)` nas Server Actions, onde
      // a assinatura é imposta pelo `useActionState` e o primeiro
      // parâmetro existe só para ocupar a posição.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // O projeto não usa `any` em lugar nenhum hoje (conferido) e a
      // intenção é que continue assim: em código que fala com banco e
      // com API externa, `any` é justamente onde o erro de tipo se
      // esconde. `unknown` + validação é o padrão da casa.
      '@typescript-eslint/no-explicit-any': 'error',
      // Regra do Pages Router: ela manda declarar fontes em
      // `pages/_document.js`, arquivo que não existe no App Router. O
      // `<link>` de fonte no `app/layout.tsx` já é global por definição.
      '@next/next/no-page-custom-font': 'off',
    },
  },
];

export default config;
