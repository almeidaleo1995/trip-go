'use client'

import { ReactNode, useState } from 'react'
import { usePathname } from 'next/navigation'
import { navegacao } from '@/config/navigation.ts'
import { LogOut, Menu, X, MapPinned } from 'lucide-react'

export function DashboardLayout({ children }: { children: ReactNode }) {
  const [menuAberto, setMenuAberto] = useState(false)
  const caminho = usePathname()

  async function sair() {
    await fetch('/api/sessao', { method: 'DELETE' })
    window.location.href = '/login'
  }

  return (
    <div className="min-h-dvh bg-(--color-fundo)">
      {/* Sidebar desktop */}
      <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:flex md:w-64 md:flex-col md:border-r md:border-(--color-borda) md:bg-(--color-cartao)">
        <div className="flex items-center gap-2.5 border-b border-(--color-borda) px-5 py-5">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white"
            style={{ background: 'var(--destaque)' }}
          >
            <MapPinned size={17} strokeWidth={2} />
          </span>
          <span className="text-lg font-bold tracking-tight">TripGo</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {navegacao.map((item) => (
            <ItemNav key={item.href} item={item} ativo={caminho === item.href} />
          ))}
        </nav>
        <button
          onClick={sair}
          className="toque m-3 flex cursor-pointer items-center gap-3 rounded-xl px-3 text-sm text-(--color-tinta-2) transition-colors hover:bg-(--color-superficie-2)"
        >
          <LogOut size={18} strokeWidth={1.75} />
          Sair
        </button>
      </aside>

      {/* Cabeçalho celular */}
      <div className="sticky top-0 z-40 border-b border-(--color-borda) bg-(--color-cartao) md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-xl text-white"
              style={{ background: 'var(--destaque)' }}
            >
              <MapPinned size={17} strokeWidth={2} />
            </span>
            <span className="font-bold tracking-tight">TripGo</span>
          </div>
          <button
            onClick={() => setMenuAberto((a) => !a)}
            aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuAberto}
            className="toque flex cursor-pointer items-center justify-center rounded-xl hover:bg-(--color-superficie-2)"
          >
            {menuAberto ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {menuAberto && (
          <nav className="space-y-1 border-t border-(--color-borda) px-3 py-3">
            {navegacao.map((item) => (
              <ItemNav key={item.href} item={item} ativo={caminho === item.href} />
            ))}
            <button
              onClick={sair}
              className="toque mt-2 flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm text-(--color-tinta-2) hover:bg-(--color-superficie-2)"
            >
              <LogOut size={18} />
              Sair
            </button>
          </nav>
        )}
      </div>

      <main className="px-4 py-5 md:ml-64 md:p-8">{children}</main>
    </div>
  )
}

function ItemNav({ item, ativo }: { item: (typeof navegacao)[number]; ativo: boolean }) {
  return (
    <a
      href={item.href}
      aria-current={ativo ? 'page' : undefined}
      className="toque flex items-center gap-3 rounded-xl px-3 text-sm transition-colors"
      style={
        ativo
          ? { background: 'var(--destaque)', color: '#fff', fontWeight: 600 }
          : { color: 'var(--color-tinta-2)' }
      }
    >
      <item.icone size={18} strokeWidth={ativo ? 2.25 : 1.75} />
      {item.nome}
    </a>
  )
}
