// Casca comum das rotas: transforma exceção em resposta HTTP com corpo em pt-BR,
// e recusa escrita que não veio de uma página nossa.
//
// Existe para não repetir o mesmo try/catch em seis rotas. ErroHttp vira o status
// que ele carrega; qualquer outra exceção vira 500 com mensagem genérica, porque
// detalhe de erro de banco não deve chegar ao navegador.
import { NextResponse } from 'next/server'
import { ErroHttp, type Limites } from './session.ts'
import { mesmaOrigem, mudaEstado, paraLog } from './seguranca.ts'
import { registrarTentativa, consultarBloqueio } from './db.ts'

export type Handler = (req: Request) => Promise<unknown>

/**
 * Casca de rota: erro vira HTTP, e escrita de fora vira 403.
 *
 * A checagem de origem entra AQUI, e não em cada handler, porque é o único lugar
 * que não dá para esquecer: rota nova nasce protegida. Uma lista de rotas a
 * proteger seria uma lista que alguém não atualiza.
 *
 * Sem escotilha de saída de propósito. Um parâmetro `{ aberta: true }` que
 * ninguém usa hoje é o parâmetro que alguém usa amanhã para fazer um teste
 * passar — e é exatamente a rota que menos deveria abrir.
 */
export function rota(handler: Handler) {
  return async (req: Request) => {
    try {
      exigirMesmaOrigem(req)
      const dados = await handler(req)
      return dados instanceof NextResponse ? dados : NextResponse.json(dados)
    } catch (e) {
      if (e instanceof ErroHttp) {
        return NextResponse.json({ erro: e.message }, { status: e.status })
      }
      // `paraLog` e nao `e`: o erro do driver carrega `detail` ("Key (email)=(...)")
      // e `internalQuery`, e console.error imprime as proprias enumeraveis junto
      // com o stack -- e-mail e codigo de convite iam para o log em texto.
      console.error('[api]', paraLog(e))
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

/**
 * A requisição que MUDA algo veio de uma página nossa?
 *
 * O cookie é `SameSite=Lax`, o que já barra o POST vindo de outro site — mas
 * quem aplica isso é o navegador, e o servidor não tem como saber se aplicou.
 * Esta é a mesma regra conferida do lado que a gente controla, exatamente como
 * `papelAlcanca` é reconferido no servidor mesmo com `posso()` na tela.
 *
 * GET fica de fora: ele não grava. O GET do /api/documento é protegido pelo que
 * importa ali, que é `documentoVisivel`, não pela origem.
 *
 * 403 com texto em pt-BR, e não 400: quem cair aqui de boa-fé está com alguma
 * extensão reescrevendo cabeçalho, e "recusado" é a informação útil.
 */
export function exigirMesmaOrigem(req: Request): void {
  if (!mudaEstado(req.method)) return

  const ok = mesmaOrigem({
    origin: req.headers.get('origin'),
    host: req.headers.get('host'),
    forwardedHost: req.headers.get('x-forwarded-host'),
    secFetchSite: req.headers.get('sec-fetch-site'),
  })
  if (!ok) throw new ErroHttp(403, 'Requisição recusada: ela não veio desta aplicação.')
}

/**
 * Limite de chamadas para uma rota que não é login nem cadastro.
 *
 * A chave é por CONTA quando há sessão, e não por IP: cinco pessoas no wi-fi do
 * hotel dividiriam um balde só, e a primeira a sincronizar bloquearia as outras
 * quatro.
 *
 * Como no cadastro, TODA chamada conta — não existe "tentativa certa" a perdoar
 * numa rota de escrita, porque o que se está barrando é o volume, não o erro.
 *
 * `async` porque o contador vive no BANCO, não na memória do processo: em
 * serverless cada instância tinha o seu, e o limite valia N vezes. Ver
 * `registrarTentativa` em lib/db.ts.
 */
export async function limitar(chave: string, limites: Limites, mensagem: string): Promise<void> {
  if (await consultarBloqueio(chave)) throw new ErroHttp(429, mensagem)
  if ((await registrarTentativa(chave, limites)).bloqueado) throw new ErroHttp(429, mensagem)
}

/** Chave do rate limit. Sem header de proxy confiável, cai para um balde único. */
export function chaveOrigem(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'desconhecido'
  )
}
