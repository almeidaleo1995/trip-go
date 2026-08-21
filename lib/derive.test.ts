// Testes dos calculos derivados. Rodam com o runner nativo do Node 24 (type
// stripping ligado por padrao): `npm run test`. Sem Jest, sem Vitest, sem config.
//
// Os casos usam a viagem real como fixture (Europa 2027, 30/12/2026 a 15/01/2027)
// porque numeros de verdade pegam erro que numero redondo esconde.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseData,
  diasAte,
  noites,
  noitesABordo,
  faseDaViagem,
  proximoCompromisso,
  ordenarEventos,
  contarLugares,
  progressoChecklist,
  totaisFinanceiro,
  projetarRota,
  mesclarLWW,
  formatarDuracao,
  formatarDinheiro,
} from './derive.ts'

const PARTIDA = '2026-12-30'
const RETORNO = '2027-01-15'

// ---------------------------------------------------------------- parseData

test('parseData nao desloca data-so-dia para o dia anterior', () => {
  // O bug classico: new Date("2026-12-30") e UTC, e vira 29/12 no Brasil.
  const d = parseData('2026-12-30')!
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 11)
  assert.equal(d.getDate(), 30)
  assert.equal(d.getHours(), 0)
})

test('parseData le hora local do destino sem converter fuso', () => {
  const d = parseData('2026-12-30T10:30')!
  assert.equal(d.getHours(), 10)
  assert.equal(d.getMinutes(), 30)
})

test('parseData aceita segundos e espaco no lugar do T', () => {
  assert.equal(parseData('2027-01-15 16:50:30')!.getSeconds(), 30)
})

test('parseData devolve null para entrada invalida', () => {
  for (const v of [null, undefined, '', 'ontem', '30/12/2026', '2026-13-45x']) {
    assert.equal(parseData(v as string), null, `deveria rejeitar: ${v}`)
  }
})

// ---------------------------------------------------------------- dias e noites

test('diasAte conta os 16 dias entre partida e retorno', () => {
  assert.equal(diasAte(PARTIDA, RETORNO), 16)
})

test('diasAte nunca devolve negativo em intervalo invertido', () => {
  assert.equal(diasAte(RETORNO, PARTIDA), 0)
})

test('diasAte ignora a hora e conta dias de calendario', () => {
  assert.equal(diasAte('2026-12-30T23:59', '2026-12-31T00:01'), 1)
})

test('noites de Hamburgo 01/01 a 03/01 sao 2', () => {
  assert.equal(noites('2027-01-01', '2027-01-03'), 2)
})

test('noites com data faltando devolve 0 em vez de NaN', () => {
  assert.equal(noites(null, '2027-01-03'), 0)
  assert.equal(noites('2027-01-01', null), 0)
})

test('noitesABordo do Preziosa sao 7', () => {
  assert.equal(noitesABordo('2027-01-03T20:00', '2027-01-10T07:00'), 7)
})

// ---------------------------------------------------------------- fase da viagem

test('faseDaViagem antes da partida conta dias restantes', () => {
  const f = faseDaViagem('2026-08-21', PARTIDA, RETORNO)
  assert.equal(f.fase, 'antes')
  assert.equal(f.diasRestantes, 131) // bate com a contagem das referencias visuais
  assert.equal(f.totalDias, 16)
})

test('faseDaViagem no dia da partida ja e durante, dia 1', () => {
  const f = faseDaViagem('2026-12-30T06:00', PARTIDA, RETORNO)
  assert.equal(f.fase, 'durante')
  assert.equal(f.diaAtual, 1)
  assert.equal(f.diasRestantes, 0)
})

test('faseDaViagem no dia do retorno ainda e durante', () => {
  assert.equal(faseDaViagem('2027-01-15T16:50', PARTIDA, RETORNO).fase, 'durante')
})

test('faseDaViagem depois do retorno e depois', () => {
  const f = faseDaViagem('2027-01-16', PARTIDA, RETORNO)
  assert.equal(f.fase, 'depois')
  assert.equal(f.diaAtual, 0)
})

test('faseDaViagem com partida depois do retorno da duracao 0, nunca negativa', () => {
  assert.equal(faseDaViagem('2026-08-21', RETORNO, PARTIDA).totalDias, 0)
})

test('faseDaViagem sem datas nao quebra', () => {
  const f = faseDaViagem('2026-08-21', null, null)
  assert.equal(f.totalDias, 0)
  assert.equal(f.fase, 'antes')
})

// ---------------------------------------------------------------- roteiro

const EVENTOS = [
  { id: 'a', ocorre_em: '2026-12-30T10:30', titulo: 'LA719 FLN - SCL' },
  { id: 'b', ocorre_em: 'data invalida', titulo: 'evento quebrado' },
  { id: 'c', ocorre_em: '2027-01-03T20:00', titulo: 'MSC Preziosa parte' },
  { id: 'd', ocorre_em: null, titulo: 'sem data' },
  { id: 'e', ocorre_em: '2026-12-31T17:30', titulo: 'Chegada Madri' },
]

test('proximoCompromisso pega o futuro mais proximo, nao o primeiro da lista', () => {
  assert.equal(proximoCompromisso(EVENTOS, '2026-12-30T12:00')!.id, 'e')
})

test('proximoCompromisso ignora eventos com data invalida ou ausente', () => {
  assert.equal(proximoCompromisso(EVENTOS, '2027-01-01')!.id, 'c')
})

test('proximoCompromisso inclui evento que acontece exatamente agora', () => {
  assert.equal(proximoCompromisso(EVENTOS, '2027-01-03T20:00')!.id, 'c')
})

test('proximoCompromisso devolve null quando nao ha futuro', () => {
  assert.equal(proximoCompromisso(EVENTOS, '2027-02-01'), null)
})

test('proximoCompromisso devolve null em lista vazia', () => {
  assert.equal(proximoCompromisso([], '2026-12-30'), null)
})

test('ordenarEventos poe os sem data no fim, preservando a ordem original', () => {
  const ids = ordenarEventos(EVENTOS).map((e) => e.id)
  assert.deepEqual(ids, ['a', 'e', 'c', 'b', 'd'])
})

// ---------------------------------------------------------------- lugares

test('contarLugares conta cidades e paises distintos', () => {
  const r = contarLugares([
    { cidade: 'Hamburgo', pais: 'Alemanha' },
    { cidade: 'Bruges', pais: 'Bélgica' },
    { cidade: 'Roterdã', pais: 'Holanda' },
    { cidade: 'Roma', pais: 'Itália' },
    { cidade: 'Barcelona', pais: 'Espanha' },
    { cidade: 'Madri', pais: 'Espanha' },
  ])
  assert.equal(r.cidades, 6)
  assert.equal(r.paises, 5)
})

test('contarLugares trata cidades homonimas em paises diferentes como distintas', () => {
  const r = contarLugares([
    { cidade: 'Santiago', pais: 'Chile' },
    { cidade: 'Santiago', pais: 'Espanha' },
  ])
  assert.equal(r.cidades, 2)
  assert.equal(r.paises, 2)
})

test('contarLugares com lista vazia devolve zeros', () => {
  assert.deepEqual(contarLugares([]), { cidades: 0, paises: 0 })
})

// ---------------------------------------------------------------- checklist

test('progressoChecklist arredonda para inteiro', () => {
  const itens = [{ id: '1' }, { id: '2' }, { id: '3' }]
  const r = progressoChecklist(itens, { '1': true })
  assert.equal(r.feitos, 1)
  assert.equal(r.pct, 33)
})

test('progressoChecklist com lista vazia devolve 0 sem dividir por zero', () => {
  const r = progressoChecklist([], {})
  assert.equal(r.pct, 0)
  assert.ok(Number.isFinite(r.pct))
})

test('progressoChecklist ignora IDs que nao existem mais no checklist', () => {
  const r = progressoChecklist([{ id: '1' }, { id: '2' }], { '1': true, apagado: true })
  assert.equal(r.total, 2)
  assert.equal(r.feitos, 1)
  assert.equal(r.pct, 50)
})

test('progressoChecklist trata valor falso como nao feito', () => {
  assert.equal(progressoChecklist([{ id: '1' }], { '1': false }).feitos, 0)
})

// ---------------------------------------------------------------- financeiro

test('totaisFinanceiro multiplica por pessoa e soma por categoria', () => {
  // ETA do Reino Unido: R$ 110 por pessoa x 5 = R$ 550
  const r = totaisFinanceiro([
    { categoria_id: 'doc', valor_centavos: 11_000, pessoas: 5 },
    { categoria_id: 'doc', valor_centavos: 28_000, pessoas: 5 },
    { categoria_id: 'voo', valor_centavos: 96_700, pessoas: 5 },
  ])
  assert.equal(r.porCategoria.doc, 195_000)
  assert.equal(r.porCategoria.voo, 483_500)
  assert.equal(r.total, 678_500)
})

test('totaisFinanceiro mantem tudo inteiro, sem residuo de ponto flutuante', () => {
  const r = totaisFinanceiro([
    { categoria_id: 'a', valor_centavos: 10, pessoas: 3 },
    { categoria_id: 'a', valor_centavos: 20, pessoas: 3 },
  ])
  assert.equal(r.total, 90)
  assert.ok(Number.isInteger(r.total))
})

test('totaisFinanceiro agrupa custo sem categoria', () => {
  const r = totaisFinanceiro([{ categoria_id: null, valor_centavos: 500, pessoas: 1 }])
  assert.equal(r.porCategoria['sem-categoria'], 500)
})

test('totaisFinanceiro com lista vazia devolve total 0', () => {
  assert.equal(totaisFinanceiro([]).total, 0)
})

// ---------------------------------------------------------------- mapa

const ROTA = [
  { cidade: 'Hamburgo', lat: 53.55, lon: 9.99 },
  { cidade: 'Zeebrugge', lat: 51.33, lon: 3.2 },
  { cidade: 'Roterdã', lat: 51.92, lon: 4.48 },
  { cidade: 'Southampton', lat: 50.9, lon: -1.4 },
]

test('projetarRota mantem todos os pontos dentro do viewBox com margem', () => {
  const p = projetarRota(ROTA, 100, 100, 10)
  assert.equal(p.length, 4)
  for (const { x, y, cidade } of p) {
    assert.ok(x >= 10 - 0.001 && x <= 90 + 0.001, `${cidade} fora no eixo x: ${x}`)
    assert.ok(y >= 10 - 0.001 && y <= 90 + 0.001, `${cidade} fora no eixo y: ${y}`)
  }
})

test('projetarRota inverte o eixo y: latitude maior fica mais em cima', () => {
  const p = projetarRota(ROTA, 100, 100, 10)
  const hamburgo = p.find((x) => x.cidade === 'Hamburgo')!
  const southampton = p.find((x) => x.cidade === 'Southampton')!
  assert.ok(hamburgo.y < southampton.y, 'Hamburgo e mais ao norte, deveria ter y menor')
})

test('projetarRota mantem a ordem de entrada, que e a ordem da rota', () => {
  assert.deepEqual(
    projetarRota(ROTA).map((p) => p.cidade),
    ['Hamburgo', 'Zeebrugge', 'Roterdã', 'Southampton'],
  )
})

test('projetarRota com um ponto so nao divide por zero', () => {
  const p = projetarRota([{ cidade: 'Roma', lat: 41.9, lon: 12.5 }], 100, 100, 10)
  assert.equal(p.length, 1)
  assert.ok(Number.isFinite(p[0].x) && Number.isFinite(p[0].y))
  assert.equal(p[0].x, 50)
  assert.equal(p[0].y, 50)
})

test('projetarRota descarta pontos sem coordenada', () => {
  const p = projetarRota([
    { cidade: 'Roma', lat: 41.9, lon: 12.5 },
    { cidade: 'Sem coords', lat: null, lon: null },
  ])
  assert.equal(p.length, 1)
})

test('projetarRota sem nenhuma coordenada devolve lista vazia', () => {
  assert.deepEqual(projetarRota([{ cidade: 'X', lat: null, lon: null }]), [])
  assert.deepEqual(projetarRota([]), [])
})

test('projetarRota reenquadra sozinha para outro continente', () => {
  const p = projetarRota(
    [
      { cidade: 'Tóquio', lat: 35.68, lon: 139.69 },
      { cidade: 'Sydney', lat: -33.87, lon: 151.21 },
    ],
    100,
    100,
    10,
  )
  for (const { x, y } of p) {
    assert.ok(x >= 9.999 && x <= 90.001)
    assert.ok(y >= 9.999 && y <= 90.001)
  }
})

// ---------------------------------------------------------------- LWW

test('mesclarLWW mantem a versao com updated_at mais recente', () => {
  const local = { updated_at: '2026-08-21T10:00:00.000Z', v: 'local' }
  const remoto = { updated_at: '2026-08-21T11:00:00.000Z', v: 'remoto' }
  assert.equal(mesclarLWW(local, remoto).v, 'remoto')
  assert.equal(mesclarLWW(remoto, local).v, 'remoto')
})

test('mesclarLWW em empate fica com o remoto, que e a fonte da verdade', () => {
  const t = '2026-08-21T10:00:00.000Z'
  assert.equal(
    mesclarLWW({ updated_at: t, v: 'local' }, { updated_at: t, v: 'remoto' }).v,
    'remoto',
  )
})

test('mesclarLWW cai para o lado que tem timestamp valido', () => {
  type Reg = { updated_at: string | null; v: string }
  const bom: Reg = { updated_at: '2026-08-21T10:00:00.000Z', v: 'bom' }
  const semData: Reg = { updated_at: null, v: 'ruim' }
  assert.equal(mesclarLWW(semData, bom).v, 'bom')
  assert.equal(mesclarLWW(bom, semData).v, 'bom')
})

// ---------------------------------------------------------------- formatacao

test('formatarDuracao usa horas e minutos', () => {
  assert.equal(formatarDuracao(760), '12h40')
  assert.equal(formatarDuracao(120), '2h')
  assert.equal(formatarDuracao(45), '45min')
})

test('formatarDuracao devolve vazio para nada, nunca "0min" nem NaN', () => {
  assert.equal(formatarDuracao(0), '')
  assert.equal(formatarDuracao(null), '')
  assert.equal(formatarDuracao(undefined), '')
})

test('formatarDinheiro converte centavos e usa a moeda da viagem', () => {
  assert.match(formatarDinheiro(482_500, 'BRL'), /4\.825,00/)
  assert.match(formatarDinheiro(2_000, 'EUR'), /20,00/)
})

test('formatarDinheiro trata valor invalido como zero em vez de NaN', () => {
  assert.match(formatarDinheiro(NaN as number, 'BRL'), /0,00/)
})
