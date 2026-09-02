// Redirecionamento de rota por sessão, exigência de HTTPS e política de conteúdo.
// No Next 16 este arquivo se chama `proxy` (era `middleware` até a 15) e roda no
// runtime Node por padrão.
//
// Checagem de sessão OTIMISTA, de propósito: só confere a assinatura do cookie,
// nunca vai ao banco. O proxy roda em toda rota, inclusive nas que o navegador
// pré-carrega, e uma consulta aqui viraria carga por link visitado. A barreira
// real é `exigirViagem` em lib/auth.ts, colada na fonte do dado.
//
// A política de conteúdo mora AQUI e não no next.config.ts porque ela carrega um
// nonce, e nonce que se repete não é nonce. Os cabeçalhos fixos (HSTS, nosniff,
// Referrer-Policy) estão no next.config.ts, que alcança também o /api/*.
import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE, lerToken } from '@/lib/session.ts'
import { rotasPrivadas, rotasPublicas } from '@/config/navigation.ts'
import { politicaCsp, precisaHttps } from '@/lib/seguranca.ts'

function temSessao(req: NextRequest): boolean {
  const token = req.cookies.get(COOKIE)?.value
  if (!token) return false
  try {
    return lerToken(token) !== null
  } catch {
    // SESSION_SECRET ausente: trata como deslogado em vez de derrubar toda rota.
    return false
  }
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const producao = process.env.NODE_ENV === 'production'

  // HTTPS antes de qualquer outra coisa. Redirecionar DEPOIS de decidir a
  // sessão só adiantaria o trabalho de uma resposta que vai ser jogada fora —
  // e, pior, mandaria um Set-Cookie por texto puro.
  const anfitriao = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (precisaHttps(req.headers.get('x-forwarded-proto'), producao, anfitriao)) {
    const url = req.nextUrl.clone()
    url.protocol = 'https:'
    // 308 e não 302: preserva o método e o corpo, então um POST que chegou em
    // http não vira GET no caminho. Permanente porque, com HSTS, é.
    return NextResponse.redirect(url, 308)
  }

  // Um nonce novo por requisição. O Next lê este mesmo cabeçalho da REQUISIÇÃO,
  // extrai o `'nonce-…'` e carimba sozinho os scripts que ele gera — por isso o
  // valor entra nos dois lados, requisição e resposta.
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const csp = politicaCsp(nonce, !producao)

  const cabecalhos = new Headers(req.headers)
  cabecalhos.set('x-nonce', nonce)
  cabecalhos.set('Content-Security-Policy', csp)

  const seguir = () => {
    const r = NextResponse.next({ request: { headers: cabecalhos } })
    r.headers.set('Content-Security-Policy', csp)
    return r
  }

  const comCsp = (r: NextResponse) => {
    r.headers.set('Content-Security-Policy', csp)
    return r
  }

  const privada = rotasPrivadas.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  const publica = rotasPublicas.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  // Rota fora das duas listas continua passando direto — mas com CSP. Antes ela
  // saía por um `return` adiantado, e era metade do app sem política nenhuma.
  if (!privada && !publica) return seguir()

  const logado = temSessao(req)

  if (privada && !logado) {
    const url = new URL('/login', req.url)
    // Guarda o destino para devolver a pessoa onde ela tentou entrar.
    if (pathname !== '/dashboard') url.searchParams.set('proximo', pathname)
    return comCsp(NextResponse.redirect(url))
  }

  if (publica && logado) {
    return comCsp(NextResponse.redirect(new URL('/dashboard', req.url)))
  }

  return seguir()
}

export const config = {
  // Fora: rotas de API (respondem 401 em JSON, nao redirecionam, e recebem os
  // cabecalhos fixos pelo next.config.ts) e os arquivos do build. Sem isto, o
  // redirecionamento engoliria CSS.
  //
  // A lista e de CAMINHOS, nunca de extensoes. Havia aqui um casamento por fim
  // de URL (`.svg|.png|.jpg|.webp`) para poupar o proxy nos icones do public/, e
  // ele dispensava QUALQUER rota cujo nome terminasse assim:
  // `/viagens/qualquer-coisa.png` saia sem checagem de sessao E sem CSP. Hoje
  // isso so alcanca 404 e casca de cliente, mas e uma dispensa que uma rota
  // futura herda por acidente de nome. O preco e o proxy rodar sobre os tres
  // PNGs do public/ -- que e ganho, porque agora eles tambem saem com politica.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sw.js).*)'],
}
