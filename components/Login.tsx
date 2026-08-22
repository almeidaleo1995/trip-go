'use client'

// Tela de entrada: toca no seu nome, digita 4 dígitos.
//
// Teclado numérico próprio em vez de <input>: no celular o teclado do sistema
// cobre metade da tela e some com o contexto. Aqui os alvos têm 64px e a pessoa
// entra com uma mão.
import { useEffect, useState } from 'react'
import { Delete, Loader2 } from 'lucide-react'

type Viajante = { id: string; nome: string }

export function Login({ aoEntrar }: { aoEntrar: () => void }) {
  const [viajantes, setViajantes] = useState<Viajante[] | null>(null)
  const [precisaImportar, setPrecisaImportar] = useState(false)
  const [escolhido, setEscolhido] = useState<Viajante | null>(null)
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    fetch('/api/viajantes')
      .then((r) => r.json())
      .then((d) => {
        setViajantes(d.viajantes ?? [])
        setPrecisaImportar(Boolean(d.precisaImportar))
      })
      .catch(() => setViajantes([]))
  }, [])

  // Envia sozinho ao completar 4 dígitos: ninguém deveria precisar tocar em "ok".
  useEffect(() => {
    if (pin.length !== 4 || !escolhido || enviando) return
    setEnviando(true)
    fetch('/api/sessao', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ travelerId: escolhido.id, pin }),
    })
      .then(async (r) => {
        if (r.ok) return aoEntrar()
        const d = await r.json().catch(() => ({}))
        setErro(d.erro ?? 'Nome ou PIN incorreto.')
        setPin('')
      })
      .catch(() => {
        setErro('Sem conexão. Tente de novo quando tiver internet.')
        setPin('')
      })
      .finally(() => setEnviando(false))
  }, [pin, escolhido, enviando, aoEntrar])

  if (viajantes === null) {
    return (
      <Centro>
        <Loader2 className="animate-spin text-[--color-tinta-3]" size={24} />
      </Centro>
    )
  }

  if (precisaImportar || viajantes.length === 0) {
    return (
      <Centro>
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold">Nenhuma viagem ainda</h1>
          <p className="mt-2 text-sm text-[--color-tinta-2]">
            Suba o arquivo JSON da viagem para começar. Ele cria a viagem, os viajantes e os PINs de
            uma vez.
          </p>
          <ImportarPrimeira aoImportar={() => location.reload()} />
        </div>
      </Centro>
    )
  }

  if (!escolhido) {
    return (
      <Centro>
        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-center text-2xl font-semibold">Quem é você?</h1>
          <p className="mb-6 text-center text-sm text-[--color-tinta-3]">
            Toque no seu nome para entrar.
          </p>
          <div className="space-y-2">
            {viajantes.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  setEscolhido(v)
                  setErro(null)
                }}
                className="toque flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-[--color-borda] bg-[--color-cartao] px-4 text-left transition-colors hover:border-[--color-destaque]"
              >
                <Inicial nome={v.nome} />
                <span className="font-medium">{v.nome}</span>
              </button>
            ))}
          </div>
        </div>
      </Centro>
    )
  }

  return (
    <Centro>
      <div className="w-full max-w-[280px] text-center">
        <Inicial nome={escolhido.nome} grande />
        <h1 className="mt-3 text-lg font-semibold">{escolhido.nome}</h1>
        <p className="mt-1 text-sm text-[--color-tinta-3]">Digite seu PIN de 4 dígitos</p>

        <div className="my-7 flex justify-center gap-3" aria-label={`${pin.length} de 4 dígitos`}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="h-3.5 w-3.5 rounded-full transition-colors"
              style={{
                background: i < pin.length ? 'var(--destaque)' : 'var(--color-borda)',
              }}
            />
          ))}
        </div>

        {erro && (
          <p
            role="alert"
            className="mb-4 rounded-xl bg-[--color-alerta-bg] px-3 py-2 text-sm text-[--color-alerta-ink]"
          >
            {erro}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <Tecla key={d} onClick={() => setPin((p) => (p + d).slice(0, 4))}>
              {d}
            </Tecla>
          ))}
          <Tecla
            onClick={() => {
              setEscolhido(null)
              setPin('')
              setErro(null)
            }}
            discreta
          >
            <span className="text-xs">Voltar</span>
          </Tecla>
          <Tecla onClick={() => setPin((p) => (p + '0').slice(0, 4))}>0</Tecla>
          <Tecla onClick={() => setPin((p) => p.slice(0, -1))} discreta>
            <Delete size={20} />
          </Tecla>
        </div>
      </div>
    </Centro>
  )
}

function Tecla({
  children,
  onClick,
  discreta,
}: {
  children: React.ReactNode
  onClick: () => void
  discreta?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-16 cursor-pointer items-center justify-center rounded-2xl text-xl transition-colors active:scale-95 ${
        discreta
          ? 'text-[--color-tinta-3] hover:bg-[--color-borda]'
          : 'border border-[--color-borda] bg-[--color-cartao] font-medium hover:border-[--color-destaque]'
      }`}
    >
      {children}
    </button>
  )
}

function Inicial({ nome, grande }: { nome: string; grande?: boolean }) {
  const letras = nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${
        grande ? 'h-16 w-16 text-xl' : 'h-9 w-9 text-xs'
      }`}
      style={{ background: 'var(--destaque)' }}
      aria-hidden
    >
      {letras}
    </span>
  )
}

function Centro({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[--color-fundo] p-6">
      {children}
    </div>
  )
}

/** Bootstrap: banco vazio é o único caso em que importar não exige sessão. */
function ImportarPrimeira({ aoImportar }: { aoImportar: () => void }) {
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  return (
    <div className="mt-6">
      <label
        className="toque inline-flex cursor-pointer items-center justify-center rounded-xl px-5 font-medium text-white"
        style={{ background: 'var(--destaque)' }}
      >
        {enviando ? 'Enviando…' : 'Escolher arquivo JSON'}
        <input
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const arquivo = e.target.files?.[0]
            if (!arquivo) return
            setEnviando(true)
            setErro(null)
            try {
              const texto = await arquivo.text()
              const r = await fetch('/api/import', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: texto,
              })
              const d = await r.json()
              if (!r.ok) throw new Error(d.erro ?? 'Falhou.')
              aoImportar()
            } catch (err) {
              setErro(err instanceof Error ? err.message : 'Falhou.')
            } finally {
              setEnviando(false)
            }
          }}
        />
      </label>
      {erro && (
        <p className="mt-3 rounded-xl bg-[--color-alerta-bg] px-3 py-2 text-left text-sm text-[--color-alerta-ink]">
          {erro}
        </p>
      )}
    </div>
  )
}
