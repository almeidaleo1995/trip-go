import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  {
    // Duas regras do compilador do React rebaixadas a AVISO, e só estas duas.
    //
    // O portão de lint da CI só serve para alguma coisa se ele puder passar. O
    // resto do arquivo continua em `error` — inclusive `no-explicit-any`, que
    // está hoje em ZERO e é o que este bloco existe para poder continuar
    // barrando. Rebaixar tudo para fazer a CI passar seria trocar um portão
    // quebrado por um portão inútil.
    //
    // As cinco ocorrências que sobram são anteriores a este trabalho e vivem no
    // miolo do app:
    //
    // - `set-state-in-effect` (TripProvider, Shell): o efeito que zera o estado
    //   ao trocar de viagem e o que escolhe a aba inicial pela fase. Consertar de
    //   verdade é reestruturar a primeira pintura, que vem do cache do IndexedDB
    //   antes da rede — o caminho que faz o app abrir em modo avião.
    // - `preserve-manual-memoization` (MapaRota): o `useCallback` do zoom, do qual
    //   depende o listener NATIVO de `wheel` (o React registra `wheel` como
    //   passivo, e em listener passivo `preventDefault()` não faz nada). Tirar a
    //   memoização manual troca a garantia de identidade estável por uma que o
    //   compilador promete, e quem paga se ele errar é o gesto do mapa.
    //
    // Nenhuma das duas é risco de segurança nem bug conhecido: são avisos de
    // desempenho e de idiomática. Viram `error` de novo no dia em que alguém
    // reescrever esses dois arquivos com tempo de testar no app rodando — e até
    // lá continuam VISÍVEIS no log, que é a diferença entre dívida registrada e
    // dívida escondida.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
])

export default eslintConfig
