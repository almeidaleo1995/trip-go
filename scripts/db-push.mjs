// Aplica db/schema.sql no Neon. Rode com: npm run db:push
//
// ponytail: sem ferramenta de migration. O schema e idempotente e a viagem e uma so,
// entao "aplicar o arquivo inteiro" e a operacao correta. Se um dia houver migracao
// destrutiva (renomear coluna, mudar tipo), ai sim vale trazer drizzle-kit ou similar.
import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL nao definida.\n' +
      'Crie um .env.local na raiz com a connection string do Neon (veja .env.example).'
  )
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)
const schema = readFileSync(join(raiz, 'db', 'schema.sql'), 'utf8')

// O driver HTTP do Neon nao aceita multiplos comandos numa chamada, entao
// separamos por `;` no fim de linha, ignorando comentarios.
const comandos = schema
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n')
  .split(';')
  .map((c) => c.trim())
  .filter(Boolean)

console.log(`Aplicando ${comandos.length} comandos em ${new URL(process.env.DATABASE_URL).host}...`)

for (const [i, comando] of comandos.entries()) {
  try {
    await sql.query(comando)
  } catch (erro) {
    console.error(`\nFalhou no comando ${i + 1}:\n${comando.slice(0, 200)}\n\n${erro.message}`)
    process.exit(1)
  }
}

const tabelas = await sql`
  select table_name, (select count(*) from information_schema.columns c
                      where c.table_name = t.table_name and c.table_schema = 'public') as colunas
  from information_schema.tables t
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name
`

console.log(`\nOK. ${tabelas.length} tabelas no banco:\n`)
for (const t of tabelas) console.log(`  ${t.table_name.padEnd(20)} ${t.colunas} colunas`)
