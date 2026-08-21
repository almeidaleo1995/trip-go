// POST /api/import - carrega uma viagem inteira a partir do JSON padrão.
//
// Duas travas: só admin (ou banco vazio, para o primeiro cadastro), e gravação
// numa transação única. Falha no meio não pode deixar meia viagem no banco.
import { randomUUID } from 'node:crypto'
import { sql, viagemAtiva } from '@/lib/db.ts'
import { hashPin, lerSessao, ErroHttp } from '@/lib/session.ts'
import { validarImportacao, resumirImportacao, type TripImport } from '@/lib/schema.ts'
import { rota, lerJson } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = rota(async (req) => {
  const existente = await viagemAtiva()

  // Banco vazio é o único caso sem dono: alguém precisa poder criar a primeira
  // viagem. Havendo viagem, só o admin dela importa.
  if (existente) {
    const sessao = await lerSessao()
    if (!sessao) throw new ErroHttp(401, 'Entre para continuar.')
    if (sessao.papel !== 'admin') {
      throw new ErroHttp(403, 'Somente o dono da viagem pode importar dados.')
    }
  }

  const bruto = (await lerJson(req)) as Record<string, unknown>
  const dryRun = bruto?.dry_run === true
  const payload = (bruto?.arquivo ?? bruto) as unknown

  const r = validarImportacao(payload)
  if (!r.sucesso) throw new ErroHttp(400, r.erro)

  const dados = r.dados
  const resumo = resumirImportacao(dados)

  // Pré-visualização: mostra o que vai entrar sem tocar no banco (DATA-02).
  if (dryRun) return { dryRun: true, resumo, viagem: dados.viagem.nome }

  await gravar(dados, existente?.id ?? null)
  return { ok: true, resumo, viagem: dados.viagem.nome }
})

async function gravar(d: TripImport, substituirId: string | null) {
  const tripId = randomUUID()

  // Todos os hashes ficam prontos antes da transação: a transação HTTP do Neon é
  // não-interativa, então nada pode ser calculado no meio dela.
  const viajantes = await Promise.all(
    d.viajantes.map(async (v) => ({
      ...v,
      id: randomUUID(),
      pin_hash: v.pin ? await hashPin(v.pin) : null,
    })),
  )

  const q: ReturnType<typeof sql>[] = []

  // Desativa a viagem anterior em vez de apagar: o histórico dela continua existindo.
  if (substituirId) q.push(sql`update trips set ativo = false where id = ${substituirId}`)

  q.push(sql`
    insert into trips (id, nome, subtitulo, data_partida, data_retorno, moeda, cor_destaque, ativo)
    values (${tripId}, ${d.viagem.nome}, ${d.viagem.subtitulo ?? null}, ${d.viagem.data_partida},
            ${d.viagem.data_retorno}, ${d.viagem.moeda}, ${d.viagem.cor_destaque}, true)
  `)

  for (const v of viajantes) {
    q.push(sql`
      insert into travelers (id, trip_id, nome, papel, pin_hash, telefone, passaporte, ordem)
      values (${v.id}, ${tripId}, ${v.nome}, ${v.papel}, ${v.pin_hash},
              ${v.telefone ?? null}, ${v.passaporte ?? null}, ${v.ordem})
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
                           localizador, nota, ordem)
      values (${vooId}, ${tripId}, ${v.companhia}, ${v.numero ?? null}, ${v.origem_iata ?? null},
              ${v.origem_cidade ?? null}, ${v.destino_iata ?? null}, ${v.destino_cidade ?? null},
              ${v.parte_em ?? null}, ${v.chega_em ?? null}, ${v.duracao_min ?? null},
              ${v.localizador ?? null}, ${v.nota ?? null}, ${v.ordem})
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

  for (const h of d.hospedagens) {
    q.push(sql`
      insert into stays (id, trip_id, nome, cidade, checkin, checkout, endereco, link, telefone, nota)
      values (${randomUUID()}, ${tripId}, ${h.nome}, ${h.cidade ?? null}, ${h.checkin ?? null},
              ${h.checkout ?? null}, ${h.endereco ?? null}, ${h.link ?? null},
              ${h.telefone ?? null}, ${h.nota ?? null})
    `)
  }

  for (const l of d.lugares) {
    q.push(sql`
      insert into places (id, trip_id, cidade, pais, dias, notas, lat, lon, ordem)
      values (${randomUUID()}, ${tripId}, ${l.cidade}, ${l.pais ?? null}, ${l.dias ?? null},
              ${l.notas ?? null}, ${l.lat ?? null}, ${l.lon ?? null}, ${l.ordem})
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
      insert into documents (id, trip_id, titulo, valor, tipo, obs, ordem)
      values (${randomUUID()}, ${tripId}, ${doc.titulo}, ${doc.valor ?? null}, ${doc.tipo},
              ${doc.obs ?? null}, ${doc.ordem})
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
      insert into expenses (id, trip_id, categoria_id, descricao, valor_centavos, pessoas, pago, estimado, nota, ordem)
      values (${randomUUID()}, ${tripId}, ${c.categoria ? (idPorCategoria.get(c.categoria) ?? null) : null},
              ${c.descricao}, ${c.valor_centavos}, ${c.pessoas}, ${c.pago}, ${c.estimado},
              ${c.nota ?? null}, ${c.ordem})
    `)
  }

  await sql.transaction(q)
}
