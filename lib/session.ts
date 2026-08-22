// Autenticacao: hash de senha, token de sessao assinado e limitador de tentativas.
//
// Zero dependencias: `node:crypto` faz scrypt e HMAC melhor do que bcryptjs faria,
// e um cookie assinado de 2 campos nao justifica trazer jose ou next-auth.
//
// O token carrega APENAS o id da conta. Papel nao cabe aqui: a mesma pessoa e
// proprietaria de uma viagem e visualizadora de outra, entao papel e propriedade
// do par (usuario, viagem) e e resolvido por consulta em lib/auth.ts. Guardar
// papel no cookie deixaria uma promocao ou remocao valendo por 90 dias.
//
// Este modulo NAO importa `next/headers` no topo de proposito - assim ele roda no
// runner de teste do Node sem contexto de request. As funcoes que mexem em cookie
// fazem import dinamico.
import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHmac } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  senha: string | Buffer,
  sal: string | Buffer,
  tamanho: number,
) => Promise<Buffer>

export type Sessao = { userId: string; expiraEm: number }

export const COOKIE = 'tripgo_sessao'
/** Cookie que lembra qual viagem estava aberta. Nao e credencial: so preferencia. */
export const COOKIE_VIAGEM = 'tripgo_viagem'

const DIAS_90 = 90 * 24 * 60 * 60

// Parametros do scrypt. N=16384 e o padrao recomendado para uso interativo:
// caro o bastante para forca bruta, rapido o bastante para um login nao travar.
const N = 16_384
const TAMANHO_CHAVE = 64

/** Piso da senha. Trocar aqui muda o cadastro e a validacao junto (lib/schema.ts). */
export const SENHA_MINIMA = 6

// ---------------------------------------------------------------- senha

/** Gera `scrypt$N$salt$hash`. Salt aleatorio por senha: dois hashes da mesma senha diferem. */
export async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16)
  const chave = await scrypt(String(senha), sal, TAMANHO_CHAVE)
  return `scrypt$${N}$${sal.toString('hex')}$${chave.toString('hex')}`
}

/**
 * Compara em tempo constante. Devolve false para qualquer entrada malformada em vez
 * de lancar - um hash corrompido no banco nao deve virar 500 na tela de login.
 */
export async function verifySenha(
  senha: string,
  guardado: string | null | undefined,
): Promise<boolean> {
  if (!guardado || typeof guardado !== 'string') return false
  const partes = guardado.split('$')
  if (partes.length !== 4 || partes[0] !== 'scrypt') return false

  const [, , salHex, hashHex] = partes
  let esperado: Buffer
  try {
    esperado = Buffer.from(hashHex, 'hex')
    if (esperado.length !== TAMANHO_CHAVE) return false
    const calculado = await scrypt(String(senha), Buffer.from(salHex, 'hex'), TAMANHO_CHAVE)
    return timingSafeEqual(calculado, esperado)
  } catch {
    return false
  }
}

/** Normaliza e-mail para comparacao e gravacao. O unique do banco conta com isto. */
export function normalizarEmail(email: string): string {
  return String(email ?? '')
    .trim()
    .toLowerCase()
}

// ---------------------------------------------------------------- token de sessao

function segredo(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET nao definida - veja .env.example')
  return s
}

function assinar(corpo: string): string {
  return createHmac('sha256', segredo()).update(corpo).digest('base64url')
}

/** `userId.expiraEm.assinatura` — assinado, nao criptografado. */
export function criarToken(userId: string, agora = Date.now()): string {
  const expiraEm = Math.floor(agora / 1000) + DIAS_90
  const corpo = `${userId}.${expiraEm}`
  return `${corpo}.${assinar(corpo)}`
}

/**
 * Devolve a sessao, ou null se o token foi adulterado, expirou ou esta malformado.
 * A comparacao da assinatura e em tempo constante.
 */
export function lerToken(token: string | null | undefined, agora = Date.now()): Sessao | null {
  if (!token || typeof token !== 'string') return null
  const partes = token.split('.')
  if (partes.length !== 3) return null

  const [userId, expStr, assinatura] = partes
  if (!userId) return null

  const esperada = assinar(`${userId}.${expStr}`)
  const a = Buffer.from(assinatura)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const expiraEm = Number(expStr)
  if (!Number.isFinite(expiraEm) || expiraEm * 1000 <= agora) return null

  return { userId, expiraEm }
}

// ---------------------------------------------------------------- rate limit

type Janela = { tentativas: number[]; bloqueadoAte: number }
const janelas = new Map<string, Janela>()

export const LIMITE = 10
export const JANELA_MS = 5 * 60 * 1000
export const BLOQUEIO_MS = 15 * 60 * 1000

/**
 * Registra uma tentativa falha e diz se a chave esta bloqueada.
 * Devolve `{ bloqueado, restamMs }`.
 *
 * ponytail: contador em memoria do processo. Em serverless cada instancia tem o
 * seu, entao um atacante distribuido consegue mais que 10 tentativas por janela -
 * mitigacao parcial, assumida e documentada no README. Se virar preocupacao real,
 * mover o contador para uma tabela no Neon e uma troca local.
 */
export function registrarFalha(
  chave: string,
  agora = Date.now(),
): { bloqueado: boolean; restamMs: number } {
  const j = janelas.get(chave) ?? { tentativas: [], bloqueadoAte: 0 }

  if (j.bloqueadoAte > agora) {
    janelas.set(chave, j)
    return { bloqueado: true, restamMs: j.bloqueadoAte - agora }
  }

  j.tentativas = j.tentativas.filter((t) => agora - t < JANELA_MS)
  j.tentativas.push(agora)

  if (j.tentativas.length > LIMITE) {
    j.bloqueadoAte = agora + BLOQUEIO_MS
    j.tentativas = []
    janelas.set(chave, j)
    return { bloqueado: true, restamMs: BLOQUEIO_MS }
  }

  janelas.set(chave, j)
  return { bloqueado: false, restamMs: 0 }
}

/** Consulta sem registrar tentativa. Usado antes de gastar CPU com scrypt. */
export function estaBloqueado(chave: string, agora = Date.now()): boolean {
  return (janelas.get(chave)?.bloqueadoAte ?? 0) > agora
}

/** Zera a janela apos login bem-sucedido. */
export function limparFalhas(chave: string): void {
  janelas.delete(chave)
}

/** Apenas para teste: esvazia o estado global entre casos. */
export function _resetRateLimit(): void {
  janelas.clear()
}

// ---------------------------------------------------------------- cookies

export class ErroHttp extends Error {
  // Campo explicito, nao parameter property: o type stripping do Node so aceita
  // sintaxe apagavel, e `constructor(readonly status: number)` gera codigo.
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const OPCOES_COOKIE = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: DIAS_90,
} as const

export async function gravarCookie(token: string): Promise<void> {
  const { cookies } = await import('next/headers')
  const jar = await cookies()
  jar.set(COOKIE, token, OPCOES_COOKIE)
}

export async function limparCookie(): Promise<void> {
  const { cookies } = await import('next/headers')
  const jar = await cookies()
  jar.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  jar.set(COOKIE_VIAGEM, '', { httpOnly: true, path: '/', maxAge: 0 })
}

/** Lembra a viagem aberta para que servidor e cliente concordem na proxima visita. */
export async function gravarViagemAtual(tripId: string): Promise<void> {
  const { cookies } = await import('next/headers')
  const jar = await cookies()
  jar.set(COOKIE_VIAGEM, tripId, OPCOES_COOKIE)
}

export async function lerViagemAtual(): Promise<string | null> {
  const { cookies } = await import('next/headers')
  const jar = await cookies()
  return jar.get(COOKIE_VIAGEM)?.value ?? null
}

export async function lerSessao(): Promise<Sessao | null> {
  const { cookies } = await import('next/headers')
  const jar = await cookies()
  return lerToken(jar.get(COOKIE)?.value)
}
