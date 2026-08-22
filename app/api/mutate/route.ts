// POST /api/mutate - aplica a fila de escritas do cliente.
//
// Três responsabilidades que não podem ser separadas: decidir QUEM pode escrever
// o quê, garantir que a escrita cai na viagem certa, e resolver conflito por
// last-write-wins. As três no servidor, porque o cliente offline não é fonte
// confiável de nenhuma delas.
import { randomUUID } from 'node:crypto'
import { sql, getSnapshot, registrarAlteracao, avisarParticipantes, usuarioPorId } from '@/lib/db.ts'
import { exigirUsuario, exigirViagem, type Acesso } from '@/lib/auth.ts'
import { ErroHttp } from '@/lib/session.ts'
import { MutationBatchSchema, validarCampos, formatarErroZod, type Entidade } from '@/lib/schema.ts'
import { papelAlcanca, type Papel } from '@/config/navigation.ts'
import { rota, lerJson } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Entidade -> tabela, como ela se liga à viagem, e o papel mínimo para escrevê-la.
 *
 * `via` é o que impede uma conta de editar registro de outra viagem passando um
 * id adivinhado: toda operação é recortada pelo trip_id da sessão, nunca só pelo id.
 */
const TABELA: Record<
  Entidade,
  { nome: string; via: 'trip' | 'flight' | 'cruise' | 'self'; minimo: Papel }
> = {
  viagem: { nome: 'trips', via: 'self', minimo: 'editor' },
  participante: { nome: 'travelers', via: 'trip', minimo: 'proprietario' },
  roteiro: { nome: 'itinerary_events', via: 'trip', minimo: 'editor' },
  voo: { nome: 'flights', via: 'trip', minimo: 'editor' },
  escala: { nome: 'flight_stops', via: 'flight', minimo: 'editor' },
  cruzeiro: { nome: 'cruises', via: 'trip', minimo: 'editor' },
  porto: { nome: 'cruise_ports', via: 'cruise', minimo: 'editor' },
  reserva: { nome: 'reservations', via: 'trip', minimo: 'editor' },
  lugar: { nome: 'places', via: 'trip', minimo: 'editor' },
  checklist_item: { nome: 'checklist_items', via: 'trip', minimo: 'editor' },
  // A única entidade que visualizador escreve — e só a própria linha.
  checklist_state: { nome: 'checklist_state', via: 'trip', minimo: 'visualizador' },
  documento: { nome: 'documents', via: 'trip', minimo: 'editor' },
  emergencia: { nome: 'emergency_contacts', via: 'trip', minimo: 'editor' },
  categoria: { nome: 'expense_categories', via: 'trip', minimo: 'editor' },
  custo: { nome: 'expenses', via: 'trip', minimo: 'editor' },
}

export const POST = rota(async (req) => {
  const u = await exigirUsuario()

  const corpo = await lerJson(req)
  const parsed = MutationBatchSchema.safeParse(corpo)
  if (!parsed.success) throw new ErroHttp(400, formatarErroZod(parsed.error))

  const acesso = await exigirViagem(u.id, parsed.data.trip_id)

  const aplicadas: string[] = []
  const rejeitadas: { id?: string; motivo: string }[] = []

  for (const op of parsed.data.ops) {
    try {
      await autorizar(acesso, op.entidade, op.op, op.campos)
      const mudou = await aplicar(acesso, op)
      if (mudou) aplicadas.push(op.id ?? 'novo')
      else rejeitadas.push({ id: op.id ?? undefined, motivo: 'versão do servidor é mais nova' })
    } catch (e) {
      // Recusa deliberada (403 de autorização, 409 de integridade) aborta o lote:
      // engolir isso numa lista faria o cliente ver 200 e achar que passou.
      // Só erro de dado de UMA operação vira item de `rejeitadas`.
      if (e instanceof ErroHttp) throw e
      rejeitadas.push({ id: op.id ?? undefined, motivo: e instanceof Error ? e.message : 'erro' })
    }
  }

  return {
    aplicadas: aplicadas.length,
    rejeitadas,
    // Mesmo envelope de /api/snapshot: sem `eu`, o cliente perde o papel e o
    // participanteId depois de QUALQUER escrita, não só na carga inicial.
    snapshot: {
      ...(await getSnapshot(acesso.tripId, acesso.papel)),
      eu: {
        userId: acesso.userId,
        usuario: await usuarioPorId(acesso.userId),
        participanteId: acesso.participanteId,
        papel: acesso.papel,
      },
    },
  }
})

/**
 * Quem pode escrever o quê.
 *
 * Visualizador só marca o próprio checklist. Qualquer outra escrita — inclusive
 * marcar o checklist de outra pessoa — é 403. Esta função é a barreira real; a
 * interface esconder o botão é só conveniência.
 */
async function autorizar(
  acesso: Acesso,
  entidade: Entidade,
  op: string,
  campos: Record<string, unknown>,
) {
  const meta = TABELA[entidade]
  if (!meta) throw new ErroHttp(400, `Entidade desconhecida: ${entidade}`)

  if (!papelAlcanca(acesso.papel, meta.minimo)) {
    throw new ErroHttp(
      403,
      meta.minimo === 'proprietario'
        ? 'Só quem criou a viagem pode gerenciar participantes.'
        : 'Você entrou como visualizador e não pode alterar esta viagem.',
    )
  }

  if (entidade === 'checklist_state' && campos.traveler_id) {
    if (campos.traveler_id !== acesso.participanteId) {
      throw new ErroHttp(403, 'Você só pode marcar o seu próprio checklist.')
    }
  }

  // O último proprietário não pode sumir, senão a viagem fica sem quem a gerencie.
  if (
    entidade === 'participante' &&
    (op === 'remover' || (campos.papel && campos.papel !== 'proprietario'))
  ) {
    const r = await sql`
      select count(*)::int as n from travelers
      where trip_id = ${acesso.tripId} and papel = 'proprietario'
    `
    if ((r[0] as { n: number }).n <= 1) {
      throw new ErroHttp(409, 'Esta é a única pessoa com acesso de dono. Promova outra antes.')
    }
  }
}

/**
 * Recorte de segurança por entidade: a cláusula que garante que o registro
 * pertence à viagem da sessão. Devolve o SQL e os parâmetros extras.
 */
function recorte(entidade: Entidade, tripId: string, posicao: number) {
  const meta = TABELA[entidade]
  if (meta.via === 'flight') {
    return {
      sql: `and flight_id in (select id from flights where trip_id = $${posicao})`,
      params: [tripId],
    }
  }
  if (meta.via === 'cruise') {
    return {
      sql: `and cruise_id in (select id from cruises where trip_id = $${posicao})`,
      params: [tripId],
    }
  }
  if (meta.via === 'self') return { sql: '', params: [] as string[] }
  return { sql: `and trip_id = $${posicao}`, params: [tripId] }
}

/** Confere que o pai informado (voo, cruzeiro) é desta viagem antes de criar o filho. */
async function conferirPai(entidade: Entidade, tripId: string, campos: Record<string, unknown>) {
  if (entidade === 'escala') {
    const id = String(campos.flight_id ?? '')
    const r = await sql`select 1 from flights where id = ${id} and trip_id = ${tripId}`
    if (r.length === 0) throw new Error('voo não encontrado nesta viagem')
  }
  if (entidade === 'porto') {
    const id = String(campos.cruise_id ?? '')
    const r = await sql`select 1 from cruises where id = ${id} and trip_id = ${tripId}`
    if (r.length === 0) throw new Error('cruzeiro não encontrado nesta viagem')
  }
}

/** Aplica uma operação. Devolve false quando o LWW descarta a escrita. */
async function aplicar(
  acesso: Acesso,
  op: {
    op: string
    entidade: Entidade
    id?: string | null
    campos: Record<string, unknown>
    client_ts: string
  },
): Promise<boolean> {
  const tripId = acesso.tripId

  // checklist_state tem chave composta e nenhum id próprio: caminho separado.
  if (op.entidade === 'checklist_state') {
    const itemId = String(op.campos.item_id ?? '')
    if (!itemId) throw new Error('item_id obrigatório')
    // O join com checklist_items é o recorte: só marca item desta viagem.
    const r = await sql`select 1 from checklist_items where id = ${itemId} and trip_id = ${tripId}`
    if (r.length === 0) throw new Error('item não encontrado nesta viagem')

    await sql`
      insert into checklist_state (traveler_id, item_id, feito, updated_at)
      values (${acesso.participanteId}, ${itemId}, ${Boolean(op.campos.feito)}, now())
      on conflict (traveler_id, item_id)
      do update set feito = excluded.feito, updated_at = now()
      where checklist_state.updated_at < ${op.client_ts}::timestamptz
    `
    return true
  }

  const meta = TABELA[op.entidade]
  const v = validarCampos(op.entidade, op.campos)
  if (!v.sucesso) throw new Error(v.erro)
  const campos: Record<string, unknown> = { ...(v.dados as Record<string, unknown>) }

  // Campos aninhados vêm no mesmo objeto por conveniência do formulário; cada um
  // é gravado pela sua própria entidade.
  delete campos.escalas
  delete campos.portos

  // `email` no participante liga o registro a uma conta existente. Sem conta com
  // esse e-mail, o participante fica como nome na lista — que é o comportamento
  // correto para quem viaja junto mas não usa o app.
  if (op.entidade === 'participante' && 'email' in campos) {
    const email = campos.email ? String(campos.email).trim().toLowerCase() : null
    campos.email = email
    const achado = email ? await sql`select id from users where email = ${email}` : []
    campos.user_id = (achado[0] as { id: string } | undefined)?.id ?? null
  }

  // ---------------------------------------------------------------- remover
  if (op.op === 'remover') {
    if (!op.id) throw new Error('id obrigatório para remover')
    if (op.entidade === 'viagem') throw new ErroHttp(400, 'Use a tela de viagens para excluir.')

    // Registra ANTES de apagar: se a entidade removida for o próprio participante
    // que assina o histórico (saiu da viagem, ou o dono se removeu depois de
    // promover outro), logar depois do delete violaria a FK — a linha de quem
    // registrou já não existiria mais.
    await registrarAlteracao(
      tripId,
      acesso.participanteId,
      op.entidade,
      op.id,
      '(registro)',
      'existia',
      'removido',
    )
    const rec = recorte(op.entidade, tripId, 2)
    await sql.query(`delete from ${meta.nome} where id = $1 ${rec.sql}`, [op.id, ...rec.params])
    return true
  }

  // ---------------------------------------------------------------- criar
  if (op.op === 'criar') {
    if (op.entidade === 'viagem') throw new ErroHttp(400, 'Use /api/viagens para criar viagem.')
    await conferirPai(op.entidade, tripId, op.campos)

    // O pai de escala e porto vem dos campos; os demais penduram no trip_id.
    if (meta.via === 'flight') campos.flight_id = op.campos.flight_id
    if (meta.via === 'cruise') campos.cruise_id = op.campos.cruise_id

    const id = op.id ?? randomUUID()
    const cols = Object.keys(campos)
    const vinculo = meta.via === 'trip' ? ['trip_id'] : []
    const nomes = ['id', ...vinculo, ...cols]
    const valores = [id, ...(vinculo.length ? [tripId] : []), ...cols.map((c) => campos[c])]
    await sql.query(
      `insert into ${meta.nome} (${nomes.join(', ')})
       values (${nomes.map((_, i) => `$${i + 1}`).join(', ')})`,
      valores,
    )
    await registrarAlteracao(
      tripId,
      acesso.participanteId,
      op.entidade,
      id,
      '(registro)',
      null,
      'criado',
    )
    if (op.entidade === 'participante') {
      await avisarParticipantes(
        tripId,
        acesso.userId,
        'Novo participante',
        `${String(campos.nome ?? 'Alguém')} entrou na viagem.`,
        '/configuracoes',
      )
    }
    return true
  }

  // ---------------------------------------------------------------- editar
  const alvo = op.entidade === 'viagem' ? tripId : op.id
  if (!alvo) throw new Error('id obrigatório para editar')

  const cols = Object.keys(campos)
  if (cols.length === 0) return true

  const recAnterior = recorte(op.entidade, tripId, 2)
  const anterior = (
    await sql.query(`select * from ${meta.nome} where id = $1 ${recAnterior.sql}`, [
      alvo,
      ...recAnterior.params,
    ])
  )[0] as Record<string, unknown> | undefined
  if (!anterior) throw new Error('registro não encontrado')

  // Last-write-wins: a escrita só passa se o servidor não tiver versão mais nova.
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ')
  const posTs = cols.length + 2
  const rec = recorte(op.entidade, tripId, posTs + 1)
  const r = await sql.query(
    `update ${meta.nome} set ${sets}, updated_at = now()
     where id = $1 and updated_at < $${posTs}::timestamptz ${rec.sql}
     returning id`,
    [alvo, ...cols.map((c) => campos[c]), op.client_ts, ...rec.params],
  )
  if (r.length === 0) return false

  for (const c of cols) {
    if (String(anterior[c] ?? '') !== String(campos[c] ?? '')) {
      await registrarAlteracao(
        tripId,
        acesso.participanteId,
        op.entidade,
        alvo,
        c,
        anterior[c],
        campos[c],
      )
    }
  }
  return true
}
