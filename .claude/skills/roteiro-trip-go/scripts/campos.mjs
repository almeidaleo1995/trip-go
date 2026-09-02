#!/usr/bin/env node
// A lista de campos VIVA do app. Rode ANTES de montar qualquer viagem.
//
//   node .claude/skills/roteiro-trip-go/scripts/campos.mjs            # tudo
//   node .claude/skills/roteiro-trip-go/scripts/campos.mjs roteiro    # uma secao
//
// POR QUE ESTE SCRIPT EXISTE
//
// Esta skill tem documentacao propria (reference/formato.md), e documentacao
// envelhece. O app nao: `lib/schema.ts` e o contrato executavel, e a importacao
// recusa o que ele recusa. Quando os dois discordam, quem esta errado e a skill —
// e a unica forma de saber e PERGUNTAR ao schema, nao reler o proprio texto.
//
// Zod DESCARTA chave desconhecida em silencio. Uma secao renomeada nao da erro:
// ela importa vazia. Um campo renomeado nao da erro: ele some. Por isso a saida
// aqui e a fonte, e a documentacao da skill e so um apoio de leitura.
//
// Nada e escrito. Este script so LE o schema e imprime.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const carregar = (p) => import(pathToFileURL(join(raiz, ...p)).href)

const { SECOES_ARQUIVO, ViagemSchema, SCHEMA_VERSION } = await carregar(['lib', 'schema.ts'])
const { z } = await carregar(['node_modules', 'zod', 'index.js'])

const filtro = process.argv[2]

/** A alternativa do campo que nao e `null` — `.nullish()` vira `anyOf` no JSON Schema. */
function util(prop) {
  const alts = prop.anyOf ?? [prop]
  return alts.find((a) => a.type !== 'null') ?? {}
}

function descrever(prop) {
  const t = util(prop)
  if (t.enum) return `um de: ${t.enum.join(' | ')}`
  if (t.type === 'string') {
    if (t.pattern === '^(\\d{4})-(\\d{2})-(\\d{2})$') return 'data "AAAA-MM-DD"'
    if (t.pattern?.includes('T(')) return 'data+hora LOCAL "AAAA-MM-DDTHH:MM" (sem Z, sem offset)'
    if (t.pattern?.startsWith('^#')) return 'cor hexadecimal "#RRGGBB"'
    if (t.format === 'uri') return 'url'
    return 'texto'
  }
  if (t.type === 'integer') return t.maximum === 2147483647 ? 'centavos inteiros (nunca decimal)' : 'inteiro'
  if (t.type === 'number') return 'numero'
  if (t.type === 'boolean') return 'true | false'
  if (t.type === 'array') return t.items?.type === 'string' ? 'lista de textos' : 'lista de objetos'
  return t.type ?? '?'
}

function imprimir(nome, esquema) {
  const j = z.toJSONSchema(esquema, { io: 'input', unrepresentable: 'any' })
  const obrigatorios = new Set(j.required ?? [])
  console.log(`\n## ${nome}`)
  for (const [campo, prop] of Object.entries(j.properties ?? {})) {
    const marca = obrigatorios.has(campo) ? '*' : ' '
    const padrao = 'default' in prop ? `  (padrao ${JSON.stringify(prop.default)})` : ''
    console.log(`  ${marca} ${campo.padEnd(24)} ${descrever(prop)}${padrao}`)
  }
}

console.log(`Contrato do app — lib/schema.ts, SCHEMA_VERSION ${SCHEMA_VERSION}`)
console.log('  * = obrigatorio. Campo ausente e ausente; nao invente valor plausivel.')
console.log('  Chave fora desta lista e DESCARTADA em silencio pelo zod.')

const secoes = { viagem: ViagemSchema, ...SECOES_ARQUIVO }

if (filtro) {
  if (!secoes[filtro]) {
    console.error(`\nsecao "${filtro}" nao existe. Ha: ${Object.keys(secoes).join(', ')}`)
    process.exit(1)
  }
  imprimir(filtro, secoes[filtro])
} else {
  for (const [nome, esquema] of Object.entries(secoes)) imprimir(nome, esquema)
}

console.log(`\nSecoes do arquivo, na ordem em que a importacao grava:`)
console.log(`  viagem, ${Object.keys(SECOES_ARQUIVO).join(', ')}`)
console.log('\nOs vinculos entre secoes sao por NOME, nunca por id:')
console.log('  custos[].pagador / .divisoes[].participante  -> participantes[].nome')
console.log('  custos[].categoria                           -> categorias[].nome')
console.log('  pagamentos[].de / .para                      -> participantes[].nome')
console.log('  checklist[].assigned_to_nomes                -> participantes[].nome')
console.log('  documentos[].dono_nome / .assigned_to_nomes  -> participantes[].nome')
console.log('  documentos[].reserva / roteiro[].reserva     -> reservas[].nome')
console.log('  roteiro[].documento                          -> documentos[].titulo')
console.log('  entregas[].requisito_nome / .dono_nome       -> requisitos[].nome / participantes[].nome')
