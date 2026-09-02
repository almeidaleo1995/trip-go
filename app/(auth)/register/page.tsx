'use client'

import { useState } from 'react'
import { MapPinned } from 'lucide-react'
import { CadastroSchema, SENHA_MINIMA } from '@/lib/schema.ts'
import { Botao, Campo } from '@/components/ui.tsx'
import { Turnstile, captchaAtivo } from '@/components/Turnstile.tsx'

export default function Register() {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  // O captcha importa MAIS aqui do que no login: no login o abuso e o chute de
  // senha, que o rate limit ja corta; aqui o abuso e a conta criada com sucesso,
  // e mil contas de mil IPs passam por baixo de qualquer balde por origem.
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [refazerCaptcha, setRefazerCaptcha] = useState(0)

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
        body: JSON.stringify({ nome, email, senha, confirmacao, captcha }),
      })
      if (r.ok) {
        // Igual ao login: navegação dura para a sessão nova valer já na próxima tela.
        window.location.href = '/dashboard'
        return
      }
      const d = await r.json()
      // Um desafio so vale uma vez; sem refazer, a segunda tentativa reenviaria
      // o mesmo token.
      setRefazerCaptcha((n) => n + 1)
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

      <div className="flex items-center justify-center bg-(--color-fundo) p-6">
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

          <h1 className="t-pagina">Criar conta</h1>
          <p className="t-aux mt-1">Leva menos de um minuto.</p>

          <form onSubmit={criar} className="mt-6 space-y-4">
            <Campo
              rotulo="Nome completo"
              tipo="text"
              valor={nome}
              aoMudar={setNome}
              autoComplete="name"
              obrigatorio
            />
            <Campo
              rotulo="E-mail"
              tipo="email"
              valor={email}
              aoMudar={setEmail}
              autoComplete="email"
              obrigatorio
            />
            <Campo
              rotulo="Senha"
              tipo="password"
              valor={senha}
              aoMudar={setSenha}
              autoComplete="new-password"
              obrigatorio
              dica={`mínimo ${SENHA_MINIMA} caracteres`}
            />
            <Campo
              rotulo="Confirmar senha"
              tipo="password"
              valor={confirmacao}
              aoMudar={setConfirmacao}
              autoComplete="new-password"
              obrigatorio
              erro={confirmacao && senha !== confirmacao ? 'As senhas não são iguais.' : null}
            />

            {erro && (
              <p
                role="alert"
                className="rounded-xl bg-(--color-perigo-bg) px-3 py-2.5 text-sm text-(--color-perigo-ink)"
              >
                {erro}
              </p>
            )}

            <Turnstile aoResolver={setCaptcha} reiniciar={refazerCaptcha} />

            <Botao
              tipo="submit"
              carregando={carregando}
              desabilitado={captchaAtivo && !captcha}
              className="w-full"
            >
              Criar conta
            </Botao>
          </form>

          <p className="mt-6 text-center text-sm text-(--color-tinta-2)">
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
