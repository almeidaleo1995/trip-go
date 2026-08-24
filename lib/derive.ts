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
  const m = valor.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/)
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
  retorno: string | null,
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

/** Dias antes da partida em que a viagem deixa de ser "planejando" e vira "proxima". */
export const JANELA_PROXIMA = 60

export type StatusViagem = 'planejando' | 'proxima' | 'andamento' | 'concluida' | 'arquivada'

/**
 * Status mostrado no cartao e usado pelos filtros de Minhas viagens.
 *
 * Derivado das datas, nunca digitado: uma viagem nao pode ficar marcada como
 * "proxima" tres anos depois de acontecer so porque ninguem voltou para corrigir.
 * Arquivada e a unica marca manual, e ela ganha de todas as outras.
 */
export function statusViagem(
  agora: Date | string,
  partida: string | null,
  retorno: string | null,
  arquivada = false,
): StatusViagem {
  if (arquivada) return 'arquivada'
  const f = faseDaViagem(agora, partida, retorno)
  if (f.fase === 'durante') return 'andamento'
  if (f.fase === 'depois') return 'concluida'
  return f.diasRestantes <= JANELA_PROXIMA ? 'proxima' : 'planejando'
}

/**
 * "hoje" / "ontem" / "ha 3 dias" / "ha 2 meses". Usado em "ultima atualizacao".
 *
 * Le a hora como local: um timestamp em UTC pode cair no dia anterior perto da
 * meia-noite. Para um rotulo de "quando mexeram nisso" isso e irrelevante, e
 * evita ter que carregar fuso para uma frase de tres palavras.
 */
export function formatarRelativo(
  valor: string | null | undefined,
  agora: Date = new Date(),
): string {
  const d = parseData(valor ?? null)
  if (!d) return ''
  const dias = diasAte(d, agora)
  if (dias === 0) return 'hoje'
  if (dias === 1) return 'ontem'
  if (dias < 30) return `há ${dias} dias`
  const meses = Math.floor(dias / 30)
  if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`
  const anos = Math.floor(dias / 365)
  return `há ${anos} ${anos === 1 ? 'ano' : 'anos'}`
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

// ---------------------------------------------------------------- roteiro por dia

/**
 * O roteiro tem tres niveis: viagem -> dia -> item. Este bloco monta o do meio.
 *
 * A LISTA DE DIAS NAO VEM DO BANCO. Ela e derivada de data_partida..data_retorno,
 * e a tabela `itinerary_days` guarda so os dias sobre os quais alguem escreveu
 * algo. Uma viagem de 17 dias sem anotacao nenhuma tem zero linhas la e mesmo
 * assim mostra 17 dias na tela - e um dia anotado que caiu fora do intervalo
 * (a viagem encurtou depois) continua aparecendo, em vez de sumir com o texto
 * dentro.
 */

export type DiaRoteiro = {
  /** 'AAAA-MM-DD' — chave de agrupamento e do seletor. */
  chave: string
  data: Date
  /** 1..n dentro da viagem. 0 quando o dia esta fora do intervalo das datas. */
  numero: number
  /** A linha de `itinerary_days`, quando existe. */
  meta: Record<string, any> | null
  itens: Record<string, any>[]
}

/** Itens que representam ESTAR em algum lugar. Alimentam "N locais". */
const TIPOS_LOCAL = new Set(['local', 'ponto', 'passeio', 'compras', 'evento'])
/** Itens que representam IR de um lugar a outro. Alimentam "N deslocamentos". */
const TIPOS_DESLOCAMENTO = new Set(['voo', 'trem', 'onibus', 'traslado', 'caminhada', 'cruzeiro'])
const TIPOS_REFEICAO = new Set(['restaurante', 'refeicao'])

/** Tipo de item -> modo de transporte, para o resumo de deslocamento do dia. */
const MODO_POR_TIPO: Record<string, string> = {
  voo: 'aviao',
  trem: 'trem',
  onibus: 'onibus',
  traslado: 'taxi',
  caminhada: 'a_pe',
  cruzeiro: 'barco',
}

/** 'AAAA-MM-DD' de um Date local. Nao usa toISOString: ele converte para UTC. */
function chaveLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * O dia de calendario de um timestamp, como chave.
 *
 * Passa por `parseData` de proposito: cortar os dez primeiros caracteres seria
 * mais curto, mas aceitaria "2027-13-05" e criaria um dia fantasma no seletor.
 */
export function chaveDia(valor: string | null | undefined): string | null {
  const d = parseData(valor)
  return d ? chaveLocal(d) : null
}

/**
 * Ordena os itens de um dia: por horario, `ordem` desempatando.
 *
 * Nao existe "ordem manual" competindo com o relogio. Num roteiro todo item tem
 * hora (a coluna e `not null`), entao mudar a ordem E mudar o horario — os
 * botoes de subir/descer trocam o `ocorre_em` dos dois vizinhos, e a linha do
 * tempo nunca fica contando uma historia diferente da dos horarios que mostra.
 * `ordem` so decide entre dois itens marcados no mesmo minuto.
 */
export function ordenarItens<T extends Evento & { ordem?: number }>(itens: T[]): T[] {
  return [...(itens ?? [])]
    .map((e, i) => ({ e, i, t: parseData(e?.ocorre_em)?.getTime() ?? null }))
    .sort((a, b) => {
      if (a.t === null && b.t === null) return a.i - b.i
      if (a.t === null) return 1
      if (b.t === null) return -1
      return a.t - b.t || Number(a.e.ordem ?? 0) - Number(b.e.ordem ?? 0) || a.i - b.i
    })
    .map((x) => x.e)
}

export function montarDias(
  viagem: { data_partida?: string | null; data_retorno?: string | null } | null,
  itens: Record<string, any>[],
  dias: Record<string, any>[],
): DiaRoteiro[] {
  const porChave = new Map<string, Record<string, any>[]>()
  for (const e of itens ?? []) {
    const c = chaveDia(e?.ocorre_em)
    if (!c) continue
    if (!porChave.has(c)) porChave.set(c, [])
    porChave.get(c)!.push(e)
  }

  const meta = new Map<string, Record<string, any>>()
  for (const d of dias ?? []) {
    const c = chaveDia(d?.dia)
    if (c) meta.set(c, d)
  }

  const partida = parseData(viagem?.data_partida ?? null)
  const retorno = parseData(viagem?.data_retorno ?? null)

  // O intervalo da viagem primeiro, para `numero` ser o dia 1, 2, 3... dela.
  const chaves: string[] = []
  const numeros = new Map<string, number>()
  if (partida && retorno) {
    const total = diasAte(partida, retorno)
    for (let i = 0; i <= total; i++) {
      const d = new Date(partida.getFullYear(), partida.getMonth(), partida.getDate() + i)
      const c = chaveLocal(d)
      chaves.push(c)
      numeros.set(c, i + 1)
    }
  }
  // Dia com conteudo fora do intervalo entra mesmo assim: apagar da tela o que
  // esta gravado no banco e pior do que mostrar um dia a mais.
  for (const c of [...porChave.keys(), ...meta.keys()]) {
    if (!numeros.has(c)) chaves.push(c)
  }

  return [...new Set(chaves)].sort().map((chave) => ({
    chave,
    data: parseData(chave)!,
    numero: numeros.get(chave) ?? 0,
    meta: meta.get(chave) ?? null,
    itens: ordenarItens((porChave.get(chave) ?? []) as (Evento & { ordem?: number })[]),
  }))
}

export type ResumoDia = {
  locais: number
  deslocamentos: number
  refeicoes: number
  reservas: number
  /** Soma de `distancia_m` dos itens do dia. */
  distanciaM: number
  /** Soma de `duracao_min`: tempo em transito. */
  minutosDeslocamento: number
  /**
   * Tempo planejado. Soma as duracoes explicitas (fim_em - ocorre_em) e, quando
   * nenhum item tem fim, cai para o intervalo do primeiro ao ultimo — que e a
   * unica coisa honesta a dizer sobre um dia sem horario de termino.
   */
  minutos: number
  /** Soma de `custo_centavos`. Estimativa, nunca despesa registrada. */
  custoCentavos: number
  /** Deslocamento agrupado por modo, para "3,2 km a pe · 2 de metro". */
  porModo: { modo: string; vezes: number; distanciaM: number; minutos: number }[]
}

/**
 * O modo de transporte efetivo de um item: a opcao recomendada, senao o tipo.
 *
 * Cai em 'outro' em vez de devolver null, porque quem chama so pergunta isso de
 * um item que TEM distancia ou duracao. Um almoco a 2,4 km de metro e um
 * deslocamento de verdade; devolver null o apagava do resumo do dia enquanto a
 * linha do tempo continuava mostrando "2,4 km · 18min" logo acima.
 */
function modoDoItem(e: Record<string, any>): string {
  const opcoes = (e.opcoes ?? []) as Record<string, any>[]
  const recomendada = opcoes.find((o) => o.recomendado) ?? opcoes[0]
  if (recomendada?.modo) return String(recomendada.modo)
  return MODO_POR_TIPO[String(e.tipo)] ?? 'outro'
}

/** Os numeros do cabecalho e do rodape do dia. Tudo somado dos itens, nada fixo. */
export function resumoDoDia(itens: Record<string, any>[]): ResumoDia {
  const lista = itens ?? []
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

  let explicito = 0
  const modos = new Map<string, { vezes: number; distanciaM: number; minutos: number }>()

  for (const e of lista) {
    const ini = parseData(e.ocorre_em)
    const fim = parseData(e.fim_em)
    if (ini && fim && fim > ini) explicito += Math.round((fim.getTime() - ini.getTime()) / 60_000)

    if (num(e.distancia_m) > 0 || num(e.duracao_min) > 0) {
      const modo = modoDoItem(e)
      const atual = modos.get(modo) ?? { vezes: 0, distanciaM: 0, minutos: 0 }
      atual.vezes += 1
      atual.distanciaM += num(e.distancia_m)
      atual.minutos += num(e.duracao_min)
      modos.set(modo, atual)
    }
  }

  // Sem nenhum horario de termino cadastrado, o "tempo planejado" e o intervalo
  // do primeiro ao ultimo item — nao zero, que faria o dia parecer vazio.
  let minutos = explicito
  if (minutos === 0) {
    const tempos = lista.map((e) => parseData(e.ocorre_em)?.getTime()).filter(Boolean) as number[]
    if (tempos.length > 1) {
      minutos = Math.round((Math.max(...tempos) - Math.min(...tempos)) / 60_000)
    }
  }

  return {
    locais: lista.filter((e) => TIPOS_LOCAL.has(String(e.tipo))).length,
    deslocamentos: lista.filter((e) => TIPOS_DESLOCAMENTO.has(String(e.tipo))).length,
    refeicoes: lista.filter((e) => TIPOS_REFEICAO.has(String(e.tipo))).length,
    reservas: lista.filter((e) => Boolean(e.reserva_id)).length,
    distanciaM: lista.reduce((s, e) => s + num(e.distancia_m), 0),
    minutosDeslocamento: lista.reduce((s, e) => s + num(e.duracao_min), 0),
    minutos,
    custoCentavos: lista.reduce((s, e) => s + num(e.custo_centavos), 0),
    porModo: [...modos.entries()]
      .map(([modo, v]) => ({ modo, ...v }))
      .sort((a, b) => b.distanciaM - a.distanciaM || b.vezes - a.vezes),
  }
}

/**
 * Qual dia abrir. Hoje, se a viagem esta acontecendo; o proximo, se ainda nao
 * comecou; o ultimo, se ja acabou (REQ 36). Devolve o indice, nao o dia, porque
 * quem chama tambem precisa rolar o seletor ate ele.
 */
export function diaFoco(dias: DiaRoteiro[], agora: Date | string): number {
  const lista = dias ?? []
  if (lista.length === 0) return -1
  const hoje = chaveLocal(agora instanceof Date ? agora : (parseData(agora) ?? new Date()))
  const exato = lista.findIndex((d) => d.chave === hoje)
  if (exato >= 0) return exato
  const futuro = lista.findIndex((d) => d.chave > hoje)
  return futuro >= 0 ? futuro : lista.length - 1
}

/** Metros -> "850 m" / "2,4 km". Vazio quando nao ha distancia cadastrada. */
export function formatarDistancia(metros: number | null | undefined): string {
  const m = Math.round(Number(metros) || 0)
  if (m <= 0) return ''
  if (m < 1000) return `${m} m`
  const km = m / 1000
  // Uma casa decimal ate 10 km, nenhuma acima: "9,4 km" ajuda, "14,3 km" nao.
  const texto = km < 10 ? km.toFixed(1) : String(Math.round(km))
  return `${texto.replace('.', ',').replace(',0', '')} km`
}

/**
 * Campo de texto com um item por linha -> lista. Alertas, dicas e os rituais de
 * sair e dormir usam isto em vez de uma tabela filha por lista.
 */
export function linhas(texto: string | null | undefined): string[] {
  return String(texto ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Esquemas que podem virar href. Qualquer outro e descartado, `javascript:` incluso. */
const ESQUEMA_OK = /^(https?:|mailto:|tel:)/i

/**
 * "Rotulo|https://..." por linha -> lista de links.
 *
 * O filtro de esquema NAO e paranoia: quem edita o roteiro escreve para todo
 * mundo da viagem, e um `javascript:` num href e execucao de codigo na tela dos
 * outros. Sem esquema, assume https — e o que a pessoa quis dizer ao colar
 * "maps.google.com".
 */
export function lerLinks(texto: string | null | undefined): { rotulo: string; url: string }[] {
  const saida: { rotulo: string; url: string }[] = []
  for (const linha of linhas(texto)) {
    const corte = linha.indexOf('|')
    const rotulo = corte >= 0 ? linha.slice(0, corte).trim() : ''
    let url = (corte >= 0 ? linha.slice(corte + 1) : linha).trim()
    if (!url) continue
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`
    if (!ESQUEMA_OK.test(url)) continue
    saida.push({ rotulo: rotulo || url.replace(/^https?:\/\//, ''), url })
  }
  return saida
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
  estado: EstadoChecklist,
): { feitos: number; total: number; pct: number } {
  const lista = itens ?? []
  const total = lista.length
  if (total === 0) return { feitos: 0, total: 0, pct: 0 }
  const feitos = lista.filter((i) => estado?.[i.id] === true).length
  return { feitos, total, pct: Math.round((feitos / total) * 100) }
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
  margem = 10,
): { cidade?: string; x: number; y: number }[] {
  // Number(null) e Number('') sao 0, o que plotaria uma cidade sem coordenada na
  // ilha nula (0, 0) e desenharia uma linha ate o golfo da Guine. Descarta antes.
  const temCoord = (v: unknown) =>
    v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))

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
    spanLat > 0 ? utilH / spanLat : Infinity,
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

/**
 * Data em pt-BR. Sem `opcoes` sai "30/12".
 *
 * `opcoes` SUBSTITUI o formato padrao, nao se soma a ele: pedir `{ month:
 * 'short' }` tem que devolver "dez.", nao "30 de dez.". Mesclar com o padrao
 * fazia com que ninguem conseguisse pedir so o mes ou so o dia da semana.
 */
export function formatarData(valor: string | null, opcoes?: Intl.DateTimeFormatOptions): string {
  const d = parseData(valor)
  if (!d) return ''
  const formato = opcoes ?? { day: '2-digit', month: '2-digit' }
  return new Intl.DateTimeFormat('pt-BR', { ...formato, ...TZ }).format(d)
}

export function formatarHora(valor: string | null): string {
  const d = parseData(valor)
  if (!d) return ''
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', ...TZ }).format(d)
}

/** Centavos -> texto na moeda da viagem. A conversao acontece so aqui. */
export function formatarDinheiro(centavos: number, moeda = 'EUR'): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda }).format(
    (Number(centavos) || 0) / 100,
  )
}

/**
 * O caminho de volta: o que a pessoa digitou vira centavos inteiros.
 *
 * Aceita "1.234,56" (pt-BR) e "1234.56" (teclado numerico). Devolve null quando
 * nao e numero, para o formulario poder dizer "valor invalido" em vez de gravar 0.
 *
 * Os centavos saem de uma conta com INTEIROS: `8,15 * 100` em ponto flutuante da
 * 814,9999... e arredondar depois ja teria perdido o centavo. Separar a parte
 * inteira da decimal antes de multiplicar nao tem esse problema.
 */
/**
 * Centavos -> o texto que vai DENTRO do campo de digitacao: "1234,56".
 *
 * Nao e `formatarDinheiro`: sem simbolo de moeda e sem separador de milhar,
 * porque o que sai daqui volta por `paraCentavos` quando a pessoa salva. E
 * sempre com duas casas — `String(10000 / 100)` da "100", e um campo de dinheiro
 * que mostra "100" quando o valor e R$ 100,00 faz a pessoa conferir duas vezes.
 */
export function paraCampoDinheiro(centavos: number | null | undefined): string {
  const n = Math.round(Number(centavos) || 0)
  return (n / 100).toFixed(2).replace('.', ',')
}

export function paraCentavos(texto: string | null | undefined): number | null {
  const limpo = String(texto ?? '').trim()
  if (!limpo) return null

  // Ponto e separador de milhar em pt-BR; virgula e o decimal. Sem virgula, um
  // ponto sozinho e tratado como decimal (teclado numerico do celular).
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo.replace(/\.(?=\d{3}(\D|$))/g, '')

  if (!/^\d+(\.\d+)?$/.test(normalizado)) return null

  const [inteiro, decimal = ''] = normalizado.split('.')
  const centavos = (decimal + '00').slice(0, 2)
  return Number(inteiro) * 100 + Number(centavos)
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
