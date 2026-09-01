// Resolve o alias `@/` para `node --test`.
//
// As rotas usam `@/lib/...` porque é o que o Next resolve, e isso deixava
// TODA rota fora do alcance dos testes — o motivo real de este projeto não ter
// nenhum teste de rota (o `test:api` mira a autenticação por PIN, removida).
// Vinte linhas de hook custam menos que a alternativa, que é nunca testar as
// rotas ou reescrever os imports só para agradar ao runner.
import { pathToFileURL } from 'node:url'
import { register } from 'node:module'

const raiz = pathToFileURL(process.cwd() + '/').href

register(
  'data:text/javascript,' +
    encodeURIComponent(`
    export async function resolve(especificador, contexto, proximo) {
      if (especificador.startsWith('@/')) {
        return proximo(new URL(especificador.slice(2), ${JSON.stringify(raiz)}).href, contexto)
      }
      // Subcaminho do next (next/navigation, next/server): o mapa de exports
      // do pacote resolve isso no bundler, mas o ESM cru do node quer a
      // extensao. Tentar com .js e so cair de volta se nao existir.
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
