'use client'

// O widget do Turnstile, e o nada que ele vira quando o captcha nao esta ligado.
//
// Componente proprio em vez de duas copias no login e no cadastro: as duas telas
// precisam do mesmo ciclo (carregar o script uma vez, desenhar, devolver o token,
// resetar depois de um erro), e a copia que fica para tras e sempre a que ninguem
// olha — no cadastro, que e justamente onde o abuso e a conta criada.
//
// Sem `NEXT_PUBLIC_TURNSTILE_SITE_KEY` ele nao renderiza nada e nao carrega
// script nenhum. O app segue funcionando exatamente como antes, que e o
// comportamento certo: um captcha mal configurado recusando todo mundo no
// aeroporto e pior do que captcha nenhum.
import { useEffect, useRef, useState } from 'react'

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

declare global {
  interface Window {
    turnstile?: {
      render: (
        alvo: HTMLElement,
        opcoes: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
          theme?: 'auto' | 'light' | 'dark'
        },
      ) => string
      reset: (id?: string) => void
    }
  }
}

/** Ligado? A tela usa isto para saber se deve esperar por um token. */
export const captchaAtivo = Boolean(SITE_KEY)

const URL_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** Carrega o script uma vez por aba, mesmo com dois widgets na mesma navegacao. */
let promessaScript: Promise<void> | null = null
function carregarScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (promessaScript) return promessaScript
  promessaScript = new Promise((resolver, rejeitar) => {
    const tag = document.createElement('script')
    tag.src = URL_SCRIPT
    tag.async = true
    tag.defer = true
    tag.onload = () => resolver()
    tag.onerror = () => {
      // Zera a promessa para uma nova tentativa poder recarregar: quem esta com
      // internet ruim no aeroporto merece a segunda chance.
      promessaScript = null
      rejeitar(new Error('turnstile'))
    }
    document.head.appendChild(tag)
  })
  return promessaScript
}

export type TurnstileProps = {
  /** Recebe o token, ou null quando ele expira e precisa ser refeito. */
  aoResolver: (token: string | null) => void
  /** Muda de valor para forcar um novo desafio depois de uma tentativa recusada. */
  reiniciar?: number
}

export function Turnstile({ aoResolver, reiniciar }: TurnstileProps) {
  const alvo = useRef<HTMLDivElement | null>(null)
  const widget = useRef<string | null>(null)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    if (!SITE_KEY || !alvo.current) return
    let vivo = true

    carregarScript()
      .then(() => {
        if (!vivo || !alvo.current || !window.turnstile || widget.current) return
        widget.current = window.turnstile.render(alvo.current, {
          sitekey: SITE_KEY,
          theme: 'auto',
          callback: (token) => aoResolver(token),
          // Token expirado e token ausente sao a mesma coisa para quem envia o
          // formulario: sem isto, a tela mandaria um token vencido e receberia
          // uma recusa que parece erro de senha.
          'expired-callback': () => aoResolver(null),
          'error-callback': () => {
            setFalhou(true)
            aoResolver(null)
          },
        })
      })
      .catch(() => {
        setFalhou(true)
        aoResolver(null)
      })

    return () => {
      vivo = false
    }
    // `aoResolver` vem do componente pai e mudaria a cada render; prender o
    // efeito a ele redesenharia o widget a cada tecla digitada na senha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (reiniciar && widget.current && window.turnstile) {
      window.turnstile.reset(widget.current)
      aoResolver(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reiniciar])

  if (!SITE_KEY) return null

  return (
    <div>
      <div ref={alvo} />
      {falhou && (
        <p className="t-aux mt-2">
          Não consegui carregar a verificação de segurança. Recarregue a página para tentar de novo.
        </p>
      )}
    </div>
  )
}
