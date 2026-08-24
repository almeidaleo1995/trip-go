// Cache do snapshot e fila de escritas, em IndexedDB.
//
// Escrito à mão em vez de trazer dexie: são dois object stores e cinco operações.
//
// Regra de ouro deste arquivo: NADA lança para quem chama. Navegador em aba
// anônima, com site data bloqueado ou sem cota simplesmente não tem modo offline —
// o app continua funcionando online. Uma exceção aqui viraria tela branca.
const BANCO = 'viagem'
// Suba a VERSAO sempre que o FORMATO do snapshot mudar.
//
// O cache guarda a resposta de /api/snapshot inteira. Quando o formato muda, o
// que está guardado é de uma versão anterior do app, e a tela pinta a partir
// dele ANTES de a rede responder — ou seja, o código novo lê o objeto antigo e
// quebra na primeira propriedade que não existe mais. Subir a versão descarta o
// cache no upgrade, e a primeira pintura passa a esperar a rede uma vez só.
//
//   1 -> 2  financeiro deixou de ser { categorias, custos } e virou dois
//           formatos por papel ({ admin: true, ... } / { admin: false, ... })
//   2 -> 3  o roteiro virou dia a dia: o snapshot ganhou `dias`, e cada evento
//           ganhou `opcoes` e uma dúzia de campos (fim_em, dicas, links...)
const VERSAO = 3
const SNAPSHOT = 'snapshot'
const FILA = 'fila'

export type Operacao = {
  op: 'criar' | 'editar' | 'remover'
  entidade: string
  id?: string | null
  campos: Record<string, unknown>
  client_ts: string
}

let promessa: Promise<IDBDatabase | null> | null = null

function abrir(): Promise<IDBDatabase | null> {
  if (promessa) return promessa
  promessa = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(BANCO, VERSAO)
      req.onupgradeneeded = () => {
        const db = req.result
        // Cache de uma versão anterior é jogado fora, não migrado: ele é
        // regenerável por uma requisição, e migrar formato de dado em
        // IndexedDB é código que só roda uma vez na vida de cada aparelho —
        // exatamente o código que ninguém testa.
        if (db.objectStoreNames.contains(SNAPSHOT)) db.deleteObjectStore(SNAPSHOT)
        db.createObjectStore(SNAPSHOT)
        // A fila SOBREVIVE: são escritas que a pessoa fez e ainda não subiram.
        // Apagá-la perderia trabalho de verdade.
        if (!db.objectStoreNames.contains(FILA)) db.createObjectStore(FILA, { autoIncrement: true })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return promessa
}

/** true quando o modo offline está disponível neste navegador. */
export async function offlineDisponivel(): Promise<boolean> {
  return (await abrir()) !== null
}

function transacao<T>(
  store: string,
  modo: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
  padrao: T,
): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((resolve) => {
        if (!db) return resolve(padrao)
        try {
          const t = db.transaction(store, modo)
          const req = fn(t.objectStore(store))
          req.onsuccess = () => resolve((req.result as T) ?? padrao)
          req.onerror = () => resolve(padrao)
          t.onerror = () => resolve(padrao)
          t.onabort = () => resolve(padrao)
        } catch {
          resolve(padrao)
        }
      }),
  )
}

// Chave = tripId: cada viagem guarda seu proprio cache, para trocar de viagem
// offline nao mostrar o snapshot (e o financeiro) de outra por sobra de cache.
export function lerSnapshot<T = unknown>(chave: string): Promise<T | null> {
  return transacao<T | null>(SNAPSHOT, 'readonly', (s) => s.get(chave), null)
}

export function gravarSnapshot(chave: string, dados: unknown): Promise<unknown> {
  return transacao(SNAPSHOT, 'readwrite', (s) => s.put(dados, chave), null)
}

export function limparSnapshot(chave: string): Promise<unknown> {
  return transacao(SNAPSHOT, 'readwrite', (s) => s.delete(chave), null)
}

export function enfileirar(op: Operacao): Promise<unknown> {
  return transacao(FILA, 'readwrite', (s) => s.add(op), null)
}

export function lerFila(): Promise<Operacao[]> {
  return transacao<Operacao[]>(FILA, 'readonly', (s) => s.getAll(), [])
}

export function tamanhoFila(): Promise<number> {
  return transacao<number>(FILA, 'readonly', (s) => s.count(), 0)
}

export function limparFila(): Promise<unknown> {
  return transacao(FILA, 'readwrite', (s) => s.clear(), null)
}
