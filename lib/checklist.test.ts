import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarTitulo, resolverSugestoes, type ContextoResolucao } from './checklist.ts'
import { ChecklistSugestaoSchema } from './schema.ts'

test('normalizarTitulo remove acento e ignora maiusculas', () => {
  assert.equal(normalizarTitulo('Passaporte Válido!'), normalizarTitulo('passaporte valido!'))
})

test('normalizarTitulo colapsa espacos internos e das pontas', () => {
  assert.equal(normalizarTitulo('  Seguro   viagem  '), 'seguro viagem')
})

test('normalizarTitulo distingue titulos genuinamente diferentes', () => {
  assert.notEqual(normalizarTitulo('Passaporte'), normalizarTitulo('Visto'))
})

// ---------------------------------------------------------------- resolverSugestoes

const CONTEXTO: ContextoResolucao = {
  participantes: [
    { id: 'p-leo', nome: 'Leonardo' },
    { id: 'p-alana', nome: 'Alana' },
  ],
  roteiro: [{ id: 'ev-porto', titulo: 'Chegada ao porto' }],
  voos: [{ id: 'voo-la719', companhia: 'LATAM', numero: '719' }],
  cruzeiros: [{ id: 'cruz-msc', navio: 'MSC Poesia' }],
  checklistExistente: [{ titulo: 'Passaporte válido' }],
}

function sugestao(campos: Partial<Parameters<typeof ChecklistSugestaoSchema.parse>[0]>) {
  return ChecklistSugestaoSchema.parse({
    titulo: 'Conferir seguro viagem',
    fonte_tipo: 'documento',
    ...campos,
  })
}

test('resolverSugestoes resolve assigned_to_nomes para ids reais', () => {
  const r = resolverSugestoes([sugestao({ assigned_to_nomes: ['Leonardo'] })], CONTEXTO)
  assert.equal(r.erros.length, 0)
  assert.deepEqual(r.validas[0].assigned_to, ['p-leo'])
  assert.equal(r.validas[0].pendente, true)
})

test('resolverSugestoes rejeita nome de participante nao encontrado (CHK-18)', () => {
  const r = resolverSugestoes([sugestao({ assigned_to_nomes: ['Fulano'] })], CONTEXTO)
  assert.equal(r.validas.length, 0)
  assert.equal(r.erros.length, 1)
  assert.match(r.erros[0].motivo, /Fulano/)
})

test('resolverSugestoes rejeita item pessoal sem nenhum assigned_to_nomes (CHK-19)', () => {
  const r = resolverSugestoes([sugestao({ escopo: 'pessoal', assigned_to_nomes: [] })], CONTEXTO)
  assert.equal(r.validas.length, 0)
  assert.equal(r.erros.length, 1)
  assert.match(r.erros[0].motivo, /pessoal/)
})

test('resolverSugestoes descarta sugestao cujo titulo normalizado ja existe no checklist', () => {
  const r = resolverSugestoes([sugestao({ titulo: 'PASSAPORTE VÁLIDO' })], CONTEXTO)
  assert.equal(r.validas.length, 0)
  assert.equal(r.erros.length, 0)
  assert.equal(r.duplicadas, 1)
})

test('resolverSugestoes mantem so a primeira de duas sugestoes iguais no mesmo lote', () => {
  const r = resolverSugestoes(
    [sugestao({ titulo: 'Visto Schengen' }), sugestao({ titulo: 'visto schengen' })],
    CONTEXTO,
  )
  assert.equal(r.validas.length, 1)
  assert.equal(r.duplicadas, 1)
})

test('resolverSugestoes resolve evento/voo/cruzeiro por nome quando bate', () => {
  const r = resolverSugestoes(
    [sugestao({ evento: 'chegada ao porto', voo: 'latam 719', cruzeiro: 'MSC POESIA' })],
    CONTEXTO,
  )
  assert.equal(r.validas[0].itinerary_event_id, 'ev-porto')
  assert.equal(r.validas[0].flight_id, 'voo-la719')
  assert.equal(r.validas[0].cruise_id, 'cruz-msc')
})

test('resolverSugestoes deixa vinculo nulo (nao erro) quando evento nao bate nada', () => {
  const r = resolverSugestoes([sugestao({ evento: 'Passeio inexistente' })], CONTEXTO)
  assert.equal(r.erros.length, 0)
  assert.equal(r.validas[0].itinerary_event_id, null)
})
