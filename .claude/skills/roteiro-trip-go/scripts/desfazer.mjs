#!/usr/bin/env node
// Desfaz uma carga que `subir.mjs` gravou. Nao escreve arquivo nenhum.
//
//   node --env-file=.env.local <este script> <lote> --conta voce@exemplo.com
//   node --env-file=.env.local <este script> <lote> --conta voce@… --conferir
//
// POR QUE ISTO EXISTE
//
// `subir.mjs` escreve numa viagem que outras pessoas ja estao usando. Uma carga
// de 40 linhas revertida a mao, item por item, na aba certa, e o tipo de tarefa
// que ninguem termina — entao na pratica o erro fica. O `lote` gravado no
// `change_log` no momento da escrita e o que torna a volta possivel; ele nao pode
// ser reconstruido depois.
//
// O QUE ELE NAO DESFAZ, E POR QUE
//
// REMOCAO. O `change_log` registra que uma linha existiu, nunca o conteudo dela,
// e `on delete cascade` leva os filhos junto. Ressuscitar seria inventar dado —
// a regra que governa esta skill inteira. `subir.mjs` so cria, entao na pratica
// isto nao aparece; mas se aparecer, a linha e listada e nao revertida.
//
// AUTORIZACAO
//
// Cada reversao passa por `autorizar` com o `Acesso` da conta informada, linha a
// linha. O `lote` e visivel no snapshot para todo participante, entao reverter
// sem essa checagem seria escalada de privilegio: um editor apagaria com ele o
// documento pessoal de outra pessoa, que ele nem pode LER. `colunaValida` fecha a
// outra ponta — o `campo` vem do banco e entra num `set <campo> = $1`.
import { carregar } from './projeto.mjs'

const argv = process.argv.slice(2)
const opcoes = {}
let lote
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const nome = argv[i].slice(2)
    const proximo = argv[i + 1]
    opcoes[nome] = proximo && !proximo.startsWith('--') ? argv[++i] : true
  } else if (!lote) {
    lote = argv[i]
  }
}
const conta = typeof opcoes.conta === 'string' ? opcoes.conta.toLowerCase() : null
const conferir = opcoes.conferir === true

if (!lote || !conta) {
  console.error('uso: desfazer.mjs <lote> --conta <email> [--conferir]')
  process.exit(2)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL nao definida. Rode com: node --env-file=.env.local ...')
  process.exit(2)
}

const { sql } = await carregar('lib', 'db.ts')
const { exigirViagem } = await carregar('lib', 'auth.ts')
const { autorizar, TABELA, colunaValida } = await carregar('lib', 'escrita.ts')

const [usuario] = await sql`select id, nome from users where email = ${conta}`
if (!usuario) {
  console.error(`Nao existe conta com o e-mail ${conta}.`)
  process.exit(1)
}

// Ordem INVERSA: a ultima escrita e a primeira a voltar. Com duas edicoes no
// mesmo campo, reproduzir de tras para frente devolve o valor original;
// reproduzir de frente devolve o INTERMEDIARIO, que ninguem escolheu.
const linhas = await sql`
  select id, trip_id, entidade, entidade_id, campo, de, para
    from change_log
   where lote = ${lote} and origem = 'skill'
   order by criado_em desc, id desc
`

if (linhas.length === 0) {
  console.error(`Lote ${lote} nao encontrado (ou nao foi gravado pela skill).`)
  process.exit(1)
}

const tripId = String(linhas[0].trip_id)
let acesso
try {
  acesso = await exigirViagem(usuario.id, tripId, 'editor')
} catch (e) {
  console.error(`${conta} nao pode escrever nesta viagem: ${e.message}`)
  process.exit(1)
}

const criacoes = linhas.filter((l) => l.campo === '(registro)' && l.para === 'criado')
const edicoes = linhas.filter((l) => l.campo !== '(registro)')
const remocoes = linhas.filter((l) => l.campo === '(registro)' && l.para === 'removido')

console.log(`Lote ${lote} — viagem ${tripId}`)
console.log(`  ${criacoes.length} criacao(oes) a apagar`)
console.log(`  ${edicoes.length} edicao(oes) a reverter`)
if (remocoes.length > 0) {
  console.log(`  ${remocoes.length} remocao(oes) NAO revertida(s): o historico guarda que a`)
  console.log(`     linha existiu, nunca o conteudo dela. Ressuscitar seria inventar dado.`)
}

if (conferir) {
  console.log('\n(--conferir: nada foi alterado)')
  process.exit(0)
}

let feitas = 0
const recusadas = []

// Edicoes primeiro: reverter o valor de uma linha que sera apagada logo abaixo
// nao custa nada, mas apagar antes deixaria a edicao sem alvo.
for (const l of [...edicoes, ...criacoes]) {
  const entidade = String(l.entidade)
  const meta = TABELA[entidade]
  const id = l.entidade_id ? String(l.entidade_id) : null
  if (!meta || !id) { recusadas.push(`${entidade}: sem tabela ou sem id`); continue }
  try {
    if (l.campo === '(registro)') {
      await autorizar(acesso, entidade, 'remover', {}, id)
      await sql.query(`delete from ${meta.nome} where id = $1`, [id])
    } else {
      const campo = String(l.campo)
      // O `campo` vem do BANCO e entra num `set <campo> = $1`. A lista branca e o
      // que separa "nao ha injecao hoje" de "nao pode haver injecao".
      if (!colunaValida(entidade, campo)) { recusadas.push(`${entidade}.${campo}: coluna fora do schema`); continue }
      await autorizar(acesso, entidade, 'editar', { [campo]: l.de }, id)
      await sql.query(`update ${meta.nome} set ${campo} = $1 where id = $2`, [l.de, id])
    }
    feitas++
  } catch (e) {
    recusadas.push(`${entidade} ${id}: ${e.message}`)
  }
}

// O historico da propria reversao sai junto: um lote desfeito que continuasse
// listado sugeriria que ainda ha o que desfazer.
await sql`delete from change_log where lote = ${lote} and origem = 'skill'`

console.log(`\n${feitas} operacao(oes) revertida(s).`)
if (recusadas.length > 0) {
  console.log(`${recusadas.length} recusada(s):`)
  for (const m of recusadas) console.log(`  x ${m}`)
}
console.log(`\nAbra em /viagens/${tripId}`)
