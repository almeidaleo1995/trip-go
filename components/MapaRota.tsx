'use client'

// Mapa real da rota: ladrilhos do OpenStreetMap com um pino por cidade e a linha
// da viagem por cima.
//
// Feito com <img> + matemática de Web Mercator em vez de Leaflet/Mapbox: são
// ~60 linhas contra ~140 KB de biblioteca, e o mapa aqui não arrasta, não dá
// zoom e não clica — é uma figura. Biblioteca de mapa só se virar mapa de verdade.
//
// ponytail: ladrilho vem da rede, então em modo avião o mapa fica só com o fundo
// e os pinos (a rota continua legível). Cache offline de ladrilho exigiria
// guardá-los no IndexedDB — só vale se alguém realmente precisar do mapa a bordo.
import { useEffect, useRef, useState } from 'react'

type Lugar = { cidade?: string; lat?: number | string | null; lon?: number | string | null }

const TILE = 256

/** Web Mercator: grau -> pixel do mundo no zoom z. */
function projetar(lat: number, lon: number, z: number) {
  const escala = TILE * 2 ** z
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999)
  return {
    x: ((lon + 180) / 360) * escala,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * escala,
  }
}

export function MapaRota({ lugares }: { lugares: Lugar[] }) {
  const caixa = useRef<HTMLDivElement>(null)
  const [tamanho, setTamanho] = useState({ w: 0, h: 0 })

  // O enquadramento depende do tamanho real na tela, que só existe depois de montar.
  useEffect(() => {
    const el = caixa.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setTamanho({ w: e.contentRect.width, h: e.contentRect.height }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pontos = (lugares ?? [])
    .map((l) => ({ cidade: l.cidade, lat: Number(l.lat), lon: Number(l.lon) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))

  if (pontos.length === 0) return null

  const { w, h } = tamanho
  let conteudo: React.ReactNode = null

  if (w > 0 && h > 0) {
    const lats = pontos.map((p) => p.lat)
    const lons = pontos.map((p) => p.lon)
    const centroLat = (Math.min(...lats) + Math.max(...lats)) / 2
    const centroLon = (Math.min(...lons) + Math.max(...lons)) / 2

    // Maior zoom em que a rota inteira ainda cabe, com margem para os pinos.
    let z = 1
    for (let cand = 12; cand >= 1; cand--) {
      const proj = pontos.map((p) => projetar(p.lat, p.lon, cand))
      const larg = Math.max(...proj.map((p) => p.x)) - Math.min(...proj.map((p) => p.x))
      const alt = Math.max(...proj.map((p) => p.y)) - Math.min(...proj.map((p) => p.y))
      if (larg <= w - 48 && alt <= h - 48) {
        z = cand
        break
      }
    }

    const centro = projetar(centroLat, centroLon, z)
    const orig = { x: centro.x - w / 2, y: centro.y - h / 2 }
    const nTiles = 2 ** z

    const tiles: React.ReactNode[] = []
    for (let tx = Math.floor(orig.x / TILE); tx <= Math.floor((orig.x + w) / TILE); tx++) {
      for (let ty = Math.floor(orig.y / TILE); ty <= Math.floor((orig.y + h) / TILE); ty++) {
        // Fora do mundo na vertical não existe; na horizontal, dá a volta.
        if (ty < 0 || ty >= nTiles) continue
        const wx = ((tx % nTiles) + nTiles) % nTiles
        tiles.push(
          <img
            key={`${tx}-${ty}`}
            src={`https://tile.openstreetmap.org/${z}/${wx}/${ty}.png`}
            alt=""
            aria-hidden="true"
            width={TILE}
            height={TILE}
            className="absolute max-w-none"
            style={{ left: tx * TILE - orig.x, top: ty * TILE - orig.y }}
          />,
        )
      }
    }

    const naTela = pontos.map((p) => {
      const q = projetar(p.lat, p.lon, z)
      return { ...p, x: q.x - orig.x, y: q.y - orig.y }
    })

    conteudo = (
      <>
        {tiles}
        <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
          <path
            d={naTela
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
              .join(' ')}
            fill="none"
            stroke="var(--destaque)"
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinecap="round"
            opacity="0.9"
          />
          {naTela.map((p, i) => (
            <g key={`${p.cidade}-${i}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={i === 0 || i === naTela.length - 1 ? 5.5 : 4}
                fill={i === 0 || i === naTela.length - 1 ? 'var(--destaque)' : '#fff'}
                stroke="var(--destaque)"
                strokeWidth="2.5"
              />
            </g>
          ))}
        </svg>
        <span className="absolute right-1 bottom-0.5 rounded bg-white/75 px-1 text-[9px] text-(--color-tinta-3)">
          © OpenStreetMap
        </span>
      </>
    )
  }

  return (
    <div
      ref={caixa}
      role="img"
      aria-label={`Mapa da rota: ${pontos
        .map((p) => p.cidade)
        .filter(Boolean)
        .join(', ')}`}
      className="relative h-full min-h-[220px] w-full overflow-hidden rounded-2xl bg-(--color-fundo)"
    >
      {conteudo}
    </div>
  )
}
