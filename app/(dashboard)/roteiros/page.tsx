'use client'

import { DashboardLayout } from '@/components/DashboardLayout'

export default function Roteiros() {
  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-[#0f172a]">Roteiros</h1>
        <div className="bg-white rounded-2xl p-12 border border-[#e2e8f0] text-center">
          <p className="text-[#64748b] mb-4">Selecione uma viagem para ver o roteiro</p>
          <a href="/viagens" className="text-[#0F766E] font-medium hover:underline">
            Ir para viagens
          </a>
        </div>
      </div>
    </DashboardLayout>
  )
}
