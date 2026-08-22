'use client'

import { ReactNode } from 'react'
import { navegacao } from '@/config/navigation'
import { LogOut, Menu, X } from 'lucide-react'
import { useState } from 'react'

export function DashboardLayout({ children }: { children: ReactNode }) {
  const [sidebarAberto, setSidebarAberto] = useState(false)

  async function sair() {
    await fetch('/api/sessao', { method: 'DELETE' })
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen bg-[#f7fafa]">
      {/* Sidebar desktop */}
      <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:w-60 md:flex md:flex-col md:border-r md:border-[#e2e8f0] md:bg-white">
        <div className="p-6 border-b border-[#e2e8f0]">
          <h1 className="text-2xl font-bold text-[#0F766E]">TripGo</h1>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navegacao.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg hover:bg-[#f7fafa] text-[#475569]"
            >
              <item.icone size={18} />
              {item.nome}
            </a>
          ))}
        </nav>
        <div className="p-4 border-t border-[#e2e8f0]">
          <button
            onClick={sair}
            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
          >
            <LogOut size={18} />
            Sair
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-40 bg-white border-b border-[#e2e8f0]">
        <div className="flex items-center justify-between p-4">
          <h1 className="font-bold text-[#0F766E]">TripGo</h1>
          <button
            onClick={() => setSidebarAberto(!sidebarAberto)}
            className="p-2 hover:bg-[#f7fafa] rounded-lg"
          >
            {sidebarAberto ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {sidebarAberto && (
          <nav className="px-4 py-2 space-y-1 border-t border-[#e2e8f0]">
            {navegacao.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-[#f7fafa]"
              >
                <item.icone size={16} />
                {item.nome}
              </a>
            ))}
            <button
              onClick={sair}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg mt-4"
            >
              <LogOut size={16} />
              Sair
            </button>
          </nav>
        )}
      </div>

      {/* Main content */}
      <main className="md:ml-60 p-4 md:p-8">{children}</main>
    </div>
  )
}
