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
import { papelAlcanca } from '@/config/navigation.ts'
import { rota } from '@/lib/api.ts'
import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 4 MB. O teto real não é o Postgres, é o corpo de requisição da função
 * serverless (4,5 MB na Vercel) — passar disso falha na borda, antes de chegar
 * aqui, e a pessoa veria um erro sem texto em vez da mensagem abaixo.
 *
 * ponytail: teto de 4 MB por arquivo. Passaporte fotografado e voucher de hotel
 * cabem folgado. Se um dia precisar de arquivo maior, o caminho é upload direto
 * para um bucket com URL assinada, não aumentar este número.
 */
const LIMITE = 4 * 1024 * 1024

const MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

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
  // ~33% a mais de texto entre banco e servidor, que num PDF de 2 MB não aparece.
  const r = await sql`
    select encode(bytes, 'base64') as b64, mime from document_files where document_id = ${id}
  `
  const arquivo = r[0] as { b64: string; mime: string } | undefined
  if (!arquivo) throw new ErroHttp(404, 'Este documento não tem arquivo anexado.')

  const nome = encodeURIComponent(doc.arquivo_nome ?? doc.titulo)
  return new NextResponse(new Uint8Array(Buffer.from(arquivo.b64, 'base64')), {
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

// POST /api/documento — cria (ou substitui o arquivo de) um documento.
//
// FormData em vez de JSON: base64 num corpo JSON inflaria o upload em um terço e
// ainda exigiria decodificar na mão. `req.formData()` é nativo.
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
  if (arquivo.size > LIMITE) {
    throw new ErroHttp(413, `Arquivo grande demais (máximo ${LIMITE / 1024 / 1024} MB).`)
  }
  if (!MIMES.has(arquivo.type)) {
    throw new ErroHttp(415, 'Formato não aceito. Envie PDF, JPG, PNG ou WEBP.')
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
    arquivo_bytes: arquivo.size,
  })
  if (!validado.sucesso) throw new ErroHttp(400, validado.erro)
  const d = validado.dados as Record<string, unknown>

  // A constraint do banco diz o mesmo, mas em 409 sem texto útil. Aqui a pessoa
  // lê o que faltou.
  if (d.escopo === 'pessoal' && !d.traveler_id) {
    throw new ErroHttp(400, 'Um documento pessoal precisa de um dono.')
  }

  const id = String(form.get('id') ?? '') || randomUUID()

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
  // Ver o comentário do GET: o arquivo viaja como base64 e o Postgres decodifica.
  const bytes = Buffer.from(await arquivo.arrayBuffer()).toString('base64')

  // Ficha e arquivo numa transação só: um documento cuja linha existe sem os
  // bytes aparece no cofre como um cartão que não abre.
  await sql.transaction([
    sql`
      insert into documents (id, trip_id, titulo, tipo, categoria, arquivo_nome, arquivo_mime,
                             arquivo_bytes, obs, ordem, escopo, traveler_id, assigned_to, tags,
                             importante, offline, validade, pais, cidade, dia,
                             itinerary_event_id, flight_id, reservation_id, criado_por)
      values (${id}, ${tripId}, ${d.titulo}, 'arquivo', ${d.categoria ?? null},
              ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${d.obs ?? null},
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

  await registrarAlteracao(
    tripId,
    acesso.participanteId,
    'documento',
    id,
    'arquivo',
    null,
    arquivo.name,
  )

  // Mesmo envelope de /api/snapshot e /api/mutate. Sem `eu`, o cliente perde o
  // papel depois do upload e a próxima pintura quebra.
  return {
    documento_id: id,
    snapshot: {
      ...(await getSnapshot(tripId, acesso.papel, acesso.participanteId)),
      eu: {
        userId: acesso.userId,
        usuario: await usuarioPorId(acesso.userId),
        participanteId: acesso.participanteId,
        papel: acesso.papel,
      },
    },
  }
})
