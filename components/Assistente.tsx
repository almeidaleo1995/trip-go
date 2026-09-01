'use client'

// O assistente: um motor, quatro entradas.
//
// O painel abre por cima de qualquer aba sem trocar de tela, porque a pergunta
// quase sempre é sobre o que já está à vista — "isso aqui abre segunda?". Sair
// da aba para perguntar sobre ela é perder o assunto no caminho.
//
// A conversa não usa balões com avatar. Duas pessoas conversando merecem balões;
// aqui é uma pessoa consultando um guia, e o que importa é a resposta ser fácil
// de ler em pé, com uma mão. Então: pergunta em tinta fraca e pequena, resposta
// em corpo de leitura, largura confortável.
import { useEffect, useRef, useState } from 'react'
import { Sparkles, Mic, MicOff, Send, X, RotateCcw, WifiOff } from 'lucide-react'
import { useTrip } from './TripProvider.tsx'
import { Botao, Girando } from './ui.tsx'
import { RevisaoPropostas, type Proposta } from './RevisaoPropostas.tsx'
import { vozDisponivel, ouvir, type Ditado } from '@/lib/voz.ts'
import { assistenteConfig } from '@/config/site.ts'

export type ModoAssistente = 'criar_viagem' | 'duvida' | 'curiosidade' | 'preparacao'

type Turno = {
  papel: 'pessoa' | 'assistente'
  texto: string
  propostas?: Proposta[]
  /** Lote aplicado a partir deste turno. Habilita o desfazer. */
  lote?: string | null
  aplicadas?: number
}

const SUGESTOES: Record<ModoAssistente, string[]> = {
  duvida: [
    'Estou aqui e tenho 40 minutos. O que dá pra fazer?',
    'O que falta resolver antes de embarcar?',
    'Quanto eu já gastei nesta viagem?',
  ],
  curiosidade: ['O que faz este lugar valer a visita?', 'O que ver aqui perto?'],
  criar_viagem: ['Monte um roteiro para os dias que ainda estão vazios.'],
  preparacao: ['O que está mais atrasado?'],
}

export function Assistente({
  modo = 'duvida',
  aba,
  aberturaAutomatica,
  aoFechar,
}: {
  modo?: ModoAssistente
  aba?: string
  /** Pergunta disparada por um gatilho contextual, sem a pessoa digitar. */
  aberturaAutomatica?: string
  aoFechar: () => void
}) {
  const { snapshot, online, recarregar } = useTrip()
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [rascunho, setRascunho] = useState('')
  const [pensando, setPensando] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ditando, setDitando] = useState(false)
  const ditado = useRef<Ditado | null>(null)
  const fim = useRef<HTMLDivElement>(null)
  const disparado = useRef(false)

  const tripId = String(snapshot?.viagem?.id ?? '')
  const temVoz = vozDisponivel()

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turnos, pensando])

  useEffect(() => {
    if (aberturaAutomatica && !disparado.current) {
      disparado.current = true
      void enviar(aberturaAutomatica)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberturaAutomatica])

  // O ditado para junto com o painel. Sem isto o microfone segue aberto depois
  // de fechar — e o navegador mantém o indicador ligado, o que parece espionagem.
  useEffect(() => () => ditado.current?.parar(), [])

  async function enviar(texto: string) {
    const limpo = texto.trim()
    if (!limpo || pensando) return

    const historico = [...turnos, { papel: 'pessoa' as const, texto: limpo }]
    setTurnos(historico)
    setRascunho('')
    setPensando(true)
    setErro(null)

    try {
      const r = await fetch('/api/assistente', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trip_id: tripId || undefined,
          modo,
          aba,
          mensagens: historico.map((t) => ({ papel: t.papel, texto: t.texto })),
        }),
      })
      const dados = await r.json()
      if (!r.ok) {
        setErro(dados.erro ?? 'Não consegui falar com o assistente.')
        return
      }
      setTurnos([
        ...historico,
        { papel: 'assistente', texto: dados.texto, propostas: dados.propostas ?? [] },
      ])
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo daqui a pouco.')
    } finally {
      setPensando(false)
    }
  }

  async function aplicar(indice: number, escolhidas: Proposta[]) {
    if (escolhidas.length === 0) return
    setAplicando(true)
    setErro(null)
    try {
      const r = await fetch('/api/assistente/aplicar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trip_id: tripId, propostas: escolhidas }),
      })
      const dados = await r.json()
      if (!r.ok) return setErro(dados.erro ?? 'Não consegui salvar.')

      setTurnos((atual) =>
        atual.map((t, i) =>
          i === indice
            ? { ...t, propostas: undefined, lote: dados.lote, aplicadas: dados.aplicadas }
            : t,
        ),
      )
      if (dados.rejeitadas?.length) {
        setErro(`Não entrou: ${dados.rejeitadas.map((x: { motivo: string }) => x.motivo).join('; ')}`)
      }
      await recarregar()
    } catch {
      setErro('Sem conexão. Nada foi salvo.')
    } finally {
      setAplicando(false)
    }
  }

  async function desfazer(indice: number, lote: string) {
    setAplicando(true)
    try {
      const r = await fetch('/api/assistente/desfazer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trip_id: tripId, lote }),
      })
      const dados = await r.json()
      if (!r.ok) return setErro(dados.erro ?? 'Não consegui desfazer.')
      setTurnos((atual) => atual.map((t, i) => (i === indice ? { ...t, lote: null } : t)))
      await recarregar()
    } finally {
      setAplicando(false)
    }
  }

  function alternarVoz() {
    if (ditando) {
      ditado.current?.parar()
      return setDitando(false)
    }
    // O texto vai para a caixa e ESPERA. Reconhecimento erra, e "apaga o jantar"
    // saindo de "paga o jantar" não pode virar proposta que ninguém leu.
    ditado.current = ouvir(
      (texto) => setRascunho(texto),
      () => setDitando(false),
    )
    setDitando(ditado.current !== null)
  }

  const vazio = turnos.length === 0 && !pensando

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-(--color-borda) px-4 py-3">
        <p className="flex items-center gap-2 font-semibold">
          <Sparkles size={17} className="text-(--destaque)" />
          {assistenteConfig.nome}
        </p>
        <button
          onClick={aoFechar}
          aria-label="Fechar o assistente"
          className="toque -mr-2 cursor-pointer rounded-lg px-2 text-(--color-tinta-2) hover:bg-(--color-superficie-2)"
        >
          <X size={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {vazio && (
          <div className="pt-2">
            <p className="text-[15px] leading-relaxed text-(--color-tinta-2)">
              {assistenteConfig.convite}
            </p>
            <ul className="mt-4 space-y-2">
              {SUGESTOES[modo].map((s) => (
                <li key={s}>
                  <button
                    onClick={() => enviar(s)}
                    className="w-full cursor-pointer rounded-xl border border-(--color-borda) bg-(--color-cartao) px-3 py-2.5 text-left text-[13.5px] text-(--color-tinta-2) hover:border-(--color-borda-forte)"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-5">
          {turnos.map((t, i) =>
            t.papel === 'pessoa' ? (
              <p key={i} className="text-[13px] font-medium text-(--color-tinta-3)">
                {t.texto}
              </p>
            ) : (
              <div key={i} className="space-y-3">
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{t.texto}</p>
                {t.propostas && t.propostas.length > 0 && (
                  <RevisaoPropostas
                    propostas={t.propostas}
                    aplicando={aplicando}
                    aoAplicar={(e) => aplicar(i, e)}
                    aoDescartar={() =>
                      setTurnos((atual) =>
                        atual.map((x, j) => (j === i ? { ...x, propostas: undefined } : x)),
                      )
                    }
                  />
                )}
                {t.lote && (
                  <p className="flex items-center gap-2 text-[13px] text-(--color-sucesso-ink)">
                    Salvo na viagem
                    <button
                      onClick={() => desfazer(i, t.lote!)}
                      className="inline-flex cursor-pointer items-center gap-1 font-medium underline underline-offset-2"
                    >
                      <RotateCcw size={12} /> desfazer
                    </button>
                  </p>
                )}
              </div>
            ),
          )}
          {pensando && (
            <p className="flex items-center gap-2 text-[13px] text-(--color-tinta-3)">
              <Girando /> pensando…
            </p>
          )}
        </div>
        <div ref={fim} />
      </div>

      {erro && (
        <p role="alert" className="mx-4 mb-2 rounded-xl bg-(--color-perigo-bg) px-3 py-2 text-[13px] text-(--color-perigo-ink)">
          {erro}
        </p>
      )}

      <div className="border-t border-(--color-borda) p-3">
        {!online ? (
          <p className="flex items-center gap-2 px-1 py-2 text-[13px] text-(--color-tinta-2)">
            <WifiOff size={15} />
            {assistenteConfig.offline}
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void enviar(rascunho)
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void enviar(rascunho)
                }
              }}
              rows={1}
              placeholder={ditando ? 'Ouvindo…' : 'Pergunte ou peça alguma coisa'}
              aria-label="Sua mensagem"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-(--color-borda-forte) bg-(--color-cartao) px-3 py-2.5 text-[15px] outline-none focus:border-(--destaque)"
            />
            {temVoz && (
              <button
                type="button"
                onClick={alternarVoz}
                aria-label={ditando ? 'Parar de ouvir' : 'Ditar por voz'}
                aria-pressed={ditando}
                className={`toque shrink-0 cursor-pointer rounded-xl border px-3 ${
                  ditando
                    ? 'border-transparent bg-(--color-perigo-bg) text-(--color-perigo-ink)'
                    : 'border-(--color-borda-forte) text-(--color-tinta-2)'
                }`}
              >
                {ditando ? <MicOff size={17} /> : <Mic size={17} />}
              </button>
            )}
            <Botao tipo="submit" desabilitado={!rascunho.trim() || pensando} className="shrink-0">
              <Send size={16} />
              <span className="sr-only">Enviar</span>
            </Botao>
          </form>
        )}
      </div>
    </div>
  )
}
