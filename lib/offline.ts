// Cache do snapshot e fila de escritas, em IndexedDB.
//
// Escrito à mão em vez de trazer dexie: são dois object stores e cinco operações.
//
// Regra de ouro deste arquivo: NADA lança para quem chama. Navegador em aba
// anônima, com site data bloqueado ou sem cota simplesmente não tem modo offline —
// o app continua funcionando online. Uma exceção aqui viraria tela branca.
const BANCO = 'viagem'
const VERSAO = 1
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
        if (!db.objectStoreNames.contains(SNAPSHOT)) db.createObjectStore(SNAPSHOT)
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

export function lerSnapshot<T = unknown>(): Promise<T | null> {
  return transacao<T | null>(SNAPSHOT, 'readonly', (s) => s.get('atual'), null)
}

export function gravarSnapshot(dados: unknown): Promise<unknown> {
  return transacao(SNAPSHOT, 'readwrite', (s) => s.put(dados, 'atual'), null)
}

export function limparSnapshot(): Promise<unknown> {
  return transacao(SNAPSHOT, 'readwrite', (s) => s.clear(), null)
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
