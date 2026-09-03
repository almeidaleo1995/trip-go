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
export async function importarViagem(d: TripImport, ownerId: string): Promise<ResultadoImportacao> {
  const tripId = randomUUID()

  // Resolvido ANTES da transacao: a transacao HTTP do Neon e nao-interativa,
  // entao nada pode ser consultado no meio dela.
  const eu = (await sql`select nome, email from users where id = ${ownerId}`)[0] as
    { nome: string; email: string } | undefined

  // SO a propria conta de quem importa e vinculada. Aqui havia uma busca por
  // `email = any(<todos os e-mails do arquivo>)` que resolvia QUALQUER conta e
  // gravava o `user_id` dela: subir um JSON com o endereco de outra pessoa
  // prendia a conta dessa pessoa a uma viagem que ela nunca aceitou, sem sessao
  // dela e sem nada que provasse o endereco. Era o mesmo pressuposto que o
  // `codigo_convite` derrubou em `vincularParticipantesPorEmail` -- e-mail nao e
  // credencial -- so que pela porta oposta: em vez de puxar acesso, empurrava
  // viagem.
  //
  // O e-mail dos demais continua gravado como TEXTO, entao nada se perde: eles
  // se cadastram com o codigo da viagem, ou quem e dono abre o participante e
  // salva, que e o caminho autenticado de lib/escrita.ts. Reimportar o proprio
  // backup custa esse religamento, e e o preco de o vinculo exigir consentimento.
  const meuEmail = eu?.email?.trim().toLowerCase() ?? null
  const participantes = d.participantes.map((p) => {
    const email = p.email?.trim().toLowerCase() ?? null
    return {
      ...p,
      id: randomUUID(),
      email,
      user_id: email && meuEmail && email === meuEmail ? ownerId : null,
    }
  })

  // Quem importou precisa aparecer na lista, senao a viagem nao abre para ele.
  const jaEstou = participantes.some((p) => p.user_id === ownerId)
  const q: ReturnType<typeof sql>[] = []

  q.push(sql`
    insert into trips (id, owner_id, nome, subtitulo, descricao, data_partida, data_retorno,
                       moeda, fuso, cor_destaque, capa_url, arquivada, orcamento_centavos)
    values (${tripId}, ${ownerId}, ${d.viagem.nome}, ${d.viagem.subtitulo ?? null},
            ${d.viagem.descricao ?? null}, ${d.viagem.data_partida}, ${d.viagem.data_retorno},
            ${d.viagem.moeda}, ${d.viagem.fuso ?? null}, ${d.viagem.cor_destaque},
            ${d.viagem.capa_url ?? null},
            ${d.viagem.arquivada}, ${d.viagem.orcamento_centavos ?? null})
  `)

  if (!jaEstou) {
    const id = randomUUID()
    participantes.unshift({
      id,
      nome: eu?.nome ?? 'Eu',
      email: eu?.email ?? null,
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

  // Nome -> id, para o item do roteiro reencontrar a reserva que o arquivo cita.
  // Nome repetido fica com o último; é o mesmo compromisso de `idPorCategoria`.
  const idPorReserva = new Map<string, string>()
  for (const r of d.reservas) {
    const reservaId = randomUUID()
    idPorReserva.set(r.nome, reservaId)
    q.push(sql`
      insert into reservations (id, trip_id, tipo, nome, cidade, inicio_em, fim_em, endereco,
                                link, telefone, localizador, valor_centavos, nota, ordem)
      values (${reservaId}, ${tripId}, ${r.tipo}, ${r.nome}, ${r.cidade ?? null},
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

  // Pessoas vem por NOME no arquivo (ids nao sobrevivem entre viagens), entao a
  // divisao, o pagador e os donos de checklist sao resolvidos contra a lista de
  // participantes recem-criada.
  const idPorNome = new Map(participantes.map((p) => [p.nome, p.id]))

  for (const c of d.checklist) {
    // Vinculo com passeio/voo/cruzeiro NAO sobrevive a exportar/importar como
    // viagem nova, pelo mesmo motivo que reserva_id/documento_id nao sobrevivem a
    // uma duplicacao de viagem (README): os ids antigos nao existem na viagem
    // nova. Quem quiser esses vinculos de volta refaz pela tela ou pela skill.
    const assignedTo = (c.assigned_to_nomes ?? [])
      .map((nome) => idPorNome.get(nome))
      .filter((id): id is NonNullable<typeof id> => Boolean(id))
    q.push(sql`
      insert into checklist_items (id, trip_id, titulo, categoria, escopo, prazo_ideal,
                                   prazo_maximo, valor_estimado_centavos, detalhe, ordem,
                                   assigned_to, prioridade, pais, cidade, pendente,
                                   fonte_tipo, fonte_detalhe, fonte_consultado_em)
      values (${randomUUID()}, ${tripId}, ${c.titulo}, ${c.categoria ?? null}, ${c.escopo},
              ${c.prazo_ideal ?? null}, ${c.prazo_maximo ?? null},
              ${c.valor_estimado_centavos ?? null}, ${c.detalhe ?? null}, ${c.ordem},
              ${assignedTo}, ${c.prioridade}, ${c.pais ?? null}, ${c.cidade ?? null},
              ${c.pendente}, ${c.fonte_tipo ?? null}, ${c.fonte_detalhe ?? null},
              ${c.fonte_consultado_em ?? null})
    `)
  }

  const idPorDocumento = new Map<string, string>()
  for (const doc of d.documentos) {
    const documentoId = randomUUID()
    idPorDocumento.set(doc.titulo, documentoId)
    // Dono e compartilhamento chegam por NOME. Um nome que nao bate vira null, e
    // ai o `escopo` cai para 'global': a constraint documento_pessoal_tem_dono
    // recusaria um pessoal sem dono e derrubaria a importacao inteira por causa
    // de um participante renomeado.
    const dono = doc.dono_nome ? (idPorNome.get(doc.dono_nome) ?? null) : null
    const compartilhado = (doc.assigned_to_nomes ?? [])
      .map((nome) => idPorNome.get(nome))
      .filter((id): id is NonNullable<typeof id> => Boolean(id))
    const escopo = doc.escopo === 'pessoal' && dono ? 'pessoal' : 'global'
    // O CONTEUDO do arquivo nao vem no JSON (ver /api/export) — so a ficha dele.
    // Documento que era um upload chega sem bytes e a tela pede o arquivo de novo.
    q.push(sql`
      insert into documents (id, trip_id, titulo, valor, tipo, categoria, arquivo_url,
                             arquivo_nome, arquivo_mime, arquivo_bytes, obs, ordem,
                             escopo, traveler_id, assigned_to, tags, importante, offline,
                             validade, pais, cidade, dia, reservation_id)
      values (${documentoId}, ${tripId}, ${doc.titulo}, ${doc.valor ?? null}, ${doc.tipo},
              ${doc.categoria ?? null}, ${doc.arquivo_url ?? null}, ${doc.arquivo_nome ?? null},
              ${doc.arquivo_mime ?? null}, ${doc.arquivo_bytes ?? null}, ${doc.obs ?? null},
              ${doc.ordem}, ${escopo}, ${dono}, ${compartilhado}, ${doc.tags},
              ${doc.importante}, ${doc.offline}, ${doc.validade ?? null}, ${doc.pais ?? null},
              ${doc.cidade ?? null}, ${doc.dia ?? null},
              ${idPorReserva.get(doc.reserva ?? '') ?? null})
    `)
  }

  // A documentação EXIGIDA. Vem depois dos documentos porque uma entrega pode
  // apontar para um arquivo do cofre, e antes do roteiro por nada em especial.
  //
  // Requisito primeiro, entrega depois: a entrega referencia o requisito por
  // NOME, pelo mesmo motivo de sempre — id não sobrevive a exportar de uma
  // viagem e importar noutra.
  const idPorRequisito = new Map<string, string>()
  for (const r of d.requisitos) {
    const requisitoId = randomUUID()
    idPorRequisito.set(r.nome, requisitoId)
    const alvos = (r.assigned_to_nomes ?? [])
      .map((nome) => idPorNome.get(nome))
      .filter((id): id is NonNullable<typeof id> => Boolean(id))
    // Requisito que era "só para fulano e beltrano" e chega sem nenhum nome que
    // bate viraria uma linha que não se aplica a ninguém — e a constraint
    // `requisito_pessoal_tem_dono` derrubaria a importação inteira. Vale para
    // todos é o único fallback seguro: a exigência continua existindo, e quem
    // organiza restringe de novo pela tela.
    const paraTodos = r.aplica_todos !== false || alvos.length === 0
    q.push(sql`
      insert into document_requirements (id, trip_id, nome, descricao, categoria, obrigatorio,
                                         aplica_todos, assigned_to, exige_numero, exige_validade,
                                         exige_arquivo, campo_perfil, prazo, pais, obs, ordem)
      values (${requisitoId}, ${tripId}, ${r.nome}, ${r.descricao ?? null},
              ${r.categoria ?? null}, ${r.obrigatorio}, ${paraTodos},
              ${paraTodos ? [] : alvos}, ${r.exige_numero}, ${r.exige_validade},
              ${r.exige_arquivo}, ${r.campo_perfil ?? null}, ${r.prazo ?? null},
              ${r.pais ?? null}, ${r.obs ?? null}, ${r.ordem})
    `)
  }

  for (const e of d.entregas) {
    const requisitoId = idPorRequisito.get(e.requisito_nome ?? '')
    const dono = idPorNome.get(e.dono_nome ?? '')
    // Entrega órfã é descartada em silêncio, não importada com null: a coluna é
    // `not null` nos dois lados, e uma entrega sem requisito ou sem pessoa não é
    // uma entrega parcial — é uma entrega de ninguém.
    if (!requisitoId || !dono) continue
    q.push(sql`
      insert into document_submissions (id, requirement_id, traveler_id, numero, validade,
                                        emitido_em, documento_id, status, comentario)
      values (${randomUUID()}, ${requisitoId}, ${dono}, ${e.numero ?? null},
              ${e.validade ?? null}, ${e.emitido_em ?? null}, null, ${e.status},
              ${e.comentario ?? null})
    `)
  }

  // O roteiro vem por último entre as listas simples porque aponta para reserva
  // e documento — que o arquivo identifica por NOME, já que ids não sobrevivem a
  // uma importação. Nome que não bate vira null: o item entra sem o vínculo, em
  // vez de a importação inteira falhar por causa de uma reserva renomeada.
  for (const e of d.roteiro) {
    const eventoId = randomUUID()
    q.push(sql`
      insert into itinerary_events (id, trip_id, ocorre_em, fim_em, cidade, local, endereco,
                                    lat, lon, titulo, descricao, tipo, ancora, distancia_m,
                                    duracao_min, transporte, como_chegar, dicas, links,
                                    custo_centavos, reserva_id, documento_id, nota, ordem)
      values (${eventoId}, ${tripId}, ${e.ocorre_em}, ${e.fim_em ?? null}, ${e.cidade ?? null},
              ${e.local ?? null}, ${e.endereco ?? null}, ${e.lat ?? null}, ${e.lon ?? null},
              ${e.titulo}, ${e.descricao ?? null}, ${e.tipo}, ${e.ancora},
              ${e.distancia_m ?? null}, ${e.duracao_min ?? null}, ${e.transporte ?? null},
              ${e.como_chegar ?? null}, ${e.dicas ?? null}, ${e.links ?? null},
              ${e.custo_centavos ?? null}, ${idPorReserva.get(e.reserva ?? '') ?? null},
              ${idPorDocumento.get(e.documento ?? '') ?? null}, ${e.nota ?? null}, ${e.ordem})
    `)
    for (const o of e.opcoes) {
      q.push(sql`
        insert into itinerary_options (id, event_id, modo, duracao_min, distancia_m, custo,
                                       detalhe, recomendado, ordem)
        values (${randomUUID()}, ${eventoId}, ${o.modo}, ${o.duracao_min ?? null},
                ${o.distancia_m ?? null}, ${o.custo ?? null}, ${o.detalhe ?? null},
                ${o.recomendado}, ${o.ordem})
      `)
    }
  }

  for (const dia of d.dias) {
    q.push(sql`
      insert into itinerary_days (id, trip_id, dia, titulo, cidade, pais, resumo, ancora,
                                  alertas, antes_sair, antes_dormir, links, mapa_url)
      values (${randomUUID()}, ${tripId}, ${dia.dia}, ${dia.titulo ?? null},
              ${dia.cidade ?? null}, ${dia.pais ?? null}, ${dia.resumo ?? null}, ${dia.ancora},
              ${dia.alertas ?? null}, ${dia.antes_sair ?? null}, ${dia.antes_dormir ?? null},
              ${dia.links ?? null}, ${dia.mapa_url ?? null})
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

  // "descricao|numero" -> id da parcela, para religar os reembolsos no fim.
  const idPorParcela = new Map<string, string>()

  for (const c of d.custos) {
    const despesaId = randomUUID()
    q.push(sql`
      insert into expenses (id, trip_id, categoria_id, traveler_id, descricao, valor_centavos,
                            moeda, ocorre_em, divisao, estimado, nota, ordem)
      values (${despesaId}, ${tripId},
              ${c.categoria ? (idPorCategoria.get(c.categoria) ?? null) : null},
              ${c.pagador ? (idPorNome.get(c.pagador) ?? null) : null},
              ${c.descricao}, ${c.valor_centavos}, ${c.moeda ?? null},
              ${c.ocorre_em ?? null}, ${c.divisao}, ${c.estimado}, ${c.nota ?? null}, ${c.ordem})
    `)

    for (const div of c.divisoes) {
      const quem = idPorNome.get(div.participante)
      // Divisao apontando para quem nao esta na lista de participantes seria uma
      // FK quebrada: pula a linha em vez de derrubar a importacao inteira.
      if (!quem) continue
      q.push(sql`
        insert into expense_shares (id, expense_id, traveler_id, peso, valor_centavos)
        values (${randomUUID()}, ${despesaId}, ${quem}, ${div.peso}, ${div.valor_centavos})
        on conflict (expense_id, traveler_id) do nothing
      `)
    }

    // Toda despesa tem pelo menos uma parcela. Arquivo sem nenhuma (v3 escrito a
    // mao) ganha a parcela unica aqui, senao o vencimento nao teria onde morar.
    const parcelas =
      c.parcelas.length > 0
        ? c.parcelas
        : [
            {
              numero: 1,
              vence_em: c.ocorre_em ?? null,
              valor_centavos: c.valor_centavos,
              pago_centavos: 0,
              pago_em: null,
            },
          ]
    for (const p of parcelas) {
      const parcelaId = randomUUID()
      const chave = `${c.descricao}|${p.numero}`
      if (!idPorParcela.has(chave)) idPorParcela.set(chave, parcelaId)
      q.push(sql`
        insert into installments (id, expense_id, numero, vence_em, valor_centavos,
                                  pago_centavos, pago_em)
        values (${parcelaId}, ${despesaId}, ${p.numero}, ${p.vence_em ?? null},
                ${p.valor_centavos}, ${p.pago_centavos}, ${p.pago_em ?? null})
        on conflict (expense_id, numero) do nothing
      `)
    }
  }

  for (const g of d.pagamentos) {
    const parcelaId =
      g.despesa && g.parcela ? (idPorParcela.get(`${g.despesa}|${g.parcela}`) ?? null) : null
    q.push(sql`
      insert into payments (id, trip_id, de_id, para_id, parcela_id, valor_centavos, ocorre_em,
                            referencia, nota)
      values (${randomUUID()}, ${tripId},
              ${g.de ? (idPorNome.get(g.de) ?? null) : null},
              ${g.para ? (idPorNome.get(g.para) ?? null) : null},
              ${parcelaId}, ${g.valor_centavos}, ${g.ocorre_em ?? null}, ${g.referencia ?? null},
              ${g.nota ?? null})
    `)
  }

  await sql.transaction(q)

  return {
    tripId,
    participantes: Object.fromEntries(participantes.map((p) => [p.nome, p.id])),
  }
}
