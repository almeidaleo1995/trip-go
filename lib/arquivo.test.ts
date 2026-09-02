import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BYTES_ASSINATURA,
  FATIA,
  LIMITE_ARQUIVO,
  LIMITE_TEXTO,
  assinaturaConfere,
  fatias,
  prepararArquivo,
} from './arquivo.ts'

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

// ---------------------------------------------------------------- assinatura

/** Os primeiros bytes de um arquivo daquele formato, seguidos de enchimento. */
const inicio = (...bytes: (number | string)[]) => {
  const lista: number[] = []
  for (const b of bytes) {
    if (typeof b === 'number') lista.push(b)
    else for (const c of b) lista.push(c.charCodeAt(0))
  }
  while (lista.length < BYTES_ASSINATURA) lista.push(0)
  return new Uint8Array(lista)
}

test('assinatura: os quatro formatos de verdade passam', () => {
  assert.ok(assinaturaConfere('application/pdf', inicio('%PDF-1.7')))
  assert.ok(assinaturaConfere('image/jpeg', inicio(0xff, 0xd8, 0xff, 0xe0)))
  assert.ok(assinaturaConfere('image/png', inicio(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a)))
  assert.ok(assinaturaConfere('image/webp', inicio('RIFF', 0, 0, 0, 0, 'WEBP')))
})

test('assinatura: HTML jurado como PDF é recusado', () => {
  // O ataque que esta checagem existe para barrar: `arquivo.type` no multipart é
  // o que o CLIENTE declarou, então renomear e declarar `application/pdf` passa
  // por qualquer lista de mimes. O conteúdo é que não mente.
  assert.equal(assinaturaConfere('application/pdf', inicio('<html><scr')), false)
})

test('assinatura: um formato não pode se passar por outro', () => {
  const png = inicio(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a)
  assert.equal(assinaturaConfere('application/pdf', png), false)
  assert.equal(assinaturaConfere('image/jpeg', png), false)
})

test('assinatura: RIFF sem WEBP não é WEBP', () => {
  // Um WAV também começa com RIFF. Conferir só os quatro primeiros bytes o aceitaria.
  assert.equal(assinaturaConfere('image/webp', inicio('RIFF', 0, 0, 0, 0, 'WAVE')), false)
})

test('assinatura: mime fora da lista é sempre falso', () => {
  // Nada de `default: true`: no dia em que MIMES_ARQUIVO crescer sem alguém
  // lembrar desta função, o formato novo é recusado, não liberado sem conferência.
  assert.equal(assinaturaConfere('image/gif', inicio('GIF89a')), false)
  assert.equal(assinaturaConfere('', inicio('%PDF-')), false)
})

test('assinatura: arquivo curto demais para decidir é recusado', () => {
  assert.equal(assinaturaConfere('application/pdf', new Uint8Array([0x25, 0x50])), false)
})
