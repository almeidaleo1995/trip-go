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
  paraCentavos,
  paraCampoDinheiro,
  projetarRota,
  mesclarLWW,
  formatarDuracao,
  formatarDinheiro,
  formatarData,
  statusViagem,
  formatarRelativo,
  montarDias,
  ordenarItens,
  resumoDoDia,
  etapasDaViagem,
  diaFoco,
  formatarDistancia,
  linhas,
  lerLinks,
  buscarNoRoteiro,
  type DiaRoteiro,
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

// ---------------------------------------------------------------- dinheiro digitado

test('paraCentavos le o numero como a pessoa digita em pt-BR', () => {
  assert.equal(paraCentavos('1.234,56'), 123456)
  assert.equal(paraCentavos('4800'), 480000)
  assert.equal(paraCentavos('4800,5'), 480050)
  assert.equal(paraCentavos('0,99'), 99)
})

test('paraCentavos aceita ponto decimal para quem digita no teclado numerico', () => {
  assert.equal(paraCentavos('1234.56'), 123456)
})

test('paraCentavos devolve null para o que nao e numero', () => {
  for (const v of ['', '   ', 'abc', '-10', '1,2,3']) {
    assert.equal(paraCentavos(v), null, `deveria recusar: ${v}`)
  }
})

test('paraCampoDinheiro e paraCentavos fazem a volta sem perder centavo', () => {
  for (const c of [0, 99, 100, 11111, 22223, 480000, 987654]) {
    assert.equal(paraCentavos(paraCampoDinheiro(c)), c, `nao voltou: ${c}`)
  }
})

test('paraCampoDinheiro sempre mostra as duas casas', () => {
  // Um campo que exibe "100" quando o valor e R$ 100,00 faz conferir duas vezes.
  assert.equal(paraCampoDinheiro(10000), '100,00')
  assert.equal(paraCampoDinheiro(22220), '222,20')
  assert.equal(paraCampoDinheiro(null), '0,00')
})

test('paraCentavos nao deixa residuo de ponto flutuante', () => {
  // 0.1 + 0.2 e o classico; aqui o risco e 8,15 * 100 dar 814,9999...
  assert.equal(paraCentavos('8,15'), 815)
  assert.equal(paraCentavos('1,10'), 110)
  assert.ok(Number.isInteger(paraCentavos('19,99')!))
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

// `opcoes` substitui o formato padrao. Sem isto, pedir so o mes devolvia
// "30 de dez." e o cartao do roteiro imprimia a data duas vezes.
test('formatarData: opcoes substituem o padrao em vez de somar', () => {
  assert.equal(formatarData('2027-12-30T08:30'), '30/12')
  assert.equal(formatarData('2027-12-30T08:30', { month: 'short' }), 'dez.')
  assert.equal(formatarData('2027-12-30T08:30', { day: '2-digit' }), '30')
  assert.equal(formatarData('2027-12-30T08:30', { weekday: 'long' }), 'quinta-feira')
})

// ---------------------------------------------------------------- statusViagem

test('statusViagem deriva o estado das datas, sem campo digitado', () => {
  assert.equal(statusViagem('2026-06-01', PARTIDA, RETORNO), 'planejando')
  assert.equal(statusViagem('2026-12-01', PARTIDA, RETORNO), 'proxima')
  assert.equal(statusViagem('2027-01-05', PARTIDA, RETORNO), 'andamento')
  assert.equal(statusViagem('2027-02-01', PARTIDA, RETORNO), 'concluida')
})

// A borda da janela: 60 dias antes ainda e "proxima", 61 ainda e "planejando".
test('statusViagem: a janela de "proxima" fecha exatamente em JANELA_PROXIMA', () => {
  assert.equal(statusViagem('2026-10-31', PARTIDA, RETORNO), 'proxima') // 60 dias
  assert.equal(statusViagem('2026-10-30', PARTIDA, RETORNO), 'planejando') // 61 dias
})

// Arquivada ganha de tudo: uma viagem em andamento que foi arquivada nao volta
// para o topo da tela de Inicio so porque a data diz que ela esta acontecendo.
test('statusViagem: arquivada ganha da fase derivada das datas', () => {
  assert.equal(statusViagem('2027-01-05', PARTIDA, RETORNO, true), 'arquivada')
})

test('statusViagem sem datas nao explode', () => {
  assert.equal(statusViagem('2026-06-01', null, null), 'proxima')
})

// ---------------------------------------------------------------- formatarRelativo

test('formatarRelativo escreve a distancia em pt-BR', () => {
  const agora = new Date(2026, 7, 22)
  assert.equal(formatarRelativo('2026-08-22T10:00', agora), 'hoje')
  assert.equal(formatarRelativo('2026-08-21T10:00', agora), 'ontem')
  assert.equal(formatarRelativo('2026-08-19T10:00', agora), 'há 3 dias')
  assert.equal(formatarRelativo('2026-06-22T10:00', agora), 'há 2 meses')
  assert.equal(formatarRelativo('2024-06-22T10:00', agora), 'há 2 anos')
  assert.equal(formatarRelativo(null, agora), '')
})

// ================================================================ roteiro por dia

const VIAGEM = { data_partida: '2026-12-30', data_retorno: '2027-01-15' }

test('montarDias cobre a viagem inteira mesmo sem nenhum item', () => {
  const dias = montarDias(VIAGEM, [], [])
  assert.equal(dias.length, 17)
  assert.equal(dias[0].chave, '2026-12-30')
  assert.equal(dias[0].numero, 1)
  assert.equal(dias.at(-1)!.chave, '2027-01-15')
  assert.equal(dias.at(-1)!.numero, 17)
})

test('montarDias agrupa os itens no dia certo e ordena por horario', () => {
  const itens = [
    { id: 'b', ocorre_em: '2027-01-02T14:00', titulo: 'HafenCity' },
    { id: 'a', ocorre_em: '2027-01-02T10:00', titulo: 'Speicherstadt' },
    { id: 'c', ocorre_em: '2027-01-03T09:00', titulo: 'Embarque' },
  ]
  const dias = montarDias(VIAGEM, itens, [])
  const doDia2 = dias.find((d) => d.chave === '2027-01-02')!
  assert.deepEqual(
    doDia2.itens.map((i) => i.id),
    ['a', 'b'],
  )
  assert.equal(dias.find((d) => d.chave === '2027-01-03')!.itens.length, 1)
})

// Dois itens no mesmo minuto: `ordem` desempata. E o unico papel dela.
test('ordenarItens usa ordem so para desempatar o mesmo horario', () => {
  const itens = [
    { id: 'x', ocorre_em: '2027-01-02T10:00', ordem: 2 },
    { id: 'y', ocorre_em: '2027-01-02T10:00', ordem: 1 },
    { id: 'z', ocorre_em: '2027-01-02T09:00', ordem: 9 },
  ]
  assert.deepEqual(
    ordenarItens(itens).map((i) => i.id),
    ['z', 'y', 'x'],
  )
})

// A viagem encurtou depois que alguem ja tinha escrito o dia 20. Sumir com o
// texto seria perder trabalho em silencio.
test('montarDias mantem dia anotado fora do intervalo da viagem', () => {
  const dias = montarDias(VIAGEM, [{ id: 'a', ocorre_em: '2027-01-20T10:00' }], [])
  const extra = dias.find((d) => d.chave === '2027-01-20')
  assert.ok(extra, 'o dia fora do intervalo tem que continuar na lista')
  assert.equal(extra!.numero, 0, 'mas nao ganha numero de dia da viagem')
})

test('montarDias liga a linha de itinerary_days ao dia correspondente', () => {
  const dias = montarDias(VIAGEM, [], [{ id: 'd1', dia: '2027-01-02', resumo: 'Hamburgo a pé' }])
  assert.equal(dias.find((d) => d.chave === '2027-01-02')!.meta!.resumo, 'Hamburgo a pé')
  assert.equal(dias.find((d) => d.chave === '2027-01-03')!.meta, null)
})

test('montarDias sem datas da viagem ainda agrupa pelos itens', () => {
  const dias = montarDias(null, [{ id: 'a', ocorre_em: '2027-01-02T10:00' }], [])
  assert.equal(dias.length, 1)
  assert.equal(dias[0].numero, 0)
})

// ---------------------------------------------------------------- resumoDoDia

const DIA_CHEIO = [
  { tipo: 'refeicao', ocorre_em: '2027-01-02T08:00', fim_em: '2027-01-02T09:00' },
  {
    tipo: 'caminhada',
    ocorre_em: '2027-01-02T09:30',
    distancia_m: 850,
    duracao_min: 11,
  },
  {
    tipo: 'ponto',
    ocorre_em: '2027-01-02T10:00',
    fim_em: '2027-01-02T11:30',
    custo_centavos: 2500,
    reserva_id: 'r1',
  },
  {
    tipo: 'traslado',
    ocorre_em: '2027-01-02T12:00',
    distancia_m: 2400,
    duracao_min: 18,
    opcoes: [{ modo: 'metro', recomendado: true }],
  },
  { tipo: 'restaurante', ocorre_em: '2027-01-02T12:30', fim_em: '2027-01-02T14:00' },
  { tipo: 'local', ocorre_em: '2027-01-02T14:00', fim_em: '2027-01-02T16:00' },
]

test('resumoDoDia conta locais, deslocamentos, refeicoes e reservas', () => {
  const r = resumoDoDia(DIA_CHEIO)
  assert.equal(r.locais, 2) // ponto + local
  assert.equal(r.deslocamentos, 2) // caminhada + traslado
  assert.equal(r.refeicoes, 2) // refeicao + restaurante
  assert.equal(r.reservas, 1)
})

test('resumoDoDia soma distancia, transito e custo estimado', () => {
  const r = resumoDoDia(DIA_CHEIO)
  assert.equal(r.distanciaM, 3250)
  assert.equal(r.minutosDeslocamento, 29)
  assert.equal(r.custoCentavos, 2500)
})

// 1h (café) + 1h30 (ponto) + 1h30 (almoço) + 2h (local) = 6h
test('resumoDoDia soma as duracoes explicitas quando existem', () => {
  assert.equal(resumoDoDia(DIA_CHEIO).minutos, 360)
})

// Sem nenhum fim_em, o unico numero honesto e o intervalo do primeiro ao ultimo.
test('resumoDoDia cai para o intervalo do dia quando ninguem cadastrou fim', () => {
  const r = resumoDoDia([
    { tipo: 'local', ocorre_em: '2027-01-02T09:00' },
    { tipo: 'local', ocorre_em: '2027-01-02T17:30' },
  ])
  assert.equal(r.minutos, 510)
})

test('resumoDoDia de um dia vazio nao explode e zera tudo', () => {
  const r = resumoDoDia([])
  assert.equal(r.minutos, 0)
  assert.equal(r.distanciaM, 0)
  assert.deepEqual(r.porModo, [])
})

// A opcao recomendada manda no modo; sem opcao, o tipo do item decide.
test('resumoDoDia agrupa o deslocamento por modo', () => {
  const r = resumoDoDia(DIA_CHEIO)
  assert.deepEqual(r.porModo, [
    { modo: 'metro', vezes: 1, distanciaM: 2400, minutos: 18 },
    { modo: 'a_pe', vezes: 1, distanciaM: 850, minutos: 11 },
  ])
})

// ---------------------------------------------------------------- diaFoco

test('diaFoco abre hoje durante a viagem, o proximo antes e o ultimo depois', () => {
  const dias = montarDias(VIAGEM, [], [])
  assert.equal(dias[diaFoco(dias, new Date(2027, 0, 2))].chave, '2027-01-02')
  assert.equal(dias[diaFoco(dias, new Date(2026, 5, 1))].chave, '2026-12-30')
  assert.equal(dias[diaFoco(dias, new Date(2027, 5, 1))].chave, '2027-01-15')
  assert.equal(diaFoco([], new Date()), -1)
})

// ---------------------------------------------------------------- formatarDistancia

test('formatarDistancia escreve metros ate 1 km e km acima', () => {
  assert.equal(formatarDistancia(850), '850 m')
  assert.equal(formatarDistancia(2400), '2,4 km')
  assert.equal(formatarDistancia(3000), '3 km')
  assert.equal(formatarDistancia(14300), '14 km')
  assert.equal(formatarDistancia(0), '')
  assert.equal(formatarDistancia(null), '')
})

// ---------------------------------------------------------------- linhas e links

test('linhas ignora vazio e espaco sobrando', () => {
  assert.deepEqual(linhas('  Passaporte \n\n Casaco\r\n'), ['Passaporte', 'Casaco'])
  assert.deepEqual(linhas(null), [])
})

test('lerLinks separa rotulo de url e assume https', () => {
  assert.deepEqual(lerLinks('Site oficial|https://elbphilharmonie.de'), [
    { rotulo: 'Site oficial', url: 'https://elbphilharmonie.de' },
  ])
  assert.deepEqual(lerLinks('maps.google.com'), [
    { rotulo: 'maps.google.com', url: 'https://maps.google.com' },
  ])
})

// O roteiro e escrito por uma pessoa e lido por todas as outras: um href com
// `javascript:` seria codigo rodando na tela dos outros participantes.
test('lerLinks descarta esquema que nao vira href seguro', () => {
  assert.deepEqual(lerLinks('Clique|javascript:alert(1)'), [])
  assert.deepEqual(lerLinks('Arquivo|file:///etc/passwd'), [])
  assert.equal(lerLinks('Ligar|tel:+493040000').length, 1)
})

// Um deslocamento cadastrado num item que não é "de transporte" (o almoço a 2,4 km
// de metrô) tem que continuar contando: a linha do tempo já mostra a distância dele.
test('resumoDoDia nao perde deslocamento de item sem modo conhecido', () => {
  const r = resumoDoDia([
    { tipo: 'restaurante', ocorre_em: '2027-01-02T12:30', distancia_m: 2400, duracao_min: 18 },
  ])
  assert.deepEqual(r.porModo, [{ modo: 'outro', vezes: 1, distanciaM: 2400, minutos: 18 }])
  assert.equal(r.distanciaM, 2400)
})

// ------------------------------------------------------------------ etapas
test('etapasDaViagem junta dias seguidos na mesma cidade', () => {
  const e = etapasDaViagem([
    { chave: '2027-01-01', cidade: 'Madri', atividades: 2 },
    { chave: '2027-01-02', cidade: 'Madri', atividades: 3 },
    { chave: '2027-01-03', cidade: 'Paris', atividades: 1 },
  ])
  assert.equal(e.length, 2)
  assert.deepEqual(e[0], {
    cidade: 'Madri',
    inicio: '2027-01-01',
    fim: '2027-01-02',
    dias: 2,
    atividades: 5,
  })
  assert.equal(e[1].cidade, 'Paris')
})

test('etapasDaViagem ignora acento e caixa ao comparar cidade', () => {
  const e = etapasDaViagem([
    { chave: '2027-01-01', cidade: 'Braganca', atividades: 0 },
    { chave: '2027-01-02', cidade: 'BRAGANÇA', atividades: 1 },
  ])
  assert.equal(e.length, 1)
  assert.equal(e[0].dias, 2)
})

test('dia sem cidade continua o trecho anterior, e nao abre um novo', () => {
  const e = etapasDaViagem([
    { chave: '2027-01-01', cidade: 'Paris', atividades: 1 },
    { chave: '2027-01-02', cidade: null, atividades: 2 },
    { chave: '2027-01-03', cidade: 'Paris', atividades: 0 },
  ])
  assert.equal(e.length, 1)
  assert.equal(e[0].dias, 3)
  assert.equal(e[0].atividades, 3)
  assert.equal(e[0].fim, '2027-01-03')
})

test('dia sem cidade ANTES do primeiro trecho nao vira etapa', () => {
  const e = etapasDaViagem([
    { chave: '2027-01-01', cidade: null, atividades: 4 },
    { chave: '2027-01-02', cidade: 'Roma', atividades: 1 },
  ])
  assert.equal(e.length, 1)
  assert.equal(e[0].inicio, '2027-01-02')
  assert.equal(e[0].atividades, 1)
})

test('a mesma cidade em dois momentos da viagem sao dois trechos', () => {
  const e = etapasDaViagem([
    { chave: '2027-01-01', cidade: 'Madri', atividades: 1 },
    { chave: '2027-01-02', cidade: 'Paris', atividades: 1 },
    { chave: '2027-01-03', cidade: 'Madri', atividades: 1 },
  ])
  assert.deepEqual(
    e.map((x) => x.cidade),
    ['Madri', 'Paris', 'Madri'],
  )
})

// ---------------------------------------------------------------- busca no roteiro

/** Três dias da viagem real, com o que a busca precisa distinguir. */
const DIAS_BUSCA: DiaRoteiro[] = [
  {
    chave: '2027-01-11',
    data: new Date('2027-01-11T12:00'),
    numero: 13,
    meta: null,
    itens: [
      { titulo: 'Museus Vaticanos e Capela Sistina', cidade: 'Roma', local: 'Musei Vaticani' },
      { titulo: 'Coliseu · horário marcado', cidade: 'Roma', descricao: 'Última entrada 15:30' },
    ],
  },
  {
    chave: '2027-01-12',
    data: new Date('2027-01-12T12:00'),
    numero: 14,
    meta: null,
    itens: [
      { titulo: 'Sagrada Família', cidade: 'Barcelona', dicas: 'Sem bilheteria física' },
      { titulo: 'Almoço no Mercat de la Boqueria', cidade: 'Barcelona', local: 'La Rambla 91' },
    ],
  },
  {
    chave: '2027-01-14',
    data: new Date('2027-01-14T12:00'),
    numero: 16,
    meta: null,
    itens: [{ titulo: 'Museu do Prado', cidade: 'Madri', descricao: 'Entrada gratuita 18:00' }],
  },
]

test('busca no roteiro ignora acento e caixa', () => {
  const r = buscarNoRoteiro(DIAS_BUSCA, 'SAGRADA FAMILIA')
  assert.equal(r.length, 1)
  assert.equal(r[0].chaveDia, '2027-01-12')
  assert.equal(r[0].numero, 14)
})

test('busca varre local, descricao e dicas, nao so o titulo', () => {
  // "rambla" só existe em `local` — casar aqui prova que a busca não para no título.
  const porLocal = buscarNoRoteiro(DIAS_BUSCA, 'rambla')
  assert.equal(porLocal.length, 1)
  assert.equal(porLocal[0].item.titulo, 'Almoço no Mercat de la Boqueria')
  assert.equal(buscarNoRoteiro(DIAS_BUSCA, 'bilheteria').length, 1)
  assert.equal(buscarNoRoteiro(DIAS_BUSCA, '15:30').length, 1)
})

test('varios termos sao E, nao OU', () => {
  // "museu" sozinho pega Vaticanos e Prado; com "madri" tem que sobrar um.
  assert.equal(buscarNoRoteiro(DIAS_BUSCA, 'museu').length, 2)
  const r = buscarNoRoteiro(DIAS_BUSCA, 'museu madri')
  assert.equal(r.length, 1)
  assert.equal(r[0].chaveDia, '2027-01-14')
})

test('termos casam em ordem qualquer e em campos diferentes', () => {
  assert.equal(buscarNoRoteiro(DIAS_BUSCA, 'madri museu').length, 1)
  assert.equal(buscarNoRoteiro(DIAS_BUSCA, 'boqueria barcelona').length, 1)
})

test('consulta vazia ou so espaco nao devolve a viagem inteira', () => {
  assert.deepEqual(buscarNoRoteiro(DIAS_BUSCA, ''), [])
  assert.deepEqual(buscarNoRoteiro(DIAS_BUSCA, '   '), [])
})

test('busca respeita o limite e devolve os PRIMEIROS dias', () => {
  const r = buscarNoRoteiro(DIAS_BUSCA, 'a', 2)
  assert.equal(r.length, 2)
  assert.equal(r[0].chaveDia, '2027-01-11')
})

test('sem resultado devolve lista vazia, nunca null', () => {
  assert.deepEqual(buscarNoRoteiro(DIAS_BUSCA, 'quiosque de tacos'), [])
  assert.deepEqual(buscarNoRoteiro([], 'roma'), [])
})
