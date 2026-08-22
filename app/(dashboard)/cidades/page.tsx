'use client'

import { useEffect, useState, use } from 'react'
import { DashboardLayout } from '@/components/DashboardLayout'

type Cidade = {
  id: string
  cidade: string
  pais: string | null
  dias: number | null
  status: string
  chega_em: string | null
  sai_em: string | null
  notas: string | null
  lat: number | null
  lon: number | null
}

type Snapshot = {
  viagem: { id: string; nome: string } | null
  lugares: Cidade[]
}

export default function CidadesPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    fetch('/api/snapshot')
      .then((r) => r.json())
      .then((d) => {
        setSnapshot(d)
        setCarregando(false)
      })
      .catch(() => setCarregando(false))
  }, [])

  if (carregando) return <DashboardLayout><div className="p-8">Carregando...</div></DashboardLayout>
  if (!snapshot?.viagem) return <DashboardLayout><div className="p-8">Viagem não encontrada</div></DashboardLayout>

  const cidades = snapshot.lugares || []

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#0f172a]">🌍 Cidades</h1>
          <p className="text-[#64748b] mt-1">Roteiro de cidades da sua viagem</p>
        </div>

        {cidades.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-[#e2e8f0]">
            <p className="text-[#64748b]">Nenhuma cidade adicionada ainda</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cidades.map((cidade) => (
              <div
                key={cidade.id}
                className="bg-white rounded-2xl p-6 border border-[#e2e8f0] hover:shadow-lg transition"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="font-bold text-lg text-[#0f172a]">{cidade.cidade}</h2>
                    {cidade.pais && <p className="text-sm text-[#64748b]">{cidade.pais}</p>}
                  </div>
                  <span
                    className={`text-xs px-3 py-1 rounded-full ${
                      cidade.status === 'visitada'
                        ? 'bg-[#d1fae5] text-[#065f46]'
                        : 'bg-[#fef3c7] text-[#92400e]'
                    }`}
                  >
                    {cidade.status === 'visitada' ? '✓ Visitada' : '◯ Planejada'}
                  </span>
                </div>

                {cidade.dias && (
                  <p className="text-sm text-[#64748b] mb-3">
                    <strong>{cidade.dias}</strong> dia{cidade.dias !== 1 ? 's' : ''}
                  </p>
                )}

                {(cidade.chega_em || cidade.sai_em) && (
                  <div className="text-sm text-[#64748b] mb-3 space-y-1">
                    {cidade.chega_em && <p>📍 Chega: {new Date(cidade.chega_em).toLocaleDateString('pt-BR')}</p>}
                    {cidade.sai_em && <p>📍 Sai: {new Date(cidade.sai_em).toLocaleDateString('pt-BR')}</p>}
                  </div>
                )}

                {cidade.notas && (
                  <p className="text-sm text-[#64748b] italic border-t border-[#e2e8f0] pt-3 mt-3">
                    {cidade.notas}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
