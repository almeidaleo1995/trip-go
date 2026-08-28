// Os BYTES de um documento do cofre. O metadado do documento vive em /api/mutate
// como qualquer outra entidade; aqui passa só o arquivo.
//
// Rota separada de propósito: o snapshot carrega a viagem inteira a cada abertura
// de tela e fica em cache no IndexedDB. Arquivo entra e sai um por vez, sob demanda.
//
// Este é o passo 1 de `DocumentStorage`: os bytes ficam no Postgres, que já tem
// backup, transação e autorização. Trocar por um bucket depois reescreve esta
// rota — a tela continua chamando GET/POST /api/documento.
import { sql, getSnapshot, registrarAlteracao, usuarioPorId } from '@/lib/db.ts'
import { exigirUsuario, exigirViagem } from '@/lib/auth.ts'
import { ErroHttp } from '@/lib/session.ts'
import { validarCampos } from '@/lib/schema.ts'
import { papelAlcanca, type Papel } from '@/config/navigation.ts'
import { rota } from '@/lib/api.ts'
import { FATIA, LIMITE_ARQUIVO, LIMITE_TEXTO, MIMES_ARQUIVO } from '@/lib/arquivo.ts'
import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// O teto e a lista de formatos vivem em lib/arquivo.ts: o navegador confere antes
// de gastar o upload, esta rota confere de novo porque e a fronteira de confianca.
// Dois numeros diferentes dariam a pior das combinacoes — a tela deixa passar e a
// rota recusa depois de subir.
/**
 * O pedaço que cada volta do stream lê do Postgres. 1 MiB.
 *
 * Não tem relação com `FATIA` (que é a porta da Vercel na subida): aqui o único
 * custo é o base64 de ida e volta, e pedaço pequeno demais multiplicaria consultas
 * num arquivo de 20 MB.
 */
const PEDACO = 1024 * 1024

type LinhaDocumento = {
  id: string
  trip_id: string
  titulo: string
  escopo: string
  traveler_id: string | null
  assigned_to: string[]
  arquivo_nome: string | null
}

/**
 * O documento existe, é desta viagem, e esta sessão pode vê-lo.
 *
 * É o mesmo recorte de `documentosDaViagem`, repetido aqui porque esta rota não
 * passa pelo snapshot: sem isto, quem soubesse o id abriria o passaporte alheio
 * por URL direta, mesmo sem a linha nunca ter aparecido na tela dele.
 */
async function documentoVisivel(userId: string, documentId: string) {
  const r = await sql`
    select id, trip_id, titulo, escopo, traveler_id, assigned_to, arquivo_nome
    from documents where id = ${documentId}
  `
  const doc = r[0] as LinhaDocumento | undefined
  if (!doc) throw new ErroHttp(404, 'Documento não encontrado.')

  const acesso = await exigirViagem(userId, doc.trip_id)
  const meu =
    doc.traveler_id === acesso.participanteId || doc.assigned_to.includes(acesso.participanteId)
  if (doc.escopo === 'pessoal' && !meu && !papelAlcanca(acesso.papel, 'proprietario')) {
    throw new ErroHttp(403, 'Este documento é pessoal de outro participante.')
  }
  return { doc, acesso }
}

/**
 * Mesmo envelope de /api/snapshot e /api/mutate. Sem `eu`, o cliente perde o
 * papel depois do upload e a próxima pintura quebra.
 *
 * Sai daqui uma vez só, na parte que FECHA o arquivo: com o upload fatiado, um
 * envelope por parte seriam sete snapshots da viagem inteira para jogar seis fora.
 */
async function envelope(
  acesso: { userId: string; papel: Papel; participanteId: string },
  tripId: string,
) {
  return {
    ...(await getSnapshot(tripId, acesso.papel, acesso.participanteId)),
    eu: {
      userId: acesso.userId,
      usuario: await usuarioPorId(acesso.userId),
      participanteId: acesso.participanteId,
      papel: acesso.papel,
    },
  }
}

// GET /api/documento?id=<id> — o arquivo em si.
export const GET = rota(async (req) => {
  const u = await exigirUsuario()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) throw new ErroHttp(400, 'Informe o documento.')

  const { doc } = await documentoVisivel(u.id, id)

  // base64 nos dois sentidos, de propósito. O driver do Neon aqui é o HTTP
  // (`neon()`), e ele troca parâmetros e resultados como JSON: um `Buffer` enviado
  // vira `{"type":"Buffer","data":[...]}` e um `bytea` lido volta como a string
  // hex `J50...`. Nenhum dos dois é o arquivo. `encode`/`decode` no próprio
  // Postgres tiram a ambiguidade e funcionam igual em qualquer driver — o preço é
  // ~33% a mais de texto entre banco e servidor.
  const r = await sql`
    select f.mime, octet_length(f.bytes) as tamanho, d.arquivo_bytes as esperado
    from document_files f join documents d on d.id = f.document_id
    where f.document_id = ${id}
  `
  const arquivo = r[0] as { mime: string; tamanho: number; esperado: number | null } | undefined
  if (!arquivo) throw new ErroHttp(404, 'Este documento não tem arquivo anexado.')

  // Upload fatiado que parou no meio deixa uma linha com bytes a menos. Servir
  // isso entregaria um PDF que abre quebrado, e a pessoa culparia o arquivo dela.
  // `documents.arquivo_bytes` guarda o tamanho que era para ter chegado.
  if (arquivo.esperado && arquivo.tamanho < arquivo.esperado) {
    throw new ErroHttp(409, 'O envio deste arquivo não terminou. Envie o documento de novo.')
  }

  // Resposta em STREAM, e não um Buffer só: a Vercel também recusa RESPOSTA acima
  // de 4,5 MB (`FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE`), e streaming é o caminho
  // documentado que não tem teto. Sem isto, o arquivo grande entraria fatiado e
  // nunca mais sairia. O `substring` mantém a conta de memória constante dos dois
  // lados — nem o Postgres nem esta função montam o PDF inteiro para mandar.
  let lidos = 0
  const corpo = new ReadableStream<Uint8Array>({
    async pull(fluxo) {
      const parte = await sql`
        select encode(substring(bytes from ${lidos + 1} for ${PEDACO}), 'base64') as b64
        from document_files where document_id = ${id}
      `
      const buf = Buffer.from((parte[0] as { b64: string }).b64, 'base64')
      if (buf.length === 0) return fluxo.close()
      lidos += buf.length
      fluxo.enqueue(new Uint8Array(buf))
      if (lidos >= arquivo.tamanho) fluxo.close()
    },
  })

  // Sem `Content-Length` de propósito: com o tamanho declarado a resposta pode ser
  // tratada como corpo único, que é exatamente o que o teto de 4,5 MB pega. Em
  // `chunked` não há dúvida de que é streaming. O que se perde é a barra de
  // progresso do navegador ao baixar.
  //
  // ponytail: se der para confirmar em produção que a borda respeita streaming com
  // tamanho declarado, o cabeçalho volta e o download ganha progresso.
  const nome = encodeURIComponent(doc.arquivo_nome ?? doc.titulo)
  return new NextResponse(corpo, {
    headers: {
      'Content-Type': arquivo.mime,
      // `inline` para o preview abrir na própria tela. Baixar é o navegador que
      // decide, pelo atributo `download` do link, não por este cabeçalho.
      'Content-Disposition': `inline; filename*=UTF-8''${nome}`,
      // Privado e sem revalidar sozinho: arquivo de viagem não pode parar num CDN.
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  })
})

// POST /api/documento — cria (ou substitui o arquivo de) um documento, em uma ou
// mais partes.
//
// FormData em vez de JSON: base64 num corpo JSON inflaria o upload em um terço e
// ainda exigiria decodificar na mão. `req.formData()` é nativo.
//
// `deslocamento` é o que torna a rota fatiável: 0 abre o documento (valida a
// ficha, checa permissão, grava a primeira parte), qualquer outro valor APENDA no
// arquivo que já começou. A ordem não é uma convenção de boa-fé — o `update` só
// acontece quando o que está gravado termina exatamente no deslocamento pedido,
// então parte fora de ordem é recusada e parte repetida de um retry não entra
// duas vezes no meio do PDF.
export const POST = rota(async (req) => {
  const u = await exigirUsuario()
  const form = await req.formData()

  const tripId = String(form.get('trip_id') ?? '')
  if (!tripId) throw new ErroHttp(400, 'Informe a viagem.')
  const acesso = await exigirViagem(u.id, tripId)

  const arquivo = form.get('arquivo')
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    throw new ErroHttp(400, 'Nenhum arquivo foi enviado.')
  }
  if (!MIMES_ARQUIVO.has(arquivo.type)) {
    throw new ErroHttp(415, 'Formato não aceito. Envie PDF, JPG, PNG ou WEBP.')
  }

  const inteiro = (v: FormDataEntryValue | null, padrao: number) => {
    const n = Number(v ?? padrao)
    return Number.isSafeInteger(n) && n >= 0 ? n : -1
  }
  const deslocamento = inteiro(form.get('deslocamento'), 0)
  const tamanhoTotal = inteiro(form.get('tamanho_total'), arquivo.size)
  if (deslocamento < 0 || tamanhoTotal < 0) {
    throw new ErroHttp(400, 'As partes do arquivo vieram malformadas.')
  }
  if (tamanhoTotal > LIMITE_ARQUIVO) {
    throw new ErroHttp(413, `Arquivo grande demais (máximo ${LIMITE_TEXTO}).`)
  }
  // Uma parte maior que a fatia combinada nunca chegaria aqui — a borda derruba
  // antes dos 4,5 MB. A checagem existe para o cliente que não é a nossa tela.
  if (arquivo.size > FATIA) {
    throw new ErroHttp(413, 'Cada parte do envio precisa ser menor.')
  }
  if (deslocamento + arquivo.size > tamanhoTotal) {
    throw new ErroHttp(400, 'Esta parte não cabe no arquivo declarado.')
  }

  // Ver o comentário do GET: o arquivo viaja como base64 e o Postgres decodifica.
  const bytes = Buffer.from(await arquivo.arrayBuffer()).toString('base64')
  const id = String(form.get('id') ?? '') || randomUUID()

  // ------------------------------------------------------------ continuação
  //
  // Da segunda parte em diante não há ficha para validar nem snapshot para
  // remontar: só a permissão (a rota é alcançável por URL, e o dono do documento
  // é o que decide quem pode escrever nele) e o append.
  if (deslocamento > 0) {
    const anterior = (
      await sql`select escopo, traveler_id from documents where id = ${id} and trip_id = ${tripId}`
    )[0] as { escopo: string; traveler_id: string | null } | undefined
    if (!anterior) throw new ErroHttp(404, 'O envio deste arquivo não foi iniciado.')
    if (!papelAlcanca(acesso.papel, 'editor')) {
      const meu = anterior.escopo === 'pessoal' && anterior.traveler_id === acesso.participanteId
      if (!meu) {
        throw new ErroHttp(
          403,
          'Você entrou como viajante: pode guardar os seus documentos pessoais, não os do grupo.',
        )
      }
    }

    const escrita = await sql`
      update document_files set bytes = bytes || decode(${bytes}, 'base64')
      where document_id = ${id} and octet_length(bytes) = ${deslocamento}
      returning octet_length(bytes) as tamanho
    `
    if (!escrita[0]) {
      throw new ErroHttp(409, 'As partes do arquivo chegaram fora de ordem. Envie de novo.')
    }
    const tamanho = Number((escrita[0] as { tamanho: number }).tamanho)
    if (tamanho < tamanhoTotal) return { documento_id: id, recebido: tamanho }

    // Última parte: agora o arquivo está inteiro e vale registrar e devolver o
    // envelope completo, igual ao envio de uma parte só.
    await registrarAlteracao(
      tripId,
      acesso.participanteId,
      'documento',
      id,
      'arquivo',
      null,
      arquivo.name,
    )
    return { documento_id: id, snapshot: await envelope(acesso, tripId) }
  }

  // Os metadados vêm no mesmo formato da entidade `documento` do /api/mutate e são
  // validados pelo MESMO schema: dois caminhos de escrita, um contrato só.
  const bruto = form.get('campos')
  let campos: Record<string, unknown> = {}
  if (typeof bruto === 'string' && bruto) {
    try {
      campos = JSON.parse(bruto) as Record<string, unknown>
    } catch {
      throw new ErroHttp(400, 'Os dados do documento vieram malformados.')
    }
  }
  const validado = validarCampos('documento', {
    ...campos,
    tipo: 'arquivo',
    arquivo_nome: arquivo.name,
    arquivo_mime: arquivo.type,
    // O tamanho do ARQUIVO INTEIRO, nao o desta parte: e ele que o GET compara
    // com o que ja chegou para saber se o envio terminou.
    arquivo_bytes: tamanhoTotal,
  })
  if (!validado.sucesso) throw new ErroHttp(400, validado.erro)
  const d = validado.dados as Record<string, unknown>

  // A constraint do banco diz o mesmo, mas em 409 sem texto útil. Aqui a pessoa
  // lê o que faltou.
  if (d.escopo === 'pessoal' && !d.traveler_id) {
    throw new ErroHttp(400, 'Um documento pessoal precisa de um dono.')
  }

  // O par desta rota com `autorizar` em /api/mutate: um `visualizador` sobe e
  // substitui o PRÓPRIO documento pessoal, e nada além disso. As duas checagens
  // precisam concordar — este endpoint é alcançável por URL, e sem ela o mesmo
  // viajante que leva 403 ao editar a ficha passaria pelo upload.
  //
  // O id existente é conferido no BANCO, não no que veio no formulário: o
  // `on conflict (id) do update` abaixo sobrescreve a linha inteira, então mandar
  // o id do passaporte alheio junto com `escopo: pessoal, traveler_id: eu`
  // trocaria o arquivo de outra pessoa pelo meu.
  if (!papelAlcanca(acesso.papel, 'editor')) {
    const anterior = (
      await sql`select escopo, traveler_id from documents where id = ${id} and trip_id = ${tripId}`
    )[0] as { escopo: string; traveler_id: string | null } | undefined
    const meu =
      d.escopo === 'pessoal' &&
      d.traveler_id === acesso.participanteId &&
      (!anterior ||
        (anterior.escopo === 'pessoal' && anterior.traveler_id === acesso.participanteId))
    if (!meu) {
      throw new ErroHttp(
        403,
        'Você entrou como viajante: pode guardar os seus documentos pessoais, não os do grupo.',
      )
    }
  }

  // Ficha e arquivo numa transação só: um documento cuja linha existe sem os
  // bytes aparece no cofre como um cartão que não abre.
  await sql.transaction([
    sql`
      insert into documents (id, trip_id, titulo, tipo, categoria, arquivo_nome, arquivo_mime,
                             arquivo_bytes, obs, ordem, escopo, traveler_id, assigned_to, tags,
                             importante, offline, validade, pais, cidade, dia,
                             itinerary_event_id, flight_id, reservation_id, criado_por)
      values (${id}, ${tripId}, ${d.titulo}, 'arquivo', ${d.categoria ?? null},
              ${arquivo.name}, ${arquivo.type}, ${tamanhoTotal}, ${d.obs ?? null},
              ${d.ordem ?? 0}, ${d.escopo ?? 'global'}, ${d.traveler_id ?? null},
              ${d.assigned_to ?? []}, ${d.tags ?? []}, ${d.importante ?? false},
              ${d.offline ?? false}, ${d.validade ?? null}, ${d.pais ?? null},
              ${d.cidade ?? null}, ${d.dia ?? null}, ${d.itinerary_event_id ?? null},
              ${d.flight_id ?? null}, ${d.reservation_id ?? null}, ${acesso.participanteId})
      on conflict (id) do update set
        titulo = excluded.titulo, categoria = excluded.categoria,
        arquivo_nome = excluded.arquivo_nome, arquivo_mime = excluded.arquivo_mime,
        arquivo_bytes = excluded.arquivo_bytes, obs = excluded.obs,
        escopo = excluded.escopo, traveler_id = excluded.traveler_id,
        assigned_to = excluded.assigned_to, tags = excluded.tags,
        importante = excluded.importante, offline = excluded.offline,
        validade = excluded.validade, pais = excluded.pais, cidade = excluded.cidade,
        dia = excluded.dia, itinerary_event_id = excluded.itinerary_event_id,
        flight_id = excluded.flight_id, reservation_id = excluded.reservation_id,
        updated_at = now()
    `,
    sql`
      insert into document_files (document_id, bytes, mime)
      values (${id}, decode(${bytes}, 'base64'), ${arquivo.type})
      on conflict (document_id) do update set
        bytes = excluded.bytes, mime = excluded.mime, criado_em = now()
    `,
  ])

  // Arquivo que ainda tem partes por vir: nada de registrar nem de montar o
  // snapshot ainda. O documento existe, mas incompleto — e o GET sabe disso pelo
  // `arquivo_bytes` acima, então ninguém abre meio PDF nesse intervalo.
  if (arquivo.size < tamanhoTotal) return { documento_id: id, recebido: arquivo.size }

  await registrarAlteracao(
    tripId,
    acesso.participanteId,
    'documento',
    id,
    'arquivo',
    null,
    arquivo.name,
  )

  return { documento_id: id, snapshot: await envelope(acesso, tripId) }
})
