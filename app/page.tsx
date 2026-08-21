'use client'

// Raiz do app. Só decide duas coisas: tem sessão ou não, e qual aba está aberta.
// Todo o resto vem do TripProvider.
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { TripProvider, useTrip } from '@/components/TripProvider.tsx'
import { Shell, type AbaId } from '@/components/Shell.tsx'
import { Login } from '@/components/Login.tsx'
import { PdfBolso } from '@/components/PdfBolso.tsx'
import { Inicio } from '@/components/tabs/Inicio.tsx'
import {
  Roteiro,
  Voos,
  Cruzeiro,
  Hospedagem,
  Lugares,
  Documentos,
} from '@/components/tabs/Conteudo.tsx'
import { Emergencia, Checklist, Financeiro } from '@/components/tabs/Interativas.tsx'
import { Dados } from '@/components/tabs/Dados.tsx'

export default function Pagina() {
  const [temSessao, setTemSessao] = useState<boolean | null>(null)

  // Uma chamada barata decide entre login e app. O snapshot inteiro só vem depois.
  const conferir = useCallback(async () => {
    try {
      const r = await fetch('/api/snapshot', { method: 'HEAD' })
      setTemSessao(r.status !== 401)
    } catch {
      // Sem rede: se há cache local, o provider pinta a partir dele.
      setTemSessao(true)
    }
  }, [])

  useEffect(() => {
    void conferir()
  }, [conferir])

  // Registra o service worker uma vez. Falhar aqui só custa o modo offline.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  if (temSessao === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="animate-spin text-[--color-tinta-3]" size={24} />
      </div>
    )
  }

  if (!temSessao) return <Login aoEntrar={() => setTemSessao(true)} />

  return (
    <TripProvider aoSair={() => setTemSessao(false)}>
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

  if (!snapshot) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold">Ainda não dá para usar offline</h1>
          <p className="mt-2 text-sm text-[--color-tinta-2]">
            Abra o app uma vez com internet. Depois disso ele funciona em modo avião com os últimos
            dados sincronizados.
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
