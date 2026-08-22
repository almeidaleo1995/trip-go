'use client'

import { useEffect, useState } from 'react'
import { Plus, Plane, CalendarClock } from 'lucide-react'
import { DashboardLayout } from '@/components/DashboardLayout.tsx'
import { CartaoViagem, type ViagemResumo } from '@/components/CartaoViagem.tsx'
import { Carregando, Vazio, Botao, Cartao, Rotulo } from '@/components/ui.tsx'
import { faseDaViagem, formatarData } from '@/lib/derive.ts'

export default function Dashboard() {
  const [viagens, setViagens] = useState<ViagemResumo[]>([])
  const [nome, setNome] = useState('')
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    fetch('/api/viagens')
      .then((r) => r.json())
      .then((d) => {
        setViagens(d.viagens || [])
        setNome(String(d.eu?.nome ?? '').split(' ')[0] || '')
      })
      .catch(() => {})
      .finally(() => setCarregando(false))
  }, [])

  if (carregando) return <Carregando texto="Carregando suas viagens…" />

  // A viagem em foco é a que está acontecendo, ou a próxima a partir. Viagem
  // concluída nunca rouba o topo da tela.
  const emFoco = [...viagens]
    .map((v) => ({ v, f: faseDaViagem(new Date(), v.data_partida, v.data_retorno) }))
    .filter((x) => x.f.fase !== 'depois')
    .sort((a, b) => a.f.diasRestantes - b.f.diasRestantes)[0]

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-[26px] leading-tight font-semibold">
            {nome ? `Olá, ${nome}! 👋` : 'Olá! 👋'}
          </h1>
          <p className="mt-1 text-sm text-(--color-tinta-2)">
            Sua próxima aventura começa aqui.
          </p>
        </div>

        {viagens.length === 0 ? (
          <Vazio
            titulo="Nenhuma viagem ainda"
            texto="Crie a primeira e comece a montar o roteiro, o checklist e as reservas."
            acao={
              <a href="/viagens">
                <Botao>
                  <Plus size={16} /> Criar viagem
                </Botao>
              </a>
            }
          />
        ) : (
          <>
            {emFoco && (
              <Cartao className="mb-6 !p-0 overflow-hidden">
                <div className="grid sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div
                    className="p-6 text-white"
                    style={{
                      background:
                        'linear-gradient(135deg, var(--destaque), var(--color-destaque-escuro))',
                    }}
                  >
                    <p className="text-[11px] font-semibold tracking-[0.08em] uppercase opacity-80">
                      {emFoco.f.fase === 'durante' ? 'Viagem em andamento' : 'Próxima viagem'}
                    </p>
                    <p className="mt-2 text-2xl leading-tight font-bold">{emFoco.v.nome}</p>
                    <p className="tab-num mt-1 text-[13px] opacity-85">
                      {formatarData(emFoco.v.data_partida, { day: '2-digit', month: 'short' })} —{' '}
                      {formatarData(emFoco.v.data_retorno, {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                    <a
                      href={`/viagens/${emFoco.v.id}`}
                      className="toque mt-4 inline-flex items-center gap-2 rounded-2xl bg-white/15 px-4 text-sm font-semibold backdrop-blur transition-colors hover:bg-white/25"
                    >
                      <Plane size={15} /> Abrir viagem
                    </a>
                  </div>
                  <div className="flex flex-row items-center justify-around gap-6 p-6 sm:flex-col sm:justify-center">
                    <div className="text-center">
                      <Rotulo>
                        {emFoco.f.fase === 'durante' ? 'Dia atual' : 'Faltam'}
                      </Rotulo>
                      <p className="tab-num mt-1 text-4xl leading-none font-bold">
                        {emFoco.f.fase === 'durante' ? emFoco.f.diaAtual : emFoco.f.diasRestantes}
                      </p>
                      <p className="mt-1 text-xs text-(--color-tinta-3)">
                        {emFoco.f.fase === 'durante' ? `de ${emFoco.f.totalDias}` : 'dias'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-(--color-tinta-2)">
                      <CalendarClock size={15} className="text-(--color-tinta-3)" />
                      {emFoco.f.totalDias} dias de viagem
                    </div>
                  </div>
                </div>
              </Cartao>
            )}

            <div className="mb-3 flex items-end justify-between">
              <Rotulo>Todas as viagens</Rotulo>
              <a
                href="/viagens"
                className="text-sm font-medium"
                style={{ color: 'var(--destaque)' }}
              >
                Gerenciar →
              </a>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {viagens.map((v) => (
                <CartaoViagem key={v.id} viagem={v} />
              ))}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
