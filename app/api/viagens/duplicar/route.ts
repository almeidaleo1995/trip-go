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
import { CATEGORIAS_DOCUMENTO } from '@/lib/schema.ts'

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

  // 'editor', e nao o minimo padrao: duplicar entrega uma viagem da qual quem
  // duplicou vira PROPRIETARIO, e a copia carrega `orcamento_centavos`, todas as
  // `expenses` e todas as `installments`. Um `visualizador` nao le nada disso --
  // o orcamento e cortado em `editor` no getSnapshot e `financeiroDaViagem` so
  // lhe manda as proprias obrigacoes -- entao ele duplicava, abria a copia como
  // dono e o `financeiroDaViagem` respondia `{admin: true}` com o razao inteiro.
  // Todo o recorte de papel do modulo financeiro caia por este endpoint.
  //
  // A regra que fecha isso e uma so, e vale para o que for adicionado a copia no
  // futuro: SO SE COPIA O QUE JA SE PODE LER. 'editor' e o limiar certo porque e
  // exatamente o que /api/export ja concede -- quem pode baixar o arquivo com
  // esses numeros nao ganha nada duplicando. A unica coisa fora do alcance de um
  // editor e o item de checklist `pessoal` alheio, e por isso a copia dele filtra
  // por escopo mais abaixo.
  await exigirViagem(u.id, corpo.id, 'editor')

  const copiar = (bloco: string) => corpo.copiar?.[bloco] ?? true

  // Deslocamento em dias aplicado a todas as datas. 0 mantém o calendário.
  const dias = Number.isFinite(Number(corpo.dias)) ? Math.trunc(Number(corpo.dias)) : 0
  const deslocamento = `${dias} days`

  // Nome escolhido pela pessoa, ou "<original> (cópia)" resolvido pelo banco.
  const nome = corpo.nome?.trim() || null

  const criada = await sql`
    insert into trips (owner_id, nome, subtitulo, descricao, data_partida, data_retorno,
                       moeda, cor_destaque, capa_url, orcamento_centavos)
    select ${u.id}, coalesce(${nome}, nome || ' (cópia)'), subtitulo, descricao,
           data_partida + ${deslocamento}::interval, data_retorno + ${deslocamento}::interval,
           moeda, cor_destaque, capa_url, orcamento_centavos
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

  // A lista fechada de categorias, para o Postgres. Mesma razao da normalizacao
  // no /api/export: `documents.categoria` foi texto livre, a constraint que a
  // fechou e `not valid`, e ela tolera a linha antiga mas RECUSA o INSERT que a
  // copia. Fora da lista vira 'outro' e a palavra original vai para `tags` —
  // duplicar uma viagem nao e hora de apagar o que alguem escreveu.
  const CATS = [...CATEGORIAS_DOCUMENTO]

  if (copiar('roteiro')) {
    // O id derivado (md5) é o que permite copiar as opções de transporte logo
    // abaixo sem uma segunda consulta para descobrir o novo id de cada item.
    //
    // `reserva_id` e `documento_id` saem NULOS de propósito: as reservas e os
    // documentos da cópia são registros novos, e manter o id antigo deixaria o
    // item apontando para outra viagem — um ponteiro pendurado que nenhuma tela
    // resolve, porque toda tela lê a lista já recortada pela viagem da sessão.
    await sql`
    insert into itinerary_events (id, trip_id, ocorre_em, fim_em, cidade, local, endereco, lat, lon,
                                  titulo, descricao, tipo, ancora, distancia_m, duracao_min,
                                  transporte, como_chegar, dicas, links, custo_centavos, nota, ordem)
    select md5(id || ${novo}), ${novo}, ocorre_em + ${d}::interval, fim_em + ${d}::interval,
           cidade, local, endereco, lat, lon, titulo, descricao, tipo, ancora, distancia_m,
           duracao_min, transporte, como_chegar, dicas, links, custo_centavos, nota, ordem
    from itinerary_events where trip_id = ${corpo.id}
  `
    await sql`
    insert into itinerary_options (event_id, modo, duracao_min, distancia_m, custo, detalhe,
                                   recomendado, ordem)
    select md5(o.event_id || ${novo}), o.modo, o.duracao_min, o.distancia_m, o.custo, o.detalhe,
           o.recomendado, o.ordem
    from itinerary_options o
    join itinerary_events e on e.id = o.event_id where e.trip_id = ${corpo.id}
  `
    await sql`
    insert into itinerary_days (trip_id, dia, titulo, cidade, pais, resumo, ancora, alertas,
                                antes_sair, antes_dormir, links, mapa_url)
    select ${novo}, dia + ${d}::interval, titulo, cidade, pais, resumo, ancora, alertas,
           antes_sair, antes_dormir, links, mapa_url
    from itinerary_days where trip_id = ${corpo.id}
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
    // SO os itens do grupo, pelo mesmo motivo que os documentos logo abaixo
    // filtram `escopo = 'global'`: `checklistDaViagem` esconde o item `pessoal`
    // de quem nao e o dono nem proprietario, e a copia nasce sem participante --
    // `assigned_to` nem e copiado. Sem o filtro, duplicar era como um editor lia
    // o titulo, o detalhe e o valor estimado do item pessoal de outra pessoa.
    await sql`
    insert into checklist_items (trip_id, titulo, categoria, escopo, prazo_ideal, prazo_maximo,
                                 valor_estimado_centavos, detalhe, ordem)
    select ${novo}, titulo, categoria, escopo, prazo_ideal + ${d}::interval,
           prazo_maximo + ${d}::interval, valor_estimado_centavos, detalhe, ordem
    from checklist_items where trip_id = ${corpo.id} and escopo = 'global'
  `
  }

  if (copiar('documentos')) {
    // SO os documentos do grupo. Um documento `pessoal` pertence a uma pessoa
    // DAQUELA viagem, e a copia nasce sem participante nenhum: nao ha onde ele
    // aterrissar, e copia-lo sem dono publicaria o passaporte de outra pessoa numa
    // viagem que quem duplicou controla. O filtro fecha as duas coisas de uma vez
    // — a constraint `documento_pessoal_tem_dono` e a privacidade.
    //
    // id deterministico (o mesmo md5 dos voos e cruzeiros) porque os BYTES sao
    // copiados logo abaixo e precisam reencontrar a linha. Sem isso, um documento
    // com arquivo viraria na copia um cartao que nao abre.
    await sql`
    insert into documents (id, trip_id, titulo, valor, tipo, categoria, arquivo_url, arquivo_nome,
                           arquivo_mime, arquivo_bytes, obs, ordem, escopo, tags, importante,
                           offline, validade, pais, cidade, dia, criado_por)
    select md5(id || ${novo}), ${novo}, titulo, valor, tipo,
           case when categoria = any(${CATS}) then categoria
                when categoria is null then null
                else 'outro' end,
           arquivo_url, arquivo_nome, arquivo_mime, arquivo_bytes, obs, ordem, 'global',
           case when categoria is null or categoria = any(${CATS}) then tags
                else tags || categoria end,
           importante, offline, validade, pais, cidade, dia + ${d}::interval, null
    from documents where trip_id = ${corpo.id} and escopo = 'global'
  `
    await sql`
    insert into document_files (document_id, bytes, mime)
    select md5(f.document_id || ${novo}), f.bytes, f.mime
    from document_files f
    join documents d on d.id = f.document_id
    where d.trip_id = ${corpo.id} and d.escopo = 'global'
  `
    // A EXIGENCIA acompanha a viagem: quem duplica "Europa 2027" para 2028 quer o
    // passaporte exigido de novo. As ENTREGAS nao — elas sao de pessoas daquela
    // viagem, e a copia comeca sem participantes, pelo mesmo motivo de
    // `checklist_state` nao ser copiado.
    //
    // `aplica_todos` vira true na copia: `assigned_to` guarda ids de participantes
    // que nao existem aqui, e um requisito restrito a fantasmas nao se aplica a
    // ninguem. Quem duplicou restringe de novo pela tela.
    await sql`
    insert into document_requirements (trip_id, nome, descricao, categoria, obrigatorio,
                                       aplica_todos, assigned_to, exige_numero, exige_validade,
                                       exige_arquivo, campo_perfil, prazo, obs, ordem)
    select ${novo}, nome, descricao, categoria, obrigatorio, true, '{}', exige_numero,
           exige_validade, exige_arquivo, campo_perfil, prazo + ${d}::interval, obs, ordem
    from document_requirements where trip_id = ${corpo.id}
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
    // `traveler_id` (quem pagou) sai nulo: duplicar não copia participantes, e
    // apontar para a pessoa da viagem original quebraria a chave estrangeira —
    // além de afirmar que alguém pagou uma despesa que ainda não aconteceu.
    await sql`
    insert into expenses (id, trip_id, categoria_id, descricao, valor_centavos, moeda,
                          ocorre_em, divisao, estimado, nota, ordem)
    select md5(id || ${novo}), ${novo},
           case when categoria_id is null then null else md5(categoria_id || ${novo}) end,
           descricao, valor_centavos, moeda, ocorre_em + ${d}::interval,
           divisao, estimado, nota, ordem
    from expenses where trip_id = ${corpo.id}
  `
    // O calendário de parcelas vem junto (é o plano de pagamento), zerado: a
    // viagem nova começa com tudo por pagar.
    await sql`
    insert into installments (id, expense_id, numero, vence_em, valor_centavos)
    select md5(i.id || ${novo}), md5(i.expense_id || ${novo}), i.numero,
           i.vence_em + ${d}::interval, i.valor_centavos
    from installments i join expenses e on e.id = i.expense_id
    where e.trip_id = ${corpo.id}
  `
    // Divisão e reembolsos NÃO são copiados: eles são sobre pessoas, e a cópia
    // começa só com quem duplicou. As despesas nascem "a dividir".
  }

  await gravarViagemAtual(novo)
  return { ok: true, id: novo }
})
