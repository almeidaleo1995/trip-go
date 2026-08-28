import test from 'node:test'
import assert from 'node:assert/strict'
import { FATIA, LIMITE_ARQUIVO, LIMITE_TEXTO, fatias, prepararArquivo } from './arquivo.ts'

// `encolher` precisa de canvas e `enviarArquivo` precisa de rede — nenhum roda
// aqui. O que se testa e o que decide se o arquivo chega inteiro: o portao de
// tamanho/formato e a conta das fatias.
//
// `File` nao deixa forjar `size`, e alocar 30 MB so para um assert e desperdicio.
// `prepararArquivo` le tres campos; o dublê tem os tres.
const arquivo = (nome: string, tipo: string, bytes: number) =>
  ({ name: nome, type: tipo, size: bytes }) as File

test('arquivo dentro do teto passa intacto', async () => {
  const f = arquivo('passaporte.pdf', 'application/pdf', LIMITE_ARQUIVO)
  assert.equal(await prepararArquivo(f), f)
})

test('pdf grande passa: e ele que vai fatiado', async () => {
  const f = arquivo('apolice.pdf', 'application/pdf', 18 * 1024 * 1024)
  assert.equal(await prepararArquivo(f), f)
})

test('formato fora da lista e recusado', async () => {
  const f = arquivo('planilha.xlsx', 'application/vnd.ms-excel', 1024)
  await assert.rejects(() => prepararArquivo(f), /Formato n[aã]o aceito/)
})

test('acima do teto diz o tamanho do arquivo da pessoa', async () => {
  const f = arquivo('contrato.pdf', 'application/pdf', 40 * 1024 * 1024)
  await assert.rejects(
    () => prepararArquivo(f),
    (e: Error) => {
      assert.match(e.message, /contrato\.pdf/)
      assert.match(e.message, /40 MB/)
      assert.match(e.message, new RegExp(LIMITE_TEXTO.replace(',', '[,.]')))
      return true
    },
  )
})

// ---------------------------------------------------------------- fatias

test('arquivo menor que uma fatia sobe numa requisicao so', () => {
  assert.deepEqual(fatias(1000), [0])
})

test('as fatias cobrem o arquivo inteiro, sem buraco nem sobreposicao', () => {
  const tamanho = 18 * 1024 * 1024 + 7
  const partes = fatias(tamanho)
  assert.equal(partes.length, Math.ceil(tamanho / FATIA))
  // Cada fatia comeca exatamente onde a anterior termina — e essa a conta que o
  // servidor confere em `octet_length(bytes) = deslocamento` antes de concatenar.
  partes.forEach((inicio, i) => assert.equal(inicio, i * FATIA))
  const ultima = partes[partes.length - 1]
  assert.ok(ultima < tamanho, 'a ultima fatia tem de ter conteudo')
  assert.equal(Math.min(ultima + FATIA, tamanho), tamanho)
})

test('fatia nunca passa do corpo aceito pela borda (4,5 MB)', () => {
  assert.ok(FATIA < 4_500_000, `${FATIA} passa do limite decimal da Vercel`)
})

test('arquivo vazio ainda gera uma requisicao, nao zero', () => {
  assert.deepEqual(fatias(0), [0])
})
