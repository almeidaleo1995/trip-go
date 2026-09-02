// O arquivo entre a tela e /api/documento: quanto cabe, o que encolher, e como
// passar um PDF de 20 MB por uma porta de 4,5 MB.
//
// A porta é da Vercel, não nossa: qualquer requisição com corpo acima de 4,5 MB
// leva 413 `FUNCTION_PAYLOAD_TOO_LARGE` na borda, antes de o handler existir — e
// a MESMA regra vale para a resposta, então um arquivo grande que entrasse por
// outro caminho continuaria sem poder sair (vercel.com/docs/functions/limitations).
//
// A saída é fatiar: o arquivo sobe em pedaços de 4 MB, um POST por pedaço, e o
// Postgres concatena. A descida é a outra metade do problema e está no GET da
// rota, que responde em streaming — streaming não tem teto de tamanho.
//
// Vive fora da rota porque as duas pontas precisam dos mesmos números. O servidor
// continua conferindo tudo de novo: ele é a fronteira de confiança, e nenhuma
// checagem de navegador substitui isso.
import { formatarTamanho } from './cofre.ts'

/**
 * O teto do arquivo inteiro. 25 MB.
 *
 * Não é mais a borda que manda aqui — com o upload fatiado, o limite é o bom
 * senso do cofre. Documento marcado como offline desce inteiro para o IndexedDB
 * de cada celular do grupo, e uma apólice de 25 MB já é pesada para isso; passar
 * disso troca "abre no avião" por "estourou a cota do navegador".
 *
 * ponytail: 25 MB por arquivo, com os bytes no Postgres. O que cede primeiro é a
 * cota offline do celular e a egress do Neon, não a rota. Se um dia precisar de
 * arquivo grande de verdade, o caminho é bucket com URL assinada — `document_files`
 * e os dois handlers de /api/documento são a costura inteira.
 */
export const LIMITE_ARQUIVO = 25 * 1024 * 1024

/**
 * O tamanho de cada pedaço que sobe. 4 MiB.
 *
 * Fica abaixo dos 4,5 MB da borda com folga para o resto do multipart — o
 * `trip_id`, o JSON de `campos`, os cabeçalhos e as fronteiras viajam no mesmo
 * corpo. E fica abaixo pela leitura mais apertada dos 4,5 MB (decimal), porque
 * errar essa conta troca uma mensagem clara por uma falha muda.
 */
export const FATIA = 4 * 1024 * 1024

export const MIMES_ARQUIVO = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

/**
 * As assinaturas de verdade dos quatro formatos aceitos — os primeiros bytes que
 * todo arquivo daquele tipo começa, definidos pelo formato, não pelo nome.
 *
 * POR QUE ISTO EXISTE. `arquivo.type` num `FormData` é o que o CLIENTE declarou.
 * Renomear `carga.html` para `passaporte.pdf` e mandar `application/pdf` no
 * multipart passa por qualquer checagem de mime — e o resultado fica guardado no
 * cofre com um `Content-Disposition: inline` e o `Content-Type` que a linha diz.
 * O `X-Content-Type-Options: nosniff` do next.config.ts fecha a metade do
 * problema (o navegador para de adivinhar); esta função fecha a outra, que é o
 * arquivo nunca ter sido o que disse ser.
 *
 * WEBP tem dois pedaços separados: `RIFF` no começo e `WEBP` no oitavo byte, com
 * o tamanho no meio. Conferir só o `RIFF` aceitaria um WAV.
 */
const ASSINATURAS: Record<string, (b: Uint8Array) => boolean> = {
  'application/pdf': (b) => texto(b, 0, '%PDF-'),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b[0] === 0x89 && texto(b, 1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a,
  'image/webp': (b) => texto(b, 0, 'RIFF') && texto(b, 8, 'WEBP'),
}

function texto(b: Uint8Array, inicio: number, esperado: string): boolean {
  for (let i = 0; i < esperado.length; i++) {
    if (b[inicio + i] !== esperado.charCodeAt(i)) return false
  }
  return true
}

/** Quantos bytes bastam para decidir. 12 cobre a assinatura mais longa (WEBP). */
export const BYTES_ASSINATURA = 12

/**
 * O conteúdo confere com o tipo declarado?
 *
 * Puro e sem `File`, para ser testável: recebe os primeiros bytes e o mime que
 * veio junto. Vale só para o PRIMEIRO pedaço do upload — do segundo em diante os
 * bytes são o meio do arquivo, e ali não há assinatura nenhuma para conferir.
 *
 * Mime fora da lista devolve `false`: quem chama já recusou antes por outro
 * motivo, e um `default: true` aqui viraria a porta dos fundos no dia em que a
 * lista de mimes crescer sem alguém lembrar desta função.
 */
export function assinaturaConfere(mime: string, bytes: Uint8Array): boolean {
  const confere = ASSINATURAS[mime]
  if (!confere) return false
  if (bytes.length < BYTES_ASSINATURA) return false
  return confere(bytes)
}

/** O teto como a tela escreve: "25 MB". Um lugar só, quatro textos. */
export const LIMITE_TEXTO = formatarTamanho(LIMITE_ARQUIVO)

/** O lado maior da foto depois de encolher. Passaporte continua legível. */
const LADO_MAIOR = 2000

/**
 * Os deslocamentos de cada parte. Puro, para poder testar sem navegador.
 *
 * Arquivo vazio não existe (a rota recusa antes), mas devolver `[]` faria o laço
 * de envio não rodar nenhuma vez e a função devolver sucesso sem ter subido nada.
 */
export function fatias(tamanho: number, fatia = FATIA): number[] {
  const partes: number[] = []
  for (let inicio = 0; inicio < tamanho; inicio += fatia) partes.push(inicio)
  return partes.length ? partes : [0]
}

/**
 * Foto grande vira foto do tamanho certo, mesmo cabendo no teto.
 *
 * Não é mais sobre o limite: é sobre o cofre. Ninguém escaneia passaporte, todo
 * mundo fotografa, e um celular atual entrega 8 MB de uma página A4 que cabe em
 * 500 KB sem perder um dígito do número. Subir os 8 MB gastaria três requisições
 * e ocuparia 8 MB no IndexedDB de cada pessoa da viagem, para ler igual.
 *
 * PDF não tem equivalente nativo — e agora não precisa: ele sobe fatiado inteiro.
 * Canvas é nativo; não entra biblioteca para redimensionar imagem.
 */
async function encolher(arquivo: File): Promise<File | null> {
  if (!arquivo.type.startsWith('image/')) return null
  try {
    const bitmap = await createImageBitmap(arquivo)
    const escala = Math.min(1, LADO_MAIOR / Math.max(bitmap.width, bitmap.height))
    const tela = document.createElement('canvas')
    tela.width = Math.round(bitmap.width * escala)
    tela.height = Math.round(bitmap.height * escala)
    tela.getContext('2d')?.drawImage(bitmap, 0, 0, tela.width, tela.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((ok) => tela.toBlob(ok, 'image/jpeg', 0.8))
    if (!blob || blob.size >= arquivo.size) return null
    // A extensão acompanha o mime novo: um `.png` que virou JPEG baixaria com o
    // nome mentindo, e o cofre mostra o tipo pela extensão do nome.
    const nome = arquivo.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], nome, { type: 'image/jpeg' })
  } catch {
    return null
  }
}

/**
 * O arquivo pronto para subir, ou um erro em pt-BR dizendo por quê não.
 *
 * Foto acima de uma fatia encolhe; o resto passa como está, até o teto. Acima do
 * teto a mensagem diz o tamanho do arquivo DA PESSOA — "grande demais" sozinho
 * não deixa ninguém decidir o que fazer.
 */
export async function prepararArquivo(arquivo: File): Promise<File> {
  if (!MIMES_ARQUIVO.has(arquivo.type)) {
    throw new Error('Formato não aceito. Envie PDF, JPG, PNG ou WEBP.')
  }
  const pronto = arquivo.size > FATIA ? ((await encolher(arquivo)) ?? arquivo) : arquivo
  if (pronto.size > LIMITE_ARQUIVO) {
    throw new Error(
      `${arquivo.name} tem ${formatarTamanho(arquivo.size)} e o máximo é ${LIMITE_TEXTO}.`,
    )
  }
  return pronto
}

export type Progresso = { parte: number; partes: number; enviado: number; total: number }

/**
 * Sobe o arquivo inteiro, em quantas requisições forem necessárias.
 *
 * Os pedaços vão em SÉRIE, e é de propósito: `deslocamento` diz ao servidor onde
 * a parte se encaixa, e ele só concatena se o que já está gravado terminar
 * exatamente ali. Em paralelo, duas partes chegariam fora de ordem e uma delas
 * seria recusada — em série, a mesma checagem vira proteção contra a parte
 * repetida de um retry, que senão entraria duas vezes no meio do PDF.
 *
 * A ficha (`campos`) viaja só na primeira parte: ela cria o documento e devolve o
 * id que as seguintes usam. As seguintes não revalidam metadado nem remontam o
 * snapshot — são sete requisições, e seis snapshots jogados fora são seis viagens
 * ao banco por nada.
 */
export async function enviarArquivo(opcoes: {
  arquivo: File
  tripId: string
  campos: Record<string, unknown>
  /** Documento existente, quando se está trocando o arquivo de um que já existe. */
  id?: string | null
  aoProgredir?: (p: Progresso) => void
}): Promise<{ documento_id: string }> {
  const arquivo = await prepararArquivo(opcoes.arquivo)
  const inicios = fatias(arquivo.size)
  let id = opcoes.id ?? ''

  for (const [indice, inicio] of inicios.entries()) {
    const pedaco = arquivo.slice(inicio, inicio + FATIA)
    const form = new FormData()
    form.set('trip_id', opcoes.tripId)
    // `slice` devolve um Blob sem nome e, dependendo do navegador, sem tipo. A
    // rota lê os dois do arquivo — reembrulhar aqui é mais barato do que dois
    // campos extras que poderiam discordar do conteúdo.
    form.set('arquivo', new File([pedaco], arquivo.name, { type: arquivo.type }))
    form.set('deslocamento', String(inicio))
    form.set('tamanho_total', String(arquivo.size))
    if (id) form.set('id', id)
    if (indice === 0) form.set('campos', JSON.stringify(opcoes.campos))

    const r = await fetch('/api/documento', { method: 'POST', body: form })
    const corpo = (await r.json().catch(() => null)) as {
      documento_id?: string
      erro?: string
    } | null
    if (!r.ok || !corpo?.documento_id) {
      throw new Error(corpo?.erro ?? 'Não foi possível enviar o arquivo.')
    }
    id = corpo.documento_id
    opcoes.aoProgredir?.({
      parte: indice + 1,
      partes: inicios.length,
      enviado: Math.min(inicio + FATIA, arquivo.size),
      total: arquivo.size,
    })
  }

  return { documento_id: id }
}
