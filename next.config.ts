// Os cabecalhos vem de `lib/seguranca.ts`, nao daqui: a lista e conferida por
// teste, e teste que importa `next.config.ts` arrasta o Next inteiro para dentro
// do `node --test`.
import type { NextConfig } from 'next'
import { CABECALHOS_SEGURANCA } from './lib/seguranca.ts'

const nextConfig: NextConfig = {
  // `X-Powered-By: Next.js` nao protege ninguem e diz ao scanner qual lista de
  // CVE tentar primeiro. Nao e defesa — e so nao entregar de graca.
  poweredByHeader: false,

  async headers() {
    return [
      {
        // Tudo: pagina, rota de API e arquivo estatico. O cofre acrescenta os
        // seus proprios por cima, na resposta.
        source: '/:caminho*',
        headers: CABECALHOS_SEGURANCA,
      },
    ]
  },
}

export default nextConfig
