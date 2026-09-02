// A SQL de montagem nao pode envelhecer separada do contrato do app.
//
// `db/montar.sql` publica uma funcao por secao do arquivo de importacao, com um
// argumento por campo. Ele e GERADO de `lib/schema.ts` — e um arquivo gerado que
// ninguem confere e um arquivo que so parece atualizado. O primeiro teste aqui e
// o que fecha isso: se alguem adiciona um campo no zod e nao roda
// `npm run sql:build`, este teste falha dizendo exatamente isso.
//
// Os outros dois travam as propriedades que a geracao poderia perder sem que o
// arquivo deixasse de ser "o que o gerador produz": uma secao sem funcao, e um
// campo de LIGACAO POR NOME que sumisse dos argumentos. Sem `dono_nome` ou
// `assigned_to_nomes`, a SQL continuaria montando viagem — sem o dono do
// passaporte e sem quem responde por cada item do checklist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SECOES_ARQUIVO } from './schema.ts'
import { gerarSql } from '../scripts/gerar-montar-sql.mjs'

const sql = readFileSync(new URL('../db/montar.sql', import.meta.url), 'utf8')

test('db/montar.sql esta em dia com lib/schema.ts', () => {
  assert.equal(
    sql,
    gerarSql(),
    'db/montar.sql divergiu do contrato do app. Rode `npm run sql:build` e ' +
      'commite o resultado: enquanto os dois nao batem, a SQL monta viagem sem o ' +
      'campo novo, em silencio, e o dado some entre o script e a tela.',
  )
})

test('toda secao do arquivo tem funcao propria na SQL', () => {
  for (const secao of Object.keys(SECOES_ARQUIVO)) {
    assert.match(
      sql,
      new RegExp(`-- Acrescenta um item a secao "${secao}" do rascunho`),
      `a secao "${secao}" existe no arquivo de importacao e nao tem funcao em ` +
        'db/montar.sql. Sem ela nao ha como montar essa parte da viagem em SQL.',
    )
    assert.match(
      sql,
      new RegExp(`'${secao}', montar\\.__secao`),
      `a secao "${secao}" nao entra em montar.arquivo(): ela seria montada e ` +
        'depois descartada na saida, que e o pior lugar para perder dado.',
    )
  }
})

test('os campos de ligacao por NOME continuam sendo argumento', () => {
  // O arquivo nao tem id de linha: a importacao cria a viagem do zero. Estes sao
  // os campos por onde uma secao encontra a outra, e cada um deles ja e o motivo
  // de um comentario em lib/importar.ts. Perder um nao quebra nada visivelmente —
  // a viagem entra sem o vinculo, que e a falha que ninguem percebe.
  const ligacoes = [
    'p_dono_nome',
    'p_assigned_to_nomes',
    'p_requisito_nome',
    'p_pagador',
    'p_categoria',
    'p_reserva',
    'p_documento',
  ]
  for (const campo of ligacoes) {
    assert.ok(sql.includes(campo), `db/montar.sql perdeu o argumento ${campo}`)
  }
})

test('a SQL de montagem nao escreve em tabela do app', () => {
  // `montar.*` monta jsonb e mais nada. Uma gravadora em PL/pgSQL seria a segunda
  // copia das regras de autorizacao — e quem roda SQL tem a DATABASE_URL, ou seja,
  // esta acima de qualquer papel: o recorte por papel protege a rede, nao o
  // console do banco. Um `select` daqui juntando `travelers` publicaria passaporte
  // alheio dentro de um jsonb que vira arquivo e circula por e-mail.
  const APP = [
    'trips',
    'travelers',
    'expenses',
    'documents',
    'document_files',
    'itinerary_events',
    'users',
  ]
  for (const tabela of APP) {
    assert.ok(
      !new RegExp(`(from|join|into|update)\\s+${tabela}\\b`, 'i').test(sql),
      `db/montar.sql alcancou a tabela ${tabela}. Este schema so monta jsonb: ` +
        'quem le viagem e /api/export (que corta por papel) e quem grava e ' +
        'lib/importar.ts (que passa pela autorizacao).',
    )
  }
})
