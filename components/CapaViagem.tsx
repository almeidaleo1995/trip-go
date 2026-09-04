'use client'

// Capa da viagem: a foto do destino quando existe, e um horizonte desenhado
// quando não.
//
// Por que desenhado. O app tem que abrir em modo avião, e uma capa que depende
// de baixar 300 KB de foto é uma capa que some justamente na viagem. Este SVG
// pesa nada, nasce da cor da própria viagem (trips.cor_destaque) e das letras do
// id dela — então duas viagens nunca saem iguais, e a mesma viagem sai igual
// sempre. Quem quiser foto de verdade preenche `capa_url` e ela ganha daqui.
//
// Nenhuma cor de marca aparece neste arquivo: tudo é derivado da cor que veio do
// banco, misturada com branco e preto para dar profundidade.

import { useState } from 'react'

const PICOS = 5

/** Mistura dois hexadecimais. `t` = 0 devolve `a`, 1 devolve `b`. */
function mistura(a: string, b: string, t: number): string {
  const ler = (h: string) => {
    const s = h.replace('#', '')
    const n = s.length === 3 ? s.replace(/./g, (c) => c + c) : s
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0)
  }
  const [r1, g1, b1] = ler(a)
  const [r2, g2, b2] = ler(b)
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0')
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`
}

/**
 * Gerador pseudoaleatório com semente (FNV-1a + mulberry32).
 *
 * Precisa ser determinístico: se a montanha mudar de forma a cada render, o
 * cartão pisca a cada troca de aba. A mesma semente devolve sempre a mesma serra.
 */
function aleatorio(semente: string): () => number {
  let h = 2166136261
  for (let i = 0; i < semente.length; i++) {
    h ^= semente.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uma crista de montanha fechada até a base do quadro. */
function crista(rnd: () => number, base: number, altura: number): string {
  const passo = 120 / PICOS
  let d = `M0 ${(base - rnd() * altura).toFixed(1)}`
  for (let i = 1; i <= PICOS; i++) {
    d += ` L${(i * passo).toFixed(1)} ${(base - rnd() * altura).toFixed(1)}`
  }
  return `${d} L120 60 L0 60 Z`
}

export function CapaViagem({
  cor,
  semente,
  url,
  className = '',
  alt = '',
}: {
  cor: string
  semente: string
  url?: string | null
  className?: string
  alt?: string
}) {
  const [quebrou, setQuebrou] = useState(false)
  if (url && !quebrou) {
    return (
      // `onError` cai para o desenho: a foto é um link para o servidor de outra
      // pessoa, e link externo morre — 404, hotlink bloqueado, ou simplesmente o
      // avião. Sem isto o cartão mostra o ícone de imagem quebrada do navegador,
      // que parece defeito do app. O desenho não depende de rede e é a capa que
      // funciona em modo avião, então ele é o chão, não o degrau de cima.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setQuebrou(true)}
        className={`h-full w-full object-cover ${className}`}
      />
    )
  }

  const rnd = aleatorio(semente || 'viagem')
  const solX = 24 + rnd() * 72
  const id = `ceu-${semente.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'x'}`

  return (
    <svg
      viewBox="0 0 120 60"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      className={`h-full w-full ${className}`}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={mistura(cor, '#ffffff', 0.92)} />
          <stop offset="100%" stopColor={mistura(cor, '#ffffff', 0.68)} />
        </linearGradient>
      </defs>

      <rect width="120" height="60" fill={`url(#${id})`} />
      <circle cx={solX} cy="19" r="16" fill="#ffffff" opacity="0.28" />
      <circle cx={solX} cy="19" r="7" fill="#ffffff" opacity="0.75" />

      <path d={crista(rnd, 44, 16)} fill={mistura(cor, '#ffffff', 0.5)} />
      <path d={crista(rnd, 50, 14)} fill={mistura(cor, '#ffffff', 0.26)} />
      <path d={crista(rnd, 56, 11)} fill={mistura(cor, '#000000', 0.06)} />
    </svg>
  )
}
