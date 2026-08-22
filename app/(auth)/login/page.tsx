'use client'

import { useState } from 'react'
import { redirect } from 'next/navigation'
import { siteConfig } from '@/config/site'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setCarregando(true)
    setErro(null)
    try {
      const r = await fetch('/api/sessao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      })
      if (r.ok) {
        redirect('/dashboard')
      }
      const d = await r.json()
      setErro(d.erro || 'Erro ao entrar')
    } catch {
      setErro('Sem conexão')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0B3B39] to-[#0F766E] p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-2xl p-8">
          <h1 className="text-3xl font-bold text-center mb-2">TripGo</h1>
          <p className="text-center text-sm text-gray-600 mb-8">
            Planeje, organize e viva suas viagens
          </p>

          <form onSubmit={entrar} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-xl"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Senha</label>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-xl"
                required
              />
            </div>
            {erro && <p className="text-red-600 text-sm">{erro}</p>}
            <button
              type="submit"
              disabled={carregando}
              className="w-full bg-[#0F766E] text-white py-2 rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
            >
              {carregando ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t text-center text-sm">
            <p className="text-gray-600 mb-3">Não tem conta?</p>
            <a href="/register" className="text-[#0F766E] font-medium hover:underline">
              Criar conta
            </a>
          </div>

          {siteConfig.demo.mostrar && (
            <div className="mt-6 pt-6 border-t text-center text-xs bg-blue-50 p-3 rounded-lg">
              <p className="font-medium text-blue-900 mb-1">Demo</p>
              <p className="text-blue-800 mb-2">{siteConfig.demo.email}</p>
              <p className="text-blue-700">{siteConfig.demo.senha}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
