'use client'

import { useEffect, useState } from 'react'
import { DashboardLayout } from '@/components/DashboardLayout.tsx'
import { CartaoViagem, type ViagemResumo } from '@/components/CartaoViagem.tsx'
import {
  AppModal,
  Botao,
  BotaoIcone,
  Campo,
  Carregando,
  ConfirmarDialogo,
  Titulo,
  Vazio,
  CLASSE_CAMPO,
  useAviso,
} from '@/components/ui.tsx'
import { MOEDAS } from '@/lib/schema.ts'
import { Plus, Trash2, Copy } from 'lucide-react'

export default function Viagens() {
  const avisar = useAviso()
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

  async function criar() {
    if (!nome.trim()) return setErro('Dê um nome para a viagem.')
    if (!dataPartida || !dataRetorno) return setErro('Informe as datas de partida e retorno.')
    if (dataRetorno < dataPartida) return setErro('O retorno não pode ser antes da partida.')

    setSalvando(true)
    setErro(null)
    try {
      const r = await fetch('/api/viagens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          data_partida: dataPartida,
          data_retorno: dataRetorno,
          moeda,
        }),
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
      avisar('sucesso', 'Viagem criada.')
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
      avisar('sucesso', 'Viagem duplicada.')
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
      avisar('sucesso', 'Viagem removida.')
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
        <Titulo
          descricao="Cada viagem tem seu roteiro, seu grupo e suas contas."
          acao={
            <Botao onClick={() => setFormAberto(true)}>
              <Plus size={16} /> Nova viagem
            </Botao>
          }
        >
          Minhas viagens
        </Titulo>

        {erro && !formAberto && (
          <p
            role="alert"
            className="mb-4 rounded-xl bg-(--color-perigo-bg) px-3 py-2.5 text-sm text-(--color-perigo-ink)"
          >
            {erro}
          </p>
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
                      tom="sobre-cor"
                      rotulo={`Duplicar ${v.nome}`}
                      onClick={() => duplicar(v)}
                      desabilitado={ocupado === v.id}
                    >
                      <Copy size={15} />
                    </BotaoIcone>
                    <BotaoIcone
                      tom="sobre-cor"
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

      {formAberto && (
        <AppModal
          titulo="Nova viagem"
          descricao="Você pode mudar tudo isso depois."
          tamanho="medio"
          aoFechar={() => setFormAberto(false)}
          acoes={
            <>
              <Botao variante="secundario" onClick={() => setFormAberto(false)}>
                Cancelar
              </Botao>
              <Botao onClick={criar} carregando={salvando}>
                Criar viagem
              </Botao>
            </>
          }
        >
          <div className="space-y-4 pb-2">
            <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                rotulo="Partida"
                tipo="date"
                valor={dataPartida}
                aoMudar={setDataPartida}
                obrigatorio
              />
              <Campo
                rotulo="Retorno"
                tipo="date"
                valor={dataRetorno}
                aoMudar={setDataRetorno}
                obrigatorio
              />
            </div>
            <label className="block">
              <span className="block text-[13px] font-medium text-(--color-tinta-2)">Moeda</span>
              <select
                value={moeda}
                onChange={(e) => setMoeda(e.target.value)}
                className={`toque mt-1 max-w-40 ${CLASSE_CAMPO}`}
              >
                {MOEDAS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            {erro && (
              <p
                role="alert"
                className="rounded-xl bg-(--color-perigo-bg) px-3 py-2 text-sm text-(--color-perigo-ink)"
              >
                {erro}
              </p>
            )}
          </div>
        </AppModal>
      )}

      {/* Confirmação diz O QUE some junto — não só "tem certeza?" */}
      {aRemover && (
        <ConfirmarDialogo
          titulo={`Remover “${aRemover.nome}”?`}
          descricao="O roteiro, as reservas, o checklist e as despesas desta viagem saem junto. Não dá para desfazer pelo app."
          rotuloConfirmar="Remover viagem"
          carregando={ocupado === aRemover.id}
          aoCancelar={() => setARemover(null)}
          aoConfirmar={() => void remover(aRemover)}
        />
      )}
    </DashboardLayout>
  )
}
