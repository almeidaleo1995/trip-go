// Casca comum das rotas: transforma exceção em resposta HTTP com corpo em pt-BR.
//
// Existe para não repetir o mesmo try/catch em seis rotas. ErroHttp vira o status
// que ele carrega; qualquer outra exceção vira 500 com mensagem genérica, porque
// detalhe de erro de banco não deve chegar ao navegador.
import { NextResponse } from 'next/server'
import { ErroHttp } from './session.ts'
import { mesmaOrigem } from './seguranca.ts'

export type Handler = (req: Request) => Promise<unknown>

/** Metodos que nao mudam nada. Tudo que nao esta aqui passa pela origem. */
const LEITURA = new Set(['GET', 'HEAD', 'OPTIONS'])

export function rota(handler: Handler) {
  return async (req: Request) => {
    try {
      // CSRF: o cookie e `SameSite=Lax`, o que ja impede um POST disparado de
      // outro site de carregar a sessao. Esta e a segunda tranca, e ela vale a
      // pena porque TODA escrita do app passa por aqui — uma linha cobre as dez
      // rotas de uma vez, e a regra fica escrita em vez de herdada do padrao do
      // navegador. `mesmaOrigem` deixa passar requisicao sem `Origin` de
      // proposito: navegador sempre manda o cabecalho em POST, entao a ausencia
      // e cliente que nao e navegador, e esse nao carrega cookie de vitima.
      if (!LEITURA.has(req.method) && !mesmaOrigem(req)) {
        throw new ErroHttp(403, 'Pedido recusado: origem não confere.')
      }

      const dados = await handler(req)
      return dados instanceof NextResponse ? dados : NextResponse.json(dados)
    } catch (e) {
      if (e instanceof ErroHttp) {
        return NextResponse.json({ erro: e.message }, { status: e.status })
      }
      console.error('[api]', e)
      return NextResponse.json({ erro: 'Algo deu errado. Tente de novo.' }, { status: 500 })
    }
  }
}

/** Corpo JSON com limite de tamanho. 2 MB cobre a maior viagem plausível. */
export async function lerJson(req: Request, limiteBytes = 2 * 1024 * 1024): Promise<unknown> {
  const bruto = await req.text()
  if (bruto.length > limiteBytes) {
    throw new ErroHttp(
      413,
      `Arquivo grande demais (máximo ${Math.round(limiteBytes / 1024 / 1024)} MB).`,
    )
  }
  try {
    return JSON.parse(bruto)
  } catch {
    throw new ErroHttp(400, 'Isso não é um JSON válido.')
  }
}

/** Chave do rate limit. Sem header de proxy confiável, cai para um balde único. */
export function chaveOrigem(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'desconhecido'
  )
}
