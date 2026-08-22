'use client'

import { useEffect, useState } from 'react'
import { DashboardLayout } from '@/components/DashboardLayout'

type Viagem = {
  id: string
  nome: string
  data_partida: string
  data_retorno: string
  participantes: number
}

export default function Dashboard() {
  const [viagens, setViagens] = useState<Viagem[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    fetch('/api/viagens')
      .then((r) => r.json())
      .then((d) => {
        setViagens(d.viagens || [])
      })
      .finally(() => setCarregando(false))
  }, [])

  if (carregando) {
    return (
      <DashboardLayout>
        <div className="p-8">Carregando...</div>
      </DashboardLayout>
    )
  }

  if (viagens.length === 0) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-bold mb-4 text-[#0f172a]">Nenhuma viagem ainda</h1>
            <p className="text-[#64748b] mb-6">Crie sua primeira viagem</p>
            <a
              href="/viagens"
              className="inline-block bg-[#0F766E] text-white px-6 py-2 rounded-xl font-medium hover:opacity-90"
            >
              Ir para viagens
            </a>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#0f172a]">Dashboard</h1>
          <p className="text-[#64748b] mt-1">Bem-vindo de volta!</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {viagens.map((v) => (
            <a
              key={v.id}
              href={`/viagens/${v.id}`}
              className="bg-white p-6 rounded-2xl border border-[#e2e8f0] hover:shadow-lg transition"
            >
              <h2 className="font-bold text-lg mb-2 text-[#0f172a]">{v.nome}</h2>
              <p className="text-sm text-[#64748b] mb-4">
                {v.data_partida} → {v.data_retorno}
              </p>
              <p className="text-xs text-[#94a3b8]">{v.participantes} participante(s)</p>
            </a>
          ))}
        </div>
      </div>
    </DashboardLayout>
  )
}
