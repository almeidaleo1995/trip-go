'use client'

import { DashboardLayout } from '@/components/DashboardLayout'

export default function Despesas() {
  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-[#0f172a]">Despesas</h1>
        <div className="bg-white rounded-2xl p-12 border border-[#e2e8f0] text-center text-[#64748b]">
          Selecione uma viagem para gerenciar despesas
        </div>
      </div>
    </DashboardLayout>
  )
}
