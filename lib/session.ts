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

export type Limites = { limite: number; janelaMs: number; bloqueioMs: number }

/** Limites do login: contam TENTATIVAS ERRADAS, e o acerto zera a janela. */
export const LIMITES_LOGIN: Limites = {
  limite: LIMITE,
  janelaMs: JANELA_MS,
  bloqueioMs: BLOQUEIO_MS,
}

/**
 * Limites do cadastro. Mais apertados, e por um motivo diferente: no login o que
 * se barra e quem CHUTA senha, entao so a falha conta e o acerto limpa. No
 * cadastro o abuso e a conta criada COM SUCESSO — mil contas de um IP so. Por
 * isso a rota conta toda tentativa, certa ou errada, e nunca chama
 * `limparFalhas`. Cinco por hora nao atrapalha uma familia inteira se cadastrando
 * na mesma rede, e corta a criacao em massa.
 */
export const LIMITES_CADASTRO: Limites = {
  limite: 5,
  janelaMs: 60 * 60 * 1000,
  bloqueioMs: 60 * 60 * 1000,
}

/**
 * Limites da SINCRONIZAÇÃO: /api/mutate, /api/viagens, /api/perfil.
 *
 * Um quarto motivo. Aqui não se barra chute de senha, nem conta em massa, nem
 * gasto: barra-se o script que descobriu um endpoint autenticado e resolveu
 * varrer a viagem inteira com ele. O teto é folgado de propósito — quem volta de
 * um dia offline sobe a fila acumulada de uma vez, e um limite apertado
 * transformaria "voltei a ter sinal" em "o app recusou minhas anotações".
 *
 * Por CONTA e não por IP: cinco pessoas no mesmo wi-fi de hotel não podem
 * dividir um balde só — a primeira a sincronizar bloquearia as outras quatro.
 */
export const LIMITES_ESCRITA: Limites = {
  limite: 240,
  janelaMs: 5 * 60 * 1000,
  bloqueioMs: 5 * 60 * 1000,
}

/**
 * Limites do UPLOAD de arquivo do cofre.
 *
 * Mais baixo que o da escrita e medido em REQUISIÇÕES, não em arquivos: um PDF de
 * 25 MB sobe em 7 partes, então 120 por hora são ~17 documentos grandes — mais do
 * que qualquer viagem precisa numa sentada, e longe do que serve para usar o
 * cofre como hospedagem de arquivo alheio.
 */
export const LIMITES_UPLOAD: Limites = {
  limite: 120,
  janelaMs: 60 * 60 * 1000,
  bloqueioMs: 15 * 60 * 1000,
}

/**
 * Limites da IMPORTAÇÃO. Bem mais apertados que os da escrita, e balde próprio,
 * porque o custo é de outra ordem: cada chamada CRIA uma viagem inteira, com
 * centenas de linhas em dezenas de tabelas, e nada obriga a pessoa a apagar
 * depois. Deixá-la no balde da sincronização daria 240 viagens em cinco minutos.
 */
export const LIMITES_IMPORTACAO: Limites = {
  limite: 10,
  janelaMs: 60 * 60 * 1000,
  bloqueioMs: 30 * 60 * 1000,
}

/**
 * Registra uma tentativa contra `chave` e diz se ela passou do limite.
 * Devolve `{ bloqueado, restamMs }`.
 *
 * O que conta como "tentativa" e de quem chama: o login registra so o que falha,
 * o cadastro registra tudo. A janela e por chave, entao namespaces diferentes
 * (`cadastro:1.2.3.4`) nao disputam o mesmo contador.
 *
 * ESTE contador vive na memoria do processo, e hoje ele e o PLANO B. O contador
 * de verdade e `registrar_tentativa` no Postgres, chamado por `registrarTentativa`
 * em lib/db.ts: em serverless cada instancia tinha o seu balde, e dez instancias
 * valiam dez vezes o limite. A versao em memoria continua aqui porque falha de
 * rede no banco nao pode derrubar o login — degradar para "limite por instancia"
 * e melhor do que trancar a viagem para fora ou do que ficar sem limite nenhum.
 */
export function registrarFalha(
  chave: string,
  agora = Date.now(),
  limites: Limites = LIMITES_LOGIN,
): { bloqueado: boolean; restamMs: number } {
  const j = janelas.get(chave) ?? { tentativas: [], bloqueadoAte: 0 }

  if (j.bloqueadoAte > agora) {
    janelas.set(chave, j)
    return { bloqueado: true, restamMs: j.bloqueadoAte - agora }
  }

  j.tentativas = j.tentativas.filter((t) => agora - t < limites.janelaMs)
  j.tentativas.push(agora)

  if (j.tentativas.length > limites.limite) {
    j.bloqueadoAte = agora + limites.bloqueioMs
    j.tentativas = []
    janelas.set(chave, j)
    return { bloqueado: true, restamMs: limites.bloqueioMs }
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
