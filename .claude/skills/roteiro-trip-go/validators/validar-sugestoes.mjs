#!/usr/bin/env node
// Valida um lote de sugestoes de checklist contra o schema REAL do projeto.
// Uso: node .claude/skills/roteiro-trip-go/validators/validar-sugestoes.mjs <arquivo.json>
//
// Importa lib/schema.ts diretamente (ChecklistSugestoesBatchSchema), igual ao
// scripts/validar.mjs irmao: nunca reimplementa a regra, so confere contra ela.
// So checa FORMATO — dedup e resolucao de nome contra participantes/roteiro
// reais so acontecem dentro do app (resolverSugestoes em lib/checklist.ts),
// porque este script nao tem acesso a nenhuma viagem especifica.
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const { ChecklistSugestoesBatchSchema, formatarErroZod } = await import(
  pathToFileURL(join(raiz, 'lib', 'schema.ts')).href
)

const alvo = process.argv[2]
if (!alvo) {
  console.error('uso: node validar-sugestoes.mjs <arquivo.json>')
  process.exit(2)
}

let dados
try {
  dados = JSON.parse(readFileSync(alvo, 'utf8'))
} catch (e) {
  console.error(`JSON invalido em ${alvo}:\n  ${e.message}`)
  process.exit(1)
}

const r = ChecklistSugestoesBatchSchema.safeParse(dados)

if (!r.success) {
  console.error(`REPROVADO - ${alvo}\n`)
  console.error(`  ${formatarErroZod(r.error)}\n`)
  console.error('Nao entregue este arquivo. Corrija os campos apontados acima.')
  process.exit(1)
}

const { viagem, gerado_em, sugestoes } = r.data

console.log(`APROVADO - ${alvo}\n`)
console.log(`  Viagem: ${viagem}`)
console.log(`  Gerado em: ${gerado_em}`)
console.log(`  Sugestoes: ${sugestoes.length}\n`)

const porFonte = {}
for (const s of sugestoes) porFonte[s.fonte_tipo] = (porFonte[s.fonte_tipo] ?? 0) + 1
for (const [fonte, n] of Object.entries(porFonte)) {
  console.log(`  ${fonte.padEnd(12)} ${String(n).padStart(3)}`)
}

// Avisos que o schema nao pega porque nao sao erro de formato.
const avisos = []
const semDono = sugestoes.filter((s) => s.escopo === 'pessoal' && s.assigned_to_nomes.length === 0)
if (semDono.length > 0) {
  avisos.push(
    `${semDono.length} sugestao(oes) pessoal sem assigned_to_nomes vao ser rejeitadas na importacao: ` +
      semDono.map((s) => s.titulo).join(', '),
  )
}
const titulosNormalizados = new Map()
for (const s of sugestoes) {
  const chave = s.titulo.trim().toLowerCase()
  if (titulosNormalizados.has(chave)) {
    avisos.push(`titulo repetido dentro do lote: "${s.titulo}" — so a primeira sobrevive na importacao`)
  }
  titulosNormalizados.set(chave, true)
}

if (avisos.length > 0) {
  console.log('\nAvisos:')
  for (const a of avisos) console.log(`  - ${a}`)
}
