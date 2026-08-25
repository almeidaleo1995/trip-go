// A matemática do mapa de rota: projeção Web Mercator, enquadramento automático
// e o ajuste de zoom que mantém um ponto parado sob o dedo.
//
// Mora aqui, e não dentro do componente, porque é a parte que erra em silêncio:
// um sinal trocado no foco do zoom joga o mapa para o outro lado do mundo e nada
// na tela explica o porquê. Fora do .tsx dá para testar sem navegador.

export const TILE = 256

/** Limites do zoom manual. Abaixo de 2 o mundo se repete na tela; acima de 17 o
    OpenStreetMap começa a devolver ladrilho vazio em boa parte do planeta. */
export const Z_MIN = 2
export const Z_MAX = 17

export type Ponto = { lat: number; lon: number }

/** O que a pessoa fez com o mapa: quantos passos de zoom saiu do enquadramento
    automático, e quantos pixels arrastou a partir do centro da rota. */
export type Vista = { passos: number; x: number; y: number }

export const VISTA_ENQUADRADA: Vista = { passos: 0, x: 0, y: 0 }

/** Web Mercator: grau -> pixel do mundo no zoom z. */
export function projetar(lat: number, lon: number, z: number) {
  const escala = TILE * 2 ** z
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999)
  return {
    x: ((lon + 180) / 360) * escala,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * escala,
  }
}

export function limitarZoom(z: number): number {
  return Math.min(Z_MAX, Math.max(Z_MIN, z))
}

/**
 * Maior zoom em que a rota inteira ainda cabe numa caixa de w x h, com margem
 * para os pinos não saírem cortados nas bordas.
 */
export function enquadramento(pontos: Ponto[], w: number, h: number, margemY = 48): number {
  if (pontos.length === 0 || w <= 0 || h <= 0) return 1
  for (let z = 12; z >= 1; z--) {
    const proj = pontos.map((p) => projetar(p.lat, p.lon, z))
    const xs = proj.map((p) => p.x)
    const ys = proj.map((p) => p.y)
    const larg = Math.max(...xs) - Math.min(...xs)
    const alt = Math.max(...ys) - Math.min(...ys)
    if (larg <= w - 48 && alt <= h - margemY) return z
  }
  return 1
}

/**
 * Aplica `delta` passos de zoom mantendo parado o ponto sob `foco` — o cursor,
 * o meio da pinça, ou o centro da caixa quando ninguém aponta nada.
 *
 * O deslocamento está em pixels do zoom ATUAL: dobrar o zoom dobra a distância
 * que aqueles mesmos pixels representam, daí o fator `k`. O segundo termo é o
 * que segura o ponto do foco: sem ele, aproximar sempre puxaria para o centro e
 * a pinça escaparia do lugar onde os dedos estão.
 *
 * Devolve a MESMA vista quando o zoom bateria no limite, e guarda `passos` já
 * limitado — assim nada acumula além do que o mapa consegue mostrar, e afastar
 * depois de insistir no `+` volta a funcionar no primeiro toque.
 */
export function aplicarZoom(
  vista: Vista,
  delta: number,
  { zBase, w, h, foco }: { zBase: number; w: number; h: number; foco?: { x: number; y: number } },
): Vista {
  const zAgora = limitarZoom(zBase + vista.passos)
  const zNovo = limitarZoom(zBase + vista.passos + delta)
  if (zNovo === zAgora) return vista

  const k = 2 ** (zNovo - zAgora)
  const fx = foco?.x ?? w / 2
  const fy = foco?.y ?? h / 2
  return {
    passos: zNovo - zBase,
    x: k * vista.x + (k - 1) * (w / 2 - fx),
    y: k * vista.y + (k - 1) * (h / 2 - fy),
  }
}
