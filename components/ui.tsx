'use client'

// Primitivos usados pelas dez abas. Existem para que "estado vazio" e "cartão"
// sejam decididos UMA vez — não dez vezes com dez aparências levemente diferentes.
import { useState, type ReactNode } from 'react'
import { Check, Copy, Inbox, MapPinned } from 'lucide-react'

/** Tela de carregamento. Um avião percorrendo a rota — não um spinner genérico. */
export function Carregando({ texto = 'Preparando sua viagem…' }: { texto?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[--color-fundo] p-6">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
          style={{ background: 'var(--destaque)' }}
        >
          <MapPinned size={19} strokeWidth={2} />
        </span>
        <span className="text-xl font-bold tracking-tight">TripGo</span>
      </div>

      <svg viewBox="0 0 240 60" className="h-14 w-60" role="img" aria-label={texto}>
        <path
          id="rota-carregando"
          d="M16 46 Q 80 4 120 30 T 224 14"
          fill="none"
          stroke="var(--color-borda)"
          strokeWidth="2"
          strokeDasharray="5 4"
          strokeLinecap="round"
        />
        <circle cx="16" cy="46" r="4" fill="var(--destaque)" />
        <circle cx="224" cy="14" r="4" fill="var(--destaque)" opacity="0.35" />
        <g>
          <circle r="5" fill="var(--destaque)">
            <animateMotion dur="1.8s" repeatCount="indefinite" rotate="auto">
              <mpath href="#rota-carregando" />
            </animateMotion>
          </circle>
        </g>
      </svg>

      <p className="text-sm text-[--color-tinta-2]">{texto}</p>
    </div>
  )
}

export function Titulo({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <h1 className="text-[22px] leading-tight font-semibold">{children}</h1>
      {acao}
    </div>
  )
}

export function Rotulo({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold tracking-[0.06em] text-[--color-tinta-3] uppercase">
      {children}
    </p>
  )
}

export function Cartao({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  const base =
    'quebra-evitar rounded-2xl border border-[--color-borda] bg-[--color-cartao] p-4 shadow-[0_1px_3px_rgb(0_0_0/0.06)]'
  return onClick ? (
    <button onClick={onClick} className={`${base} w-full cursor-pointer text-left ${className}`}>
      {children}
    </button>
  ) : (
    <div className={`${base} ${className}`}>{children}</div>
  )
}

/** Estado vazio. Toda aba usa este — nenhuma quebra por falta de dado. */
export function Vazio({
  titulo,
  texto,
  acao,
}: {
  titulo: string
  texto: string
  acao?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[--color-borda] px-6 py-12 text-center">
      <Inbox className="mx-auto mb-3 text-[--color-tinta-3]" size={28} strokeWidth={1.5} />
      <p className="font-medium">{titulo}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-[--color-tinta-2]">{texto}</p>
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  )
}

const TONS: Record<string, { bg: string; ink: string }> = {
  voo: { bg: 'var(--color-voo-bg)', ink: 'var(--color-voo-ink)' },
  hospedagem: { bg: 'var(--color-hosp-bg)', ink: 'var(--color-hosp-ink)' },
  cruzeiro: { bg: 'var(--color-cruz-bg)', ink: 'var(--color-cruz-ink)' },
  passeio: { bg: 'var(--color-pass-bg)', ink: 'var(--color-pass-ink)' },
  traslado: { bg: 'var(--color-borda)', ink: 'var(--color-tinta-2)' },
  documento: { bg: 'var(--color-alerta-bg)', ink: 'var(--color-alerta-ink)' },
  refeicao: { bg: 'var(--color-hosp-bg)', ink: 'var(--color-hosp-ink)' },
}

const NOMES: Record<string, string> = {
  voo: 'Voo',
  hospedagem: 'Hospedagem',
  cruzeiro: 'Cruzeiro',
  passeio: 'Passeio',
  traslado: 'Traslado',
  documento: 'Documento',
  refeicao: 'Refeição',
}

export function Badge({ tipo, texto }: { tipo?: string; texto?: string }) {
  const tom = TONS[tipo ?? ''] ?? TONS.traslado
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
      style={{ background: tom.bg, color: tom.ink }}
    >
      {texto ?? NOMES[tipo ?? ''] ?? tipo}
    </span>
  )
}

/** Copiar sem depender de rede nem de permissão especial. */
export function Copiar({ valor, rotulo }: { valor: string; rotulo?: string }) {
  const [feito, setFeito] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(valor)
          setFeito(true)
          setTimeout(() => setFeito(false), 1600)
        } catch {
          /* contexto sem clipboard: o valor continua visível na tela */
        }
      }}
      aria-label={`Copiar ${rotulo ?? valor}`}
      className="toque inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm transition-colors hover:bg-[--color-borda]"
    >
      <span className="tab-num font-semibold tracking-wider">{valor}</span>
      {feito ? (
        <Check size={14} className="text-[--color-destaque]" />
      ) : (
        <Copy size={14} className="text-[--color-tinta-3]" />
      )}
    </button>
  )
}

export function Botao({
  children,
  onClick,
  variante = 'principal',
  tipo,
}: {
  children: ReactNode
  onClick?: () => void
  variante?: 'principal' | 'secundario' | 'perigo'
  tipo?: 'button' | 'submit'
}) {
  const estilos = {
    principal: {
      background: 'var(--destaque)',
      color: '#fff',
      border: '1px solid transparent',
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.08)',
    },
    secundario: {
      background: 'var(--color-cartao)',
      color: 'var(--color-tinta)',
      border: '1px solid var(--color-borda)',
    },
    perigo: {
      background: 'var(--color-alerta-bg)',
      color: 'var(--color-alerta-ink)',
      border: '1px solid transparent',
    },
  }[variante]
  return (
    <button
      type={tipo ?? 'button'}
      onClick={onClick}
      style={estilos}
      className="toque inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl px-4 text-sm font-medium transition-all hover:opacity-90 active:scale-[0.97]"
    >
      {children}
    </button>
  )
}

/** Bloco de estatística com ícone, usado no Início e em outras telas de resumo. */
export function CartaoEstatistica({
  icone: Icone,
  numero,
  rotulo,
  onClick,
}: {
  icone: React.ElementType
  numero: ReactNode
  rotulo: string
  onClick?: () => void
}) {
  return (
    <Cartao onClick={onClick} className="text-center">
      <div
        className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl"
        style={{ background: 'var(--color-destaque-fraco)', color: 'var(--destaque)' }}
      >
        <Icone size={18} strokeWidth={1.75} />
      </div>
      <p className="tab-num text-2xl leading-none font-bold">{numero}</p>
      <p className="mt-1 text-xs text-[--color-tinta-3]">{rotulo}</p>
    </Cartao>
  )
}

/** Linha rótulo/valor, o formato de meia dúzia de telas. */
export function Linha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  if (valor === null || valor === undefined || valor === '') return null
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-[--color-tinta-3]">{rotulo}</span>
      <span className="text-right text-sm font-medium">{valor}</span>
    </div>
  )
}

export function Progresso({ pct }: { pct: number }) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-[--color-borda]"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${pct}%`, background: 'var(--destaque)' }}
      />
    </div>
  )
}
