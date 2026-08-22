'use client'

import { useEffect, useState } from 'react'
import { DashboardLayout } from '@/components/DashboardLayout'
import { CartaoViagem, type ViagemResumo } from '@/components/CartaoViagem'
import { Carregando, Vazio, Botao } from '@/components/ui'
import { Plus, Trash2, Copy, X, Luggage } from 'lucide-react'

export default function Viagens() {
  const [viagens, setViagens] = useState<ViagemResumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [formAberto, setFormAberto] = useState(false)
  const [nome, setNome] = useState('')
  const [dataPartida, setDataPartida] = useState('')
  const [dataRetorno, setDataRetorno] = useState('')
  const [moeda, setMoeda] = useState('BRL')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aRemover, setARemover] = useState<ViagemResumo | null>(null)

  useEffect(() => {
    fetch('/api/viagens')
      .then((r) => r.json())
      .then((d) => setViagens(d.viagens || []))
      .catch(() => setErro('Não consegui carregar suas viagens.'))
      .finally(() => setCarregando(false))
  }, [])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setSalvando(true)
    setErro(null)
    try {
      const r = await fetch('/api/viagens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome, data_partida: dataPartida, data_retorno: dataRetorno, moeda }),
      })
      const d = await r.json()
      if (!r.ok) {
        setErro(d.erro || 'Não consegui criar a viagem.')
        return
      }
      setViagens((a) => [...a, { ...d.viagem, participantes: d.viagem.participantes ?? 1 }])
      setNome('')
      setDataPartida('')
      setDataRetorno('')
      setFormAberto(false)
    } catch {
      setErro('Sem conexão. Tente de novo quando a internet voltar.')
    } finally {
      setSalvando(false)
    }
  }

  async function duplicar(v: ViagemResumo) {
    setOcupado(v.id)
    setErro(null)
    try {
      const r = await fetch('/api/viagens/duplicar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: v.id }),
      })
      const d = await r.json()
      if (!r.ok) {
        setErro(d.erro || 'Não consegui duplicar a viagem.')
        return
      }
      // Recarrega a lista: a cópia traz contagens próprias que o cliente não sabe montar.
      const lista = await fetch('/api/viagens').then((x) => x.json())
      setViagens(lista.viagens || [])
    } catch {
      setErro('Sem conexão. Tente de novo quando a internet voltar.')
    } finally {
      setOcupado(null)
    }
  }

  async function remover(v: ViagemResumo) {
    setOcupado(v.id)
    setErro(null)
    try {
      const r = await fetch('/api/viagens', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: v.id }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setErro(d.erro || 'Não consegui remover a viagem.')
        return
      }
      setViagens((a) => a.filter((x) => x.id !== v.id))
      setARemover(null)
    } catch {
      setErro('Sem conexão. Tente de novo quando a internet voltar.')
    } finally {
      setOcupado(null)
    }
  }

  if (carregando) return <Carregando texto="Carregando suas viagens…" />

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[26px] leading-tight font-semibold">Minhas viagens</h1>
            <p className="mt-1 text-sm text-[--color-tinta-2]">
              Cada viagem tem seu roteiro, seu grupo e suas contas.
            </p>
          </div>
          <Botao onClick={() => setFormAberto((a) => !a)}>
            {formAberto ? <X size={16} /> : <Plus size={16} />}
            {formAberto ? 'Cancelar' : 'Nova viagem'}
          </Botao>
        </div>

        {erro && (
          <p
            role="alert"
            className="mb-4 rounded-xl bg-[--color-alerta-bg] px-3 py-2.5 text-sm text-[--color-alerta-ink]"
          >
            {erro}
          </p>
        )}

        {formAberto && (
          <form
            onSubmit={criar}
            className="mb-6 rounded-2xl border border-[--color-borda] bg-[--color-cartao] p-5 shadow-[0_1px_3px_rgb(0_0_0/0.06)]"
          >
            <h2 className="mb-3 font-semibold">Nova viagem</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Nome" tipo="text" valor={nome} aoMudar={setNome} />
              <Campo rotulo="Partida" tipo="date" valor={dataPartida} aoMudar={setDataPartida} />
              <Campo rotulo="Retorno" tipo="date" valor={dataRetorno} aoMudar={setDataRetorno} />
              <label className="block">
                <span className="text-[11px] font-semibold tracking-[0.06em] text-[--color-tinta-3] uppercase">
                  Moeda
                </span>
                <select
                  value={moeda}
                  onChange={(e) => setMoeda(e.target.value)}
                  className="toque mt-1 w-full rounded-xl border border-[--color-borda] bg-[--color-cartao] px-3 py-2.5 text-[15px] outline-none focus:border-[--destaque] focus:ring-2 focus:ring-[--color-destaque-fraco]"
                >
                  <option value="BRL">BRL</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </select>
              </label>
            </div>
            <div className="mt-4">
              <Botao tipo="submit">{salvando ? 'Criando…' : 'Criar viagem'}</Botao>
            </div>
          </form>
        )}

        {viagens.length === 0 ? (
          <Vazio
            titulo="Nenhuma viagem ainda"
            texto="Crie a primeira e comece a montar o roteiro, o checklist e as reservas."
            acao={
              <Botao onClick={() => setFormAberto(true)}>
                <Plus size={16} /> Nova viagem
              </Botao>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {viagens.map((v) => (
              <CartaoViagem
                key={v.id}
                viagem={v}
                acoes={
                  <>
                    <BotaoIcone
                      rotulo={`Duplicar ${v.nome}`}
                      onClick={() => duplicar(v)}
                      desabilitado={ocupado === v.id}
                    >
                      <Copy size={15} />
                    </BotaoIcone>
                    <BotaoIcone
                      rotulo={`Remover ${v.nome}`}
                      onClick={() => setARemover(v)}
                      desabilitado={ocupado === v.id}
                    >
                      <Trash2 size={15} />
                    </BotaoIcone>
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Confirmação diz O QUE some junto — não só "tem certeza?" */}
      {aRemover && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setARemover(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border border-[--color-borda] bg-[--color-cartao] p-6 shadow-2xl"
          >
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[--color-alerta-bg] text-[--color-alerta-ink]">
              <Luggage size={20} />
            </span>
            <h2 className="text-lg font-semibold">Remover “{aRemover.nome}”?</h2>
            <p className="mt-2 text-sm text-[--color-tinta-2]">
              O roteiro, as reservas, o checklist e as despesas desta viagem saem junto. Não dá para
              desfazer pelo app.
            </p>
            <div className="mt-5 flex gap-2">
              <Botao variante="perigo" onClick={() => remover(aRemover)}>
                {ocupado === aRemover.id ? 'Removendo…' : 'Remover viagem'}
              </Botao>
              <Botao variante="secundario" onClick={() => setARemover(null)}>
                Cancelar
              </Botao>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

function BotaoIcone({
  children,
  rotulo,
  onClick,
  desabilitado,
}: {
  children: React.ReactNode
  rotulo: string
  onClick: () => void
  desabilitado?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      disabled={desabilitado}
      onClick={onClick}
      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition-colors hover:bg-white/35 disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function Campo({
  rotulo,
  tipo,
  valor,
  aoMudar,
}: {
  rotulo: string
  tipo: string
  valor: string
  aoMudar: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold tracking-[0.06em] text-[--color-tinta-3] uppercase">
        {rotulo}
      </span>
      <input
        type={tipo}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        required
        className="toque mt-1 w-full rounded-xl border border-[--color-borda] bg-[--color-cartao] px-3 py-2.5 text-[15px] outline-none transition-colors focus:border-[--destaque] focus:ring-2 focus:ring-[--color-destaque-fraco]"
      />
    </label>
  )
}
