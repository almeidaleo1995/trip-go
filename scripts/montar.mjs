// Roda um .sql de montagem, confere o rascunho e escreve o arquivo de importacao.
//
//   npm run montar -- <rascunho> [--sql db/exemplo-montar.sql] [--saida viagem.json]
//                                [--para email@conta]
//
// O que ele faz, em ordem, e por que cada passo existe:
//
//   1. aplica db/montar.sql (idempotente) — o schema `montar` precisa existir;
//   2. roda o .sql que voce escreveu, se houver;
//   3. `montar.conferir` — as ligacoes por nome entre secoes, que so o banco ve;
//   4. `montar.arquivo` — o JSON;
//   5. valida o JSON contra `TripImportSchema`, O MESMO que /api/import usa.
//
// O passo 5 e o que impede este caminho de virar um formato paralelo. A SQL nao
// tem uma nocao propria do que e um arquivo valido: ela monta, e quem diz se
// presta e o contrato do app. Um campo que o zod recusa para aqui, com o caminho
// exato (`voos[2].parte_em: use o formato AAAA-MM-DDTHH:MM`), e nao na tela de
// quem for importar.
//
// `--para <email>` grava a viagem direto na conta daquele e-mail, pelo MESMO
// `importarViagem` que a rota usa — e o atalho para quem esta no terminal com a
// DATABASE_URL na mao. Sem ele nada e gravado: sai um arquivo, e a viagem entra
// pelo botao Importar como sempre.
import { neon } from '@neondatabase/serverless'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { validarImportacao, resumirImportacao } from '@/lib/schema.ts'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------- argumentos

const argv = process.argv.slice(2)
const opcoes = {}
let rascunho

// Um passo por token, e nao `indexOf`: o valor de uma opcao pode ser igual ao nome
// do rascunho ("--saida exemplo"), e `indexOf` acharia o primeiro dos dois.
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    opcoes[argv[i].slice(2)] = argv[++i]
  } else if (!rascunho) {
    rascunho = argv[i]
  }
}

const alvoSql = opcoes.sql
const saida = opcoes.saida
const para = opcoes.para

if (!rascunho) {
  console.error(
    'uso: npm run montar -- <rascunho> [--sql arquivo.sql] [--saida viagem.json] [--para email]',
  )
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL nao definida. Rode com: node --env-file=.env.local ...')
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)

// ---------------------------------------------------------------- execucao

/**
 * O driver HTTP do Neon manda um comando por requisicao, entao um .sql com varias
 * instrucoes precisa ser fatiado — e o corte tem que respeitar `$$ ... $$`, senao
 * meia funcao PL/pgSQL chega ao banco. Mesma funcao de scripts/db-push.mjs, e a
 * duplicacao e deliberada: sao dois scripts de linha de comando independentes, e
 * um `lib/` compartilhado so para isto arrastaria o banco para o bundle do app.
 */
function separarComandos(texto) {
  const limpo = texto
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')

  const comandos = []
  let atual = ''
  let dentroDeBloco = false

  for (let i = 0; i < limpo.length; i++) {
    if (limpo[i] === '$' && limpo[i + 1] === '$') {
      dentroDeBloco = !dentroDeBloco
      atual += '$$'
      i++
      continue
    }
    if (limpo[i] === ';' && !dentroDeBloco) {
      comandos.push(atual)
      atual = ''
      continue
    }
    atual += limpo[i]
  }
  comandos.push(atual)
  return comandos.map((c) => c.trim()).filter(Boolean)
}

async function rodarArquivo(caminho) {
  const comandos = separarComandos(readFileSync(caminho, 'utf8'))
  for (const [i, comando] of comandos.entries()) {
    try {
      await sql.query(comando)
    } catch (e) {
      console.error(`\n${caminho}: falhou no comando ${i + 1}\n${comando.slice(0, 300)}\n`)
      console.error(e.message)
      process.exit(1)
    }
  }
  return comandos.length
}

console.log(`Aplicando db/montar.sql...`)
await rodarArquivo(join(raiz, 'db', 'montar.sql'))

if (alvoSql) {
  const caminho = resolve(process.cwd(), alvoSql)
  const n = await rodarArquivo(caminho)
  console.log(`${alvoSql}: ${n} comandos.`)
}

// ---------------------------------------------------------------- conferencia

const problemas = await sql`select * from montar.conferir(${rascunho})`
for (const p of problemas) {
  const marca = p.gravidade === 'erro' ? '✗' : '!'
  console.log(`${marca} ${p.secao} · ${p.item}: ${p.problema}`)
}

// Aviso nao impede: ele diz "provavelmente nao e o que voce quis", e as vezes e
// mesmo (um passeio um dia antes do embarque, marcado de proposito). Erro impede,
// porque erro quer dizer que a importacao vai PERDER ou torcer o dado — e essa
// perda e silenciosa do outro lado.
const erros = problemas.filter((p) => p.gravidade === 'erro')
if (erros.length > 0) {
  console.error(`\n${erros.length} erro(s) no rascunho. Corrija e rode de novo.`)
  process.exit(1)
}

// ---------------------------------------------------------------- arquivo

// `montar.arquivo` erra alto num nome desconhecido — a mensagem do banco ja diz
// o que fazer, entao ela sobe como esta em vez de virar um "arquivo vazio".
const [linha] = await sql`select montar.arquivo(${rascunho}) as arquivo`

// A MESMA validacao de POST /api/import. Se o zod recusa aqui, recusaria la.
const r = validarImportacao(linha.arquivo)
if (!r.sucesso) {
  console.error(`\nO arquivo nao passa no contrato do app:\n  ${r.erro}`)
  process.exit(1)
}

const resumo = resumirImportacao(r.dados)
console.log(`\n${r.dados.viagem.nome} — ${r.dados.viagem.data_partida} a ${r.dados.viagem.data_retorno}`)
for (const [secao, n] of Object.entries(resumo)) {
  if (n > 0) console.log(`  ${secao.padEnd(16)} ${n}`)
}

if (saida) {
  const destino = resolve(process.cwd(), saida)
  writeFileSync(destino, JSON.stringify(linha.arquivo, null, 2), 'utf8')
  console.log(`\nArquivo: ${destino}`)
  console.log('Importe pela aba Participantes e dados -> Importar.')
}

// ---------------------------------------------------------------- gravar

if (para) {
  const [conta] = await sql`select id, nome from users where email = ${para.toLowerCase()}`
  if (!conta) {
    console.error(`\nNao existe conta com o e-mail ${para}. Cadastre-se no app primeiro.`)
    process.exit(1)
  }
  // Importado pelo caminho de sempre: uma gravadora so, aqui e na rota. Ela cria a
  // viagem NOVA e faz de `conta` a proprietaria — nunca sobrescreve viagem que
  // exista, que e a mesma regra do botao Importar.
  const { importarViagem } = await import('@/lib/importar.ts')
  const { tripId } = await importarViagem(r.dados, conta.id)
  console.log(`\nViagem criada para ${conta.nome} (${para}): /viagens/${tripId}`)
}

if (!saida && !para) {
  console.log('\n(nada gravado: use --saida para o arquivo, ou --para <email> para criar a viagem)')
}
