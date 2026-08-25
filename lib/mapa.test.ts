// Testes da matemática do mapa. `npm run test`.
//
// O que importa aqui é uma invariante só, e é ela que quebra em silêncio:
// depois de aproximar, o ponto que estava sob o dedo tem de continuar sob o
// dedo. Um sinal trocado no ajuste passa pelo typecheck, pelo lint e pelo olho —
// e só aparece quando o mapa foge do lugar no meio de uma pinça.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TILE,
  Z_MIN,
  Z_MAX,
  enquadramento,
  aplicarZoom,
  limitarZoom,
  VISTA_ENQUADRADA,
  type Vista,
} from './mapa.ts'

const CAIXA = { w: 318, h: 224 } // o cartão do mapa do dia, tamanho real
const MADRI = { lat: 40.4168, lon: -3.708 }
const HAMBURGO = { lat: 53.5511, lon: 9.9937 }

/**
 * Onde, em fração do mundo (0 a 1), cai o pixel `s` da caixa numa dada vista.
 * É a conta que o componente faz para posicionar ladrilho e pino, escrita aqui
 * de forma independente do zoom para poder comparar duas vistas diferentes.
 */
function fracaoDoMundo(vista: Vista, zBase: number, s: { x: number; y: number }) {
  const escala = TILE * 2 ** limitarZoom(zBase + vista.passos)
  return {
    x: (s.x - CAIXA.w / 2 - vista.x) / escala,
    y: (s.y - CAIXA.h / 2 - vista.y) / escala,
  }
}

test('enquadramento cabe a rota inteira e aproxima num ponto so', () => {
  const dois = enquadramento([MADRI, HAMBURGO], CAIXA.w, CAIXA.h, 72)
  const um = enquadramento([MADRI], CAIXA.w, CAIXA.h, 72)
  assert.ok(dois < um, 'dois pontos distantes precisam de zoom menor que um so')
  assert.equal(um, 12, 'um ponto so vai ao zoom maximo do enquadramento')
})

test('enquadramento nao explode sem pontos nem sem caixa medida', () => {
  assert.equal(enquadramento([], CAIXA.w, CAIXA.h), 1)
  assert.equal(enquadramento([MADRI], 0, 0), 1)
})

test('aproximar sem foco mantem o centro da caixa parado', () => {
  const zBase = 10
  const centro = { x: CAIXA.w / 2, y: CAIXA.h / 2 }
  const antes = fracaoDoMundo(VISTA_ENQUADRADA, zBase, centro)
  const depois = fracaoDoMundo(aplicarZoom(VISTA_ENQUADRADA, 1, { zBase, ...CAIXA }), zBase, centro)
  assert.ok(Math.abs(antes.x - depois.x) < 1e-12)
  assert.ok(Math.abs(antes.y - depois.y) < 1e-12)
})

test('aproximar com foco mantem parado o ponto sob o dedo, nao o centro', () => {
  const zBase = 10
  const foco = { x: 280, y: 24 } // canto superior direito, bem longe do centro
  const antes = fracaoDoMundo(VISTA_ENQUADRADA, zBase, foco)
  const depois = fracaoDoMundo(
    aplicarZoom(VISTA_ENQUADRADA, 1, { zBase, ...CAIXA, foco }),
    zBase,
    foco,
  )
  assert.ok(Math.abs(antes.x - depois.x) < 1e-12, 'o ponto do foco escorregou no eixo x')
  assert.ok(Math.abs(antes.y - depois.y) < 1e-12, 'o ponto do foco escorregou no eixo y')
})

test('o foco continua parado partindo de um mapa ja arrastado e aproximado', () => {
  const zBase = 8
  const foco = { x: 60, y: 190 }
  const vista: Vista = { passos: 3, x: -140, y: 75 }
  const antes = fracaoDoMundo(vista, zBase, foco)
  const depois = fracaoDoMundo(aplicarZoom(vista, 1, { zBase, ...CAIXA, foco }), zBase, foco)
  assert.ok(Math.abs(antes.x - depois.x) < 1e-12)
  assert.ok(Math.abs(antes.y - depois.y) < 1e-12)
})

test('afastar desfaz exatamente o aproximar, com o mesmo foco', () => {
  const zBase = 9
  const foco = { x: 200, y: 40 }
  const perto = aplicarZoom(VISTA_ENQUADRADA, 1, { zBase, ...CAIXA, foco })
  const volta = aplicarZoom(perto, -1, { zBase, ...CAIXA, foco })
  assert.equal(volta.passos, 0)
  assert.ok(Math.abs(volta.x) < 1e-9)
  assert.ok(Math.abs(volta.y) < 1e-9)
})

test('a pinca larga em varios passos de uma vez mantem o foco parado', () => {
  const zBase = 6
  const foco = { x: 250, y: 200 }
  const antes = fracaoDoMundo(VISTA_ENQUADRADA, zBase, foco)
  const depois = fracaoDoMundo(
    aplicarZoom(VISTA_ENQUADRADA, 3, { zBase, ...CAIXA, foco }),
    zBase,
    foco,
  )
  assert.ok(Math.abs(antes.x - depois.x) < 1e-12)
  assert.ok(Math.abs(antes.y - depois.y) < 1e-12)
})

test('no limite a vista nao muda e passos nao acumula escondido', () => {
  const zBase = 12
  // insiste no aproximar muito alem do teto
  let v = VISTA_ENQUADRADA
  for (let i = 0; i < 20; i++) v = aplicarZoom(v, 1, { zBase, ...CAIXA })
  assert.equal(limitarZoom(zBase + v.passos), Z_MAX)
  assert.equal(v.passos, Z_MAX - zBase, 'passos ficou alem do que o mapa mostra')

  // o primeiro afastar depois disso tem de valer
  const afastou = aplicarZoom(v, -1, { zBase, ...CAIXA })
  assert.equal(limitarZoom(zBase + afastou.passos), Z_MAX - 1)

  // e o mesmo do outro lado
  let baixo = VISTA_ENQUADRADA
  for (let i = 0; i < 20; i++) baixo = aplicarZoom(baixo, -1, { zBase, ...CAIXA })
  assert.equal(limitarZoom(zBase + baixo.passos), Z_MIN)
  assert.equal(limitarZoom(zBase + aplicarZoom(baixo, 1, { zBase, ...CAIXA }).passos), Z_MIN + 1)
})

test('zoom travado devolve a mesma vista, sem objeto novo', () => {
  const zBase = Z_MAX
  const v: Vista = { passos: 0, x: 10, y: 20 }
  assert.equal(aplicarZoom(v, 1, { zBase, ...CAIXA }), v)
})
