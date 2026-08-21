'use client'

// Mapa da rota: pinos das cidades na ordem da viagem, ligados por curva.
//
// Genérico de verdade — projeta lat/lon e se reenquadra sozinho. Troque a viagem
// do Báltico por uma volta ao mundo e o desenho continua certo, sem tocar aqui.
//
// ponytail: o fundo é um gradiente abstrato, NÃO o contorno real dos continentes.
// Costa de verdade exige um GeoJSON simplificado (~20-50 KB) vindo de fonte
// confiável — é viável e continua offline, mas é dado que não se inventa. Se
// entrar, a projeção daqui precisa passar a bater com a do dataset.
import { projetarRota } from '@/lib/derive.ts'

type Lugar = { cidade?: string; lat?: number | string | null; lon?: number | string | null }

const L = 320
const A = 190

export function MapaRota({ lugares }: { lugares: Lugar[] }) {
  const pontos = projetarRota(
    (lugares ?? []).map((l) => ({ cidade: l.cidade, lat: l.lat ?? null, lon: l.lon ?? null })),
    L,
    A,
    26,
  )

  // Sem coordenada nenhuma o mapa não renderiza — e não deixa buraco na tela.
  if (pontos.length === 0) return null

  const curva = pontos
    .map((p, i) => {
      if (i === 0) return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      const a = pontos[i - 1]
      // Controle no meio, deslocado para cima: dá o arco de rota aérea sem
      // precisar de biblioteca de curva.
      const cx = (a.x + p.x) / 2
      const cy = (a.y + p.y) / 2 - Math.abs(p.x - a.x) * 0.16
      return `Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${L} ${A}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Rota da viagem: ${pontos
        .map((p) => p.cidade)
        .filter(Boolean)
        .join(', ')}`}
    >
      <defs>
        <linearGradient id="mar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E6F4F3" />
          <stop offset="100%" stopColor="#F7FAFA" />
        </linearGradient>
      </defs>

      <rect width={L} height={A} rx="16" fill="url(#mar)" />

      <path
        d={curva}
        fill="none"
        stroke="var(--destaque)"
        strokeWidth="1.6"
        strokeDasharray="4 3"
        strokeLinecap="round"
        opacity="0.75"
      />

      {pontos.map((p, i) => {
        const primeiro = i === 0
        const ultimo = i === pontos.length - 1
        const destacado = primeiro || ultimo
        // Rótulo à esquerda quando o pino está perto da borda direita, para o
        // texto não sair do quadro.
        const aEsquerda = p.x > L * 0.72
        return (
          <g key={`${p.cidade}-${i}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={destacado ? 5 : 3.5}
              fill={destacado ? 'var(--destaque)' : '#fff'}
              stroke="var(--destaque)"
              strokeWidth="1.8"
            />
            {p.cidade && (
              <text
                x={aEsquerda ? p.x - 8 : p.x + 8}
                y={p.y + 3.5}
                textAnchor={aEsquerda ? 'end' : 'start'}
                fontSize="9"
                fontWeight={destacado ? 700 : 500}
                /* #115E59 = 7.58:1 sobre o fundo claro do mapa */
                fill="#115E59"
              >
                {p.cidade}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
