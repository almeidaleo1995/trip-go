#!/usr/bin/env node
// Extrai texto de PDFs para .txt ao lado do original.
// Uso: node extrair.mjs <arquivo.pdf> [outro.pdf ...]
//
// Detecta a ferramenta disponivel em vez de assumir. -layout preserva colunas de
// tabela; -enc UTF-8 evita que todo acento vire "?" - os dois sao obrigatorios,
// nao preferencia.
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename, extname, join, dirname } from 'node:path'

const arquivos = process.argv.slice(2)
if (arquivos.length === 0) {
  console.error('uso: node extrair.mjs <arquivo.pdf> [...]')
  process.exit(2)
}

function existe(cmd) {
  try {
    execFileSync(cmd, ['-v'], { stdio: 'ignore' })
    return true
  } catch (e) {
    // pdftotext sai com codigo != 0 no -v mas existe; ENOENT e que significa ausente
    return e.code !== 'ENOENT'
  }
}

const temPdftotext = existe('pdftotext')

if (!temPdftotext) {
  console.error(
    'Nenhum extrator de PDF encontrado.\n\n' +
      'Instale um destes:\n' +
      '  Windows (Git Bash ja costuma trazer): pdftotext vem no poppler\n' +
      '  macOS:   brew install poppler\n' +
      '  Linux:   apt-get install poppler-utils\n' +
      '  Python:  pip install pypdf  (fallback mais lento e sem -layout)\n'
  )
  process.exit(1)
}

let falhas = 0
for (const pdf of arquivos) {
  if (!existsSync(pdf)) {
    console.error(`nao encontrado: ${pdf}`)
    falhas++
    continue
  }
  const saida = join(dirname(pdf), basename(pdf, extname(pdf)) + '.txt')
  try {
    execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, saida], { stdio: 'pipe' })
    const kb = (statSync(saida).size / 1024).toFixed(1)
    console.log(`${saida}  (${kb} KB)`)
  } catch (e) {
    console.error(`falhou em ${pdf}: ${e.message}`)
    falhas++
  }
}

if (falhas > 0) process.exit(1)
console.log('\nLeia cada .txt INTEIRO antes de montar o JSON. Documento de viagem se')
console.log('contradiz, e a correcao costuma estar longe da informacao errada.')
