// Resolucao e deduplicacao de sugestoes de checklist vindas da skill
// roteiro-trip-go. Zero I/O, zero React, zero rede - so entra dado e sai dado,
// no mesmo espirito de lib/derive.ts.
import type { z } from 'zod'
import type { ChecklistSugestaoSchema } from './schema.ts'

type ChecklistSugestao = z.infer<typeof ChecklistSugestaoSchema>

const MARCAS_DIACRITICAS = /[̀-ͯ]/g

/**
 * Normaliza um titulo para comparacao: minusculo, sem acento, sem espaco nas
 * pontas, espacos internos colapsados. Base da deduplicacao (CHK-14) -
 * "Passaporte  válido" e "passaporte valido" tem que colidir.
 */
export function normalizarTitulo(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(MARCAS_DIACRITICAS, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

// ---------------------------------------------------------------- resolucao de sugestoes

/** Só o que `resolverSugestoes` precisa da viagem — não o Snapshot inteiro,
    para este arquivo continuar sem depender de lib/db.ts. */
export type ContextoResolucao = {
  participantes: { id: string; nome: string }[]
  roteiro: { id: string; titulo: string }[]
  voos: { id: string; companhia: string; numero?: string | null }[]
  cruzeiros: { id: string; navio: string }[]
  checklistExistente: { titulo: string }[]
}

export type ChecklistItemCriar = {
  titulo: string
  categoria?: string | null
  escopo: 'global' | 'pessoal'
  assigned_to: string[]
  prioridade: ChecklistSugestao['prioridade']
  pais?: string | null
  cidade?: string | null
  itinerary_event_id: string | null
  flight_id: string | null
  cruise_id: string | null
  pendente: true
  fonte_tipo: ChecklistSugestao['fonte_tipo']
  fonte_detalhe?: string | null
  fonte_consultado_em?: string | null
  prazo_ideal?: string | null
  prazo_maximo?: string | null
}

export type ErroSugestao = { sugestao: ChecklistSugestao; motivo: string }

export type ResultadoResolucao = {
  validas: ChecklistItemCriar[]
  erros: ErroSugestao[]
  /** Quantas sugestões bateram um título já existente (no checklist ou no
      próprio lote) e foram descartadas em silêncio, sem virar erro. */
  duplicadas: number
}

/**
 * Resolve nomes -> ids contra a viagem atual, deduplica por título normalizado
 * e separa o que pode virar `criar` de `checklist_item` (pendente) do que precisa
 * de correção antes (CHK-11, CHK-14, CHK-18, CHK-19).
 *
 * Vínculo de evento/voo/cruzeiro que não bate nada não é erro — o item entra sem
 * o vínculo (mesma tolerância que reserva/documento já têm na importação cheia).
 * Participante que não bate É erro: sem dono certo, `assigned_to` estaria errado.
 */
export function resolverSugestoes(
  sugestoes: ChecklistSugestao[],
  contexto: ContextoResolucao,
): ResultadoResolucao {
  const idPorNome = new Map(contexto.participantes.map((p) => [normalizarTitulo(p.nome), p.id]))
  const idPorEvento = new Map(contexto.roteiro.map((e) => [normalizarTitulo(e.titulo), e.id]))
  const idPorVoo = new Map(
    contexto.voos.map((v) => [normalizarTitulo(`${v.companhia} ${v.numero ?? ''}`), v.id]),
  )
  const idPorCruzeiro = new Map(contexto.cruzeiros.map((c) => [normalizarTitulo(c.navio), c.id]))

  const titulosVistos = new Set(contexto.checklistExistente.map((c) => normalizarTitulo(c.titulo)))

  const validas: ChecklistItemCriar[] = []
  const erros: ErroSugestao[] = []
  let duplicadas = 0

  for (const s of sugestoes) {
    const tituloNorm = normalizarTitulo(s.titulo)
    if (titulosVistos.has(tituloNorm)) {
      duplicadas++
      continue
    }

    const assignedTo: string[] = []
    const naoResolvidos: string[] = []
    for (const nome of s.assigned_to_nomes) {
      const id = idPorNome.get(normalizarTitulo(nome))
      if (id) assignedTo.push(id)
      else naoResolvidos.push(nome)
    }
    if (naoResolvidos.length > 0) {
      erros.push({ sugestao: s, motivo: `participante não encontrado: ${naoResolvidos.join(', ')}` })
      continue
    }
    if (s.escopo === 'pessoal' && assignedTo.length === 0) {
      erros.push({ sugestao: s, motivo: 'item pessoal sem nenhum participante em assigned_to_nomes' })
      continue
    }

    titulosVistos.add(tituloNorm)
    validas.push({
      titulo: s.titulo,
      categoria: s.categoria,
      escopo: s.escopo,
      assigned_to: assignedTo,
      prioridade: s.prioridade,
      pais: s.pais,
      cidade: s.cidade,
      itinerary_event_id: s.evento ? (idPorEvento.get(normalizarTitulo(s.evento)) ?? null) : null,
      flight_id: s.voo ? (idPorVoo.get(normalizarTitulo(s.voo)) ?? null) : null,
      cruise_id: s.cruzeiro ? (idPorCruzeiro.get(normalizarTitulo(s.cruzeiro)) ?? null) : null,
      pendente: true,
      fonte_tipo: s.fonte_tipo,
      fonte_detalhe: s.fonte_detalhe,
      fonte_consultado_em: s.fonte_consultado_em,
      prazo_ideal: s.prazo_ideal,
      prazo_maximo: s.prazo_maximo,
    })
  }

  return { validas, erros, duplicadas }
}
