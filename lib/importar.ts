// Grava uma viagem inteira a partir do formato de importacao.
//
// Um so importador para dois chamadores: a rota /api/import (backup do usuario) e
// o seed (dados de demonstracao). Duplicar isso significaria duas versoes do
// mesmo mapeamento envelhecendo em ritmos diferentes - e o seed seria o primeiro
// a sair do ar sem ninguem perceber.
//
// Tudo em UMA transacao: falha no meio nao pode deixar meia viagem no banco.
import { randomUUID } from 'node:crypto'
import { sql } from './db.ts'
import type { TripImport } from './schema.ts'

export type ResultadoImportacao = { tripId: string; participantes: Record<string, string> }

/**
 * Cria a viagem e devolve o id, mais o mapa nome -> id dos participantes (o seed
 * usa para marcar checklist e distribuir despesas).
 *
 * `ownerId` vira proprietario. Participantes cujo `email` bate com uma conta
 * existente sao vinculados a ela; os demais ficam como nome na lista.
 */
export async function importarViagem(
  d: TripImport,
  ownerId: string,
): Promise<ResultadoImportacao> {
  const tripId = randomUUID()

  // As contas sao resolvidas ANTES da transacao: a transacao HTTP do Neon e
  // nao-interativa, entao nada pode ser consultado no meio dela.
  const emails = d.participantes.map((p) => p.email?.trim().toLowerCase()).filter(Boolean)
  const contas =
    emails.length > 0
      ? ((await sql`select id, email from users where email = any(${emails})`) as {
          id: string
          email: string
        }[])
      : []
  const idPorEmail = new Map(contas.map((c) => [c.email, c.id]))

  const participantes = d.participantes.map((p) => {
    const email = p.email?.trim().toLowerCase() ?? null
    return { ...p, id: randomUUID(), email, user_id: email ? (idPorEmail.get(email) ?? null) : null }
  })

  // Quem importou precisa aparecer na lista, senao a viagem nao abre para ele.
  const jaEstou = participantes.some((p) => p.user_id === ownerId)
  const q: ReturnType<typeof sql>[] = []

  q.push(sql`
    insert into trips (id, owner_id, nome, subtitulo, descricao, data_partida, data_retorno,
                       moeda, cor_destaque, capa_url, arquivada)
    values (${tripId}, ${ownerId}, ${d.viagem.nome}, ${d.viagem.subtitulo ?? null},
            ${d.viagem.descricao ?? null}, ${d.viagem.data_partida}, ${d.viagem.data_retorno},
            ${d.viagem.moeda}, ${d.viagem.cor_destaque}, ${d.viagem.capa_url ?? null},
            ${d.viagem.arquivada})
  `)

  if (!jaEstou) {
    const eu = await sql`select nome, email from users where id = ${ownerId}`
    const dono = eu[0] as { nome: string; email: string } | undefined
    const id = randomUUID()
    participantes.unshift({
      id,
      nome: dono?.nome ?? 'Eu',
      email: dono?.email ?? null,
      user_id: ownerId,
      papel: 'proprietario',
      telefone: null,
      passaporte: null,
      documento: null,
      nascimento: null,
      ordem: -1,
    })
  }

  for (const p of participantes) {
    q.push(sql`
      insert into travelers (id, trip_id, user_id, nome, email, papel, telefone, passaporte, documento, nascimento, ordem)
      values (${p.id}, ${tripId}, ${p.user_id}, ${p.nome}, ${p.email}, ${p.papel},
              ${p.telefone ?? null}, ${p.passaporte ?? null}, ${p.documento ?? null}, ${p.nascimento ?? null}, ${p.ordem})
    `)
  }

  for (const e of d.roteiro) {
    q.push(sql`
      insert into itinerary_events (id, trip_id, ocorre_em, cidade, local, titulo, descricao, tipo, ancora, nota)
      values (${randomUUID()}, ${tripId}, ${e.ocorre_em}, ${e.cidade ?? null}, ${e.local ?? null},
              ${e.titulo}, ${e.descricao ?? null}, ${e.tipo}, ${e.ancora}, ${e.nota ?? null})
    `)
  }

  for (const v of d.voos) {
    const vooId = randomUUID()
    q.push(sql`
      insert into flights (id, trip_id, companhia, numero, origem_iata, origem_cidade,
                           destino_iata, destino_cidade, parte_em, chega_em, duracao_min,
                           localizador, terminal, portao, assento, bagagem, nota, ordem)
      values (${vooId}, ${tripId}, ${v.companhia}, ${v.numero ?? null}, ${v.origem_iata ?? null},
              ${v.origem_cidade ?? null}, ${v.destino_iata ?? null}, ${v.destino_cidade ?? null},
              ${v.parte_em ?? null}, ${v.chega_em ?? null}, ${v.duracao_min ?? null},
              ${v.localizador ?? null}, ${v.terminal ?? null}, ${v.portao ?? null},
              ${v.assento ?? null}, ${v.bagagem ?? null}, ${v.nota ?? null}, ${v.ordem})
    `)
    for (const es of v.escalas) {
      q.push(sql`
        insert into flight_stops (id, flight_id, iata, cidade, espera_min, ordem)
        values (${randomUUID()}, ${vooId}, ${es.iata ?? null}, ${es.cidade ?? null},
                ${es.espera_min ?? null}, ${es.ordem})
      `)
    }
  }

  for (const c of d.cruzeiros) {
    const cruzeiroId = randomUUID()
    q.push(sql`
      insert into cruises (id, trip_id, navio, companhia, embarque_em, desembarque_em,
                           porto_embarque, porto_desembarque, cabine, localizador, terminal, nota)
      values (${cruzeiroId}, ${tripId}, ${c.navio}, ${c.companhia ?? null}, ${c.embarque_em ?? null},
              ${c.desembarque_em ?? null}, ${c.porto_embarque ?? null}, ${c.porto_desembarque ?? null},
              ${c.cabine ?? null}, ${c.localizador ?? null}, ${c.terminal ?? null}, ${c.nota ?? null})
    `)
    for (const p of c.portos) {
      q.push(sql`
        insert into cruise_ports (id, cruise_id, porto, cidade, pais, chega_em, sai_em, dia_no_mar, ordem, nota)
        values (${randomUUID()}, ${cruzeiroId}, ${p.porto ?? null}, ${p.cidade ?? null}, ${p.pais ?? null},
                ${p.chega_em ?? null}, ${p.sai_em ?? null}, ${p.dia_no_mar}, ${p.ordem}, ${p.nota ?? null})
      `)
    }
  }

  for (const r of d.reservas) {
    q.push(sql`
      insert into reservations (id, trip_id, tipo, nome, cidade, inicio_em, fim_em, endereco,
                                link, telefone, localizador, valor_centavos, nota, ordem)
      values (${randomUUID()}, ${tripId}, ${r.tipo}, ${r.nome}, ${r.cidade ?? null},
              ${r.inicio_em ?? null}, ${r.fim_em ?? null}, ${r.endereco ?? null}, ${r.link ?? null},
              ${r.telefone ?? null}, ${r.localizador ?? null}, ${r.valor_centavos ?? null},
              ${r.nota ?? null}, ${r.ordem})
    `)
  }

  for (const l of d.lugares) {
    q.push(sql`
      insert into places (id, trip_id, cidade, pais, dias, status, chega_em, sai_em, notas, lat, lon, ordem)
      values (${randomUUID()}, ${tripId}, ${l.cidade}, ${l.pais ?? null}, ${l.dias ?? null},
              ${l.status}, ${l.chega_em ?? null}, ${l.sai_em ?? null}, ${l.notas ?? null},
              ${l.lat ?? null}, ${l.lon ?? null}, ${l.ordem})
    `)
  }

  for (const c of d.checklist) {
    q.push(sql`
      insert into checklist_items (id, trip_id, titulo, categoria, escopo, prazo_ideal,
                                   prazo_maximo, valor_estimado_centavos, detalhe, ordem)
      values (${randomUUID()}, ${tripId}, ${c.titulo}, ${c.categoria ?? null}, ${c.escopo},
              ${c.prazo_ideal ?? null}, ${c.prazo_maximo ?? null},
              ${c.valor_estimado_centavos ?? null}, ${c.detalhe ?? null}, ${c.ordem})
    `)
  }

  for (const doc of d.documentos) {
    q.push(sql`
      insert into documents (id, trip_id, titulo, valor, tipo, categoria, arquivo_url,
                             arquivo_mime, arquivo_bytes, obs, ordem)
      values (${randomUUID()}, ${tripId}, ${doc.titulo}, ${doc.valor ?? null}, ${doc.tipo},
              ${doc.categoria ?? null}, ${doc.arquivo_url ?? null}, ${doc.arquivo_mime ?? null},
              ${doc.arquivo_bytes ?? null}, ${doc.obs ?? null}, ${doc.ordem})
    `)
  }

  for (const e of d.emergencia) {
    q.push(sql`
      insert into emergency_contacts (id, trip_id, titulo, telefone, detalhe, ordem)
      values (${randomUUID()}, ${tripId}, ${e.titulo}, ${e.telefone ?? null}, ${e.detalhe ?? null}, ${e.ordem})
    `)
  }

  // Custos referenciam categoria por NOME no arquivo; aqui vira id.
  const idPorCategoria = new Map<string, string>()
  for (const c of d.categorias) {
    const id = randomUUID()
    idPorCategoria.set(c.nome, id)
    q.push(sql`
      insert into expense_categories (id, trip_id, nome, ordem)
      values (${id}, ${tripId}, ${c.nome}, ${c.ordem})
    `)
  }

  for (const c of d.custos) {
    q.push(sql`
      insert into expenses (id, trip_id, categoria_id, descricao, valor_centavos, moeda,
                            pessoas, ocorre_em, pago, estimado, nota, ordem)
      values (${randomUUID()}, ${tripId},
              ${c.categoria ? (idPorCategoria.get(c.categoria) ?? null) : null},
              ${c.descricao}, ${c.valor_centavos}, ${c.moeda ?? null}, ${c.pessoas},
              ${c.ocorre_em ?? null}, ${c.pago}, ${c.estimado}, ${c.nota ?? null}, ${c.ordem})
    `)
  }

  await sql.transaction(q)

  return {
    tripId,
    participantes: Object.fromEntries(participantes.map((p) => [p.nome, p.id])),
  }
}
