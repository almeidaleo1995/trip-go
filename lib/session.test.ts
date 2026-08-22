// Testes do caminho de seguranca. Rodam sem Next: o modulo so importa `next/headers`
// dinamicamente, dentro das funcoes de cookie.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.SESSION_SECRET ??= 'segredo-de-teste-nao-usar-em-producao'

import {
  hashSenha,
  verifySenha,
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

// ---------------------------------------------------------------- hash de senha

test('hashSenha gera salt aleatorio: a mesma senha produz hashes diferentes', async () => {
  const a = await hashSenha('1234')
  const b = await hashSenha('1234')
  assert.notEqual(a, b)
})

test('hashSenha nao deixa a senha em texto puro em lugar nenhum do hash', async () => {
  const h = await hashSenha('4831')
  assert.ok(!h.includes('4831'), 'a senha aparece dentro do hash')
  assert.match(h, /^scrypt\$\d+\$[0-9a-f]+\$[0-9a-f]+$/)
})

test('verifySenha aceita a senha correta e recusa a errada', async () => {
  const h = await hashSenha('1234')
  assert.equal(await verifySenha('1234', h), true)
  assert.equal(await verifySenha('1235', h), false)
  assert.equal(await verifySenha('', h), false)
})

test('verifySenha recusa hash ausente, vazio ou corrompido sem lancar', async () => {
  for (const ruim of [null, undefined, '', 'nao-e-hash', 'scrypt$16384$zz$zz', 'a$b$c$d']) {
    assert.equal(await verifySenha('1234', ruim as string), false, `deveria recusar: ${ruim}`)
  }
})

test('verifySenha recusa hash com tamanho de chave errado', async () => {
  assert.equal(await verifySenha('1234', 'scrypt$16384$abcd$00ff'), false)
})

// ---------------------------------------------------------------- token de sessao

test('criarToken e lerToken fazem a volta preservando userId', () => {
  const s = lerToken(criarToken('t1'))!
  assert.equal(s.userId, 't1')
})

test('token dura 90 dias', () => {
  const agora = Date.UTC(2026, 7, 21)
  const s = lerToken(criarToken('t1', agora), agora)!
  const dias = (s.expiraEm * 1000 - agora) / 86_400_000
  assert.equal(Math.round(dias), 90)
})

test('token com assinatura adulterada e rejeitado', () => {
  const t = criarToken('t1')
  const [id, exp] = t.split('.')
  assert.equal(lerToken(`${id}.${exp}.assinaturaFalsa`), null)
})

test('esticar a expiracao no token e rejeitado', () => {
  const t = criarToken('t1')
  const [id, exp, sig] = t.split('.')
  assert.equal(lerToken(`${id}.${Number(exp) + 86_400}.${sig}`), null)
})

test('token expirado e rejeitado', () => {
  const agora = Date.UTC(2026, 7, 21)
  const t = criarToken('t1', agora)
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
