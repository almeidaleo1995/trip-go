'use client'

// Tela de abertura. É a que abre no aeroporto, então responde as perguntas na
// ordem em que importam: quanto falta, o que vem agora, o que precisa de
// atenção, e o que mudou.
import {
  CalendarDays,
  MapPin,
  Globe,
  Plane,
  Building2,
  FileText,
  ClipboardCheck,
  Wallet,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { MapaRota } from '../MapaRota.tsx'
import { Cartao, Rotulo, Badge, Progresso, CartaoEstatistica } from '../ui.tsx'
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
  const primeiroNome = String(snapshot.eu.usuario?.nome ?? '').split(' ')[0] || 'viajante'

  const voos = (snapshot.voos ?? []) as any[]
  const hospedagens = ((snapshot.reservas ?? []) as any[]).filter((r) => r.tipo === 'hospedagem')
  const documentos = (snapshot.documentos ?? []) as any[]
  const documentosPendentes = documentos.filter((d) => !d.valor).length
  const documentosPct = documentos.length
    ? Math.round(((documentos.length - documentosPendentes) / documentos.length) * 100)
    : null

  const meus = Object.fromEntries(
    snapshot.checklist_state
      .filter((e) => e.traveler_id === snapshot.eu.participanteId)
      .map((e) => [e.item_id, Boolean(e.feito)]),
  )
  const progresso = progressoChecklist(snapshot.checklist as { id: string }[], meus)

  const financeiro = snapshot.financeiro
  const custosPendentes = financeiro
    ? (financeiro.custos as any[]).filter((c) => !c.pago).length
    : 0
  const financeiroPct = financeiro && financeiro.custos.length
    ? Math.round(
        ((financeiro.custos as any[]).filter((c) => c.pago).length / financeiro.custos.length) *
          100,
      )
    : null

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

  const pendencias = [
    progresso.total - progresso.feitos > 0
      ? {
          icone: ClipboardCheck,
          aba: 'checklist' as AbaId,
          rotulo: `${progresso.total - progresso.feitos} ${
            progresso.total - progresso.feitos === 1 ? 'item' : 'itens'
          } do checklist`,
        }
      : null,
    documentosPendentes > 0
      ? {
          icone: FileText,
          aba: 'documentos' as AbaId,
          rotulo: `${documentosPendentes} ${
            documentosPendentes === 1 ? 'documento' : 'documentos'
          } a preencher`,
        }
      : null,
    financeiro && custosPendentes > 0
      ? {
          icone: Wallet,
          aba: 'financeiro' as AbaId,
          rotulo: `${custosPendentes} ${custosPendentes === 1 ? 'despesa' : 'despesas'} a pagar`,
        }
      : null,
  ].filter(Boolean) as { icone: React.ElementType; aba: AbaId; rotulo: string }[]

  const barras = [
    progresso.total > 0 ? { rotulo: 'Checklist', pct: progresso.pct } : null,
    documentosPct !== null ? { rotulo: 'Documentos', pct: documentosPct } : null,
    financeiroPct !== null ? { rotulo: 'Financeiro', pct: financeiroPct } : null,
  ].filter(Boolean) as { rotulo: string; pct: number }[]

  return (
    <div className="space-y-4">
      {/* saudação */}
      <div>
        <h1 className="text-[22px] leading-tight font-semibold">Olá, {primeiroNome}! 👋</h1>
        <p className="text-sm text-[--color-tinta-2]">Sua próxima aventura começa aqui.</p>
      </div>

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

      {/* herói: contagem + mapa + próximo compromisso */}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Cartao className="!p-0 overflow-hidden">
          <div className="grid gap-0 sm:grid-cols-2">
            <div
              className="flex flex-col justify-center p-6 text-white"
              style={{
                background: 'linear-gradient(135deg, var(--destaque), var(--color-destaque-escuro))',
              }}
            >
              <p className="text-[11px] font-semibold tracking-[0.08em] uppercase opacity-80">
                {v.subtitulo ? String(v.subtitulo) : String(v.nome ?? 'Sua viagem')}
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
            <div className="min-h-[220px] p-3">
              <MapaRota lugares={snapshot.lugares as any[]} />
            </div>
          </div>
        </Cartao>

        <Cartao onClick={() => irPara('roteiro')} className="flex flex-col justify-center">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Rotulo>Próximo compromisso</Rotulo>
              {proximo ? (
                <>
                  <p className="mt-1.5 truncate text-lg font-semibold">{String(proximo.titulo)}</p>
                  <p className="tab-num mt-1 text-sm text-[--color-tinta-2]">
                    {formatarData(proximo.ocorre_em)} · {formatarHora(proximo.ocorre_em)}
                    {proximo.cidade ? ` · ${proximo.cidade}` : ''}
                  </p>
                </>
              ) : (
                <p className="mt-1.5 text-[--color-tinta-2]">Sem compromissos futuros</p>
              )}
            </div>
            <ChevronRight size={20} className="shrink-0 text-[--color-tinta-3]" />
          </div>
        </Cartao>
      </div>

      {/* resumo da viagem */}
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        <CartaoEstatistica icone={CalendarDays} numero={fase.totalDias} rotulo="dias" />
        <CartaoEstatistica
          icone={Globe}
          numero={paises}
          rotulo={paises === 1 ? 'país' : 'países'}
        />
        <CartaoEstatistica
          icone={MapPin}
          numero={cidades}
          rotulo={cidades === 1 ? 'cidade' : 'cidades'}
        />
        <CartaoEstatistica
          icone={Plane}
          numero={voos.length}
          rotulo={voos.length === 1 ? 'voo' : 'voos'}
          onClick={() => irPara('voos')}
        />
        <CartaoEstatistica
          icone={Building2}
          numero={hospedagens.length}
          rotulo="hospedagens"
          onClick={() => irPara('hospedagem')}
        />
        <CartaoEstatistica
          icone={FileText}
          numero={documentos.length}
          rotulo="documentos"
          onClick={() => irPara('documentos')}
        />
      </div>

      {/* pendências + progresso */}
      {(pendencias.length > 0 || barras.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {pendencias.length > 0 && (
            <Cartao>
              <Rotulo>Pendências importantes</Rotulo>
              <div className="mt-2 divide-y divide-[--color-borda]">
                {pendencias.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => irPara(p.aba)}
                    className="toque flex w-full cursor-pointer items-center gap-3 py-2.5 text-left"
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: 'var(--color-alerta-bg)', color: 'var(--color-alerta-ink)' }}
                    >
                      <p.icone size={15} />
                    </span>
                    <span className="flex-1 text-sm font-medium">{p.rotulo}</span>
                    <ChevronRight size={16} className="shrink-0 text-[--color-tinta-3]" />
                  </button>
                ))}
              </div>
            </Cartao>
          )}

          {barras.length > 0 && (
            <Cartao>
              <Rotulo>Progresso geral</Rotulo>
              <div className="mt-3 space-y-3">
                {barras.map((b) => (
                  <div key={b.rotulo}>
                    <div className="mb-1 flex items-baseline justify-between text-sm">
                      <span className="font-medium">{b.rotulo}</span>
                      <span className="tab-num text-[--color-tinta-3]">{b.pct}%</span>
                    </div>
                    <Progresso pct={b.pct} />
                  </div>
                ))}
              </div>
            </Cartao>
          )}
        </div>
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
