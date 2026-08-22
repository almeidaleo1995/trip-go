'use client'

// Cartão de viagem usado no Início e em Minhas viagens. Existe uma vez para que
// as duas telas não descrevam a mesma viagem de dois jeitos diferentes.
import { CalendarDays, Users, Globe, ChevronRight } from 'lucide-react'
import { faseDaViagem, formatarData, formatarRelativo, statusViagem } from '@/lib/derive.ts'
import type { StatusViagem } from '@/lib/derive.ts'
import { CapaViagem } from './CapaViagem.tsx'
import { Badge, Progresso } from './ui.tsx'

export type ViagemResumo = {
  id: string
  nome: string
  subtitulo?: string | null
  descricao?: string | null
  data_partida: string
  data_retorno: string
  moeda?: string
  cor_destaque?: string
  capa_url?: string | null
  arquivada?: boolean
  papel?: 'proprietario' | 'editor' | 'visualizador'
  participantes: number
  /** Contagens vindas de /api/viagens. Ausentes só em respostas antigas. */
  cidades?: number
  paises?: number
  compromissos?: number
  reservas?: number
  tarefas?: number
  tarefas_feitas?: number
  atualizada_em?: string
  /** Cidades e países da viagem, concatenados. Só a busca lê isto. */
  destinos?: string | null
}

/** Rótulo e tom de cada status. Os tons são pares ink/bg já medidos em ui.tsx. */
export const ROTULO_STATUS: Record<StatusViagem, { texto: string; tom: string }> = {
  planejando: { texto: 'Planejando', tom: 'info' },
  proxima: { texto: 'Próxima', tom: 'sucesso' },
  andamento: { texto: 'Em andamento', tom: 'atencao' },
  concluida: { texto: 'Concluída', tom: 'neutro' },
  arquivada: { texto: 'Arquivada', tom: 'neutro' },
}

/** A frase de contagem: o que muda de um cartão para o outro. */
export function contagem(v: ViagemResumo): string {
  const f = faseDaViagem(new Date(), v.data_partida, v.data_retorno)
  if (f.fase === 'durante') return `Dia ${f.diaAtual} de ${f.totalDias}`
  if (f.fase === 'depois') return `${f.totalDias} ${f.totalDias === 1 ? 'dia' : 'dias'} de viagem`
  if (f.diasRestantes === 0) return 'Parte hoje'
  return `Faltam ${f.diasRestantes} ${f.diasRestantes === 1 ? 'dia' : 'dias'}`
}

export function periodo(v: ViagemResumo): string {
  return `${formatarData(v.data_partida, { day: '2-digit', month: 'short' })} — ${formatarData(
    v.data_retorno,
    { day: '2-digit', month: 'short', year: 'numeric' },
  )}`
}

export function CartaoViagem({
  viagem,
  acoes,
  href,
}: {
  viagem: ViagemResumo
  /** Menu de ações, ancorado no canto da capa. */
  acoes?: React.ReactNode
  href?: string
}) {
  const cor = viagem.cor_destaque || '#0F766E'
  const status = statusViagem(
    new Date(),
    viagem.data_partida,
    viagem.data_retorno,
    viagem.arquivada,
  )
  const rotulo = ROTULO_STATUS[status]
  const f = faseDaViagem(new Date(), viagem.data_partida, viagem.data_retorno)
  const total = viagem.tarefas ?? 0
  const pct = total > 0 ? Math.round(((viagem.tarefas_feitas ?? 0) / total) * 100) : null

  return (
    <div
      style={{ ['--destaque' as string]: cor }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-(--color-borda) bg-(--color-cartao) shadow-[var(--sombra-1)] transition-shadow hover:shadow-[var(--sombra-2)]"
    >
      <a href={href ?? `/viagens/${viagem.id}`} className="flex flex-1 flex-col">
        {/* A capa não tem texto em cima: assim nenhum contraste depende da arte. */}
        <div className="relative h-24 shrink-0 overflow-hidden">
          <CapaViagem cor={cor} semente={viagem.id} url={viagem.capa_url} />
        </div>

        <div className="flex flex-1 flex-col p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="t-cartao truncate text-base">{viagem.nome}</p>
              {viagem.subtitulo && <p className="t-aux truncate">{String(viagem.subtitulo)}</p>}
            </div>
            <Badge tipo={rotulo.tom} texto={rotulo.texto} />
          </div>

          <div className="space-y-1.5 text-sm text-(--color-tinta-2)">
            <p className="tab-num flex items-center gap-2">
              <CalendarDays size={14} className="shrink-0 text-(--color-tinta-3)" />
              {periodo(viagem)}
            </p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="flex items-center gap-2">
                <Users size={14} className="shrink-0 text-(--color-tinta-3)" />
                {viagem.participantes}{' '}
                {viagem.participantes === 1 ? 'participante' : 'participantes'}
              </span>
              {(viagem.paises ?? 0) > 0 && (
                <span className="flex items-center gap-1.5">
                  <Globe size={14} className="shrink-0 text-(--color-tinta-3)" />
                  {viagem.paises} {viagem.paises === 1 ? 'país' : 'países'}
                </span>
              )}
              {f.totalDias > 0 && <span>· {f.totalDias} dias</span>}
            </p>
          </div>

          {pct !== null && (
            <div className="mt-3">
              <div className="mb-1 flex items-baseline justify-between text-[12px] text-(--color-tinta-3)">
                <span>Preparação</span>
                <span className="tab-num font-semibold text-(--color-tinta-2)">{pct}%</span>
              </div>
              <Progresso pct={pct} rotulo={`Preparação de ${viagem.nome}`} />
            </div>
          )}

          <div className="mt-3 flex items-end justify-between gap-2 pt-1">
            <div className="min-w-0">
              <p className="text-sm font-semibold" style={{ color: 'var(--destaque)' }}>
                {contagem(viagem)}
              </p>
              {viagem.atualizada_em && (
                <p className="text-[12px] text-(--color-tinta-3)">
                  Atualizada {formatarRelativo(viagem.atualizada_em)}
                </p>
              )}
            </div>
            <ChevronRight
              size={18}
              className="shrink-0 text-(--color-tinta-3) transition-transform group-hover:translate-x-0.5"
            />
          </div>
        </div>
      </a>

      {acoes && <div className="absolute top-3 right-3 flex gap-1">{acoes}</div>}
    </div>
  )
}
