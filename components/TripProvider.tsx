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
import { papelAlcanca, type Papel } from '@/config/navigation.ts'
import { resolverDivisao, gerarParcelas, type Obrigacao } from '@/lib/financeiro.ts'

/** Financeiro de quem administra: as listas cruas, para a tela fazer as contas. */
export type FinanceiroAdmin = {
  admin: true
  categorias: Record<string, any>[]
  despesas: Record<string, any>[]
  divisoes: Record<string, any>[]
  parcelas: Record<string, any>[]
  pagamentos: Record<string, any>[]
}

/** Financeiro de um viajante comum: só as obrigações dele, já resolvidas. */
export type FinanceiroPessoal = {
  admin: false
  obrigacoes: Obrigacao[]
  historico: Record<string, any>[]
  devendo: number
  pago: number
  do_mes: number
  atrasadas: number
}

export type Snapshot = {
  viagem: Record<string, any> | null
  participantes: Record<string, any>[]
  roteiro: Record<string, any>[]
  dias: Record<string, any>[]
  voos: Record<string, any>[]
  cruzeiros: Record<string, any>[]
  reservas: Record<string, any>[]
  lugares: Record<string, any>[]
  checklist: Record<string, any>[]
  checklist_state: Record<string, any>[]
  documentos: Record<string, any>[]
  emergencia: Record<string, any>[]
  mensagens: Record<string, any>[]
  alteracoes: Record<string, any>[]
  financeiro: FinanceiroAdmin | FinanceiroPessoal
  server_time: string
  eu: { userId: string; usuario: Record<string, any>; participanteId: string; papel: Papel }
}

type Contexto = {
  snapshot: Snapshot | null
  carregando: boolean
  online: boolean
  offlineOk: boolean
  pendentes: number
  ultimaSync: string | null
  erro: string | null
  papel: Papel | null
  posso: (minimo: Papel) => boolean
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

export function TripProvider({
  tripId,
  children,
  aoSair,
}: {
  tripId: string
  children: ReactNode
  aoSair: () => void
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [online, setOnline] = useState(true)
  const [offlineOk, setOfflineOk] = useState(true)
  const [pendentes, setPendentes] = useState(0)
  const [ultimaSync, setUltimaSync] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const enviando = useRef(false)

  const aplicarSnapshot = useCallback(
    (s: Snapshot) => {
      setSnapshot(normalizar(s))
      setUltimaSync(new Date().toISOString())
      void gravarSnapshot(tripId, s)
    },
    [tripId],
  )

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
        body: JSON.stringify({ trip_id: tripId, ops: fila }),
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
  }, [aplicarSnapshot, tripId])

  const recarregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/snapshot?trip=${encodeURIComponent(tripId)}`)
      if (r.status === 401) return aoSair()
      if (!r.ok) throw new Error()
      aplicarSnapshot(await r.json())
      setErro(null)
    } catch {
      // Offline: o cache já está na tela.
    } finally {
      setCarregando(false)
    }
  }, [aplicarSnapshot, aoSair, tripId])

  // Primeira pintura vem do cache; a rede só confirma depois. Cache trocado
  // sempre que a viagem aberta muda — cada viagem tem o seu, nunca mistura.
  useEffect(() => {
    let vivo = true
    setSnapshot(null)
    setCarregando(true)
    ;(async () => {
      setOfflineOk(await offlineDisponivel())
      const cache = await lerSnapshot<Snapshot>(tripId)
      if (vivo && cache) {
        setSnapshot(normalizar(cache))
        setCarregando(false)
      }
      setPendentes(await tamanhoFila())
      if (vivo) await recarregar()
      if (vivo) await drenar()
    })()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId])

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
    await limparSnapshot(tripId)
    aoSair()
  }, [aoSair, tripId])

  const papel = snapshot?.eu.papel ?? null

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
        papel,
        posso: (minimo) => papelAlcanca(papel, minimo),
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
  dia: 'dias',
  voo: 'voos',
  cruzeiro: 'cruzeiros',
  reserva: 'reservas',
  lugar: 'lugares',
  checklist_item: 'checklist',
  documento: 'documentos',
  emergencia: 'emergencia',
  participante: 'participantes',
}

/** Financeiro vazio de viajante comum. É o que a tela mostra quando não há dado. */
const FINANCEIRO_VAZIO: FinanceiroPessoal = {
  admin: false,
  obrigacoes: [],
  historico: [],
  devendo: 0,
  pago: 0,
  do_mes: 0,
  atrasadas: 0,
}

/**
 * Garante que o snapshot tem o formato que as telas esperam.
 *
 * Existe por causa de UMA situação real: o cache offline pode conter a resposta
 * gravada por uma versão anterior do app, e a primeira pintura sai dele, antes
 * de a rede responder. `lib/offline.ts` descarta o cache quando a versão sobe,
 * mas isso protege só as mudanças que alguém lembrou de versionar — aqui a tela
 * fica de pé mesmo diante de um objeto que não reconhece, em vez de quebrar
 * inteira por causa de uma propriedade que sumiu.
 */
function normalizar(s: Snapshot): Snapshot {
  const f = s?.financeiro as unknown as { admin?: boolean } | null | undefined
  if (f && typeof f.admin === 'boolean') return s
  return { ...s, financeiro: FINANCEIRO_VAZIO }
}

/**
 * Espelha uma escrita financeira no snapshot local.
 *
 * A despesa é o único caso em que a tela precisa refazer a conta do servidor:
 * criar uma despesa em modo avião tem que mostrar a divisão e as parcelas na
 * hora, não depois do sync. Usa as MESMAS funções puras que o servidor
 * (`resolverDivisao`, `gerarParcelas`), então o que aparece offline é
 * exatamente o que vai ser gravado — não uma aproximação que muda ao sincronizar.
 */
function aplicarFinanceiro(fin: FinanceiroAdmin, op: Operacao): FinanceiroAdmin {
  const lista = (chave: keyof FinanceiroAdmin, idDe = (x: any) => x.id) => {
    const atual = fin[chave] as Record<string, any>[]
    if (op.op === 'remover') return atual.filter((x) => idDe(x) !== op.id)
    if (op.op === 'criar') return [...atual, { id: op.id, ...op.campos }]
    return atual.map((x) => (idDe(x) === op.id ? { ...x, ...op.campos } : x))
  }

  if (op.entidade === 'categoria') return { ...fin, categorias: lista('categorias') }
  if (op.entidade === 'parcela') return { ...fin, parcelas: lista('parcelas') }
  if (op.entidade === 'pagamento') return { ...fin, pagamentos: lista('pagamentos') }

  // custo — a despesa e tudo que pende dela
  const id = String(op.id ?? '')
  if (op.op === 'remover') {
    return {
      ...fin,
      despesas: fin.despesas.filter((x) => x.id !== id),
      divisoes: fin.divisoes.filter((x) => x.expense_id !== id),
      parcelas: fin.parcelas.filter((x) => x.expense_id !== id),
    }
  }

  const c = op.campos as Record<string, any>
  const total = Number(c.valor_centavos) || 0
  const divisoes = resolverDivisao(total, c.divisao, c.divisoes ?? []).map((d) => ({
    ...d,
    expense_id: id,
  }))
  const parcelas = gerarParcelas(
    total,
    Number(c.parcelas_quantidade) || 1,
    c.parcelas_primeira_em ?? c.ocorre_em ?? null,
    c.parcelas_frequencia ?? 'mensal',
  ).map((p) => {
    // Preserva o que já foi pago ao fornecedor: o formulário de despesa não
    // manda esse campo, e zerá-lo aqui faria uma parcela quitada voltar a
    // aparecer como em aberto até o próximo sync.
    const antiga = fin.parcelas.find((x) => x.expense_id === id && Number(x.numero) === p.numero)
    return {
      id: antiga?.id ?? `${id}:${p.numero}`,
      expense_id: id,
      pago_centavos: 0,
      ...antiga,
      ...p,
    }
  })

  const despesa = {
    id,
    categoria_id: c.categoria_id ?? null,
    traveler_id: c.traveler_id ?? null,
    descricao: c.descricao,
    valor_centavos: total,
    moeda: c.moeda ?? null,
    ocorre_em: c.ocorre_em ?? null,
    divisao: c.divisao ?? 'igual',
    estimado: c.estimado ?? true,
    nota: c.nota ?? null,
    ordem: c.ordem ?? 0,
  }

  return {
    ...fin,
    despesas:
      op.op === 'criar'
        ? [...fin.despesas, despesa]
        : fin.despesas.map((x) => (x.id === id ? { ...x, ...despesa } : x)),
    divisoes: [...fin.divisoes.filter((x) => x.expense_id !== id), ...divisoes],
    parcelas: [...fin.parcelas.filter((x) => x.expense_id !== id), ...parcelas],
  }
}

function aplicarLocal(s: Snapshot, op: Operacao): Snapshot {
  const novo = { ...s }

  if (op.entidade === 'checklist_state') {
    const itemId = String(op.campos.item_id)
    const meuId = s.eu.participanteId
    const outros = s.checklist_state.filter(
      (e) => !(e.item_id === itemId && e.traveler_id === meuId),
    )
    novo.checklist_state = [
      ...outros,
      { item_id: itemId, traveler_id: meuId, feito: Boolean(op.campos.feito) },
    ]
    return novo
  }

  if (op.entidade === 'viagem') {
    novo.viagem = { ...s.viagem, ...op.campos }
    return novo
  }

  // Financeiro: só o pacote de administrador tem listas para espelhar. O do
  // viajante comum é calculado no servidor e ele não escreve nada nele.
  if (['custo', 'categoria', 'parcela', 'pagamento'].includes(op.entidade)) {
    if (!s.financeiro.admin) return novo
    novo.financeiro = aplicarFinanceiro(s.financeiro, op)
    return novo
  }

  // Opção de transporte: mora ANINHADA em roteiro[].opcoes, não numa lista de
  // topo. Sem este ramo, adicionar "de metrô, 18 min" em modo avião só aparecia
  // depois do sync — e o app promete o contrário.
  if (op.entidade === 'opcao') {
    const eventoId = String(op.campos.event_id ?? '')
    novo.roteiro = s.roteiro.map((e) => {
      const opcoes = (e.opcoes ?? []) as Record<string, any>[]
      if (op.op === 'remover') return { ...e, opcoes: opcoes.filter((o) => o.id !== op.id) }
      if (op.op === 'criar') {
        return e.id === eventoId ? { ...e, opcoes: [...opcoes, { id: op.id, ...op.campos }] } : e
      }
      return { ...e, opcoes: opcoes.map((o) => (o.id === op.id ? { ...o, ...op.campos } : o)) }
    })
    return novo
  }

  // O dia é upsert por data no servidor (unique (trip_id, dia)). Espelhar isso
  // como `push` deixaria duas linhas do mesmo dia na tela até o próximo sync,
  // e a segunda escreveria por cima da primeira sem que ninguém entendesse.
  if (op.entidade === 'dia' && op.op === 'criar') {
    const data = String(op.campos.dia ?? '')
    const existente = s.dias.find((d) => String(d.dia).slice(0, 10) === data.slice(0, 10))
    novo.dias = existente
      ? s.dias.map((d) => (d === existente ? { ...d, ...op.campos } : d))
      : [...s.dias, { id: op.id, ...op.campos }]
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
