'use client'

// Cartão de viagem usado no Início e em Minhas viagens. Existe uma vez para que
// as duas telas não descrevam a mesma viagem de dois jeitos diferentes.
import { CalendarDays, Users, ChevronRight } from 'lucide-react'
import { faseDaViagem, formatarData } from '@/lib/derive.ts'

export type ViagemResumo = {
  id: string
  nome: string
  subtitulo?: string | null
  data_partida: string
  data_retorno: string
  moeda?: string
  participantes: number
}

/** Faixa de status derivada das datas: é o que diferencia um cartão do outro. */
function status(v: ViagemResumo) {
  const fase = faseDaViagem(new Date(), v.data_partida, v.data_retorno)
  if (fase.fase === 'antes')
    return {
      texto:
        fase.diasRestantes === 0
          ? 'Parte hoje'
          : `Faltam ${fase.diasRestantes} ${fase.diasRestantes === 1 ? 'dia' : 'dias'}`,
      bg: 'var(--color-destaque-fraco)',
      ink: 'var(--color-voo-ink)',
    }
  if (fase.fase === 'durante')
    return {
      texto: `Dia ${fase.diaAtual} de ${fase.totalDias}`,
      bg: 'var(--color-hosp-bg)',
      ink: 'var(--color-hosp-ink)',
    }
  return { texto: 'Concluída', bg: 'var(--color-borda)', ink: 'var(--color-tinta-2)' }
}

export function CartaoViagem({ viagem, acoes }: { viagem: ViagemResumo; acoes?: React.ReactNode }) {
  const s = status(viagem)
  const fase = faseDaViagem(new Date(), viagem.data_partida, viagem.data_retorno)

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-[--color-borda] bg-[--color-cartao] shadow-[0_1px_3px_rgb(0_0_0/0.06)] transition-shadow hover:shadow-[0_4px_16px_rgb(0_0_0/0.08)]">
      <a href={`/viagens/${viagem.id}`} className="block">
        {/* faixa colorida — dá identidade ao cartão sem precisar de foto */}
        <div
          className="flex h-24 items-end p-4 text-white"
          style={{
            background: 'linear-gradient(135deg, var(--destaque), var(--color-destaque-escuro))',
          }}
        >
          <div className="min-w-0">
            <p className="truncate text-lg leading-tight font-bold">{viagem.nome}</p>
            {viagem.subtitulo && (
              <p className="truncate text-[13px] opacity-85">{String(viagem.subtitulo)}</p>
            )}
          </div>
        </div>

        <div className="p-4">
          <span
            className="inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: s.bg, color: s.ink }}
          >
            {s.texto}
          </span>

          <div className="mt-3 space-y-1.5 text-sm text-[--color-tinta-2]">
            <p className="tab-num flex items-center gap-2">
              <CalendarDays size={14} className="shrink-0 text-[--color-tinta-3]" />
              {formatarData(viagem.data_partida, { day: '2-digit', month: 'short' })} —{' '}
              {formatarData(viagem.data_retorno, {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </p>
            <p className="flex items-center gap-2">
              <Users size={14} className="shrink-0 text-[--color-tinta-3]" />
              {viagem.participantes}{' '}
              {viagem.participantes === 1 ? 'participante' : 'participantes'}
              {fase.totalDias > 0 ? ` · ${fase.totalDias} dias` : ''}
            </p>
          </div>

          <span
            className="mt-3 inline-flex items-center gap-1 text-sm font-semibold"
            style={{ color: 'var(--destaque)' }}
          >
            Abrir viagem
            <ChevronRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </a>

      {acoes && <div className="absolute top-3 right-3 flex gap-1">{acoes}</div>}
    </div>
  )
}
