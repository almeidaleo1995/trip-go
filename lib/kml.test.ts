// Testes do casamento entre ponto do KML e parada do roteiro. `npm run test`.
//
// A leitura do XML não é testada aqui: ela mora no `DOMParser` do navegador e
// falha alto. O que erra calado é o casamento por nome — gravar 40.4169 na
// parada errada não quebra nada, só muda o mapa de lugar. As duas invariantes
// que seguram isso: um acerto óbvio tem de ser encontrado, e nomes de lugares
// diferentes não podem casar por acaso.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { casarPontos, pontuar, normalizar, extrairKmz, LIMIAR } from './kml.ts'

const PARADAS = [
  { id: 'a', texto: 'Chegada em Madri · entrada no Schengen (EES) Barajas T4' },
  { id: 'b', texto: 'Uber Barajas → hotel no centro' },
  { id: 'c', texto: 'Réveillon na Puerta del Sol' },
  { id: 'd', texto: 'Volta a pé para o hotel' },
]

test('normalizar apaga acento e pontuação', () => {
  assert.equal(normalizar('Puerta del Sol'), 'puerta del sol')
  assert.equal(normalizar('  RÉVEILLON, na  Puerta-del-Sol! '), 'reveillon na puerta del sol')
})

test('o nome contido no título da parada casa', () => {
  assert.ok(pontuar('Puerta del Sol', 'Réveillon na Puerta del Sol') >= LIMIAR)
  // Sem contenção exata, as palavras que importam bastam.
  assert.ok(pontuar('Catedral de Notre-Dame', 'Visita à Catedral Notre Dame') >= LIMIAR)
  // Uma palavra em comum não basta: "Barajas" também está na corrida de Uber,
  // e marcar o aeroporto em cima dela põe o pino no lugar errado.
  assert.ok(pontuar('Aeroporto Barajas T4', 'Uber Barajas → hotel no centro') < LIMIAR)
})

test('lugares diferentes não casam', () => {
  assert.ok(pontuar('Plaza Mayor', 'Réveillon na Puerta del Sol') < LIMIAR)
  assert.ok(pontuar('Museu do Prado', 'Volta a pé para o hotel') < LIMIAR)
  // Só a palavra vazia em comum não é semelhança nenhuma.
  assert.equal(pontuar('Casa de Campo', 'Parque de Retiro'), 0)
})

test('cada parada recebe um ponto só', () => {
  const escolha = casarPontos(
    [
      { nome: 'Puerta del Sol', lat: 40.4169, lon: -3.7033 },
      // Mesmo lugar escrito de outro jeito: casaria com a mesma parada, mas ela
      // já está tomada — o segundo sobra para a conferência à mão.
      { nome: 'Puerta del Sol (relógio)', lat: 40.417, lon: -3.7034 },
    ],
    PARADAS,
  )
  assert.deepEqual(escolha, ['c', null])
})

test('ponto sem parada parecida fica sem palpite', () => {
  const escolha = casarPontos([{ nome: 'Sagrada Família', lat: 41.4036, lon: 2.1744 }], PARADAS)
  assert.deepEqual(escolha, [null])
})

test('a ordem do resultado acompanha a ordem do arquivo', () => {
  const escolha = casarPontos(
    [
      { nome: 'Volta a pé para o hotel', lat: 40.42, lon: -3.7 },
      { nome: 'Puerta del Sol', lat: 40.4169, lon: -3.7033 },
    ],
    PARADAS,
  )
  assert.deepEqual(escolha, ['d', 'c'])
})

test('no empate, ganha a parada que ainda não tem local', () => {
  const escolha = casarPontos(
    [{ nome: 'Puerta del Sol', lat: 40.4169, lon: -3.7033 }],
    [
      { id: 'ja', texto: 'Réveillon na Puerta del Sol', temLocal: true },
      { id: 'falta', texto: 'Sair do hotel a pé para a Puerta del Sol', temLocal: false },
    ],
  )
  assert.deepEqual(escolha, ['falta'])
})

// ---------------------------------------------------------------- kmz

/** Um zip mínimo de uma entrada só, montado à mão — é o formato que
    `extrairKmz` promete ler, e nenhuma biblioteca precisa entrar no repositório
    só para escrever o que ele já sabe interpretar. */
function zipDeUmArquivo(nome: string, conteudo: string, comprimir: boolean): ArrayBuffer {
  const bytes = Buffer.from(conteudo, 'utf8')
  const dados = comprimir ? deflateRawSync(bytes) : bytes
  const nomeBuf = Buffer.from(nome, 'utf8')
  const metodo = comprimir ? 8 : 0

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(metodo, 8)
  local.writeUInt32LE(dados.length, 18)
  local.writeUInt32LE(bytes.length, 22)
  local.writeUInt16LE(nomeBuf.length, 26)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(metodo, 10)
  central.writeUInt32LE(dados.length, 20)
  central.writeUInt32LE(bytes.length, 24)
  central.writeUInt16LE(nomeBuf.length, 28)
  central.writeUInt32LE(0, 42) // a entrada local começa no byte 0

  const inicioCentral = local.length + nomeBuf.length + dados.length
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(1, 8)
  fim.writeUInt16LE(1, 10)
  fim.writeUInt32LE(central.length + nomeBuf.length, 12)
  fim.writeUInt32LE(inicioCentral, 16)

  const tudo = Buffer.concat([local, nomeBuf, dados, central, nomeBuf, fim])
  return tudo.buffer.slice(tudo.byteOffset, tudo.byteOffset + tudo.byteLength) as ArrayBuffer
}

test('extrairKmz devolve o .kml de dentro do zip, comprimido ou não', async () => {
  const xml = '<kml><Document><name>Madri</name></Document></kml>'
  for (const comprimir of [true, false]) {
    assert.equal(await extrairKmz(zipDeUmArquivo('doc.kml', xml, comprimir)), xml)
  }
})

test('extrairKmz pula o que não é .kml e reclama quando não acha nenhum', async () => {
  await assert.rejects(() => extrairKmz(zipDeUmArquivo('icone.png', 'não é kml', true)), /kml/i)
  await assert.rejects(() => extrairKmz(new ArrayBuffer(4)), /zip/i)
})
