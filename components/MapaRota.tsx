'use client'

// Mapa real da rota: ladrilhos do OpenStreetMap com um pino por cidade e a linha
// da viagem por cima.
//
// Feito com <img> + Web Mercator em vez de Leaflet/Mapbox: ~140 linhas contra
// ~140 KB de biblioteca. Enquadra a rota sozinho, aproxima e afasta pelos botões,
// pela roda e pela pinça, e arrasta com o dedo, o mouse ou as setas — mas não
// gira, não inclina e não clica no pino. Biblioteca de mapa só quando faltar
// disso. A matemática mora em `lib/mapa.ts`, testada sem navegador.
//
// QUEM MANDA NO GESTO: A PÁGINA, ATÉ VOCÊ APROXIMAR. O mapa é um cartão dentro
// de uma coluna que rola, então no enquadramento o dedo e a roda pertencem à
// página — a rota inteira já está na tela, não há para onde ir. Aproximou, o
// mapa assume: arrasta com um dedo, rola para dar zoom. Duas saídas ficam
// sempre abertas: a pinça (dois dedos nunca são rolagem) e Ctrl/⌘ + roda.
//
//   touch-action  pan-y  no enquadramento → um dedo rola a página, dois pinçam
//                 none   aproximado       → um dedo arrasta o mapa
//
// O botão de reenquadrar é a saída de volta de qualquer zoom ou arrasto — sem
// ele dava para se perder no oceano sem caminho de retorno.
//
// ponytail: ladrilho vem da rede, então em modo avião o mapa fica só com o fundo
// e os pinos (a rota continua legível). Cache offline de ladrilho exigiria
// guardá-los no IndexedDB — só vale se alguém realmente precisar do mapa a bordo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus,
  Minus,
  Route,
  Building2,
  BedDouble,
  Camera,
  UtensilsCrossed,
  Plane,
  TrainFront,
  Anchor,
  type LucideIcon,
} from 'lucide-react'
import { agrupar, type Categoria, type Marcador } from '@/lib/mapaViagem.ts'
import type { Modo } from '@/lib/hoje.ts'
import {
  TILE,
  Z_MIN,
  Z_MAX,
  VISTA_ENQUADRADA,
  projetar,
  enquadramento,
  limitarZoom,
  aplicarZoom,
  type Vista,
} from '@/lib/mapa.ts'

type Lugar = { cidade?: string; lat?: number | string | null; lon?: number | string | null }

/** Ícone e cor de cada categoria de marcador. A cor sai de `config/theme.ts`
    pelos tokens CSS — nenhuma cor de marca escrita aqui dentro. */
export const ESTILO_CATEGORIA: Record<Categoria, { Icone: LucideIcon; cor: string }> = {
  cidade: { Icone: Building2, cor: 'var(--destaque)' },
  hotel: { Icone: BedDouble, cor: '#9A3412' },
  atividade: { Icone: Camera, cor: '#6B21A8' },
  restaurante: { Icone: UtensilsCrossed, cor: '#BE123C' },
  aeroporto: { Icone: Plane, cor: '#1E40AF' },
  estacao: { Icone: TrainFront, cor: '#15803D' },
  porto: { Icone: Anchor, cor: '#0F766E' },
}

/**
 * Como cada modo desenha a linha (§6).
 *
 * O tracejado NÃO é decoração: ele é a diferença entre um trajeto que alguém
 * conferiu e duas cidades que só acontecem uma depois da outra. Voo e barco são
 * pontilhados porque a linha reta é honesta ali — ninguém espera que um avião
 * siga a estrada; trem e carro são contínuos porque a linha reta ali é uma
 * simplificação do traçado real, e a legenda do trecho diz isso.
 */
const TRACO_MODO: Record<Modo, string> = {
  aviao: '2 5',
  barco: '2 5',
  trem: '',
  carro: '',
  taxi: '',
  onibus: '',
  metro: '',
  a_pe: '1 4',
}

/** Um trecho desenhado no mapa. */
export type Segmento = {
  id: string
  de: { lat: number; lon: number }
  para: { lat: number; lon: number }
  modo: Modo | null
  /** Falso desenha mais apagado: a tela escreve "Rota não verificada" ao lado. */
  verificado: boolean
  rotulo: string
  /** Cor da perna, escolhida por quem monta o mapa (uma por etapa de origem,
      em rotação — ver `corDaEtapa` em config/theme.ts). Sem ela, cai no
      `--destaque` único de sempre. */
  cor?: string
}

/** Quanto cada seta do teclado move o mapa, em pixels. */
const PASSO_SETA = 40
const SETAS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** Quanto a roda precisa acumular para valer um passo de zoom. Um clique de
    mouse manda ~100 de uma vez; trackpad manda dezenas de migalhas, e sem
    acumular cada migalha viraria um passo — o mapa dispararia ao toque. */
const LIMIAR_RODA = 100

/** Fator de conversão de `deltaMode` para pixels: 0 já é pixel, 1 é linha, 2 é página. */
const ESCALA_DELTA = [1, 16, 100]

export function MapaRota({
  lugares,
  numerados,
  marcadores,
  segmentos,
  selecionado,
  aoSelecionar,
  aoSelecionarSegmento,
  corMarcador,
}: {
  lugares: Lugar[]
  /** Pinos numerados em sequência (1, 2, 3…) em vez do par início/fim — usado
      no mapa de um dia, onde a ordem de visita é a informação, não as pontas. */
  numerados?: boolean
  /**
   * O modo RICO do mapa: um pino por lugar, com categoria, ícone e clique.
   *
   * Quando vem preenchido, ele manda no enquadramento e substitui os pinos de
   * `lugares` — que continua sendo a forma simples usada no Início e no cartão
   * do dia. Dois modos no mesmo componente, e não dois componentes, porque a
   * parte difícil (ladrilho, Mercator, pinça, arrasto) é a mesma nos dois; era
   * ela que seria duplicada.
   */
  marcadores?: Marcador[]
  segmentos?: Segmento[]
  selecionado?: string | null
  aoSelecionar?: (id: string) => void
  aoSelecionarSegmento?: (id: string) => void
  /** Cor por marcador, decidida por quem monta o mapa — hoje só usada para dar
      uma cor por CIDADE (uma etapa da viagem, uma cor, em rotação), nunca uma
      paleta nova por categoria: hotel continua marrom, atividade continua
      roxo, em qualquer cidade. `undefined` cai no `ESTILO_CATEGORIA` de sempre. */
  corMarcador?: (m: Marcador) => string | undefined
}) {
  const rico = Array.isArray(marcadores)
  const caixa = useRef<HTMLDivElement>(null)
  const [tamanho, setTamanho] = useState({ w: 0, h: 0 })
  /** Zoom e deslocamento juntos: um gesto mexe nos dois de uma vez, e separados
      dava para pintar um quadro com o zoom novo e o deslocamento velho. */
  const [vista, setVista] = useState<Vista>(VISTA_ENQUADRADA)
  /** Onde cada dedo/ponteiro está agora. É o que distingue arrasto de pinça. */
  const ponteiros = useRef(new Map<number, { x: number; y: number }>())
  /** Onde o arrasto começou e qual era o deslocamento naquele instante. */
  const inicio = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  /** Distância inicial entre os dois dedos e quantos passos a pinça já aplicou. */
  const pinca = useRef<{ distancia: number; aplicados: number } | null>(null)
  const rodaAcumulada = useRef(0)

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

  // No modo rico o enquadramento segue os marcadores E as pontas dos segmentos:
  // uma perna Lisboa → Madri precisa caber inteira, mesmo que só uma das duas
  // cidades tenha pino visível pela camada ligada.
  const pontos = useMemo(
    () =>
      rico
        ? [
            ...(marcadores ?? []).map((m) => ({ cidade: m.nome, lat: m.lat, lon: m.lon })),
            ...(segmentos ?? []).flatMap((g) => [
              { cidade: g.rotulo, lat: g.de.lat, lon: g.de.lon },
              { cidade: g.rotulo, lat: g.para.lat, lon: g.para.lon },
            ]),
          ]
        : (lugares ?? [])
            .map((l) => ({ cidade: l.cidade, lat: Number(l.lat), lon: Number(l.lon) }))
            .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)),
    [rico, marcadores, segmentos, lugares],
  )

  const chavePontos = pontos.map((p) => `${p.lat},${p.lon}`).join('|')

  // Trocar de dia reenquadra. O zoom que alguém deu para ler uma rua de Madri
  // não quer dizer nada sobre Hamburgo — e voltar a um mapa aproximado no lugar
  // errado é pior do que não ter zoom.
  //
  // Ajustado DURANTE a renderização, não num efeito: React refaz este render na
  // hora, sem pintar o quadro intermediário. Num `useEffect` o mapa chegaria a
  // aparecer aproximado no lugar antigo antes de se corrigir.
  const [chaveAnterior, setChaveAnterior] = useState(chavePontos)
  if (chaveAnterior !== chavePontos) {
    setChaveAnterior(chavePontos)
    setVista(VISTA_ENQUADRADA)
  }

  const { w, h } = tamanho
  const zBase = enquadramento(pontos, w, h, numerados ? 72 : 48)
  const z = limitarZoom(zBase + vista.passos)
  // O mapa só toma conta do gesto depois que alguém aproximou — ver a nota no topo.
  const arrastavel = vista.passos > 0
  const enquadrado = vista.passos === 0 && vista.x === 0 && vista.y === 0

  const mudarZoom = useCallback(
    (delta: number, foco?: { x: number; y: number }) =>
      setVista((v) => aplicarZoom(v, delta, { zBase, w, h, foco })),
    [zBase, w, h],
  )

  // A roda precisa de listener nativo: React registra `wheel` como passivo no
  // root, e num listener passivo `preventDefault()` não faz nada — a página
  // rolaria junto com o zoom.
  useEffect(() => {
    const el = caixa.current
    if (!el) return
    const aoRolar = (e: WheelEvent) => {
      const forcado = e.ctrlKey || e.metaKey
      if (!forcado && !arrastavel) return // a página rola por cima do mapa
      e.preventDefault()
      rodaAcumulada.current += e.deltaY * (ESCALA_DELTA[e.deltaMode] ?? 1)
      const passos = Math.trunc(rodaAcumulada.current / LIMIAR_RODA)
      if (passos === 0) return
      rodaAcumulada.current -= passos * LIMIAR_RODA
      const r = el.getBoundingClientRect()
      // Rolar para longe (deltaY < 0) aproxima, como em qualquer mapa.
      mudarZoom(-passos, { x: e.clientX - r.left, y: e.clientY - r.top })
    }
    el.addEventListener('wheel', aoRolar, { passive: false })
    return () => el.removeEventListener('wheel', aoRolar)
  }, [arrastavel, mudarZoom])

  if (pontos.length === 0) return null

  const meioDosDedos = (alvo: HTMLElement) => {
    const [a, b] = [...ponteiros.current.values()]
    const r = alvo.getBoundingClientRect()
    return {
      distancia: Math.hypot(a.x - b.x, a.y - b.y),
      foco: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top },
    }
  }

  const aoPressionar = (e: React.PointerEvent<HTMLDivElement>) => {
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ponteiros.current.size === 2) {
      // Dois dedos é pinça, sempre — mesmo enquadrado, que é como se aproxima
      // no celular. O arrasto em curso é abandonado para não somar os dois.
      inicio.current = null
      pinca.current = { distancia: meioDosDedos(e.currentTarget).distancia, aplicados: 0 }
      return
    }
    if (!arrastavel) return
    e.currentTarget.setPointerCapture(e.pointerId)
    inicio.current = { x: e.clientX, y: e.clientY, vx: vista.x, vy: vista.y }
  }

  const aoMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ponteiros.current.has(e.pointerId)) return
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const p = pinca.current
    if (p && ponteiros.current.size === 2) {
      const { distancia, foco } = meioDosDedos(e.currentTarget)
      if (p.distancia <= 0) return
      // Cada dobro de distância entre os dedos vale um passo de zoom. `aplicados`
      // guarda o que já foi feito nesta pinça para não aplicar duas vezes.
      const desejado = Math.round(Math.log2(distancia / p.distancia))
      const delta = desejado - p.aplicados
      if (delta === 0) return
      p.aplicados = desejado
      mudarZoom(delta, foco)
      return
    }

    const i = inicio.current
    if (!i) return
    setVista((v) => ({ ...v, x: i.vx + (e.clientX - i.x), y: i.vy + (e.clientY - i.y) }))
  }

  const aoSoltar = (e: React.PointerEvent<HTMLDivElement>) => {
    ponteiros.current.delete(e.pointerId)
    if (ponteiros.current.size < 2) pinca.current = null
    inicio.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // Quem não usa ponteiro move pelas setas — arrastar não pode ser a única forma.
  const aoTeclar = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!arrastavel) return
    const rumo = SETAS[e.key]
    if (!rumo) return
    e.preventDefault()
    setVista((v) => ({ ...v, x: v.x - rumo[0] * PASSO_SETA, y: v.y - rumo[1] * PASSO_SETA }))
  }

  let conteudo: React.ReactNode = null

  if (w > 0 && h > 0) {
    const lats = pontos.map((p) => p.lat)
    const lons = pontos.map((p) => p.lon)
    const centro = projetar(
      (Math.min(...lats) + Math.max(...lats)) / 2,
      (Math.min(...lons) + Math.max(...lons)) / 2,
      z,
    )
    const orig = { x: centro.x - w / 2 - vista.x, y: centro.y - h / 2 - vista.y }
    const nTiles = 2 ** z

    const tiles: React.ReactNode[] = []
    for (let tx = Math.floor(orig.x / TILE); tx <= Math.floor((orig.x + w) / TILE); tx++) {
      for (let ty = Math.floor(orig.y / TILE); ty <= Math.floor((orig.y + h) / TILE); ty++) {
        // Fora do mundo na vertical não existe; na horizontal, dá a volta.
        if (ty < 0 || ty >= nTiles) continue
        const wx = ((tx % nTiles) + nTiles) % nTiles
        tiles.push(
          <img
            // A chave é o ladrilho NO MUNDO, não a posição na tela: arrastando,
            // o mesmo <img> muda de lugar em vez de ser recriado e recarregado.
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

    /** Grau -> pixel desta tela. Usado pelos marcadores e pelos segmentos. */
    const emTela = (pt: { lat: number; lon: number }) => {
      const q = projetar(pt.lat, pt.lon, z)
      return { x: q.x - orig.x, y: q.y - orig.y }
    }

    conteudo = (
      <>
        {/* A figura é um nó só para o leitor de tela: os pinos não são alvos e a
            legenda já diz a rota. Os botões ficam FORA dela — dentro de um
            role="img" nada é alcançável. */}
        <div
          // No modo rico isto vira um GRUPO, não uma figura: `role="img"` torna
          // a subárvore inteira um nó só, e os pinos-botões desapareceriam do
          // leitor de tela e do Tab. No modo simples continua figura — lá os
          // pinos realmente não são alvos e a legenda já diz a rota.
          role={rico ? 'group' : 'img'}
          aria-label={`Mapa da rota: ${pontos
            .map((p) => p.cidade)
            .filter(Boolean)
            .join(', ')}${arrastavel ? '. Arraste ou use as setas para mover.' : ''}`}
          tabIndex={arrastavel ? 0 : undefined}
          onPointerDown={aoPressionar}
          onPointerMove={aoMover}
          onPointerUp={aoSoltar}
          onPointerCancel={aoSoltar}
          onKeyDown={aoTeclar}
          // `pan-y` deixa um dedo rolar a página e ainda entrega a pinça aqui;
          // aproximado, `none` porque um dedo passa a arrastar o mapa.
          style={{ touchAction: arrastavel ? 'none' : 'pan-y' }}
          className={`absolute inset-0 ${
            arrastavel ? 'cursor-grab select-none active:cursor-grabbing' : ''
          }`}
        >
          {tiles}
          <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
            {/* No modo rico a rota são segmentos independentes, um por perna,
                cada um com o traço do seu modo. No modo simples continua sendo
                uma polilinha só — é uma rota, não uma lista de trajetos. */}
            {rico ? (
              (segmentos ?? []).map((g) => {
                const a = emTela(g.de)
                const b = emTela(g.para)
                const ativo = selecionado === g.id
                return (
                  <line
                    key={g.id}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={g.cor ?? 'var(--destaque)'}
                    strokeWidth={ativo ? 4 : 2.5}
                    // Sem modo conhecido o traço é largo e vazado: é a marca de
                    // "Rota não verificada", visível antes de qualquer texto.
                    strokeDasharray={g.modo ? TRACO_MODO[g.modo] : '6 6'}
                    strokeLinecap="round"
                    opacity={g.verificado ? (ativo ? 1 : 0.75) : 0.4}
                  />
                )
              })
            ) : (
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
            )}
            {!rico &&
              naTela.map((p, i) =>
                numerados ? (
                  // A ponta da gota fica NA coordenada; o número sobe para a cabeça.
                  // Um disco centrado no ponto marcaria um lugar ~17px acima do real.
                  <g key={`${p.cidade}-${i}`}>
                    <path
                      d={`M ${p.x - 5} ${p.y - 14} L ${p.x} ${p.y} L ${p.x + 5} ${p.y - 14} Z`}
                      fill="var(--destaque)"
                    />
                    <circle
                      cx={p.x}
                      cy={p.y - 17}
                      r={9}
                      fill="var(--destaque)"
                      stroke="#fff"
                      strokeWidth="2"
                    />
                    <text
                      x={p.x}
                      y={p.y - 17}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="10"
                      fontWeight="700"
                      fill="#fff"
                    >
                      {i + 1}
                    </text>
                  </g>
                ) : (
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
                ),
              )}
          </svg>

          {/* Os marcadores são BOTÕES de verdade, não formas dentro do SVG.
              Um <circle> não recebe foco, não tem nome acessível e não tem
              alvo de toque — e §34 pede os três. Como HTML, cada pino já vem
              com anel de foco, `aria-label` e 44px de área tocável. */}
          {rico &&
            agrupar((marcadores ?? []).map((m) => ({ ...m, ...emTela(m) }))).map((grupo) => {
              // Mais de um no mesmo pixel vira um contador. Aproximar SEPARA o
              // grupo sozinho, porque a grade é medida em pixels de tela — daí
              // o clique dar zoom em vez de abrir uma lista: a lista já existe
              // no mapa, escondida atrás da sobreposição.
              if (grupo.itens.length > 1) {
                return (
                  <button
                    key={grupo.chave}
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => mudarZoom(2, { x: grupo.x, y: grupo.y })}
                    aria-label={`${grupo.itens.length} locais juntos: ${grupo.itens
                      .map((i) => i.nome)
                      .join(', ')}. Aproximar para separar.`}
                    className="tab-num absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-2 border-white text-[12px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--destaque)"
                    style={{
                      left: grupo.x,
                      top: grupo.y,
                      background: 'var(--destaque)',
                      boxShadow: 'var(--sombra-1)',
                      zIndex: 2,
                    }}
                  >
                    {grupo.itens.length}
                  </button>
                )
              }

              const m = grupo.itens[0]
              const { x, y } = m
              const { Icone, cor: corPadrao } = ESTILO_CATEGORIA[m.categoria]
              const cor = corMarcador?.(m) ?? corPadrao
              const ativo = selecionado === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => aoSelecionar?.(m.id)}
                  aria-pressed={ativo}
                  aria-label={`${m.nome}${m.aproximado ? ' — localização aproximada' : ''}`}
                  title={m.nome}
                  // 44px de alvo, com a arte de 26px centrada dentro: o toque é
                  // generoso sem o pino cobrir o mapa. A ponta do pino fica NA
                  // coordenada — daí o -100% e os 13px de volta.
                  className="absolute flex h-11 w-11 -translate-x-1/2 cursor-pointer items-end justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--destaque)"
                  style={{ left: x, top: y - 44 + 13, zIndex: ativo ? 3 : 2 }}
                >
                  <span
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-white transition-transform"
                    style={{
                      background: cor,
                      boxShadow: 'var(--sombra-1)',
                      transform: ativo ? 'scale(1.25)' : undefined,
                    }}
                  >
                    <Icone size={13} color="#fff" aria-hidden strokeWidth={2.4} />
                  </span>
                  {/* Localização aproximada NÃO depende só de cor: é um anel
                      tracejado em volta do pino, que sobrevive a daltonismo e
                      a uma captura em preto e branco. */}
                  {m.aproximado && (
                    <span
                      aria-hidden
                      className="absolute bottom-0 h-[34px] w-[34px] rounded-full border border-dashed"
                      style={{ borderColor: cor }}
                    />
                  )}
                </button>
              )
            })}

          {/* O trecho é clicável pelo MEIO da linha: um <line> de 2px é um alvo
              impossível no dedo, e o meio é onde ninguém disputa com um pino. */}
          {rico &&
            aoSelecionarSegmento &&
            (segmentos ?? []).map((g) => {
              const a = emTela(g.de)
              const b = emTela(g.para)
              return (
                <button
                  key={`alvo-${g.id}`}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => aoSelecionarSegmento(g.id)}
                  aria-label={`Trecho ${g.rotulo}${g.verificado ? '' : ' — rota não verificada'}`}
                  title={g.rotulo}
                  className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--destaque)"
                  style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2, zIndex: 1 }}
                />
              )
            })}

          <span className="absolute right-1 bottom-0.5 rounded bg-white/75 px-1 text-[9px] text-(--color-tinta-3)">
            © OpenStreetMap
          </span>
        </div>

        <ControlesZoom
          podeAproximar={z < Z_MAX}
          podeAfastar={z > Z_MIN}
          enquadrado={enquadrado}
          aoAproximar={() => mudarZoom(1)}
          aoAfastar={() => mudarZoom(-1)}
          aoEnquadrar={() => setVista(VISTA_ENQUADRADA)}
        />
      </>
    )
  }

  return (
    <div
      ref={caixa}
      className="relative h-full min-h-[220px] w-full overflow-hidden rounded-2xl bg-(--color-fundo)"
    >
      {conteudo}
    </div>
  )
}

/**
 * Aproximar, afastar e voltar ao enquadramento da rota.
 *
 * 36px de alvo, e não os 44px de `.toque`: é a convenção de controle de mapa, e
 * o cartão do dia tem 224px de altura — dois quadrados de 44 dominariam a figura
 * que eles servem. Fica acima do mínimo de 24px do WCAG 2.2 AA, com rótulo e
 * anel de foco. Num mapa maior (tela cheia) dá para subir para 44.
 */
function ControlesZoom({
  podeAproximar,
  podeAfastar,
  enquadrado,
  aoAproximar,
  aoAfastar,
  aoEnquadrar,
}: {
  podeAproximar: boolean
  podeAfastar: boolean
  enquadrado: boolean
  aoAproximar: () => void
  aoAfastar: () => void
  aoEnquadrar: () => void
}) {
  const botao =
    'flex h-9 w-9 cursor-pointer items-center justify-center text-(--color-tinta) transition-colors hover:bg-(--color-superficie-2) disabled:cursor-not-allowed disabled:text-(--color-tinta-3) disabled:opacity-50 disabled:hover:bg-transparent'
  const risco = <span aria-hidden className="h-px bg-(--color-borda)" />

  return (
    <div
      className="sem-impressao absolute right-2 bottom-6 flex flex-col overflow-hidden rounded-xl border border-(--color-borda) bg-(--color-cartao)"
      style={{ boxShadow: 'var(--sombra-1)' }}
    >
      <button type="button" onClick={aoAproximar} disabled={!podeAproximar} className={botao}>
        <Plus size={15} aria-hidden />
        <span className="sr-only">Aproximar o mapa</span>
      </button>
      {risco}
      <button type="button" onClick={aoAfastar} disabled={!podeAfastar} className={botao}>
        <Minus size={15} aria-hidden />
        <span className="sr-only">Afastar o mapa</span>
      </button>
      {/* Só aparece quando há para onde voltar: no enquadramento da rota ele não
          faria nada, e um botão que não faz nada ensina a ignorar o grupo. */}
      {!enquadrado && (
        <>
          {risco}
          <button type="button" onClick={aoEnquadrar} className={botao}>
            <Route size={15} aria-hidden />
            <span className="sr-only">Voltar ao enquadramento da rota</span>
          </button>
        </>
      )}
    </div>
  )
}
