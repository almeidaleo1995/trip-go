#!/usr/bin/env node
// Quais viagens existem, e de quem. Nao escreve nada.
//
//   node --env-file=.env.local <este script>                    # contas e viagens
//   node --env-file=.env.local <este script> --conta <email>    # so as dessa conta
//
// POR QUE ESTE SCRIPT EXISTE
//
// `subir.mjs` precisa de um `tripId` e de uma conta, e ninguem decora um uuid.
// Sem isto, "sobe na minha viagem" viraria uma pergunta ("qual e o id?") a cada
// pedido — e o objetivo e o contrario: a pessoa pede, e a skill resolve. Com uma
// viagem so na conta, nao ha o que perguntar; com varias, a pergunta e por NOME.
//
// Le `trips` e `travelers` e mais nada. Nao toca em `expenses`, `documents` nem
// em coluna de dado pessoal: descobrir para ONDE escrever nao exige ler o que ja
// esta escrito lá.
import { carregar } from './projeto.mjs'

const argv = process.argv.slice(2)
const i = argv.indexOf('--conta')
const conta = i >= 0 ? String(argv[i + 1] ?? '').toLowerCase() : null

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL nao definida. Rode com: node --env-file=.env.local ...')
  process.exit(2)
}

const { sql } = await carregar('lib', 'db.ts')

const linhas = await sql`
  select u.email, u.nome as pessoa, t.id, t.nome as viagem, p.papel,
         to_char(t.data_partida, 'YYYY-MM-DD') as partida,
         to_char(t.data_retorno, 'YYYY-MM-DD') as retorno,
         t.arquivada
    from travelers p
    join trips t on t.id = p.trip_id
    join users u on u.id = p.user_id
   order by u.email, t.data_partida
`

const filtradas = conta ? linhas.filter((l) => l.email === conta) : linhas

if (filtradas.length === 0) {
  console.log(conta ? `Nenhuma viagem para ${conta}.` : 'Nenhuma viagem com conta vinculada.')
  console.log('Uma viagem so aparece aqui quando alguem se cadastrou com o e-mail do participante.')
  process.exit(0)
}

let atual = null
for (const l of filtradas) {
  if (l.email !== atual) {
    atual = l.email
    console.log(`\n${l.pessoa} <${l.email}>`)
  }
  const marca = l.arquivada ? ' [arquivada]' : ''
  console.log(`  ${l.id}  ${l.viagem}${marca}`)
  console.log(`  ${' '.repeat(36)}  ${l.partida} a ${l.retorno} · ${l.papel}`)
}

console.log(`\nPara subir nesta viagem:`)
console.log(`  subir.mjs <arquivo.json> --viagem <id acima> --conta <e-mail acima> --conferir`)
