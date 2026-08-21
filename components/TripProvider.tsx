'use client'

// Fonte de estado da interface. Nenhuma aba fala com a rede: todas leem daqui.
//
// Fluxo: pinta pelo cache local na hora, revalida pela rede em segundo plano,
// aplica escrita otimista e enfileira. Offline e online percorrem exatamente o
// mesmo caminho de código — offline é só a fila demorando mais para esvaziar.
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  lerSnapshot,
  gravarSnapshot,
  limparSnapshot,
  enfileirar,
  lerFila,
  limparFila,
  tamanhoFila,
  offlineDisponivel,
  type Operacao,
} from '@/lib/offline.ts'

export type Snapshot = {
  viagem: Record<string, any> | null
  viajantes: Record<string, any>[]
  roteiro: Record<string, any>[]
  voos: Record<string, any>[]
  cruzeiros: Record<string, any>[]
  hospedagens: Record<string, any>[]
  lugares: Record<string, any>[]
  checklist: Record<string, any>[]
  checklist_state: Record<string, any>[]
  documentos: Record<string, any>[]
  emergencia: Record<string, any>[]
  alteracoes: Record<string, any>[]
  financeiro: { categorias: Record<string, any>[]; custos: Record<string, any>[] } | null
  server_time: string
  sessao: { travelerId: string; papel: 'admin' | 'viajante' }
}

type Contexto = {
  snapshot: Snapshot | null
  carregando: boolean
  online: boolean
  offlineOk: boolean
  pendentes: number
  ultimaSync: string | null
  erro: string | null
  souAdmin: boolean
  mutate: (op: Operacao) => Promise<void>
  recarregar: () => Promise<void>
  sair: () => Promise<void>
}

const Ctx = createContext<Contexto | null>(null)

export function useTrip() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useTrip precisa estar dentro de <TripProvider>')
  return c
}

export function TripProvider({ children, aoSair }: { children: ReactNode; aoSair: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [online, setOnline] = useState(true)
  const [offlineOk, setOfflineOk] = useState(true)
  const [pendentes, setPendentes] = useState(0)
  const [ultimaSync, setUltimaSync] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const enviando = useRef(false)

  const aplicarSnapshot = useCallback((s: Snapshot) => {
    setSnapshot(s)
    setUltimaSync(new Date().toISOString())
    void gravarSnapshot(s)
  }, [])

  /** Sobe a fila. Falha mantém tudo enfileirado para a próxima tentativa. */
  const drenar = useCallback(async () => {
    if (enviando.current) return
    const fila = await lerFila()
    if (fila.length === 0) return
    enviando.current = true
    try {
      const r = await fetch('/api/mutate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ops: fila }),
      })
      if (!r.ok) {
        // 401 e 403 não se resolvem tentando de novo: a fila fica parada e o
        // usuário vê o aviso, em vez de o app girar em loop silencioso.
        const corpo = await r.json().catch(() => ({}))
        setErro(corpo.erro ?? 'Não consegui enviar as alterações.')
        return
      }
      const dados = await r.json()
      await limparFila()
      setErro(null)
      aplicarSnapshot(dados.snapshot)
    } catch {
      // Sem rede: fila preservada de propósito.
    } finally {
      enviando.current = false
      setPendentes(await tamanhoFila())
    }
  }, [aplicarSnapshot])

  const recarregar = useCallback(async () => {
    try {
      const r = await fetch('/api/snapshot')
      if (r.status === 401) return aoSair()
      if (!r.ok) throw new Error()
      aplicarSnapshot(await r.json())
      setErro(null)
    } catch {
      // Offline: o cache já está na tela.
    } finally {
      setCarregando(false)
    }
  }, [aplicarSnapshot, aoSair])

  // Primeira pintura vem do cache; a rede só confirma depois.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      setOfflineOk(await offlineDisponivel())
      const cache = await lerSnapshot<Snapshot>()
      if (vivo && cache) {
        setSnapshot(cache)
        setCarregando(false)
      }
      setPendentes(await tamanhoFila())
      if (vivo) await recarregar()
      if (vivo) await drenar()
    })()
    return () => {
      vivo = false
    }
  }, [recarregar, drenar])

  useEffect(() => {
    setOnline(navigator.onLine)
    const voltou = () => {
      setOnline(true)
      void recarregar().then(drenar)
    }
    const caiu = () => setOnline(false)
    window.addEventListener('online', voltou)
    window.addEventListener('offline', caiu)
    return () => {
      window.removeEventListener('online', voltou)
      window.removeEventListener('offline', caiu)
    }
  }, [recarregar, drenar])

  /** Escrita otimista: a tela muda antes de a rede responder. */
  const mutate = useCallback(
    async (op: Operacao) => {
      setSnapshot((atual) => (atual ? aplicarLocal(atual, op) : atual))
      await enfileirar(op)
      setPendentes(await tamanhoFila())
      await drenar()
    },
    [drenar],
  )

  const sair = useCallback(async () => {
    await fetch('/api/sessao', { method: 'DELETE' }).catch(() => {})
    // Limpa o cache local: o próximo a entrar neste aparelho não pode ver o
    // Financeiro do anterior por sobra de cache.
    await limparSnapshot()
    aoSair()
  }, [aoSair])

  return (
    <Ctx.Provider
      value={{
        snapshot,
        carregando,
        online,
        offlineOk,
        pendentes,
        ultimaSync,
        erro,
        souAdmin: snapshot?.sessao.papel === 'admin',
        mutate,
        recarregar,
        sair,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

/** Espelha localmente o que o servidor fará, para a tela responder na hora. */
const LISTA: Record<string, keyof Snapshot> = {
  roteiro: 'roteiro',
  voo: 'voos',
  cruzeiro: 'cruzeiros',
  hospedagem: 'hospedagens',
  lugar: 'lugares',
  checklist_item: 'checklist',
  documento: 'documentos',
  emergencia: 'emergencia',
  viajante: 'viajantes',
}

function aplicarLocal(s: Snapshot, op: Operacao): Snapshot {
  const novo = { ...s }

  if (op.entidade === 'checklist_state') {
    const itemId = String(op.campos.item_id)
    const outros = s.checklist_state.filter(
      (e) => !(e.item_id === itemId && e.traveler_id === s.sessao.travelerId),
    )
    novo.checklist_state = [
      ...outros,
      { item_id: itemId, traveler_id: s.sessao.travelerId, feito: Boolean(op.campos.feito) },
    ]
    return novo
  }

  if (op.entidade === 'viagem') {
    novo.viagem = { ...s.viagem, ...op.campos }
    return novo
  }

  if (op.entidade === 'custo' || op.entidade === 'categoria') {
    if (!s.financeiro) return novo
    const chave = op.entidade === 'custo' ? 'custos' : 'categorias'
    const lista = s.financeiro[chave]
    novo.financeiro = {
      ...s.financeiro,
      [chave]:
        op.op === 'remover'
          ? lista.filter((x) => x.id !== op.id)
          : op.op === 'criar'
            ? [...lista, { id: op.id, ...op.campos }]
            : lista.map((x) => (x.id === op.id ? { ...x, ...op.campos } : x)),
    }
    return novo
  }

  const campo = LISTA[op.entidade]
  if (!campo) return novo
  const lista = s[campo] as Record<string, any>[]
  novo[campo] = (
    op.op === 'remover'
      ? lista.filter((x) => x.id !== op.id)
      : op.op === 'criar'
        ? [...lista, { id: op.id, ...op.campos }]
        : lista.map((x) => (x.id === op.id ? { ...x, ...op.campos } : x))
  ) as any
  return novo
}
