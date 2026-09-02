// Criptografia de campo, para o punhado de colunas cujo conteúdo é a identidade
// de alguém: CPF, RG e número de passaporte.
//
// POR QUE SÓ ESSAS TRÊS. Cifrar a tabela inteira seria mais fácil de explicar e
// pior de usar: uma coluna cifrada não é comparável, não é ordenável e não entra
// num índice. O nome do hotel não precisa disso; o número do passaporte precisa.
// A régua usada foi: se um dump do banco vazasse, este campo sozinho serve para
// se passar por alguém? Se sim, cifra.
//
// O QUE ISTO PROTEGE, E O QUE NÃO. Protege o dado EM REPOUSO — backup, dump,
// réplica, print de um cliente de SQL, olho de quem administra o banco. NÃO
// protege contra quem tem a aplicação: o servidor tem a chave, então quem executa
// código no servidor lê tudo. Isso é inerente a uma aplicação que precisa mostrar
// o número de volta para o dono, e trocar por criptografia de ponta a ponta
// custaria a única coisa que o app promete — abrir offline, em qualquer aparelho
// do grupo, sem digitar mais uma senha.
//
// AES-256-GCM, do `node:crypto`: autenticado, então adulterar o texto cifrado dá
// erro de verificação em vez de devolver lixo silenciosamente. Zero dependência
// nova, como o resto do projeto.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/** Marca do formato. Um dia que a chave mudar de esquema, muda aqui e o `decifrar`
    continua lendo o v1 enquanto reescreve em v2. */
const PREFIXO = 'enc.v1.'

const IV_BYTES = 12 // recomendação do GCM: 96 bits
const TAG_BYTES = 16

let chaveCache: Buffer | null | undefined

/**
 * A chave, derivada de `DADOS_SECRET`.
 *
 * Variável PRÓPRIA, separada da `SESSION_SECRET`, e a razão é operacional: girar
 * a chave de sessão é rotina barata (todo mundo faz login de novo). Girar esta
 * torna ilegível o que já está gravado. Compartilhar as duas transformaria a
 * operação barata na cara.
 *
 * `undefined` = ainda não olhei. `null` = não existe, e o app grava em texto puro.
 */
function chave(): Buffer | null {
  if (chaveCache !== undefined) return chaveCache

  const bruto = process.env.DADOS_SECRET?.trim()
  if (!bruto) {
    // Ausente é um MODO SUPORTADO, não um erro: a instalação que já existe não
    // pode parar de abrir o perfil porque uma variável nova não foi definida, e
    // um deploy que quebra a tela é um deploy que volta atrás — levando a
    // criptografia junto. O aviso sai uma vez, no log do servidor.
    console.warn(
      '[cripto] DADOS_SECRET ausente: CPF, RG e passaporte ficam em texto puro no banco. ' +
        'Veja .env.example.',
    )
    chaveCache = null
    return null
  }

  // 64 dígitos hex é o formato que o .env.example manda gerar — nesse caso os
  // bytes são a chave, sem derivação. Qualquer outra coisa (uma frase) passa pelo
  // scrypt para virar 32 bytes, em vez de ser recusada: recusar empurraria quem
  // está com pressa para não definir a variável.
  chaveCache = /^[0-9a-fA-F]{64}$/.test(bruto)
    ? Buffer.from(bruto, 'hex')
    : scryptSync(bruto, 'tripgo.dados.v1', 32)
  return chaveCache
}

/** Só para teste: esquece a chave lida, para o caso trocar a variável. */
export function _resetChave(): void {
  chaveCache = undefined
}

/** O valor já está cifrado por nós? */
export function estaCifrado(valor: unknown): boolean {
  return typeof valor === 'string' && valor.startsWith(PREFIXO)
}

/**
 * Texto puro → `enc.v1.<iv>.<tag>.<texto cifrado>`, tudo em base64url.
 *
 * Nulo e vazio passam direto: cifrar "não informado" gastaria 60 bytes para
 * esconder que não há nada a esconder, e ainda faria `cheio(cpf)` — que é como
 * lib/db.ts sabe quais campos do perfil estão preenchidos — dizer que sim.
 *
 * Sem chave definida, devolve o texto puro. É o modo degradado descrito acima.
 */
export function cifrar(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null
  const texto = String(valor)
  if (texto === '') return null
  if (estaCifrado(texto)) return texto

  const k = chave()
  if (!k) return texto

  const iv = randomBytes(IV_BYTES)
  const cifra = createCipheriv('aes-256-gcm', k, iv)
  const corpo = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()])
  const tag = cifra.getAuthTag()

  return PREFIXO + [iv, tag, corpo].map((b) => b.toString('base64url')).join('.')
}

/**
 * O caminho de volta. Aceita as duas formas de propósito.
 *
 * Uma linha gravada ANTES de a chave existir está em texto puro e continua
 * legível — sem isto, ligar a criptografia apagaria da tela o CPF de todo mundo
 * que já tinha cadastrado. A linha volta cifrada na próxima vez que a pessoa
 * salvar o perfil.
 *
 * Texto cifrado que não abre devolve `null`, não exceção: é chave trocada ou
 * linha corrompida, e derrubar a tela de perfil inteira com 500 esconderia o
 * resto dos dados da pessoa em vez de mostrar um campo em branco que ela
 * consegue preencher de novo. O erro fica no log do servidor.
 */
export function decifrar(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null
  const texto = String(valor)
  if (texto === '') return null
  if (!estaCifrado(texto)) return texto

  const partes = texto.slice(PREFIXO.length).split('.')
  if (partes.length !== 3) return null

  const k = chave()
  if (!k) {
    console.error('[cripto] valor cifrado no banco e DADOS_SECRET ausente.')
    return null
  }

  try {
    const [iv, tag, corpo] = partes.map((p) => Buffer.from(p, 'base64url'))
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null

    const decifra = createDecipheriv('aes-256-gcm', k, iv)
    decifra.setAuthTag(tag)
    return Buffer.concat([decifra.update(corpo), decifra.final()]).toString('utf8')
  } catch {
    console.error('[cripto] nao foi possivel decifrar um campo do perfil.')
    return null
  }
}

/**
 * As colunas de `users` que viajam cifradas.
 *
 * Lista explícita, e não uma convenção de nome, porque quem adiciona um campo
 * novo de documento precisa VER esta lista para saber que ela existe — do mesmo
 * jeito que `PROIBIDOS` em lib/assistente.ts. Um campo esquecido aqui não quebra
 * nada; só fica em texto puro, que é exatamente a falha que ninguém percebe.
 *
 * Datas ficam de fora: `nascimento` e `passaporte_validade` são colunas `date`, e
 * texto cifrado não entra numa delas. Elas também são o dado menos identificador
 * do conjunto — uma validade sozinha não abre conta em lugar nenhum.
 */
export const CAMPOS_CIFRADOS = ['cpf', 'rg', 'passaporte_numero'] as const

export function cifrarPerfil<T extends Record<string, unknown>>(d: T): T {
  const saida: Record<string, unknown> = { ...d }
  for (const c of CAMPOS_CIFRADOS) {
    if (c in saida) saida[c] = cifrar(saida[c] as string | null)
  }
  return saida as T
}

export function decifrarPerfil<T extends Record<string, unknown> | null>(d: T): T {
  if (!d) return d
  const saida: Record<string, unknown> = { ...d }
  for (const c of CAMPOS_CIFRADOS) {
    if (c in saida) saida[c] = decifrar(saida[c] as string | null)
  }
  return saida as T
}
