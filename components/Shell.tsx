'use client'

// Casca de navegação: tab bar embaixo no celular, barra lateral no desktop.
//
// A lista de abas é montada a partir dos DADOS, não fixa no código:
//   - Financeiro só existe para admin
//   - Cruzeiro só existe se a viagem tiver navio
// Aba que não existe não é escondida com CSS — o componente não monta.
import { useEffect, useState, type ReactNode } from 'react'
import {
  Home,
  Map,
  Plane,
  Ship,
  Building2,
  Globe,
  ClipboardCheck,
  FileText,
  LifeBuoy,
  Wallet,
  Database,
  LogOut,
  WifiOff,
  RefreshCw,
} from 'lucide-react'
import { useTrip } from './TripProvider.tsx'
import { formatarHora } from '@/lib/derive.ts'

export type AbaId =
  | 'inicio'
  | 'roteiro'
  | 'voos'
  | 'cruzeiro'
  | 'hospedagem'
  | 'lugares'
  | 'checklist'
  | 'documentos'
  | 'emergencia'
  | 'financeiro'
  | 'dados'

const ABAS = [
  { id: 'inicio', nome: 'Início', icone: Home },
  { id: 'roteiro', nome: 'Roteiro', icone: Map },
  { id: 'voos', nome: 'Voos', icone: Plane },
  { id: 'cruzeiro', nome: 'Cruzeiro', icone: Ship },
  { id: 'hospedagem', nome: 'Hospedagem', icone: Building2 },
  { id: 'lugares', nome: 'Cidades', icone: Globe },
  { id: 'checklist', nome: 'Checklist', icone: ClipboardCheck },
  { id: 'documentos', nome: 'Documentos', icone: FileText },
  { id: 'emergencia', nome: 'Emergência', icone: LifeBuoy },
  { id: 'financeiro', nome: 'Financeiro', icone: Wallet },
  { id: 'dados', nome: 'Dados', icone: Database },
] as const

const CHAVE_ABA = 'viagem:aba'

export function Shell({
  aba,
  setAba,
  children,
}: {
  aba: AbaId
  setAba: (a: AbaId) => void
  children: ReactNode
}) {
  const { snapshot, souAdmin, online, offlineOk, pendentes, ultimaSync, erro, sair } = useTrip()
  const [montado, setMontado] = useState(false)

  const temCruzeiro = (snapshot?.cruzeiros?.length ?? 0) > 0
  const visiveis = ABAS.filter((a) => {
    if (a.id === 'financeiro' || a.id === 'dados') return souAdmin
    if (a.id === 'cruzeiro') return temCruzeiro
    return true
  })

  // Restaura a aba escolhida (UI-06). Só depois de montar, para não divergir do
  // HTML renderizado no servidor.
  useEffect(() => {
    setMontado(true)
    try {
      const salva = sessionStorage.getItem(CHAVE_ABA) as AbaId | null
      if (salva && ABAS.some((a) => a.id === salva)) setAba(salva)
    } catch {
      /* sessionStorage bloqueado: começa no Início, sem drama */
    }
  }, [setAba])

  useEffect(() => {
    if (!montado) return
    try {
      sessionStorage.setItem(CHAVE_ABA, aba)
    } catch {
      /* idem */
    }
  }, [aba, montado])

  // Aba que deixou de existir (virou viajante, ou a viagem perdeu o cruzeiro).
  useEffect(() => {
    if (montado && !visiveis.some((a) => a.id === aba)) setAba('inicio')
  }, [aba, visiveis, montado, setAba])

  const destaque = snapshot?.viagem?.cor_destaque ?? '#0F766E'

  return (
    <div style={{ ['--destaque' as string]: destaque }} className="min-h-dvh">
      {/* barra lateral — desktop */}
      <aside className="sem-impressao fixed top-0 left-0 hidden h-dvh w-60 flex-col border-r border-[--color-borda] bg-[--color-cartao] md:flex">
        <div className="px-5 py-5">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-[--color-tinta-3] uppercase">
            Viagem
          </p>
          <p className="mt-1 leading-tight font-semibold">{snapshot?.viagem?.nome ?? '—'}</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-3">
          {visiveis.map((a) => (
            <ItemLateral key={a.id} aba={a} ativo={a.id === aba} onClick={() => setAba(a.id)} />
          ))}
        </nav>
        <button
          onClick={sair}
          className="toque m-3 flex cursor-pointer items-center gap-3 rounded-xl px-3 text-sm text-[--color-tinta-2] transition-colors hover:bg-[--color-fundo]"
        >
          <LogOut size={18} strokeWidth={1.75} /> Sair
        </button>
      </aside>

      <div className="md:pl-60">
        <Avisos
          online={online}
          offlineOk={offlineOk}
          pendentes={pendentes}
          ultimaSync={ultimaSync}
          erro={erro}
        />
        <main className="mx-auto max-w-5xl px-4 py-5 md:px-8 md:py-8">{children}</main>
      </div>

      {/* tab bar — celular. Rolagem horizontal porque são até 11 abas. */}
      <nav className="sem-impressao fixed inset-x-0 bottom-0 z-20 border-t border-[--color-borda] bg-[--color-cartao]/95 backdrop-blur md:hidden">
        <div
          className="flex overflow-x-auto"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {visiveis.map((a) => {
            const Icone = a.icone
            const ativo = a.id === aba
            return (
              <button
                key={a.id}
                onClick={() => setAba(a.id)}
                aria-current={ativo ? 'page' : undefined}
                className="toque flex shrink-0 cursor-pointer flex-col items-center gap-1 px-4 py-2"
                style={{ color: ativo ? 'var(--destaque)' : 'var(--color-tinta-3)' }}
              >
                <Icone size={20} strokeWidth={ativo ? 2.25 : 1.75} />
                <span className={`text-[10px] ${ativo ? 'font-semibold' : ''}`}>{a.nome}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

function ItemLateral({
  aba,
  ativo,
  onClick,
}: {
  aba: (typeof ABAS)[number]
  ativo: boolean
  onClick: () => void
}) {
  const Icone = aba.icone
  return (
    <button
      onClick={onClick}
      aria-current={ativo ? 'page' : undefined}
      className="toque flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm transition-colors"
      style={{
        background: ativo ? 'var(--color-destaque-fraco)' : 'transparent',
        color: ativo ? 'var(--destaque)' : 'var(--color-tinta-2)',
        fontWeight: ativo ? 600 : 400,
      }}
    >
      <Icone size={18} strokeWidth={ativo ? 2.25 : 1.75} />
      {aba.nome}
    </button>
  )
}

function Avisos({
  online,
  offlineOk,
  pendentes,
  ultimaSync,
  erro,
}: {
  online: boolean
  offlineOk: boolean
  pendentes: number
  ultimaSync: string | null
  erro: string | null
}) {
  const faixas: { texto: string; icone: ReactNode; tom: 'neutro' | 'alerta' }[] = []

  if (!online) {
    faixas.push({
      texto: ultimaSync ? `Offline · dados de ${formatarHora(ultimaSync.slice(0, 16))}` : 'Offline',
      icone: <WifiOff size={14} />,
      tom: 'neutro',
    })
  }
  if (pendentes > 0) {
    faixas.push({
      texto: `${pendentes} ${pendentes === 1 ? 'alteração pendente' : 'alterações pendentes'}`,
      icone: <RefreshCw size={14} />,
      tom: 'neutro',
    })
  }
  if (!offlineOk) {
    faixas.push({
      texto: 'Modo offline indisponível neste navegador',
      icone: <WifiOff size={14} />,
      tom: 'alerta',
    })
  }
  if (erro) faixas.push({ texto: erro, icone: <WifiOff size={14} />, tom: 'alerta' })

  if (faixas.length === 0) return null

  return (
    <div className="sem-impressao space-y-px">
      {faixas.map((f, i) => (
        <div
          key={i}
          className="flex items-center justify-center gap-2 px-4 py-1.5 text-[12px]"
          style={{
            background: f.tom === 'alerta' ? 'var(--color-alerta-bg)' : 'var(--color-borda)',
            color: f.tom === 'alerta' ? 'var(--color-alerta-ink)' : 'var(--color-tinta-2)',
          }}
        >
          {f.icone}
          {f.texto}
        </div>
      ))}
    </div>
  )
}
