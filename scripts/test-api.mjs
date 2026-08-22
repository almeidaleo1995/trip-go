#!/usr/bin/env node
// Runner dos testes de integração.
//
// Existe por um motivo específico: a suíte roda `truncate trips cascade`. Se ela
// apontar para o mesmo banco do app, rodar os testes APAGA a viagem de verdade —
// e foi exatamente o que aconteceu uma vez aqui. Este script torna esse acidente
// impossível: ele valida que existe um banco separado, sobe um servidor próprio
// apontado para ele, roda os testes e derruba tudo.
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { neon } from '@neondatabase/serverless'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORTA = 3100

const { DATABASE_URL, TEST_DATABASE_URL, SESSION_SECRET } = process.env

function abortar(msg) {
  console.error(`\n${msg}\n`)
  process.exit(1)
}

if (!TEST_DATABASE_URL) {
  abortar(
    'TEST_DATABASE_URL não definida.\n\n' +
      'Os testes de integração apagam todas as tabelas, então precisam de um banco\n' +
      'só deles. Crie um (no Neon, um branch ou um database separado) e adicione\n' +
      'TEST_DATABASE_URL no .env.local. Veja .env.example.'
  )
}

// A trava que importa.
if (TEST_DATABASE_URL === DATABASE_URL) {
  abortar(
    'TEST_DATABASE_URL é IGUAL a DATABASE_URL.\n\n' +
      'Rodar assim apagaria a viagem de verdade. Aponte TEST_DATABASE_URL para um\n' +
      'banco separado.'
  )
}

const alvo = new URL(TEST_DATABASE_URL.replace('postgresql://', 'https://'))
console.log(`Banco de teste: ${alvo.host}${alvo.pathname}`)

// Schema no banco de teste, para ele nunca ficar defasado do de produção.
const sql = neon(TEST_DATABASE_URL)
const comandos = readFileSync(join(raiz, 'db', 'schema.sql'), 'utf8')
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n')
  .split(';')
  .map((c) => c.trim())
  .filter(Boolean)

for (const c of comandos) {
  try {
    await sql.query(c)
  } catch (e) {
    abortar(`Falhou ao preparar o schema de teste:\n${e.message}`)
  }
}
console.log(`Schema aplicado (${comandos.length} comandos).`)

// Servidor próprio, apontado para o banco de teste.
//
// Chama o binário do Next direto com `node`, sem npx e sem shell: no Windows o
// `npx.cmd` com shell:true falhava em silêncio e o runner só descobria depois
// de 60s de espera.
const servidor = spawn(
  process.execPath,
  [join(raiz, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--port', String(PORTA)],
  {
    cwd: raiz,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, SESSION_SECRET },
    stdio: ['ignore', 'ignore', 'pipe'],
  }
)

// Se o servidor morrer, mostra o motivo em vez de deixar o runner esperando.
let erroServidor = ''
servidor.stderr?.on('data', (d) => (erroServidor += String(d)))
servidor.on('exit', (c) => {
  if (!pronto) abortar(`Servidor de teste morreu (código ${c}).
${erroServidor.slice(-800)}`)
})

let pronto = false

const derrubar = () => {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(servidor.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(-servidor.pid, 'SIGTERM')
    }
  } catch {
    /* já morreu */
  }
}
process.on('exit', derrubar)
process.on('SIGINT', () => process.exit(130))

const base = `http://localhost:${PORTA}`
process.stdout.write('Subindo servidor de teste')
for (let i = 0; i < 60; i++) {
  try {
    await fetch(`${base}/api/viajantes`)
    pronto = true
    break
  } catch {
    process.stdout.write('.')
    await new Promise((r) => setTimeout(r, 1000))
  }
}
console.log()
if (!pronto) abortar('Servidor de teste não subiu em 60s.')

const testes = spawn(
  process.execPath,
  ['--test', 'tests/api.test.mjs'],
  {
    cwd: raiz,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, BASE_URL: base },
    stdio: 'inherit',
  }
)

testes.on('exit', (codigo) => {
  derrubar()
  process.exit(codigo ?? 1)
})
