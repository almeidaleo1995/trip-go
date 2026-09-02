'use client'

import { useState } from 'react'
import { MapPinned, Plane, Map, Wallet, ClipboardCheck } from 'lucide-react'
import { siteConfig } from '@/config/site.ts'
import { Botao, Campo } from '@/components/ui.tsx'
import { Turnstile, captchaAtivo } from '@/components/Turnstile.tsx'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  // O token do captcha, quando ele esta ligado. `null` enquanto o desafio nao
  // foi resolvido — e `captchaAtivo` false o deixa null para sempre, que e o
  // que faz esta tela continuar idêntica num servidor sem Turnstile.
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [refazerCaptcha, setRefazerCaptcha] = useState(0)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setCarregando(true)
    setErro(null)
    try {
      const r = await fetch('/api/sessao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, senha, captcha }),
      })
      if (r.ok) {
        // Navegação dura de propósito: recarrega com o cookie de sessão já posto.
        // `redirect()` do next/navigation não funciona dentro de handler de evento.
        window.location.href = '/dashboard'
        return
      }
      const d = await r.json()
      // Um desafio so vale uma vez: sem refazer, a segunda tentativa mandaria o
      // mesmo token e levaria uma recusa que parece erro de senha.
      setRefazerCaptcha((n) => n + 1)
      setErro(d.erro || 'Não consegui entrar. Confira e-mail e senha.')
    } catch {
      setErro('Sem conexão. Tente de novo quando a internet voltar.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* painel da marca — só no desktop */}
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
            Tudo da sua viagem, num lugar só.
          </h2>
          <p className="mt-4 max-w-sm text-white/80">
            Roteiro, voos, hospedagem, checklist e despesas — organizados antes de embarcar e à mão
            durante a viagem.
          </p>
          <ul className="mt-8 grid max-w-sm grid-cols-2 gap-3">
            {[
              { icone: Map, texto: 'Roteiro dia a dia' },
              { icone: Plane, texto: 'Voos e reservas' },
              { icone: ClipboardCheck, texto: 'Checklist do grupo' },
              { icone: Wallet, texto: 'Despesas divididas' },
            ].map((f) => (
              <li
                key={f.texto}
                className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2.5 text-sm"
              >
                <f.icone size={16} className="shrink-0" />
                {f.texto}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-white/60">Funciona offline durante a viagem.</p>

        {/* rota decorativa ao fundo */}
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

      {/* formulário */}
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

          <h1 className="t-pagina">Entrar</h1>
          <p className="t-aux mt-1">
            Use o e-mail com que você foi convidado para a viagem.
          </p>

          <form onSubmit={entrar} className="mt-6 space-y-4">
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
              autoComplete="current-password"
              obrigatorio
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
              // Enquanto o desafio nao volta, o botao espera. Deixar enviar sem o
              // token so trocaria uma espera curta por um 400 confuso.
              desabilitado={captchaAtivo && !captcha}
              className="w-full"
            >
              Entrar
            </Botao>
          </form>

          <p className="mt-6 text-center text-sm text-(--color-tinta-2)">
            Não tem conta?{' '}
            <a
              href="/register"
              className="font-semibold hover:underline"
              style={{ color: 'var(--destaque)' }}
            >
              Criar conta
            </a>
          </p>

          {siteConfig.demo.mostrar && (
            <div className="mt-8 rounded-2xl border border-(--color-borda) bg-(--color-cartao) p-4 text-center">
              <p className="t-legenda">Conta de demonstração</p>
              <p className="tab-num mt-1.5 text-sm font-medium">{siteConfig.demo.email}</p>
              <p className="tab-num text-sm text-(--color-tinta-2)">{siteConfig.demo.senha}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
