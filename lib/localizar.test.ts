// Testes da montagem da consulta e da fila do Nominatim. `npm run test`.
//
// A chamada de rede em si não é testada — falha alto e devolve lista vazia. O
// que erra em silêncio é o texto da pergunta (buscar "Volta a pé para o hotel"
// devolve um lugar qualquer, e o pino vai parar nele) e o espaçamento entre
// chamadas, que é o que mantém o serviço gratuito de pé.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { consultaDaParada, temCampoDeLugar, buscarLugar } from './localizar.ts'

test('a consulta prefere endereço, depois local, e só então o título', () => {
  assert.equal(
    consultaDaParada({ endereco: 'Puerta del Sol, 1', local: 'Sol', cidade: 'Madri' }),
    'Puerta del Sol, 1, Madri',
  )
  assert.equal(consultaDaParada({ local: 'Barajas T4', cidade: 'Madri' }), 'Barajas T4, Madri')
  assert.equal(
    consultaDaParada({ titulo: 'Volta a pé para o hotel', cidade: 'Madri' }),
    'Volta a pé para o hotel, Madri',
  )
})

test('a cidade não é repetida quando já está no texto', () => {
  assert.equal(
    consultaDaParada({ local: 'Aeroporto de Madri', cidade: 'Madri' }),
    'Aeroporto de Madri',
  )
  assert.equal(consultaDaParada({ cidade: 'Hamburgo' }), 'Hamburgo')
  assert.equal(consultaDaParada({}), '')
})

test('só quem tem campo de lugar entra na busca em massa', () => {
  assert.equal(temCampoDeLugar({ local: 'Barajas T4' }), true)
  assert.equal(temCampoDeLugar({ endereco: 'Rua X, 10' }), true)
  assert.equal(temCampoDeLugar({ local: '   ' }), false)
  assert.equal(temCampoDeLugar({}), false)
})

test('texto curto demais nem chega na rede', async () => {
  assert.deepEqual(await buscarLugar('ab'), [])
  assert.deepEqual(await buscarLugar('   '), [])
})

test('duas buscas seguidas saem espaçadas, nunca em paralelo', async () => {
  const original = globalThis.fetch
  const quando: number[] = []
  globalThis.fetch = (async () => {
    quando.push(Date.now())
    return { ok: true, json: async () => [] } as unknown as Response
  }) as typeof fetch

  try {
    await Promise.all([buscarLugar('Puerta del Sol'), buscarLugar('Plaza Mayor')])
    assert.equal(quando.length, 2)
    assert.ok(
      quando[1] - quando[0] >= 1000,
      `as buscas saíram com ${quando[1] - quando[0]}ms de intervalo`,
    )
  } finally {
    globalThis.fetch = original
  }
})
