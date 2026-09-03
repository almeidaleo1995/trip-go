// Os TRECHOS de um dia: quem sai de onde, para onde, quando, e se o plano cabe
// no relógio.
//
// Não é um módulo de rota — é a leitura do que já está gravado. `distancia_m`,
// `duracao_min` e `transporte` moram no item de DESTINO (db/schema.sql), e as
// alternativas de modo em `itinerary_options`. Aqui isso vira uma lista de
// trechos com hora de sair e diagnóstico de viabilidade.
//
// A conta de "saia às" NÃO é refeita aqui: `horaDeSair`/`margemDe` de
// lib/hoje.ts são as mesmas que a aba Hoje usa. Duas implementações dariam dois
// horários para o mesmo compromisso, e quem está na rua não teria como saber
// qual dos dois está certo.
//
// Zero I/O, zero React: entra a lista de itens do dia, sai o que a tela desenha.
import { ordenarItens, parseData } from './derive.ts'
import {
  MARGEM_POR_TIPO,
  NOME_MODO,
  horaDeSair,
  margemDe,
  type ItemRoteiro,
  type Modo,
} from './hoje.ts'

/** Só é número quando é número positivo de verdade. `Number(null)` é 0, e um
    deslocamento de 0 min não é deslocamento — é campo em branco. */
function numeroOuNulo(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function coordenada(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Ponta de um trecho: um item do roteiro, ou a hospedagem da noite. */
export type Ponta = {
  titulo: string
  local: string | null
  endereco: string | null
  lat: number | null
  lon: number | null
  /** A linha de origem, quando a ponta veio de um item do roteiro. */
  item: Record<string, unknown> | null
}

export type Trecho = {
  /** Id do item de DESTINO — é nele que o deslocamento está gravado. */
  id: string
  origem: Ponta | null
  destino: Ponta
  distanciaM: number | null
  duracaoMin: number | null
  /** Modo normalizado, quando `transporte` casa com um dos oito modos. */
  modo: Modo | null
  /** `transporte` cru — texto livre ("Metrô L2", "Via BR-101"). */
  transporte: string | null
  /** Alternativas de `itinerary_options`, recomendada primeiro. */
  opcoes: Record<string, unknown>[]
  chegaAs: Date | null
  sairAs: Date | null
  margemMin: number
  /**
   * Teto do tempo livre entre o item anterior e este, em minutos.
   *
   * Medido do FIM do anterior quando ele tem `fim_em`; do COMEÇO dele quando
   * não tem. Sem `fim_em` ninguém sabe quando o anterior acaba, e supor que
   * acaba na hora em que começa dá um limite SUPERIOR do tempo livre: nunca
   * acusa um conflito que não existe, e ainda pega o caso em que nem o
   * intervalo inteiro daria conta do deslocamento.
   */
  folgaMin: number | null
  /** O deslocamento não cabe no intervalo. Certeza, não estimativa. */
  conflito: boolean
  /** Cabe, mas come a margem de segurança. */
  apertado: boolean
  /** Quantos minutos faltam, quando há conflito. */
  faltamMin: number | null
  /** Sem `duracao_min` gravada não há rota conferida — a tela diz isso, em vez
      de inventar um horário de saída. */
  verificado: boolean
}

function pontaDoItem(item: Record<string, unknown>): Ponta {
  return {
    titulo: String(item.titulo ?? item.local ?? '').trim() || 'Parada sem nome',
    local: String(item.local ?? '').trim() || null,
    endereco: String(item.endereco ?? '').trim() || null,
    lat: coordenada(item.lat),
    lon: coordenada(item.lon),
    item,
  }
}

/** A hospedagem como ponta: é de onde o dia sai e para onde ele volta (§28). */
export function pontaDaHospedagem(
  reserva: Record<string, unknown> | null | undefined,
): Ponta | null {
  if (!reserva) return null
  return {
    titulo: String(reserva.titulo ?? reserva.local ?? 'Hospedagem').trim() || 'Hospedagem',
    local: String(reserva.local ?? '').trim() || null,
    endereco: String(reserva.endereco ?? '').trim() || null,
    lat: coordenada(reserva.lat),
    lon: coordenada(reserva.lon),
    item: null,
  }
}

function opcoesOrdenadas(item: Record<string, unknown>): Record<string, unknown>[] {
  const lista = (item.opcoes ?? []) as Record<string, unknown>[]
  // `Boolean` antes de `Number`: a coluna é `not null`, mas uma opção recém
  // criada na tela ainda não tem a chave, e `Number(undefined)` é NaN — que faz
  // o comparador devolver NaN e a ordenação sair aleatória, escondendo justo a
  // opção marcada como recomendada.
  return [...lista].sort(
    (a, b) =>
      Number(Boolean(b.recomendado)) - Number(Boolean(a.recomendado)) ||
      (Number(a.ordem) || 0) - (Number(b.ordem) || 0),
  )
}

/** `transporte` é texto livre; só vira `Modo` quando a palavra é exatamente um
    dos oito. Sem casar, o texto continua aparecendo como legenda do trecho. */
function modoValido(v: unknown): Modo | null {
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
  return s in NOME_MODO ? (s as Modo) : null
}

/**
 * Os deslocamentos de um dia, na ordem em que acontecem.
 *
 * Um trecho por item que TEM deslocamento gravado — e mais um, quando há
 * hospedagem, para a volta ao hotel no fim do dia (§29). O primeiro trecho sai
 * da hospedagem: é de lá que se acorda, e `distancia_m` do primeiro item já
 * descreve exatamente esse percurso.
 */
export function trechosDoDia(
  itens: Record<string, unknown>[],
  opcoes: {
    hospedagem?: Record<string, unknown> | null
    margens?: Record<string, number>
  } = {},
): Trecho[] {
  const margens = opcoes.margens ?? MARGEM_POR_TIPO
  const ordenados = ordenarItens(
    (itens ?? []) as (ItemRoteiro & { ordem?: number })[],
  ) as unknown as Record<string, unknown>[]
  const casa = pontaDaHospedagem(opcoes.hospedagem)
  const trechos: Trecho[] = []

  for (let i = 0; i < ordenados.length; i++) {
    const item = ordenados[i]
    const distanciaM = numeroOuNulo(item.distancia_m)
    const duracaoMin = numeroOuNulo(item.duracao_min)
    const transporte = String(item.transporte ?? '').trim() || null
    const alternativas = opcoesOrdenadas(item)

    // Sem nenhum sinal de deslocamento o item é só um compromisso, não um trecho.
    if (!distanciaM && !duracaoMin && !transporte && alternativas.length === 0) continue

    const anterior = ordenados[i - 1] ?? null
    const chegaAs = parseData(item.ocorre_em)
    const margemMin = duracaoMin === null ? 0 : margemDe(String(item.tipo ?? ''), margens)

    const fimAnterior = anterior
      ? (parseData(anterior.fim_em) ?? parseData(anterior.ocorre_em))
      : null
    const folgaMin =
      fimAnterior && chegaAs ? Math.round((chegaAs.getTime() - fimAnterior.getTime()) / 60_000) : null

    const conflito = folgaMin !== null && duracaoMin !== null && folgaMin < duracaoMin
    const apertado =
      !conflito && folgaMin !== null && duracaoMin !== null && folgaMin < duracaoMin + margemMin

    trechos.push({
      id: String(item.id ?? `t${i}`),
      origem: anterior ? pontaDoItem(anterior) : casa,
      destino: pontaDoItem(item),
      distanciaM,
      duracaoMin,
      modo: modoValido(transporte),
      transporte,
      opcoes: alternativas,
      chegaAs,
      // A mesma conta da aba Hoje. O `agora` não entra no resultado: aqui só
      // interessa o horário de sair, não se ele já passou.
      sairAs: horaDeSair(item as ItemRoteiro, new Date(), margens),
      margemMin,
      folgaMin,
      conflito,
      apertado,
      faltamMin: conflito ? duracaoMin! - folgaMin! : null,
      verificado: duracaoMin !== null,
    })
  }

  // A volta para o hotel (§29). Existe como destino, nunca como duração
  // inventada: nenhum item guarda esse trecho, então ele nasce não verificado e
  // é a auditoria que o cobra de quem prepara a viagem.
  const ultimo = ordenados[ordenados.length - 1] ?? null
  if (casa && ultimo && String(ultimo.tipo) !== 'hospedagem') {
    trechos.push({
      id: `volta:${String(ultimo.id ?? 'fim')}`,
      origem: pontaDoItem(ultimo),
      destino: casa,
      distanciaM: null,
      duracaoMin: null,
      modo: null,
      transporte: null,
      opcoes: [],
      chegaAs: null,
      sairAs: null,
      margemMin: 0,
      folgaMin: null,
      conflito: false,
      apertado: false,
      faltamMin: null,
      verificado: false,
    })
  }

  return trechos
}

export type ResumoTrechos = {
  quantos: number
  distanciaM: number
  minutos: number
  conflitos: number
  naoVerificados: number
}

/** O cabeçalho da visão Deslocamentos (§13): quantos, quanta distância, quanto tempo. */
export function resumoTrechos(trechos: Trecho[]): ResumoTrechos {
  return (trechos ?? []).reduce<ResumoTrechos>(
    (s, t) => ({
      quantos: s.quantos + 1,
      distanciaM: s.distanciaM + (t.distanciaM ?? 0),
      minutos: s.minutos + (t.duracaoMin ?? 0),
      conflitos: s.conflitos + (t.conflito ? 1 : 0),
      naoVerificados: s.naoVerificados + (t.verificado ? 0 : 1),
    }),
    { quantos: 0, distanciaM: 0, minutos: 0, conflitos: 0, naoVerificados: 0 },
  )
}

export type Problema = {
  /** `erro` só para o que quebra o dia; `aviso` para o que falta conferir. */
  nivel: 'erro' | 'aviso'
  texto: string
  /** Id do trecho, para a tela levar até ele. */
  id: string
}

/**
 * Auditoria de navegação (§41).
 *
 * Relata só o que dá para provar com o que está gravado: conflito de horário,
 * rota sem duração conferida, parada sem endereço nem coordenada. Nada de
 * "aeroporto longe demais" — sem coordenada dos dois lados isso seria chute, e
 * um alerta chutado ensina a ignorar os alertas verdadeiros.
 */
export function auditarNavegacao(trechos: Trecho[]): Problema[] {
  const problemas: Problema[] = []

  for (const t of trechos ?? []) {
    const nome = t.destino.titulo

    if (t.conflito) {
      problemas.push({
        nivel: 'erro',
        id: t.id,
        texto: `${nome}: ${t.folgaMin} min disponíveis, ${t.duracaoMin} min necessários`,
      })
    } else if (t.apertado) {
      problemas.push({
        nivel: 'aviso',
        id: t.id,
        texto: `${nome}: chega em cima da hora, sem os ${t.margemMin} min de margem`,
      })
    }

    if (!t.verificado) {
      problemas.push({
        nivel: 'aviso',
        id: t.id,
        texto: `${t.origem?.titulo ?? 'Origem'} → ${nome}: rota sem duração conferida`,
      })
    }

    if (!t.destino.endereco && t.destino.lat === null) {
      problemas.push({ nivel: 'aviso', id: t.id, texto: `${nome}: sem endereço nem coordenada` })
    }
  }

  // Erro antes de aviso, mantida a ordem do dia dentro de cada nível. Um dia com
  // nove pendências e o único conflito na sétima linha é um conflito que ninguém
  // lê — e conflito é a única coisa aqui que quebra o dia de verdade.
  return problemas.sort((a, b) => Number(b.nivel === 'erro') - Number(a.nivel === 'erro'))
}
