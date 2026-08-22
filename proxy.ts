// Redirecionamento de rota por sessao. No Next 16 este arquivo se chama `proxy`
// (era `middleware` ate a 15) e roda no runtime Node por padrao.
//
// Checagem OTIMISTA, de proposito: so confere a assinatura do cookie, nunca vai
// ao banco. O proxy roda em toda rota, inclusive nas que o navegador pre-carrega,
// e uma consulta aqui viraria carga por link visitado. A barreira real e
// `exigirViagem` em lib/auth.ts, colada na fonte do dado.
import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE, lerToken } from '@/lib/session.ts'
import { rotasPrivadas, rotasPublicas } from '@/config/navigation.ts'

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
  const privada = rotasPrivadas.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  const publica = rotasPublicas.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  if (!privada && !publica) return NextResponse.next()

  const logado = temSessao(req)

  if (privada && !logado) {
    const url = new URL('/login', req.url)
    // Guarda o destino para devolver a pessoa onde ela tentou entrar.
    if (pathname !== '/dashboard') url.searchParams.set('proximo', pathname)
    return NextResponse.redirect(url)
  }

  if (publica && logado) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
}

export const config = {
  // Fora: rotas de API (respondem 401 em JSON, nao redirecionam), arquivos do
  // build e assets da pasta public. Sem isto, o redirecionamento engoliria CSS.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:svg|png|jpg|webp)$).*)'],
}
