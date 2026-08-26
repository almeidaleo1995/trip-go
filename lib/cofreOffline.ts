// DocumentStorage: de onde vêm os bytes de um documento, e quem decide isso.
//
// A tela nunca fala com a rede nem com o IndexedDB direto — ela chama `abrir()` e
// recebe uma URL que funciona. Essa é a fronteira que o §37 pede: trocar o
// Postgres por um bucket depois muda `baixar()` e mais nada.
//
// A ordem de busca é deliberada: PRIMEIRO o que já está no aparelho, depois a
// rede. Um documento marcado como offline não pode depender de uma requisição
// para abrir — é essa a diferença entre o cofre e uma pasta de links.
import { lerArquivo, gravarArquivo, removerArquivo, arquivosSalvos } from './offline.ts'
import type { ArquivoOffline } from './offline.ts'
import type { Documento } from './cofre.ts'

export type { ArquivoOffline }

/** Onde o arquivo foi encontrado. A tela usa isto para dizer "aberto do aparelho". */
export type Origem = 'aparelho' | 'rede'

export class ErroCofre extends Error {
  constructor(
    message: string,
    readonly semRede = false,
  ) {
    super(message)
    this.name = 'ErroCofre'
  }
}

/** Busca os bytes no servidor. É o único ponto que conhece a rota. */
async function baixar(documentoId: string): Promise<ArquivoOffline> {
  let resposta: Response
  try {
    resposta = await fetch(`/api/documento?id=${encodeURIComponent(documentoId)}`)
  } catch {
    // fetch só rejeita quando não houve resposta nenhuma: sem rede, DNS, ou a
    // pessoa está no avião. É a mensagem que vale a pena distinguir das outras.
    throw new ErroCofre('Sem conexão para baixar este documento.', true)
  }
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null
    throw new ErroCofre(corpo?.erro ?? 'Não foi possível baixar este documento.')
  }
  const blob = await resposta.blob()
  return {
    blob,
    mime: blob.type || 'application/octet-stream',
    nome: documentoId,
    bytes: blob.size,
    salvo_em: new Date().toISOString(),
  }
}

/**
 * Os bytes de um documento, venham de onde vierem.
 *
 * Quem chama é responsável por `URL.revokeObjectURL(url)` quando terminar. Sem
 * isso o blob fica preso na memória da aba até a página recarregar — com uma
 * dezena de PDFs abertos numa sessão longa, isso aparece.
 */
export async function abrir(
  doc: Documento,
): Promise<{ url: string; origem: Origem; mime: string }> {
  const local = await lerArquivo(doc.id)
  if (local) {
    return { url: URL.createObjectURL(local.blob), origem: 'aparelho', mime: local.mime }
  }

  const baixado = await baixar(doc.id)
  // Marcado como offline e ainda não guardado: aproveita a abertura para guardar.
  // A pessoa acabou de provar que precisa dele, e provavelmente ainda tem rede.
  if (doc.offline) {
    await gravarArquivo(doc.id, { ...baixado, nome: doc.arquivo_nome ?? doc.titulo })
  }
  return { url: URL.createObjectURL(baixado.blob), origem: 'rede', mime: baixado.mime }
}

/** Garante que este aparelho tem o arquivo. Idempotente: já baixado não rebaixa. */
export async function salvarOffline(doc: Documento): Promise<void> {
  if (await lerArquivo(doc.id)) return
  const baixado = await baixar(doc.id)
  await gravarArquivo(doc.id, { ...baixado, nome: doc.arquivo_nome ?? doc.titulo })
}

/** Devolve o espaço. O documento continua existindo, só deixa de viajar junto. */
export async function esquecerOffline(documentoId: string): Promise<void> {
  await removerArquivo(documentoId)
}

export type ResultadoSync = {
  salvos: Set<string>
  erros: Map<string, string>
}

/**
 * Põe o aparelho em dia com o que a viagem marcou como offline.
 *
 * Baixa o que falta e descarta o que deixou de ser offline (ou foi apagado da
 * viagem) — senão o cofre só cresce, e o navegador acaba estourando a cota
 * guardando o voucher de um hotel que ninguém mais vai usar.
 *
 * Um arquivo que falha NÃO interrompe os outros: no aeroporto, dez de onze
 * baixados é um resultado bom, e uma exceção no meio da fila deixaria os nove
 * seguintes de fora por causa do décimo.
 *
 * ponytail: baixa em série. São poucos arquivos e a rede de roaming não gosta de
 * paralelismo; se um dia forem centenas, o passo é uma fila com concorrência 3.
 */
export async function sincronizar(documentos: Documento[]): Promise<ResultadoSync> {
  const jaSalvos = new Set(await arquivosSalvos())
  const querem = documentos.filter((d) => d.offline && d.tipo === 'arquivo')
  const queremIds = new Set(querem.map((d) => d.id))

  for (const id of jaSalvos) {
    if (!queremIds.has(id)) await removerArquivo(id)
  }

  const salvos = new Set([...jaSalvos].filter((id) => queremIds.has(id)))
  const erros = new Map<string, string>()

  for (const doc of querem) {
    if (salvos.has(doc.id)) continue
    try {
      await salvarOffline(doc)
      salvos.add(doc.id)
    } catch (e) {
      erros.set(doc.id, e instanceof Error ? e.message : 'Falha ao preparar o documento.')
    }
  }

  return { salvos, erros }
}

/** O que já está guardado neste aparelho, sem tocar na rede. */
export async function jaSalvos(): Promise<Set<string>> {
  return new Set(await arquivosSalvos())
}
