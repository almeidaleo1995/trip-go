// Abre os modulos do app para os scripts desta skill. Nada mais.
//
// O app importa `@/lib/db.ts`, e esse `@/` e um alias que o Next resolve no
// bundler — o ESM cru do node nao conhece. Sem o resolvedor abaixo, importar
// `lib/escrita.ts` daqui morre com "Cannot find package '@/lib'", e a skill
// acabaria reimplementando as regras de escrita em vez de USAR as do app. Essa
// reimplementacao seria a copia que envelhece: no dia em que uma autorizacao
// mudasse no app, a skill continuaria gravando pela regra velha.
//
// `scripts/alias.mjs` no projeto faz o mesmo para `node --test`, so que ancorado
// em `process.cwd()`. Aqui a raiz e calculada a partir DESTE arquivo, para que os
// scripts funcionem de qualquer diretorio.
import { pathToFileURL } from 'node:url'
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

export const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const base = pathToFileURL(raiz + '/').href

register(
  'data:text/javascript,' +
    encodeURIComponent(`
    export async function resolve(especificador, contexto, proximo) {
      if (especificador.startsWith('@/')) {
        return proximo(new URL(especificador.slice(2), ${JSON.stringify(base)}).href, contexto)
      }
      // Subcaminho do next (next/navigation, next/headers): o mapa de exports do
      // pacote resolve isso no bundler, mas o ESM cru do node quer a extensao.
      if (/^next\\/[a-z-]+$/.test(especificador)) {
        try {
          return await proximo(especificador + '.js', contexto)
        } catch {
          return proximo(especificador, contexto)
        }
      }
      return proximo(especificador, contexto)
    }
  `),
  import.meta.url,
)

/** Um modulo do app, pelo caminho a partir da raiz: carregar('lib', 'escrita.ts'). */
export const carregar = (...partes) => import(pathToFileURL(join(raiz, ...partes)).href)
