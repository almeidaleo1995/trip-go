// POST /api/mutate - aplica a fila de escritas do cliente.
//
// Duas responsabilidades que não podem ser separadas: decidir QUEM pode escrever
// o quê, e resolver conflito por last-write-wins. Ambas no servidor, porque o
// cliente offline não é fonte confiável de nenhuma das duas.
import { randomUUID } from 'node:crypto'
import { sql, viagemAtiva, getSnapshot, registrarAlteracao } from '@/lib/db.ts'
import { requireSession, hashPin, ErroHttp, type Sessao } from '@/lib/session.ts'
import { MutationBatchSchema, validarCampos, formatarErroZod, type Entidade } from '@/lib/schema.ts'
import { rota, lerJson } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Entidade -> tabela e como ela se liga à viagem. */
const TABELA: Record<string, { nome: string; via: 'trip' | 'flight' | 'cruise' | 'checklist' }> = {
  viagem: { nome: 'trips', via: 'trip' },
  viajante: { nome: 'travelers', via: 'trip' },
  roteiro: { nome: 'itinerary_events', via: 'trip' },
  voo: { nome: 'flights', via: 'trip' },
  escala: { nome: 'flight_stops', via: 'flight' },
  cruzeiro: { nome: 'cruises', via: 'trip' },
  porto: { nome: 'cruise_ports', via: 'cruise' },
  hospedagem: { nome: 'stays', via: 'trip' },
  lugar: { nome: 'places', via: 'trip' },
  checklist_item: { nome: 'checklist_items', via: 'trip' },
  checklist_state: { nome: 'checklist_state', via: 'checklist' },
  documento: { nome: 'documents', via: 'trip' },
  emergencia: { nome: 'emergency_contacts', via: 'trip' },
  categoria: { nome: 'expense_categories', via: 'trip' },
  custo: { nome: 'expenses', via: 'trip' },
}

export const POST = rota(async (req) => {
  const sessao = await requireSession()
  const viagem = await viagemAtiva()
  if (!viagem) throw new ErroHttp(404, 'Nenhuma viagem cadastrada ainda.')

  const corpo = await lerJson(req)
  const parsed = MutationBatchSchema.safeParse(corpo)
  if (!parsed.success) throw new ErroHttp(400, formatarErroZod(parsed.error))

  const aplicadas: string[] = []
  const rejeitadas: { id?: string; motivo: string }[] = []

  for (const op of parsed.data.ops) {
    try {
      await autorizar(sessao, op.entidade, op.op, op.campos)
      const mudou = await aplicar(viagem.id, sessao, op)
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
    snapshot: await getSnapshot(viagem.id, sessao.papel),
  }
})

/**
 * Quem pode escrever o quê.
 *
 * Viajante comum só marca o próprio checklist. Qualquer outra escrita — inclusive
 * marcar o checklist de outra pessoa — é 403. Esta função é a barreira real; a
 * interface esconder o botão é só conveniência.
 */
async function autorizar(
  sessao: Sessao,
  entidade: Entidade,
  op: string,
  campos: Record<string, unknown>,
) {
  if (sessao.papel === 'admin') {
    // O último admin não pode sumir, senão a viagem fica sem dono e sem Financeiro.
    if (entidade === 'viajante' && (op === 'remover' || campos.papel === 'viajante')) {
      const r = await sql`select count(*)::int as n from travelers where papel = 'admin'`
      if ((r[0] as { n: number }).n <= 1) {
        throw new ErroHttp(409, 'Esta é a única pessoa com acesso de dono. Promova outra antes.')
      }
    }
    return
  }

  if (entidade !== 'checklist_state') {
    throw new ErroHttp(403, 'Somente o dono da viagem pode alterar isso.')
  }
  if (campos.traveler_id && campos.traveler_id !== sessao.travelerId) {
    throw new ErroHttp(403, 'Você só pode marcar o seu próprio checklist.')
  }
}

/** Aplica uma operação. Devolve false quando o LWW descarta a escrita. */
async function aplicar(
  tripId: string,
  sessao: Sessao,
  op: {
    op: string
    entidade: Entidade
    id?: string | null
    campos: Record<string, unknown>
    client_ts: string
  },
): Promise<boolean> {
  // checklist_state tem chave composta e nenhum id próprio: caminho separado.
  if (op.entidade === 'checklist_state') {
    const itemId = String(op.campos.item_id ?? '')
    if (!itemId) throw new Error('item_id obrigatório')
    await sql`
      insert into checklist_state (traveler_id, item_id, feito, updated_at)
      values (${sessao.travelerId}, ${itemId}, ${Boolean(op.campos.feito)}, now())
      on conflict (traveler_id, item_id)
      do update set feito = excluded.feito, updated_at = now()
      where checklist_state.updated_at < ${op.client_ts}::timestamptz
    `
    return true
  }

  const meta = TABELA[op.entidade]
  if (!meta) throw new Error(`entidade desconhecida: ${op.entidade}`)

  const v = validarCampos(op.entidade, op.campos)
  if (!v.sucesso) throw new Error(v.erro)
  const campos: Record<string, unknown> = { ...(v.dados as Record<string, unknown>) }

  // PIN nunca é gravado em texto puro, em nenhum caminho.
  if ('pin' in campos) {
    const pin = campos.pin
    delete campos.pin
    if (pin) campos.pin_hash = await hashPin(String(pin))
  }
  // O nome da categoria vem do formulário; a coluna guarda o id.
  delete campos.escalas
  delete campos.portos

  if (op.op === 'remover') {
    if (!op.id) throw new Error('id obrigatório para remover')
    await sql.query(`delete from ${meta.nome} where id = $1`, [op.id])
    await registrarAlteracao(
      tripId,
      sessao.travelerId,
      op.entidade,
      op.id,
      '(registro)',
      'existia',
      'removido',
    )
    return true
  }

  if (op.op === 'criar') {
    const id = op.id ?? randomUUID()
    const cols = Object.keys(campos)
    const vinculo = meta.via === 'trip' && op.entidade !== 'viagem' ? ['trip_id'] : []
    const valores = [id, ...(vinculo.length ? [tripId] : []), ...cols.map((c) => campos[c])]
    const nomes = ['id', ...vinculo, ...cols]
    const marcadores = nomes.map((_, i) => `$${i + 1}`)
    await sql.query(
      `insert into ${meta.nome} (${nomes.join(', ')}) values (${marcadores.join(', ')})`,
      valores,
    )
    await registrarAlteracao(
      tripId,
      sessao.travelerId,
      op.entidade,
      id,
      '(registro)',
      null,
      'criado',
    )
    return true
  }

  // editar
  if (!op.id) throw new Error('id obrigatório para editar')
  const cols = Object.keys(campos)
  if (cols.length === 0) return true

  const anterior = (await sql.query(`select * from ${meta.nome} where id = $1`, [op.id]))[0] as
    Record<string, unknown> | undefined
  if (!anterior) throw new Error('registro não encontrado')

  // Last-write-wins: a escrita só passa se o servidor não tiver versão mais nova.
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ')
  const r = await sql.query(
    `update ${meta.nome} set ${sets}, updated_at = now()
     where id = $1 and updated_at < $${cols.length + 2}::timestamptz
     returning id`,
    [op.id, ...cols.map((c) => campos[c]), op.client_ts],
  )
  if (r.length === 0) return false

  for (const c of cols) {
    if (c === 'pin_hash') continue // não registra hash no histórico
    if (String(anterior[c] ?? '') !== String(campos[c] ?? '')) {
      await registrarAlteracao(
        tripId,
        sessao.travelerId,
        op.entidade,
        op.id,
        c,
        anterior[c],
        campos[c],
      )
    }
  }
  return true
}
