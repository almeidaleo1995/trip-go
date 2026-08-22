'use client'

import { useState } from 'react'
import { redirect } from 'next/navigation'
import { CadastroSchema } from '@/lib/schema'

export default function Register() {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setCarregando(true)
    setErro(null)
    try {
      const parsed = CadastroSchema.safeParse({ nome, email, senha, confirmacao })
      if (!parsed.success) {
        const erros = parsed.error.issues.map((i) => i.message).join(', ')
        setErro(erros)
        return
      }

      const r = await fetch('/api/usuarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome, email, senha, confirmacao }),
      })
      if (r.ok) {
        redirect('/dashboard')
      }
      const d = await r.json()
      setErro(d.erro || 'Erro ao cadastrar')
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
          <h1 className="text-3xl font-bold text-center mb-2">Criar conta</h1>
          <p className="text-center text-sm text-gray-600 mb-8">
            Comece a planejar suas viagens
          </p>

          <form onSubmit={criar} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Nome completo</label>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-xl"
                required
              />
            </div>
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
            <div>
              <label className="block text-sm font-medium mb-2">Confirmar senha</label>
              <input
                type="password"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
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
              {carregando ? 'Criando...' : 'Criar conta'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t text-center text-sm">
            <p className="text-gray-600">Já tem conta?</p>
            <a href="/login" className="text-[#0F766E] font-medium hover:underline">
              Entrar
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
