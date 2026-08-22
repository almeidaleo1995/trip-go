'use client'

import { useEffect, useState, use } from 'react'
import { DashboardLayout } from '@/components/DashboardLayout'

export default function ViagemDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [viagem, setViagem] = useState<any>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    fetch(`/api/snapshot?trip=${id}`)
      .then((r) => r.json())
      .then((d) => {
        setViagem(d.viagem)
        setCarregando(false)
      })
      .catch(() => setCarregando(false))
  }, [id])

  if (carregando) return <div className="p-8">Carregando...</div>
  if (!viagem) return <div className="p-8">Viagem não encontrada</div>

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 text-[#0f172a]">{viagem.nome}</h1>
          {viagem.subtitulo && <p className="text-[#64748b]">{viagem.subtitulo}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-2xl p-6 border border-[#e2e8f0]">
            <p className="text-sm text-[#64748b] mb-2">Período</p>
            <p className="font-bold text-[#0f172a]">
              {viagem.data_partida} → {viagem.data_retorno}
            </p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-[#e2e8f0]">
            <p className="text-sm text-[#64748b] mb-2">Moeda</p>
            <p className="font-bold text-[#0f172a]">{viagem.moeda}</p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-[#e2e8f0]">
            <p className="text-sm text-[#64748b] mb-2">Cor</p>
            <div
              className="w-12 h-12 rounded-lg border border-[#e2e8f0]"
              style={{ backgroundColor: viagem.cor_destaque }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <nav className="space-y-2">
            {[
              { href: 'roteiros', nome: '📅 Roteiro' },
              { href: 'voos', nome: '✈️ Voos' },
              { href: 'reservas', nome: '🏨 Reservas' },
              { href: 'despesas', nome: '💰 Despesas' },
            ].map((item) => (
              <a
                key={item.href}
                href={`/viagens/${id}/${item.href}`}
                className="block bg-white rounded-xl p-4 border border-[#e2e8f0] hover:shadow-lg transition"
              >
                {item.nome}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </DashboardLayout>
  )
}
