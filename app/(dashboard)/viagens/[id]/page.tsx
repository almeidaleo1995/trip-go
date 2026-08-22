'use client'

// Página da viagem: casca de abas (Shell) + estado (TripProvider) + o conteúdo
// de cada aba. É a mesma composição do antigo app de viagem única, agora presa
// a um :id da URL em vez de "a viagem atual" implícita.
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { TripProvider, useTrip } from '@/components/TripProvider.tsx'
import { Shell, type AbaId } from '@/components/Shell.tsx'
import { PdfBolso } from '@/components/PdfBolso.tsx'
import { Inicio } from '@/components/tabs/Inicio.tsx'
import { Roteiro, Voos, Cruzeiro, Hospedagem, Lugares, Documentos } from '@/components/tabs/Conteudo.tsx'
import { Emergencia, Checklist, Financeiro } from '@/components/tabs/Interativas.tsx'
import { Dados } from '@/components/tabs/Dados.tsx'

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

  if (carregando && !snapshot) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="animate-spin text-[--color-tinta-3]" size={24} />
      </div>
    )
  }

  if (!snapshot?.viagem) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold">Não deu para abrir esta viagem</h1>
          <p className="mt-2 text-sm text-[--color-tinta-2]">
            Ou ela não existe, ou sua conta não participa dela. Se já abriu uma vez com internet,
            os últimos dados sincronizados aparecem em modo avião.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="sem-impressao">
        <Shell aba={aba} setAba={setAba}>
          {aba === 'inicio' && <Inicio irPara={setAba} />}
          {aba === 'roteiro' && <Roteiro />}
          {aba === 'voos' && <Voos />}
          {aba === 'cruzeiro' && <Cruzeiro />}
          {aba === 'hospedagem' && <Hospedagem />}
          {aba === 'lugares' && <Lugares />}
          {aba === 'checklist' && <Checklist />}
          {aba === 'documentos' && <Documentos />}
          {aba === 'emergencia' && <Emergencia />}
          {aba === 'financeiro' && <Financeiro />}
          {aba === 'dados' && <Dados />}
        </Shell>
      </div>
      {/* Fora da casca: aparece só na impressão, de qualquer aba. */}
      <PdfBolso />
    </>
  )
}
