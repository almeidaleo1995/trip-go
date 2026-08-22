'use client'

import { useState } from 'react'
import { MapPinned } from 'lucide-react'
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
        setErro(parsed.error.issues.map((i) => i.message).join(', '))
        return
      }

      const r = await fetch('/api/usuarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome, email, senha, confirmacao }),
      })
      if (r.ok) {
        // Igual ao login: navegação dura para a sessão nova valer já na próxima tela.
        window.location.href = '/dashboard'
        return
      }
      const d = await r.json()
      setErro(d.erro || 'Não consegui criar a conta.')
    } catch {
      setErro('Sem conexão. Tente de novo quando a internet voltar.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{
          background: 'linear-gradient(135deg, var(--color-destaque-escuro), var(--destaque))',
        }}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
            <MapPinned size={19} />
          </span>
          <span className="text-xl font-bold tracking-tight">TripGo</span>
        </div>

        <div className="relative z-10">
          <h2 className="max-w-md text-[38px] leading-[1.1] font-bold">
            Comece pela primeira viagem.
          </h2>
          <p className="mt-4 max-w-sm text-white/80">
            Crie a conta com o mesmo e-mail que o organizador usou no convite — sua viagem já estará
            esperando por você.
          </p>
        </div>

        <p className="text-sm text-white/60">Seus dados ficam só na sua viagem.</p>

        <svg
          className="pointer-events-none absolute -right-24 -bottom-16 h-80 w-80 opacity-15"
          viewBox="0 0 200 200"
          aria-hidden="true"
        >
          <path
            d="M20 160 Q 70 60 110 110 T 190 40"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeDasharray="6 5"
          />
          {[
            [20, 160],
            [110, 110],
            [190, 40],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="6" fill="#fff" />
          ))}
        </svg>
      </div>

      <div className="flex items-center justify-center bg-[--color-fundo] p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
              style={{ background: 'var(--destaque)' }}
            >
              <MapPinned size={19} />
            </span>
            <span className="text-xl font-bold tracking-tight">TripGo</span>
          </div>

          <h1 className="text-[26px] leading-tight font-semibold">Criar conta</h1>
          <p className="mt-1 text-sm text-[--color-tinta-2]">Leva menos de um minuto.</p>

          <form onSubmit={criar} className="mt-6 space-y-4">
            <Campo
              rotulo="Nome completo"
              tipo="text"
              valor={nome}
              aoMudar={setNome}
              autoComplete="name"
            />
            <Campo
              rotulo="E-mail"
              tipo="email"
              valor={email}
              aoMudar={setEmail}
              autoComplete="email"
            />
            <Campo
              rotulo="Senha"
              tipo="password"
              valor={senha}
              aoMudar={setSenha}
              autoComplete="new-password"
            />
            <Campo
              rotulo="Confirmar senha"
              tipo="password"
              valor={confirmacao}
              aoMudar={setConfirmacao}
              autoComplete="new-password"
            />

            {erro && (
              <p
                role="alert"
                className="rounded-xl bg-[--color-alerta-bg] px-3 py-2.5 text-sm text-[--color-alerta-ink]"
              >
                {erro}
              </p>
            )}

            <button
              type="submit"
              disabled={carregando}
              style={{ background: 'var(--destaque)' }}
              className="toque w-full cursor-pointer rounded-2xl text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
            >
              {carregando ? 'Criando…' : 'Criar conta'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[--color-tinta-2]">
            Já tem conta?{' '}
            <a
              href="/login"
              className="font-semibold hover:underline"
              style={{ color: 'var(--destaque)' }}
            >
              Entrar
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

function Campo({
  rotulo,
  tipo,
  valor,
  aoMudar,
  autoComplete,
}: {
  rotulo: string
  tipo: string
  valor: string
  aoMudar: (v: string) => void
  autoComplete?: string
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
        autoComplete={autoComplete}
        required
        className="toque mt-1 w-full rounded-xl border border-[--color-borda] bg-[--color-cartao] px-3 py-2.5 text-[15px] outline-none transition-colors focus:border-[--destaque] focus:ring-2 focus:ring-[--color-destaque-fraco]"
      />
    </label>
  )
}
