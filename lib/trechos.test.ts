import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  auditarNavegacao,
  pontaDaHospedagem,
  resumoTrechos,
  trechosDoDia,
  type Trecho,
} from './trechos.ts'

const DIA = '2027-01-06'
const em = (hora: string) => `${DIA}T${hora}`

function item(campos: Record<string, unknown>): Record<string, unknown> {
  return { id: String(campos.titulo ?? 'x'), tipo: 'passeio', titulo: 'Item', ...campos }
}

const HOTEL = {
  tipo: 'hospedagem',
  titulo: 'Hotel Catalonia',
  endereco: 'Gran Via, 4',
  lat: 40.4198,
  lon: -3.7025,
}

/** O trecho de um destino pelo título, para os testes lerem como a tela. */
const ate = (trechos: Trecho[], titulo: string) =>
  trechos.find((t) => t.destino.titulo === titulo)!

// ---------------------------------------------------------------- saia às

test('saia às = começo − deslocamento − margem', () => {
  const [t] = trechosDoDia([item({ titulo: 'Museu', ocorre_em: em('14:00'), duracao_min: 30 })])
  // passeio: margem padrão de 5 min -> 14:00 − 30 − 5
  assert.equal(t.sairAs?.getHours(), 13)
  assert.equal(t.sairAs?.getMinutes(), 25)
  assert.equal(t.margemMin, 5)
})

test('margem é contextual: voo, cruzeiro e trem ganham folga maior que um passeio', () => {
  const comTipo = (tipo: string) =>
    trechosDoDia([item({ titulo: tipo, tipo, ocorre_em: em('18:40'), duracao_min: 45 })])[0]

  assert.equal(comTipo('passeio').margemMin, 5)
  assert.equal(comTipo('trem').margemMin, 20)
  assert.equal(comTipo('voo').margemMin, 30)
  assert.equal(comTipo('cruzeiro').margemMin, 45)

  // Voo às 18:40, 45 min até o aeroporto, 30 de margem -> 17:25 (§18).
  const voo = comTipo('voo')
  assert.equal(voo.sairAs?.getHours(), 17)
  assert.equal(voo.sairAs?.getMinutes(), 25)
})

test('sem duracao_min não existe hora de sair, e o trecho fica não verificado', () => {
  const [t] = trechosDoDia([item({ titulo: 'Museu', ocorre_em: em('14:00'), distancia_m: 1400 })])
  assert.equal(t.sairAs, null)
  assert.equal(t.verificado, false)
  assert.equal(t.duracaoMin, null)
  assert.equal(t.margemMin, 0)
})

// ---------------------------------------------------------------- conflitos

test('conflito: 15 min disponíveis, 30 necessários', () => {
  const trechos = trechosDoDia([
    item({ titulo: 'Almoço', ocorre_em: em('13:00'), fim_em: em('13:30') }),
    item({ titulo: 'Parque', ocorre_em: em('13:45'), duracao_min: 30 }),
  ])
  const t = ate(trechos, 'Parque')
  assert.equal(t.folgaMin, 15)
  assert.equal(t.conflito, true)
  assert.equal(t.faltamMin, 15)
})

test('cabe, mas come a margem: apertado, não conflito', () => {
  const trechos = trechosDoDia([
    item({ titulo: 'Almoço', ocorre_em: em('13:00'), fim_em: em('13:30') }),
    // 32 min livres, 30 de deslocamento: passa, mas sem os 5 de margem.
    item({ titulo: 'Parque', ocorre_em: em('14:02'), duracao_min: 30 }),
  ])
  const t = ate(trechos, 'Parque')
  assert.equal(t.conflito, false)
  assert.equal(t.apertado, true)
})

test('folga suficiente não é conflito nem aperto', () => {
  const trechos = trechosDoDia([
    item({ titulo: 'Almoço', ocorre_em: em('13:00'), fim_em: em('13:30') }),
    item({ titulo: 'Parque', ocorre_em: em('15:00'), duracao_min: 30 }),
  ])
  const t = ate(trechos, 'Parque')
  assert.equal(t.conflito, false)
  assert.equal(t.apertado, false)
  assert.equal(t.faltamMin, null)
})

test('sem fim_em a folga sai do COMEÇO do anterior — nunca acusa conflito falso', () => {
  const trechos = trechosDoDia([
    // Sem hora de término: não se sabe quando o almoço acaba.
    item({ titulo: 'Almoço', ocorre_em: em('13:00') }),
    item({ titulo: 'Parque', ocorre_em: em('14:00'), duracao_min: 30 }),
  ])
  const t = ate(trechos, 'Parque')
  // 60 min de teto, 30 de deslocamento: o app não inventa um conflito que não
  // consegue provar.
  assert.equal(t.folgaMin, 60)
  assert.equal(t.conflito, false)
})

test('sem fim_em, um conflito CERTO continua sendo acusado', () => {
  const trechos = trechosDoDia([
    item({ titulo: 'Almoço', ocorre_em: em('13:00') }),
    item({ titulo: 'Parque', ocorre_em: em('13:20'), duracao_min: 50 }),
  ])
  // Nem o intervalo inteiro entre os dois começos dá conta do deslocamento.
  assert.equal(ate(trechos, 'Parque').conflito, true)
})

// ---------------------------------------------------------------- ordem e pontas

test('os trechos saem na ordem do relógio, não na ordem do array', () => {
  const trechos = trechosDoDia([
    item({ titulo: 'Tarde', ocorre_em: em('15:00'), duracao_min: 12 }),
    item({ titulo: 'Manhã', ocorre_em: em('09:30'), duracao_min: 18 }),
  ])
  assert.deepEqual(
    trechos.map((t) => t.destino.titulo),
    ['Manhã', 'Tarde'],
  )
  // O segundo trecho parte do primeiro item, não do hotel.
  assert.equal(ate(trechos, 'Tarde').origem?.titulo, 'Manhã')
})

test('o primeiro trecho do dia sai do hotel (§28)', () => {
  const trechos = trechosDoDia(
    [item({ titulo: 'Museu', ocorre_em: em('09:30'), duracao_min: 22 })],
    { hospedagem: HOTEL },
  )
  assert.equal(trechos[0].origem?.titulo, 'Hotel Catalonia')
  assert.equal(trechos[0].origem?.endereco, 'Gran Via, 4')
})

test('sem hospedagem, o primeiro trecho não tem origem — e não inventa uma', () => {
  const [t] = trechosDoDia([item({ titulo: 'Museu', ocorre_em: em('09:30'), duracao_min: 22 })])
  assert.equal(t.origem, null)
})

test('o último trecho volta ao hotel, não verificado (§29)', () => {
  const trechos = trechosDoDia(
    [item({ titulo: 'Parque', ocorre_em: em('15:00'), duracao_min: 12 })],
    { hospedagem: HOTEL },
  )
  const volta = trechos[trechos.length - 1]
  assert.equal(volta.destino.titulo, 'Hotel Catalonia')
  assert.equal(volta.origem?.titulo, 'Parque')
  assert.equal(volta.verificado, false)
  assert.equal(volta.duracaoMin, null)
  assert.equal(volta.sairAs, null)
})

test('um dia que termina na própria hospedagem não ganha volta ao hotel', () => {
  const trechos = trechosDoDia(
    [
      item({ titulo: 'Parque', ocorre_em: em('15:00'), duracao_min: 12 }),
      item({ titulo: 'Check-in', tipo: 'hospedagem', ocorre_em: em('18:00'), duracao_min: 20 }),
    ],
    { hospedagem: HOTEL },
  )
  assert.equal(trechos.filter((t) => t.destino.titulo === 'Hotel Catalonia').length, 0)
})

test('item sem nenhum sinal de deslocamento não vira trecho', () => {
  const trechos = trechosDoDia([
    item({ titulo: 'Museu', ocorre_em: em('09:30') }),
    item({ titulo: 'Almoço', ocorre_em: em('13:00'), duracao_min: 18 }),
  ])
  assert.deepEqual(
    trechos.map((t) => t.destino.titulo),
    ['Almoço'],
  )
})

test('só as opções já cadastradas bastam para o item virar trecho', () => {
  const trechos = trechosDoDia([
    item({
      titulo: 'Museu',
      ocorre_em: em('09:30'),
      opcoes: [{ id: 'b', modo: 'a_pe', ordem: 1 }, { id: 'a', modo: 'metro', recomendado: true }],
    }),
  ])
  assert.equal(trechos.length, 1)
  // Recomendada primeiro, o resto por ordem.
  assert.deepEqual(
    trechos[0].opcoes.map((o) => o.id),
    ['a', 'b'],
  )
})

test('transporte livre vira modo só quando casa com um dos oito', () => {
  const modoDe = (transporte: string) =>
    trechosDoDia([item({ titulo: 'x', ocorre_em: em('09:00'), transporte })])[0].modo

  assert.equal(modoDe('metro'), 'metro')
  assert.equal(modoDe('  Metro  '), 'metro')
  assert.equal(modoDe('A_Pe'), 'a_pe')
  // Texto de guia continua sendo texto de guia: vira legenda do trecho, não
  // chave de ícone. Mesma regra de `modoValido` em lib/hoje.ts.
  assert.equal(modoDe('Metrô L2 → Tirso de Molina'), null)
  assert.equal(modoDe('a pé'), null)
})

// ---------------------------------------------------------------- dados ausentes

test('nada devolve NaN, undefined nem Infinity', () => {
  const trechos = trechosDoDia([
    item({ titulo: 'Zerado', ocorre_em: em('09:00'), distancia_m: 900, duracao_min: 0, transporte: '  ' }),
    item({ titulo: 'Ruim', ocorre_em: 'não é data', distancia_m: 'abc', duracao_min: -5, transporte: 'metro' }),
    item({ titulo: 'Sem hora', distancia_m: 900 }),
  ])
  assert.equal(trechos.length, 3)

  for (const t of trechos) {
    for (const v of [t.distanciaM, t.duracaoMin, t.folgaMin, t.faltamMin, t.margemMin]) {
      assert.ok(v === null || Number.isFinite(v), `valor não finito em ${t.destino.titulo}`)
    }
    assert.ok(t.sairAs === null || !Number.isNaN(t.sairAs.getTime()))
    assert.equal(typeof t.destino.titulo, 'string')
  }

  // Duração não positiva e distância inválida viram ausência, não zero mentiroso.
  assert.equal(ate(trechos, 'Zerado').duracaoMin, null)
  assert.equal(ate(trechos, 'Zerado').transporte, null)
  assert.equal(ate(trechos, 'Ruim').distanciaM, null)
  assert.equal(ate(trechos, 'Ruim').duracaoMin, null)
})

test('lista vazia devolve lista vazia, e o resumo devolve zeros', () => {
  assert.deepEqual(trechosDoDia([]), [])
  assert.deepEqual(resumoTrechos([]), {
    quantos: 0,
    distanciaM: 0,
    minutos: 0,
    conflitos: 0,
    naoVerificados: 0,
  })
})

test('pontaDaHospedagem sem reserva é null', () => {
  assert.equal(pontaDaHospedagem(null), null)
  assert.equal(pontaDaHospedagem(undefined), null)
})

// ---------------------------------------------------------------- resumo e auditoria

test('resumo soma distância e tempo, e conta o que falta conferir', () => {
  const trechos = trechosDoDia(
    [
      item({ titulo: 'Museu', ocorre_em: em('09:30'), duracao_min: 18, distancia_m: 1400 }),
      item({ titulo: 'Almoço', ocorre_em: em('13:00'), duracao_min: 24, distancia_m: 3200 }),
      item({ titulo: 'Parque', ocorre_em: em('15:00'), distancia_m: 900 }),
    ],
    { hospedagem: HOTEL },
  )
  const r = resumoTrechos(trechos)
  assert.equal(r.quantos, 4) // três itens + a volta ao hotel
  assert.equal(r.distanciaM, 5500)
  assert.equal(r.minutos, 42)
  // O Parque (sem duração) e a volta ao hotel.
  assert.equal(r.naoVerificados, 2)
})

test('auditoria acusa conflito como erro e rota não conferida como aviso', () => {
  const trechos = trechosDoDia([
    item({ titulo: 'Almoço', ocorre_em: em('13:00'), fim_em: em('13:30'), endereco: 'Pl. 11' }),
    item({ titulo: 'Parque', ocorre_em: em('13:45'), duracao_min: 30, endereco: 'Paseo, s/n' }),
    item({ titulo: 'Mirante', ocorre_em: em('17:00'), distancia_m: 900 }),
  ])
  const problemas = auditarNavegacao(trechos)

  const erros = problemas.filter((p) => p.nivel === 'erro')
  assert.equal(erros.length, 1)
  assert.match(erros[0].texto, /15 min disponíveis, 30 min necessários/)

  assert.ok(problemas.some((p) => /rota sem duração conferida/.test(p.texto)))
  assert.ok(problemas.some((p) => /sem endereço nem coordenada/.test(p.texto)))
})

test('a auditoria põe o erro antes dos avisos, mesmo quando ele acontece mais tarde', () => {
  const trechos = trechosDoDia([
    // Cedo, e só um aviso: rota sem duração.
    item({ titulo: 'Museu', ocorre_em: em('09:30'), distancia_m: 900, endereco: 'Ruiz, 23' }),
    // Tarde, e um conflito de verdade.
    item({ titulo: 'Almoço', ocorre_em: em('13:00'), fim_em: em('13:30'), endereco: 'Pl. 11' }),
    item({ titulo: 'Parque', ocorre_em: em('13:45'), duracao_min: 30, endereco: 'Paseo' }),
  ])
  const problemas = auditarNavegacao(trechos)
  assert.equal(problemas[0].nivel, 'erro')
  assert.match(problemas[0].texto, /^Parque/)
})

test('um dia bem preparado não gera problema nenhum', () => {
  const trechos = trechosDoDia([
    item({ titulo: 'Museu', ocorre_em: em('09:30'), fim_em: em('12:00'), duracao_min: 18, endereco: 'Ruiz de Alarcón, 23' }),
    item({ titulo: 'Almoço', ocorre_em: em('13:00'), duracao_min: 24, endereco: 'Pl. de la Cebada, 11' }),
  ])
  assert.deepEqual(auditarNavegacao(trechos), [])
})

test('coordenada sozinha já basta: parada sem endereço mas com lat não é problema', () => {
  const trechos = trechosDoDia([
    item({ titulo: 'Mirante', ocorre_em: em('17:00'), duracao_min: 12, lat: 40.42, lon: -3.7 }),
  ])
  assert.deepEqual(auditarNavegacao(trechos), [])
})
