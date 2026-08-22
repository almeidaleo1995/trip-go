// POST /api/viagens/duplicar -> copia uma viagem inteira com novas datas opcionais.
//
// A cópia acontece toda no banco, sem trazer as linhas para o Node. O truque é
// `md5(id_antigo || id_novo)`: dá um id novo determinístico para cada registro,
// então os filhos (escalas, portos, custos) reencontram os pais copiados sem que
// o servidor precise manter um mapa de-para em memória.
//
// O que NÃO é copiado, de propósito:
//   checklist_state -> uma viagem nova começa com tudo por fazer
//   messages        -> conversa pertence à viagem original
//   change_log      -> histórico não se duplica
//   participantes   -> só quem duplicou entra; convidar de novo é decisão de quem copia
//
// `copiar` escolhe o resto. Ausente = copia tudo, que era o comportamento antes
// dos blocos existirem — a tela manda os blocos sempre, mas um script antigo
// continua funcionando.
import { sql } from '@/lib/db.ts'
import { exigirUsuario, exigirViagem } from '@/lib/auth.ts'
import { gravarViagemAtual, ErroHttp } from '@/lib/session.ts'
import { rota, lerJson } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = rota(async (req) => {
  const u = await exigirUsuario()
  const corpo = (await lerJson(req, 2048)) as {
    id?: string
    nome?: string
    dias?: number
    copiar?: Record<string, boolean>
  }
  if (!corpo.id) throw new ErroHttp(400, 'Informe a viagem.')
  await exigirViagem(u.id, corpo.id)

  const copiar = (bloco: string) => corpo.copiar?.[bloco] ?? true

  // Deslocamento em dias aplicado a todas as datas. 0 mantém o calendário.
  const dias = Number.isFinite(Number(corpo.dias)) ? Math.trunc(Number(corpo.dias)) : 0
  const deslocamento = `${dias} days`

  // Nome escolhido pela pessoa, ou "<original> (cópia)" resolvido pelo banco.
  const nome = corpo.nome?.trim() || null

  const criada = await sql`
    insert into trips (owner_id, nome, subtitulo, descricao, data_partida, data_retorno,
                       moeda, cor_destaque, capa_url)
    select ${u.id}, coalesce(${nome}, nome || ' (cópia)'), subtitulo, descricao,
           data_partida + ${deslocamento}::interval, data_retorno + ${deslocamento}::interval,
           moeda, cor_destaque, capa_url
    from trips where id = ${corpo.id}
    returning id
  `
  const novo = (criada[0] as { id: string } | undefined)?.id
  if (!novo) throw new ErroHttp(404, 'Viagem não encontrada.')

  await sql`
    insert into travelers (trip_id, user_id, nome, email, papel, ordem)
    values (${novo}, ${u.id}, ${u.nome}, ${u.email}, 'proprietario', 0)
  `

  const d = deslocamento

  if (copiar('roteiro')) {
    await sql`
    insert into itinerary_events (trip_id, ocorre_em, cidade, local, titulo, descricao, tipo, ancora, nota)
    select ${novo}, ocorre_em + ${d}::interval, cidade, local, titulo, descricao, tipo, ancora, nota
    from itinerary_events where trip_id = ${corpo.id}
  `
    await sql`
    insert into flights (id, trip_id, companhia, numero, origem_iata, origem_cidade, destino_iata,
                         destino_cidade, parte_em, chega_em, duracao_min, localizador, terminal,
                         portao, assento, bagagem, nota, ordem)
    select md5(id || ${novo}), ${novo}, companhia, numero, origem_iata, origem_cidade, destino_iata,
           destino_cidade, parte_em + ${d}::interval, chega_em + ${d}::interval, duracao_min,
           localizador, terminal, portao, assento, bagagem, nota, ordem
    from flights where trip_id = ${corpo.id}
  `
    await sql`
    insert into flight_stops (flight_id, iata, cidade, espera_min, ordem)
    select md5(s.flight_id || ${novo}), s.iata, s.cidade, s.espera_min, s.ordem
    from flight_stops s join flights f on f.id = s.flight_id where f.trip_id = ${corpo.id}
  `
    await sql`
    insert into cruises (id, trip_id, navio, companhia, embarque_em, desembarque_em, porto_embarque,
                         porto_desembarque, cabine, localizador, terminal, nota)
    select md5(id || ${novo}), ${novo}, navio, companhia, embarque_em + ${d}::interval,
           desembarque_em + ${d}::interval, porto_embarque, porto_desembarque, cabine,
           localizador, terminal, nota
    from cruises where trip_id = ${corpo.id}
  `
    await sql`
    insert into cruise_ports (cruise_id, porto, cidade, pais, chega_em, sai_em, dia_no_mar, ordem, nota)
    select md5(p.cruise_id || ${novo}), p.porto, p.cidade, p.pais, p.chega_em + ${d}::interval,
           p.sai_em + ${d}::interval, p.dia_no_mar, p.ordem, p.nota
    from cruise_ports p join cruises c on c.id = p.cruise_id where c.trip_id = ${corpo.id}
  `
    await sql`
    insert into places (trip_id, cidade, pais, dias, status, chega_em, sai_em, notas, lat, lon, ordem)
    select ${novo}, cidade, pais, dias, 'planejada', chega_em + ${d}::interval,
           sai_em + ${d}::interval, notas, lat, lon, ordem
    from places where trip_id = ${corpo.id}
  `
  }

  if (copiar('reservas')) {
    await sql`
    insert into reservations (trip_id, tipo, nome, cidade, inicio_em, fim_em, endereco, link,
                              telefone, localizador, valor_centavos, nota, ordem)
    select ${novo}, tipo, nome, cidade, inicio_em + ${d}::interval, fim_em + ${d}::interval,
           endereco, link, telefone, localizador, valor_centavos, nota, ordem
    from reservations where trip_id = ${corpo.id}
  `
  }

  if (copiar('checklist')) {
    await sql`
    insert into checklist_items (trip_id, titulo, categoria, escopo, prazo_ideal, prazo_maximo,
                                 valor_estimado_centavos, detalhe, ordem)
    select ${novo}, titulo, categoria, escopo, prazo_ideal + ${d}::interval,
           prazo_maximo + ${d}::interval, valor_estimado_centavos, detalhe, ordem
    from checklist_items where trip_id = ${corpo.id}
  `
  }

  if (copiar('documentos')) {
    await sql`
    insert into documents (trip_id, titulo, valor, tipo, categoria, arquivo_url, arquivo_mime,
                           arquivo_bytes, obs, ordem)
    select ${novo}, titulo, valor, tipo, categoria, arquivo_url, arquivo_mime, arquivo_bytes, obs, ordem
    from documents where trip_id = ${corpo.id}
  `
    await sql`
    insert into emergency_contacts (trip_id, titulo, telefone, detalhe, ordem)
    select ${novo}, titulo, telefone, detalhe, ordem
    from emergency_contacts where trip_id = ${corpo.id}
  `
  }

  if (copiar('financeiro')) {
    await sql`
    insert into expense_categories (id, trip_id, nome, ordem)
    select md5(id || ${novo}), ${novo}, nome, ordem
    from expense_categories where trip_id = ${corpo.id}
  `
    await sql`
    insert into expenses (trip_id, categoria_id, descricao, valor_centavos, moeda, pessoas,
                          ocorre_em, pago, estimado, nota, ordem)
    select ${novo},
           case when categoria_id is null then null else md5(categoria_id || ${novo}) end,
           descricao, valor_centavos, moeda, pessoas, ocorre_em + ${d}::interval,
           false, estimado, nota, ordem
    from expenses where trip_id = ${corpo.id}
  `
  }

  await gravarViagemAtual(novo)
  return { ok: true, id: novo }
})
