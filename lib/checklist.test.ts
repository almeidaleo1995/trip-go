import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarTitulo } from './checklist.ts'

test('normalizarTitulo remove acento e ignora maiusculas', () => {
  assert.equal(normalizarTitulo('Passaporte Válido!'), normalizarTitulo('passaporte valido!'))
})

test('normalizarTitulo colapsa espacos internos e das pontas', () => {
  assert.equal(normalizarTitulo('  Seguro   viagem  '), 'seguro viagem')
})

test('normalizarTitulo distingue titulos genuinamente diferentes', () => {
  assert.notEqual(normalizarTitulo('Passaporte'), normalizarTitulo('Visto'))
})
