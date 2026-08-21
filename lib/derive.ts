// Calculos derivados da viagem. Zero I/O, zero React, zero rede - so entra dado
// e sai numero. E por isso que este e o unico arquivo com teste unitario de verdade:
// e aqui que um bug fica invisivel ate a pessoa perder o voo.
//
// Convencao de tempo do projeto: horarios sao hora LOCAL DO DESTINO, escritos como
// "2026-12-30T10:30" (sem Z, sem offset). Nunca convertemos fuso.

export type Fase = 'antes' | 'durante' | 'depois'

export type FaseDaViagem = {
  fase: Fase
  /** dias inteiros ate a partida; 0 quando ja comecou */
  diasRestantes: number
  /** 1..totalDias enquanto a viagem corre; 0 fora dela */
  diaAtual: number
  totalDias: number
}

export type Evento = {
  id?: string
  ocorre_em: string | null | undefined
  titulo?: string
  cidade?: string | null
  local?: string | null
}

export type ItemChecklist = { id: string }
export type EstadoChecklist = Record<string, boolean>

export type Custo = {
  categoria_id?: string | null
  valor_centavos: number
  pessoas: number
}

export type Ponto = { cidade?: string; lat: number | string | null; lon: number | string | null }

// ---------------------------------------------------------------- datas

/**
 * Converte "YYYY-MM-DD" ou "YYYY-MM-DDTHH:mm[:ss]" em Date no fuso local.
 *
 * Existe porque `new Date("2026-12-30")` e interpretado como UTC pela spec do JS,
 * o que joga a data para o dia anterior em qualquer fuso a oeste de Greenwich -
 * incluindo o Brasil. Construir componente a componente evita isso.
 */
export function parseData(valor: string | null | undefined): Date | null {
  if (!valor || typeof valor !== 'string') return null
  const m = valor
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  const [ano, mes, dia, hora, min, seg] = m.slice(1).map((v) => Number(v ?? 0))

  const d = new Date(ano, mes - 1, dia, hora, min, seg)
  if (Number.isNaN(d.getTime())) return null

  // O construtor de Date faz rollover em silencio: mes 13 vira janeiro do ano
  // seguinte, dia 45 vira o mes que vem. Num JSON importado, "2026-13-05" viraria
  // 05/01/2027 sem ninguem perceber - e o voo apareceria no mes errado. Conferir
  // os componentes de volta e o que transforma esse rollover em erro visivel.
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null
  if (d.getHours() !== hora || d.getMinutes() !== min) return null

  return d
}

/** Numero do dia no calendario local, ignorando a hora. Base das contas em dias. */
function numeroDoDia(d: Date): number {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000)
}

/**
 * Dias inteiros de `de` ate `para`. Nunca negativo: intervalo invertido devolve 0.
 * Compara dias de calendario, nao milissegundos, entao horario de verao nao distorce.
 */
export function diasAte(de: string | Date | null, para: string | Date | null): number {
  const a = de instanceof Date ? de : parseData(de)
  const b = para instanceof Date ? para : parseData(para)
  if (!a || !b) return 0
  return Math.max(0, numeroDoDia(b) - numeroDoDia(a))
}

/** Noites entre check-in e check-out. Intervalo invertido ou incompleto devolve 0. */
export function noites(checkin: string | null, checkout: string | null): number {
  return diasAte(checkin, checkout)
}

/** Noites a bordo, das datas de embarque e desembarque do cruzeiro. */
export function noitesABordo(embarque: string | null, desembarque: string | null): number {
  return diasAte(embarque, desembarque)
}

// ---------------------------------------------------------------- fase da viagem

export function faseDaViagem(
  agora: Date | string,
  partida: string | null,
  retorno: string | null
): FaseDaViagem {
  const hoje = agora instanceof Date ? agora : (parseData(agora) ?? new Date())
  const p = parseData(partida)
  const r = parseData(retorno)

  // Sem datas nao ha viagem a medir.
  if (!p || !r) return { fase: 'antes', diasRestantes: 0, diaAtual: 0, totalDias: 0 }

  // Partida depois do retorno e dado invalido: duracao 0, nunca negativa.
  const totalDias = diasAte(p, r)
  const dHoje = numeroDoDia(hoje)

  if (dHoje < numeroDoDia(p)) {
    return { fase: 'antes', diasRestantes: numeroDoDia(p) - dHoje, diaAtual: 0, totalDias }
  }
  if (dHoje > numeroDoDia(r)) {
    return { fase: 'depois', diasRestantes: 0, diaAtual: 0, totalDias }
  }
  return {
    fase: 'durante',
    diasRestantes: 0,
    diaAtual: dHoje - numeroDoDia(p) + 1,
    totalDias,
  }
}

// ---------------------------------------------------------------- roteiro

/**
 * O evento futuro mais proximo. Eventos com data ausente ou invalida sao ignorados
 * em vez de derrubarem o calculo - a aba Roteiro ainda os exibe, no fim da lista.
 */
export function proximoCompromisso<T extends Evento>(eventos: T[], agora: Date | string): T | null {
  const ref = agora instanceof Date ? agora : (parseData(agora) ?? new Date())
  let melhor: T | null = null
  let melhorTempo = Infinity

  for (const e of eventos ?? []) {
    const d = parseData(e?.ocorre_em)
    if (!d) continue
    const t = d.getTime()
    if (t >= ref.getTime() && t < melhorTempo) {
      melhor = e
      melhorTempo = t
    }
  }
  return melhor
}

/** Ordena por data; eventos sem data valida vao para o fim, preservando a ordem entre si. */
export function ordenarEventos<T extends Evento>(eventos: T[]): T[] {
  return [...(eventos ?? [])]
    .map((e, i) => ({ e, i, t: parseData(e?.ocorre_em)?.getTime() ?? null }))
    .sort((a, b) => {
      if (a.t === null && b.t === null) return a.i - b.i
      if (a.t === null) return 1
      if (b.t === null) return -1
      return a.t - b.t || a.i - b.i
    })
    .map((x) => x.e)
}

// ---------------------------------------------------------------- lugares

/**
 * Conta cidades e paises distintos. Cidades homonimas em paises diferentes contam
 * como duas - por isso a chave e o par (cidade, pais), nao so a cidade.
 */
export function contarLugares(lugares: { cidade?: string; pais?: string | null }[]): {
  cidades: number
  paises: number
} {
  const cidades = new Set<string>()
  const paises = new Set<string>()
  for (const l of lugares ?? []) {
    if (l?.cidade) cidades.add(`${l.cidade}|${l.pais ?? ''}`.toLowerCase())
    if (l?.pais) paises.add(l.pais.toLowerCase())
  }
  return { cidades: cidades.size, paises: paises.size }
}

// ---------------------------------------------------------------- checklist

/**
 * Progresso do usuario atual. IDs no estado salvo que nao existem mais no checklist
 * sao ignorados: o denominador e sempre o checklist atual, nunca o historico.
 */
export function progressoChecklist(
  itens: ItemChecklist[],
  estado: EstadoChecklist
): { feitos: number; total: number; pct: number } {
  const lista = itens ?? []
  const total = lista.length
  if (total === 0) return { feitos: 0, total: 0, pct: 0 }
  const feitos = lista.filter((i) => estado?.[i.id] === true).length
  return { feitos, total, pct: Math.round((feitos / total) * 100) }
}

// ---------------------------------------------------------------- financeiro

/**
 * Totais em centavos. Tudo inteiro do inicio ao fim - converter para reais/euros
 * so acontece na formatacao, nunca no calculo.
 */
export function totaisFinanceiro(custos: Custo[]): {
  porCategoria: Record<string, number>
  total: number
} {
  const porCategoria: Record<string, number> = {}
  let total = 0
  for (const c of custos ?? []) {
    const valor = Math.round(Number(c?.valor_centavos) || 0) * (Number(c?.pessoas) || 0)
    const chave = c?.categoria_id ?? 'sem-categoria'
    porCategoria[chave] = (porCategoria[chave] ?? 0) + valor
    total += valor
  }
  return { porCategoria, total }
}

// ---------------------------------------------------------------- mapa da rota

/**
 * Projeta lat/lon em coordenadas do SVG (equirretangular) enquadrando a rota inteira.
 *
 * Enquadramento automatico: qualquer conjunto de cidades cabe, de um cruzeiro no
 * Baltico a uma volta ao mundo. Um ponto so, ou varios pontos na mesma coordenada,
 * caem no centro em vez de dividir por zero.
 *
 * ponytail: equirretangular, nao Mercator. Numa faixa de latitude de um continente a
 * distorcao e imperceptivel, e o fundo e abstrato de qualquer forma. Se um dia entrar
 * contorno de costa real, a projecao precisa passar a bater com a do GeoJSON.
 */
export function projetarRota(
  pontos: Ponto[],
  largura = 100,
  altura = 100,
  margem = 10
): { cidade?: string; x: number; y: number }[] {
  // Number(null) e Number('') sao 0, o que plotaria uma cidade sem coordenada na
  // ilha nula (0, 0) e desenharia uma linha ate o golfo da Guine. Descarta antes.
  const temCoord = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))

  const validos = (pontos ?? [])
    .filter((p) => temCoord(p?.lat) && temCoord(p?.lon))
    .map((p) => ({ cidade: p.cidade, lat: Number(p.lat), lon: Number(p.lon) }))

  if (validos.length === 0) return []

  const lats = validos.map((p) => p.lat)
  const lons = validos.map((p) => p.lon)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)

  const utilW = largura - margem * 2
  const utilH = altura - margem * 2
  const spanLon = maxLon - minLon
  const spanLat = maxLat - minLat

  // Mantem a proporcao: usa a mesma escala nos dois eixos e centraliza a sobra.
  const escala = Math.min(
    spanLon > 0 ? utilW / spanLon : Infinity,
    spanLat > 0 ? utilH / spanLat : Infinity
  )
  const k = Number.isFinite(escala) ? escala : 1

  const sobraX = (utilW - spanLon * k) / 2
  const sobraY = (utilH - spanLat * k) / 2

  return validos.map((p) => ({
    cidade: p.cidade,
    x: margem + sobraX + (p.lon - minLon) * k,
    // y invertido: latitude cresce para o norte, y do SVG cresce para baixo
    y: margem + sobraY + (maxLat - p.lat) * k,
  }))
}

// ---------------------------------------------------------------- sincronizacao

/**
 * Resolucao de conflito por last-write-wins, comparando `updated_at`.
 *
 * ponytail: LWW por registro, sem vetor de versao. Teto conhecido e aceito - duas
 * pessoas editando o MESMO registro dentro da mesma janela de sync: a escrita mais
 * antiga e descartada em silencio. Com 5 pessoas e praticamente um so admin
 * escrevendo, isso quase nunca acontece, e o change_log guarda as duas versoes,
 * entao nada some sem rastro. Se virar problema real, o proximo passo e vetor de
 * versao por linha - nao CRDT.
 */
export function mesclarLWW<T extends { updated_at?: string | null }>(local: T, remoto: T): T {
  const tl = parseData(local?.updated_at)?.getTime() ?? Date.parse(local?.updated_at ?? '') ?? NaN
  const tr = parseData(remoto?.updated_at)?.getTime() ?? Date.parse(remoto?.updated_at ?? '') ?? NaN
  if (Number.isNaN(tl)) return remoto
  if (Number.isNaN(tr)) return local
  return tr >= tl ? remoto : local
}

// ---------------------------------------------------------------- formatacao pt-BR

const TZ = { timeZone: undefined } as const

export function formatarData(valor: string | null, opcoes?: Intl.DateTimeFormatOptions): string {
  const d = parseData(valor)
  if (!d) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', ...TZ, ...opcoes })
    .format(d)
}

export function formatarHora(valor: string | null): string {
  const d = parseData(valor)
  if (!d) return ''
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', ...TZ }).format(d)
}

/** Centavos -> texto na moeda da viagem. A conversao acontece so aqui. */
export function formatarDinheiro(centavos: number, moeda = 'EUR'): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda }).format(
    (Number(centavos) || 0) / 100
  )
}

/** Duracao em minutos -> "12h40" / "45min". Usado em voos e conexoes. */
export function formatarDuracao(minutos: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(minutos) || 0))
  if (m === 0) return ''
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}min`
  return r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, '0')}`
}
