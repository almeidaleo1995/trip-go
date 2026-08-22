'use client'

// Tela de abertura. É a que abre no aeroporto, então responde três perguntas na
// ordem em que importam: quanto falta, o que vem agora, e o que mudou.
import { CalendarDays, MapPin, Globe, ChevronRight, AlertTriangle } from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { MapaRota } from '../MapaRota.tsx'
import { Cartao, Rotulo, Badge, Progresso } from '../ui.tsx'
import type { AbaId } from '../Shell.tsx'
import {
  faseDaViagem,
  proximoCompromisso,
  ordenarEventos,
  contarLugares,
  progressoChecklist,
  formatarData,
  formatarHora,
  parseData,
} from '@/lib/derive.ts'

export function Inicio({ irPara }: { irPara: (a: AbaId) => void }) {
  const { snapshot } = useTrip()
  if (!snapshot?.viagem) return null
  const v = snapshot.viagem

  const agora = new Date()
  const fase = faseDaViagem(agora, v.data_partida, v.data_retorno)
  const proximo = proximoCompromisso(snapshot.roteiro as any[], agora)
  const { cidades, paises } = contarLugares(snapshot.lugares as any[])

  const meus = Object.fromEntries(
    snapshot.checklist_state
      .filter((e) => e.traveler_id === snapshot.sessao.travelerId)
      .map((e) => [e.item_id, Boolean(e.feito)]),
  )
  const progresso = progressoChecklist(snapshot.checklist as { id: string }[], meus)

  // Alterações das últimas 48h — é como o grupo descobre que algo mudou.
  const recentes = snapshot.alteracoes.filter((a) => {
    const t = new Date(String(a.criado_em)).getTime()
    return Number.isFinite(t) && Date.now() - t < 48 * 3600 * 1000
  })

  const proximosDias = ordenarEventos(snapshot.roteiro as any[])
    .filter((e) => {
      const d = parseData(e.ocorre_em)
      return d ? d.getTime() >= agora.getTime() : false
    })
    .slice(0, 4)

  return (
    <div className="space-y-4">
      {recentes.length > 0 && (
        <Cartao className="!border-[--color-alerta-bg] !bg-[--color-alerta-bg]">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[--color-alerta-ink]" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[--color-alerta-ink]">
                {recentes.length === 1
                  ? '1 alteração recente'
                  : `${recentes.length} alterações recentes`}
              </p>
              <ul className="mt-1.5 space-y-1">
                {recentes.slice(0, 3).map((a) => (
                  <li key={String(a.id)} className="text-[13px] text-[--color-alerta-ink]">
                    <span className="font-medium">{String(a.entidade)}</span>
                    {a.campo && a.campo !== '(registro)' ? ` · ${a.campo}: ` : ' · '}
                    {a.para ? String(a.para).slice(0, 48) : '—'}
                    <span className="opacity-70"> · {a.autor ? String(a.autor) : 'alguém'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Cartao>
      )}

      {/* herói: contagem + mapa */}
      <Cartao className="!p-0 overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div
            className="flex flex-col justify-center p-6 text-white"
            style={{
              background: 'linear-gradient(135deg, var(--destaque), var(--color-destaque-escuro))',
            }}
          >
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase opacity-80">
              {v.subtitulo ? String(v.subtitulo) : 'Sua viagem'}
            </p>
            {fase.fase === 'antes' && (
              <>
                <p className="mt-3 text-sm opacity-90">Faltam</p>
                <p className="tab-num text-[56px] leading-none font-bold">
                  {fase.diasRestantes}
                  <span className="ml-2 text-xl font-medium opacity-90">
                    {fase.diasRestantes === 1 ? 'dia' : 'dias'}
                  </span>
                </p>
              </>
            )}
            {fase.fase === 'durante' && (
              <>
                <p className="mt-3 text-sm opacity-90">Viagem em andamento</p>
                <p className="tab-num text-[44px] leading-none font-bold">
                  Dia {fase.diaAtual}
                  <span className="ml-2 text-xl font-medium opacity-90">de {fase.totalDias}</span>
                </p>
              </>
            )}
            {fase.fase === 'depois' && (
              <p className="mt-3 text-[32px] leading-tight font-bold">Viagem concluída</p>
            )}
            <p className="mt-4 text-[13px] opacity-85">
              {formatarData(v.data_partida, { day: '2-digit', month: 'short' })} —{' '}
              {formatarData(v.data_retorno, { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <div className="p-3">
            <MapaRota lugares={snapshot.lugares as any[]} />
          </div>
        </div>
      </Cartao>

      {/* próximo compromisso */}
      <Cartao onClick={() => irPara('roteiro')}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Rotulo>Próximo compromisso</Rotulo>
            {proximo ? (
              <>
                <p className="mt-1 truncate font-semibold">{String(proximo.titulo)}</p>
                <p className="tab-num mt-0.5 text-sm text-[--color-tinta-2]">
                  {formatarData(proximo.ocorre_em)} · {formatarHora(proximo.ocorre_em)}
                  {proximo.cidade ? ` · ${proximo.cidade}` : ''}
                </p>
              </>
            ) : (
              <p className="mt-1 text-[--color-tinta-2]">Sem compromissos futuros</p>
            )}
          </div>
          <ChevronRight size={20} className="shrink-0 text-[--color-tinta-3]" />
        </div>
      </Cartao>

      {/* resumo */}
      <div className="grid grid-cols-3 gap-3">
        <Estatistica icone={CalendarDays} numero={fase.totalDias} rotulo="dias" />
        <Estatistica
          icone={MapPin}
          numero={cidades}
          rotulo={cidades === 1 ? 'cidade' : 'cidades'}
        />
        <Estatistica icone={Globe} numero={paises} rotulo={paises === 1 ? 'país' : 'países'} />
      </div>

      {/* checklist */}
      {progresso.total > 0 && (
        <Cartao onClick={() => irPara('checklist')}>
          <div className="mb-2 flex items-baseline justify-between">
            <Rotulo>Seu checklist</Rotulo>
            <span className="tab-num text-sm font-semibold">
              {progresso.feitos}/{progresso.total} · {progresso.pct}%
            </span>
          </div>
          <Progresso pct={progresso.pct} />
        </Cartao>
      )}

      {/* roteiro em destaque */}
      {proximosDias.length > 0 && (
        <Cartao>
          <div className="mb-3 flex items-center justify-between">
            <Rotulo>Roteiro em destaque</Rotulo>
            <button
              onClick={() => irPara('roteiro')}
              className="cursor-pointer text-sm font-medium"
              style={{ color: 'var(--destaque)' }}
            >
              Ver tudo →
            </button>
          </div>
          <ul className="divide-y divide-[--color-borda]">
            {proximosDias.map((e) => (
              <li key={String(e.id)} className="flex items-center gap-3 py-2.5">
                <div className="w-11 shrink-0 text-center">
                  <p className="tab-num text-[15px] leading-none font-bold">
                    {formatarData(e.ocorre_em, { day: '2-digit' })}
                  </p>
                  <p className="mt-0.5 text-[10px] tracking-wide text-[--color-tinta-3] uppercase">
                    {formatarData(e.ocorre_em, { month: 'short' }).replace('.', '')}
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{String(e.titulo)}</p>
                  <p className="tab-num truncate text-[13px] text-[--color-tinta-3]">
                    {formatarHora(e.ocorre_em)}
                    {e.cidade ? ` · ${e.cidade}` : ''}
                  </p>
                </div>
                <Badge tipo={String(e.tipo)} />
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  )
}

function Estatistica({
  icone: Icone,
  numero,
  rotulo,
}: {
  icone: React.ElementType
  numero: number
  rotulo: string
}) {
  return (
    <Cartao className="text-center">
      <Icone size={18} className="mx-auto mb-1.5" style={{ color: 'var(--destaque)' }} />
      <p className="tab-num text-2xl leading-none font-bold">{numero}</p>
      <p className="mt-1 text-xs text-[--color-tinta-3]">{rotulo}</p>
    </Cartao>
  )
}
