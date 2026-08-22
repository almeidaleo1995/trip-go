'use client'

import { useEffect, useState } from 'react'
import { DashboardLayout } from '@/components/DashboardLayout'
import { Plus, Trash2, Copy } from 'lucide-react'

type Viagem = {
  id: string
  nome: string
  subtitulo: string | null
  data_partida: string
  data_retorno: string
  moeda: string
  participantes: number
}

export default function Viagens() {
  const [viagens, setViagens] = useState<Viagem[]>([])
  const [nome, setNome] = useState('')
  const [dataPartida, setDataPartida] = useState('')
  const [dataRetorno, setDataRetorno] = useState('')
  const [moeda, setMoeda] = useState('BRL')
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/viagens')
      .then((r) => r.json())
      .then((d) => setViagens(d.viagens || []))
  }, [])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setCriando(true)
    setErro(null)
    try {
      const r = await fetch('/api/viagens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nome,
          data_partida: dataPartida,
          data_retorno: dataRetorno,
          moeda,
        }),
      })
      if (r.ok) {
        const d = await r.json()
        setViagens([...viagens, d.viagem])
        setNome('')
        setDataPartida('')
        setDataRetorno('')
      } else {
        const d = await r.json()
        setErro(d.erro || 'Erro ao criar')
      }
    } catch {
      setErro('Sem conexão')
    } finally {
      setCriando(false)
    }
  }

  async function deletar(id: string) {
    if (!confirm('Tem certeza?')) return
    try {
      await fetch('/api/viagens', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      setViagens(viagens.filter((v) => v.id !== id))
    } catch {
      setErro('Erro ao deletar')
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 text-[#0f172a]">Minhas viagens</h1>
          <p className="text-[#475569]">Crie e gerencie suas viagens</p>
        </div>

        {/* Formulário */}
        <form onSubmit={criar} className="bg-white rounded-2xl p-6 border border-[#e2e8f0] mb-8">
          <h2 className="font-bold mb-4 text-[#0f172a]">Nova viagem</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <input
              type="text"
              placeholder="Nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="px-4 py-2 border border-[#e2e8f0] rounded-xl"
              required
            />
            <input
              type="date"
              value={dataPartida}
              onChange={(e) => setDataPartida(e.target.value)}
              className="px-4 py-2 border border-[#e2e8f0] rounded-xl"
              required
            />
            <input
              type="date"
              value={dataRetorno}
              onChange={(e) => setDataRetorno(e.target.value)}
              className="px-4 py-2 border border-[#e2e8f0] rounded-xl"
              required
            />
            <select
              value={moeda}
              onChange={(e) => setMoeda(e.target.value)}
              className="px-4 py-2 border border-[#e2e8f0] rounded-xl"
            >
              <option value="BRL">BRL</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </div>
          {erro && <p className="text-red-600 text-sm mt-2">{erro}</p>}
          <button
            type="submit"
            disabled={criando}
            className="mt-4 bg-[#0F766E] text-white px-6 py-2 rounded-xl font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            <Plus size={18} />
            Criar
          </button>
        </form>

        {/* Lista */}
        <div className="grid gap-4">
          {viagens.map((v) => (
            <a
              key={v.id}
              href={`/viagens/${v.id}`}
              className="bg-white rounded-2xl p-6 border border-[#e2e8f0] hover:shadow-lg transition"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-[#0f172a] mb-2">{v.nome}</h3>
                  <p className="text-sm text-[#64748b]">
                    {v.data_partida} → {v.data_retorno} · {v.moeda}
                  </p>
                  <p className="text-xs text-[#94a3b8] mt-2">{v.participantes} participante(s)</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      alert('Duplicar em breve')
                    }}
                    className="p-2 hover:bg-[#f7fafa] rounded-lg text-[#64748b]"
                  >
                    <Copy size={18} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      deletar(v.id)
                    }}
                    className="p-2 hover:bg-red-50 rounded-lg text-red-600"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </DashboardLayout>
  )
}
