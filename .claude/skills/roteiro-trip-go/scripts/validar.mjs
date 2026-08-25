#!/usr/bin/env node
// Valida um JSON de importacao contra o schema REAL do projeto.
// Uso: node .claude/skills/roteiro-trip-go/scripts/validar.mjs <arquivo.json>
//
// Importa lib/schema.ts diretamente em vez de reimplementar as regras: assim a
// skill nunca sai de sincronia com o app. Se o schema mudar, este script muda junto.
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const { validarImportacao, resumirImportacao } = await import(
  pathToFileURL(join(raiz, 'lib', 'schema.ts')).href
)

const alvo = process.argv[2]
if (!alvo) {
  console.error('uso: node validar.mjs <arquivo.json>')
  process.exit(2)
}

let dados
try {
  dados = JSON.parse(readFileSync(alvo, 'utf8'))
} catch (e) {
  console.error(`JSON invalido em ${alvo}:\n  ${e.message}`)
  process.exit(1)
}

const r = validarImportacao(dados)

if (!r.sucesso) {
  console.error(`REPROVADO - ${alvo}\n`)
  console.error(`  ${r.erro}\n`)
  console.error('Nao entregue este arquivo. Corrija os campos apontados acima.')
  process.exit(1)
}

const resumo = resumirImportacao(r.dados)
const total = Object.values(resumo).reduce((a, b) => a + b, 0)

console.log(`APROVADO - ${alvo}\n`)
console.log(`  Viagem: ${r.dados.viagem.nome}`)
console.log(`  Periodo: ${r.dados.viagem.data_partida} a ${r.dados.viagem.data_retorno}`)
console.log(`  Moeda: ${r.dados.viagem.moeda}   Destaque: ${r.dados.viagem.cor_destaque}\n`)

for (const [secao, n] of Object.entries(resumo)) {
  const marca = n === 0 ? '  (vazia)' : ''
  console.log(`  ${secao.padEnd(14)} ${String(n).padStart(3)}${marca}`)
}
console.log(`  ${'TOTAL'.padEnd(14)} ${String(total).padStart(3)} registros`)

const vazias = Object.entries(resumo).filter(([, n]) => n === 0).map(([s]) => s)
if (vazias.length > 0) {
  console.log(`\nSecoes vazias: ${vazias.join(', ')}`)
  console.log('Confira se isso e esperado ou se faltou extrair algo do documento.')
}

// Conferencias que o schema nao faz porque nao sao erro de formato, e sim de leitura.
const avisos = []
const semCoord = r.dados.lugares.filter((l) => l.lat == null || l.lon == null)
if (semCoord.length > 0) {
  avisos.push(`${semCoord.length} lugar(es) sem coordenada nao aparecem no mapa: ` +
    semCoord.map((l) => l.cidade).join(', '))
}
const semEmail = r.dados.participantes.filter((p) => !p.email)
if (semEmail.length > 0) {
  avisos.push(`${semEmail.length} participante(s) sem e-mail nao se vinculam a uma conta sozinhos ` +
    `(precisam se cadastrar em /register com esse e-mail depois): ` +
    semEmail.map((p) => p.nome).join(', '))
}
if (r.dados.participantes.length > 0 && !r.dados.participantes.some((p) => p.papel === 'proprietario')) {
  avisos.push('nenhum participante tem papel proprietario - ninguem vai conseguir editar nem ver o Financeiro completo')
}
for (const c of r.dados.cruzeiros) {
  if (c.portos.length === 0) avisos.push(`cruzeiro "${c.navio}" sem nenhum porto cadastrado`)
}

if (avisos.length > 0) {
  console.log('\nAvisos:')
  for (const a of avisos) console.log(`  - ${a}`)
}
