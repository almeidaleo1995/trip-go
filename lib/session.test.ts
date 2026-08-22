// Testes do caminho de seguranca. Rodam sem Next: o modulo so importa `next/headers`
// dinamicamente, dentro das funcoes de cookie.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.SESSION_SECRET ??= 'segredo-de-teste-nao-usar-em-producao'

import {
  hashPin,
  verifyPin,
  criarToken,
  lerToken,
  registrarFalha,
  estaBloqueado,
  limparFalhas,
  _resetRateLimit,
  LIMITE,
  JANELA_MS,
  BLOQUEIO_MS,
} from './session.ts'

beforeEach(() => _resetRateLimit())

// ---------------------------------------------------------------- hash de PIN

test('hashPin gera salt aleatorio: o mesmo PIN produz hashes diferentes', async () => {
  const a = await hashPin('1234')
  const b = await hashPin('1234')
  assert.notEqual(a, b)
})

test('hashPin nao deixa o PIN em texto puro em lugar nenhum do hash', async () => {
  const h = await hashPin('4831')
  assert.ok(!h.includes('4831'), 'o PIN aparece dentro do hash')
  assert.match(h, /^scrypt\$\d+\$[0-9a-f]+\$[0-9a-f]+$/)
})

test('verifyPin aceita o PIN correto e recusa o errado', async () => {
  const h = await hashPin('1234')
  assert.equal(await verifyPin('1234', h), true)
  assert.equal(await verifyPin('1235', h), false)
  assert.equal(await verifyPin('', h), false)
})

test('verifyPin recusa hash ausente, vazio ou corrompido sem lancar', async () => {
  for (const ruim of [null, undefined, '', 'nao-e-hash', 'scrypt$16384$zz$zz', 'a$b$c$d']) {
    assert.equal(await verifyPin('1234', ruim as string), false, `deveria recusar: ${ruim}`)
  }
})

test('verifyPin recusa hash com tamanho de chave errado', async () => {
  assert.equal(await verifyPin('1234', 'scrypt$16384$abcd$00ff'), false)
})

// ---------------------------------------------------------------- token de sessao

test('criarToken e lerToken fazem a volta preservando id e papel', () => {
  const s = lerToken(criarToken('t1', 'admin'))!
  assert.equal(s.travelerId, 't1')
  assert.equal(s.papel, 'admin')
})

test('token dura 90 dias', () => {
  const agora = Date.UTC(2026, 7, 21)
  const s = lerToken(criarToken('t1', 'viajante', agora), agora)!
  const dias = (s.expiraEm * 1000 - agora) / 86_400_000
  assert.equal(Math.round(dias), 90)
})

test('token com assinatura adulterada e rejeitado', () => {
  const t = criarToken('t1', 'viajante')
  const [id, papel, exp] = t.split('.')
  assert.equal(lerToken(`${id}.${papel}.${exp}.assinaturaFalsa`), null)
})

test('promover viajante a admin no token e rejeitado - a assinatura nao bate', () => {
  const t = criarToken('t1', 'viajante')
  const [id, , exp, sig] = t.split('.')
  assert.equal(lerToken(`${id}.admin.${exp}.${sig}`), null)
})

test('esticar a expiracao no token e rejeitado', () => {
  const t = criarToken('t1', 'viajante')
  const [id, papel, exp, sig] = t.split('.')
  assert.equal(lerToken(`${id}.${papel}.${Number(exp) + 86_400}.${sig}`), null)
})

test('token expirado e rejeitado', () => {
  const agora = Date.UTC(2026, 7, 21)
  const t = criarToken('t1', 'admin', agora)
  const daqui91Dias = agora + 91 * 86_400_000
  assert.equal(lerToken(t, daqui91Dias), null)
})

test('token malformado ou ausente devolve null sem lancar', () => {
  for (const ruim of [null, undefined, '', 'a.b', 'a.b.c.d.e', 'x.papelInvalido.999.sig']) {
    assert.equal(lerToken(ruim as string), null, `deveria recusar: ${ruim}`)
  }
})

// ---------------------------------------------------------------- rate limit

test('rate limit deixa passar ate o limite e bloqueia na tentativa seguinte', () => {
  for (let i = 0; i < LIMITE; i++) {
    assert.equal(registrarFalha('ip1').bloqueado, false, `tentativa ${i + 1} nao deveria bloquear`)
  }
  assert.equal(registrarFalha('ip1').bloqueado, true, `tentativa ${LIMITE + 1} deveria bloquear`)
})

test('o bloqueio dura 15 minutos', () => {
  const t0 = 1_000_000
  for (let i = 0; i <= LIMITE; i++) registrarFalha('ip2', t0)
  assert.equal(estaBloqueado('ip2', t0 + BLOQUEIO_MS - 1), true)
  assert.equal(estaBloqueado('ip2', t0 + BLOQUEIO_MS + 1), false)
})

test('tentativas velhas saem da janela de 5 minutos', () => {
  const t0 = 1_000_000
  for (let i = 0; i < LIMITE; i++) registrarFalha('ip3', t0)
  // passada a janela, o contador reinicia e nao bloqueia
  assert.equal(registrarFalha('ip3', t0 + JANELA_MS + 1).bloqueado, false)
})

test('cada chave tem sua propria janela', () => {
  for (let i = 0; i <= LIMITE; i++) registrarFalha('ip4')
  assert.equal(estaBloqueado('ip4'), true)
  assert.equal(estaBloqueado('ip5'), false)
})

test('limparFalhas zera a janela apos login bem-sucedido', () => {
  for (let i = 0; i < LIMITE; i++) registrarFalha('ip6')
  limparFalhas('ip6')
  assert.equal(registrarFalha('ip6').bloqueado, false)
})
