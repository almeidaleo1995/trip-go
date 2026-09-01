'use client'

// Página da viagem: casca de abas (Shell) + estado (TripProvider) + o conteúdo
// de cada aba. É a mesma composição do antigo app de viagem única, agora presa
// a um :id da URL em vez de "a viagem atual" implícita.
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { MapPinOff } from 'lucide-react'
import { Carregando } from '@/components/ui.tsx'
import { TripProvider, useTrip } from '@/components/TripProvider.tsx'
import { Shell, type AbaId } from '@/components/Shell.tsx'
import { PdfBolso } from '@/components/PdfBolso.tsx'
import { Inicio } from '@/components/tabs/Inicio.tsx'
import { Roteiro } from '@/components/tabs/Roteiro.tsx'
import { Voos, Cruzeiro, Hospedagem, Lugares } from '@/components/tabs/Conteudo.tsx'
import { Documentos } from '@/components/tabs/Documentos.tsx'
import { Emergencia } from '@/components/tabs/Interativas.tsx'
import { Checklist } from '@/components/tabs/Checklist.tsx'
import { Preparacao } from '@/components/tabs/Preparacao.tsx'
import { Financeiro } from '@/components/tabs/Financeiro.tsx'
import { Dados } from '@/components/tabs/Dados.tsx'
import { AssistenteAba } from '@/components/tabs/AssistenteAba.tsx'
import { Consumo } from '@/components/tabs/Consumo.tsx'
import { Hoje } from '@/components/tabs/Hoje.tsx'

export default function ViagemPagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  // Registra o service worker uma vez por visita à área da viagem. Falhar aqui
  // só custa o modo offline, nunca a tela.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  return (
    <TripProvider tripId={id} aoSair={() => router.push('/login')}>
      <App />
    </TripProvider>
  )
}

function App() {
  const [aba, setAba] = useState<AbaId>('inicio')
  const { snapshot, carregando } = useTrip()

  if (carregando && !snapshot) return <Carregando />

  if (!snapshot?.viagem) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-(--color-fundo) p-6">
        <div className="max-w-sm rounded-2xl border border-(--color-borda) bg-(--color-cartao) p-8 text-center shadow-[0_1px_3px_rgb(0_0_0/0.06)]">
          <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-(--color-alerta-bg) text-(--color-alerta-ink)">
            <MapPinOff size={20} />
          </span>
          <h1 className="text-lg font-semibold">Não deu para abrir esta viagem</h1>
          <p className="mt-2 text-sm text-(--color-tinta-2)">
            Ou ela não existe, ou sua conta não participa dela. Se já abriu uma vez com internet, os
            últimos dados sincronizados aparecem em modo avião.
          </p>
          <a
            href="/viagens"
            className="toque mt-5 inline-flex items-center justify-center rounded-2xl px-4 text-sm font-semibold text-white"
            style={{ background: 'var(--destaque)' }}
          >
            Ver minhas viagens
          </a>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="sem-impressao">
        <Shell aba={aba} setAba={setAba}>
          {aba === 'inicio' && <Inicio irPara={setAba} />}
          {aba === 'hoje' && <Hoje irPara={setAba} />}
          {aba === 'roteiro' && <Roteiro />}
          {aba === 'voos' && <Voos />}
          {aba === 'cruzeiro' && <Cruzeiro />}
          {aba === 'hospedagem' && <Hospedagem />}
          {aba === 'lugares' && <Lugares />}
          {aba === 'preparacao' && <Preparacao irPara={setAba} />}
          {aba === 'checklist' && <Checklist irPara={setAba} />}
          {aba === 'documentos' && <Documentos />}
          {/* Mesma tela, rolada até a cobrança — ver ALIAS em Shell. */}
          {aba === 'documentacao' && <Documentos ancora="exigidos" />}
          {aba === 'emergencia' && <Emergencia />}
          {aba === 'financeiro' && <Financeiro />}
          {aba === 'dados' && <Dados />}
          {aba === 'assistente' && <AssistenteAba />}
          {aba === 'consumo' && <Consumo />}
        </Shell>
      </div>
      {/* Fora da casca: aparece só na impressão, de qualquer aba. */}
      <PdfBolso />
    </>
  )
}
