import type { NextConfig } from 'next'
import { cabecalhosEstaticos } from './lib/seguranca.ts'

// Os cabeçalhos de segurança que NÃO dependem da requisição moram aqui, e não no
// proxy.ts, por um motivo só: o `matcher` do proxy exclui /api/*, e uma resposta
// de API sem `nosniff` é um arquivo do cofre que o navegador pode decidir tratar
// como HTML. `headers()` alcança tudo — página, rota e arquivo estático.
//
// O que continua no proxy é o que muda a cada requisição: a política de conteúdo,
// porque ela carrega um nonce novo por resposta.
const nextConfig: NextConfig = {
  // `X-Powered-By: Next.js` não é vulnerabilidade, é só dizer a versão do alvo de
  // graça para quem estiver varrendo.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:caminho*',
        headers: cabecalhosEstaticos(process.env.NODE_ENV === 'production'),
      },
    ]
  },
}

export default nextConfig
