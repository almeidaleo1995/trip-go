// A lista branca de colunas do caminho de escrita.
//
// Ela existe por causa de UMA forma de escrita: desfazer um lote monta
// `set <campo> = $1` com um `campo` lido do `change_log` — hoje isso acontece em
// `montar.desfazer` (db/montar.sql), e qualquer rota de desfazer futura repetiria
// o padrão. Esse valor só pode ser chave de schema, porque o zod descarta o resto
// antes de `registrarAlteracao` receber — mas a distância entre "não há injeção" e
// "não pode haver injeção" é exatamente esta função.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colunaValida } from './schema.ts'

test('aceita coluna real da entidade', () => {
  assert.ok(colunaValida('roteiro', 'titulo'))
  assert.ok(colunaValida('roteiro', 'ocorre_em'))
  assert.ok(colunaValida('lugar', 'cidade'))
})

test('recusa coluna de outra entidade', () => {
  assert.ok(!colunaValida('lugar', 'ocorre_em'), 'ocorre_em não é coluna de places')
})

test('recusa o campo sintético `(registro)`', () => {
  // As linhas de criar/remover usam este campo. Se uma delas escapasse dos
  // guardas do replay, `set (registro) = $1` seria erro de sintaxe — falha alta
  // e feia num endpoint que a pessoa chamou para consertar alguma coisa.
  assert.ok(!colunaValida('roteiro', '(registro)'))
})

test('recusa tentativa de injeção', () => {
  for (const veneno of [
    'titulo = titulo, ordem = 999 --',
    'titulo; drop table trips',
    'titulo") = 1, ("x',
    '*',
    '',
  ]) {
    assert.ok(!colunaValida('roteiro', veneno), `deixou passar: ${veneno}`)
  }
})

test('entidade sem schema não libera nada', () => {
  assert.ok(!colunaValida('checklist_state', 'qualquer_coisa'))
})
