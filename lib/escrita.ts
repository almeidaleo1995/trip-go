// O caminho de escrita da viagem: quem pode escrever o quê, em que tabela, e
// como a operação cai na viagem certa.
//
// Estas funções moravam dentro de `app/api/mutate/route.ts`. Saíram de lá quando
// o assistente de IA passou a precisar gravar: duas rotas com duas cópias das
// regras de autorização são duas regras que divergem, e a que fica para trás é
// justamente a que ninguém olha. Aqui elas são uma só, e as rotas são cascas.
//
// Nada neste arquivo confia no cliente. `Acesso` vem de `exigirViagem`, o papel
// é conferido contra a `TABELA`, e `recorte` garante que o id recebido pertence
// à viagem da sessão — sem isso, um id adivinhado alcançaria registro de outra
// viagem.
import { randomUUID } from 'node:crypto'
import { sql, registrarAlteracao, avisarParticipantes } from '@/lib/db.ts'
import { type Acesso } from '@/lib/auth.ts'
import { ErroHttp } from '@/lib/session.ts'
import type { z } from 'zod'
import { validarCampos, DespesaSchema, type Entidade } from '@/lib/schema.ts'
import { resolverDivisao, gerarParcelas } from '@/lib/financeiro.ts'
import { papelAlcanca, type Papel } from '@/config/navigation.ts'

/**
 * Entidade -> tabela, como ela se liga à viagem, e o papel mínimo para escrevê-la.
 *
 * `via` é o que impede uma conta de editar registro de outra viagem passando um
 * id adivinhado: toda operação é recortada pelo trip_id da sessão, nunca só pelo id.
 */
export const TABELA: Record<
  Entidade,
  {
    nome: string
    via: 'trip' | 'flight' | 'cruise' | 'expense' | 'event' | 'requisito' | 'self'
    minimo: Papel
  }
> = {
  viagem: { nome: 'trips', via: 'self', minimo: 'editor' },
  participante: { nome: 'travelers', via: 'trip', minimo: 'proprietario' },
  roteiro: { nome: 'itinerary_events', via: 'trip', minimo: 'editor' },
  dia: { nome: 'itinerary_days', via: 'trip', minimo: 'editor' },
  opcao: { nome: 'itinerary_options', via: 'event', minimo: 'editor' },
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
  // A EXIGENCIA e configuracao da viagem: quem organiza define o que e preciso ter.
  requisito: { nome: 'document_requirements', via: 'trip', minimo: 'editor' },
  // A ENTREGA e do viajante — como `checklist_state`, ele escreve a PROPRIA linha
  // mesmo como visualizador. `autorizar` e que separa o que ele pode escrever
  // (o dado) do que so quem revisa escreve (o veredito).
  entrega: { nome: 'document_submissions', via: 'requisito', minimo: 'visualizador' },
  emergencia: { nome: 'emergency_contacts', via: 'trip', minimo: 'editor' },
  categoria: { nome: 'expense_categories', via: 'trip', minimo: 'editor' },
  // A despesa passa pelo caminho transacional em `gravarDespesa`; a entrada aqui
  // ainda vale para a autorização e para o `delete`.
  custo: { nome: 'expenses', via: 'trip', minimo: 'editor' },
  parcela: { nome: 'installments', via: 'expense', minimo: 'editor' },
  pagamento: { nome: 'payments', via: 'trip', minimo: 'editor' },
}
/**
 * Quem pode escrever o quê.
 *
 * Visualizador só marca o próprio checklist. Qualquer outra escrita — inclusive
 * marcar o checklist de outra pessoa — é 403. Esta função é a barreira real; a
 * interface esconder o botão é só conveniência.
 */
export async function autorizar(
  acesso: Acesso,
  entidade: Entidade,
  op: string,
  campos: Record<string, unknown>,
  id?: string | null,
) {
  const meta = TABELA[entidade]
  if (!meta) throw new ErroHttp(400, `Entidade desconhecida: ${entidade}`)

  // Item pessoal do checklist: quem está em assigned_to edita/apaga o próprio
  // mesmo como visualizador (única exceção ao mínimo 'editor' da tabela) — mas
  // ninguém além do dono ou do proprietário mexe nele, nem um editor comum.
  let itemChecklist: { escopo: string; assigned_to: string[] } | undefined
  if (entidade === 'checklist_item' && (op === 'editar' || op === 'remover') && id) {
    const r = await sql`
      select escopo, assigned_to from checklist_items where id = ${id} and trip_id = ${acesso.tripId}
    `
    itemChecklist = r[0] as { escopo: string; assigned_to: string[] } | undefined
  }
  const souDonoDoItem =
    itemChecklist?.escopo === 'pessoal' && itemChecklist.assigned_to.includes(acesso.participanteId)

  // Documento PESSOAL do próprio viajante: mesma exceção do item de checklist
  // acima. Um `visualizador` guarda e substitui o próprio passaporte — é o que a
  // palavra "cofre" promete, e recusar isso deixaria a única pessoa que tem o
  // documento dependendo de quem organiza a viagem para subi-lo.
  //
  // `documento` continua com mínimo 'editor' na TABELA de propósito: a exceção é
  // ESTA linha, não a entidade. Documento do grupo, de outra pessoa, ou sem dono
  // continua caindo no 403 logo abaixo.
  let documentoAlvo: { escopo: string; traveler_id: string | null } | undefined
  if (entidade === 'documento' && (op === 'editar' || op === 'remover') && id) {
    const r = await sql`
      select escopo, traveler_id from documents where id = ${id} and trip_id = ${acesso.tripId}
    `
    documentoAlvo = r[0] as { escopo: string; traveler_id: string | null } | undefined
  }
  const souDonoDoDocumento =
    entidade === 'documento' &&
    (op === 'criar'
      ? campos.escopo === 'pessoal' && campos.traveler_id === acesso.participanteId
      : documentoAlvo?.escopo === 'pessoal' &&
        documentoAlvo.traveler_id === acesso.participanteId)

  if (!papelAlcanca(acesso.papel, meta.minimo) && !souDonoDoItem && !souDonoDoDocumento) {
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

  // Um item pessoal so pode ser editado/apagado por quem esta em assigned_to ou
  // pelo proprietario — do contrario um editor poderia mexer no item pessoal de
  // outro participante mesmo sem poder VE-LO (checklistDaViagem ja o esconde na
  // leitura; isto fecha o mesmo buraco na escrita).
  if (
    entidade === 'checklist_item' &&
    (op === 'editar' || op === 'remover') &&
    !papelAlcanca(acesso.papel, 'proprietario') &&
    itemChecklist?.escopo === 'pessoal' &&
    !souDonoDoItem
  ) {
    throw new ErroHttp(403, 'Este item pessoal é de outro participante.')
  }

  // Documento pessoal só é editado/apagado pelo dono ou pelo proprietário. É o par
  // de escrita do recorte de leitura em `documentosDaViagem`: sem isto, um editor
  // que não PODE VER o passaporte de outra pessoa ainda poderia sobrescrevê-lo
  // mandando o id direto.
  if (
    entidade === 'documento' &&
    !papelAlcanca(acesso.papel, 'proprietario') &&
    documentoAlvo?.escopo === 'pessoal' &&
    documentoAlvo.traveler_id !== acesso.participanteId
  ) {
    throw new ErroHttp(403, 'Este documento é pessoal de outro participante.')
  }

  // A ENTREGA de um requisito tem DOIS donos, e o 403 mora exatamente entre eles.
  //
  //   o dado   (numero, validade, emitido_em, documento_id) e do VIAJANTE
  //   o veredito (status de revisao, comentario)            e de quem REVISA
  //
  // Sem esta separacao, o mesmo endpoint que deixa a Ana cadastrar o passaporte
  // dela deixaria a Ana se auto-aprovar — e deixaria um editor reescrever o numero
  // do passaporte alheio, que ele nem pode LER. As duas metades sao checadas
  // separadamente porque as duas acontecem na mesma linha da mesma tabela.
  if (entidade === 'entrega') {
    const dono = String(campos.traveler_id ?? '')
    const meu = !dono || dono === acesso.participanteId
    const revisor = papelAlcanca(acesso.papel, 'editor')

    const VEREDITOS = ['aprovado', 'rejeitado', 'correcao']
    const dandoVeredito =
      (typeof campos.status === 'string' && VEREDITOS.includes(campos.status)) ||
      campos.comentario !== undefined
    const DADOS = ['numero', 'validade', 'emitido_em', 'documento_id']
    const mexendoNoDado = DADOS.some((c) => c in campos)

    if (!meu && !revisor) {
      throw new ErroHttp(403, 'Você só pode enviar a sua própria documentação.')
    }
    if (!meu && mexendoNoDado) {
      throw new ErroHttp(403, 'A documentação de outro participante é preenchida por ele.')
    }
    if (dandoVeredito && !revisor) {
      throw new ErroHttp(403, 'Só quem organiza a viagem aprova ou recusa um documento.')
    }
    if (op === 'remover' && !meu && !revisor) {
      throw new ErroHttp(403, 'Você só pode apagar a sua própria documentação.')
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
export function recorte(entidade: Entidade, tripId: string, posicao: number) {
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
  if (meta.via === 'expense') {
    return {
      sql: `and expense_id in (select id from expenses where trip_id = $${posicao})`,
      params: [tripId],
    }
  }
  if (meta.via === 'event') {
    return {
      sql: `and event_id in (select id from itinerary_events where trip_id = $${posicao})`,
      params: [tripId],
    }
  }
  if (meta.via === 'requisito') {
    return {
      sql: `and requirement_id in (select id from document_requirements where trip_id = $${posicao})`,
      params: [tripId],
    }
  }
  if (meta.via === 'self') return { sql: '', params: [] as string[] }
  return { sql: `and trip_id = $${posicao}`, params: [tripId] }
}

/**
 * Grava despesa + divisão + parcelas numa transação só.
 *
 * O cliente manda o QUE (valor total, quem paga, quem divide, em quantas vezes);
 * quem faz a ARITMÉTICA é este servidor, com as funções testadas de
 * `lib/financeiro.ts`. É deliberado: a soma das partes fechar com o total não
 * pode depender de o navegador ter arredondado do mesmo jeito.
 *
 * As parcelas são atualizadas por `(expense_id, numero)` e nunca apagadas em
 * bloco: `payments.parcela_id` aponta para elas, e recriar as linhas ao renomear
 * uma despesa desligaria os reembolsos já registrados. `pago_centavos` também
 * não é tocado aqui — quem manda nele é a entidade `parcela`.
 */
async function gravarDespesa(
  acesso: Acesso,
  op: { op: string; id?: string | null; campos: Record<string, unknown>; client_ts: string },
): Promise<boolean> {
  const tripId = acesso.tripId
  const v = validarCampos('custo', op.campos)
  if (!v.sucesso) throw new Error(v.erro)
  const d = v.dados as z.infer<typeof DespesaSchema>

  const criando = op.op === 'criar'
  const id = criando ? (op.id ?? randomUUID()) : String(op.id ?? '')
  if (!id) throw new Error('id obrigatório para editar')

  await conferirParticipantes(tripId, [d.traveler_id, ...d.divisoes.map((x) => x.traveler_id)])
  if (d.categoria_id) {
    const r = await sql`
      select 1 from expense_categories where id = ${d.categoria_id} and trip_id = ${tripId}
    `
    if (r.length === 0) throw new Error('categoria não encontrada nesta viagem')
  }

  const anterior = criando
    ? undefined
    : ((await sql`select * from expenses where id = ${id} and trip_id = ${tripId}`)[0] as
        Record<string, unknown> | undefined)
  if (!criando && !anterior) throw new Error('registro não encontrado')

  // Last-write-wins, igual ao caminho genérico: a versão do servidor mais nova
  // descarta a escrita em vez de sobrescrevê-la.
  if (anterior && new Date(String(anterior.updated_at)) >= new Date(op.client_ts)) return false

  // A divisão é RECALCULADA no servidor. Em `personalizado` os valores digitados
  // são respeitados, mas a soma tem que fechar — corrigir em silêncio esconderia
  // um erro de digitação dentro de uma conta de dinheiro.
  const divisoes = resolverDivisao(d.valor_centavos, d.divisao, d.divisoes)
  if (d.divisao === 'personalizado' && divisoes.length > 0) {
    const soma = divisoes.reduce((s, x) => s + x.valor_centavos, 0)
    if (soma !== d.valor_centavos) {
      throw new Error(`a divisão soma ${soma / 100} e a despesa é ${d.valor_centavos / 100}`)
    }
  }

  const parcelas = gerarParcelas(
    d.valor_centavos,
    d.parcelas_quantidade,
    d.parcelas_primeira_em ?? d.ocorre_em ?? null,
    d.parcelas_frequencia,
  )

  await sql.transaction([
    sql`
      insert into expenses (id, trip_id, categoria_id, traveler_id, descricao, valor_centavos,
                            moeda, ocorre_em, divisao, estimado, nota, ordem, updated_at)
      values (${id}, ${tripId}, ${d.categoria_id ?? null}, ${d.traveler_id ?? null},
              ${d.descricao}, ${d.valor_centavos}, ${d.moeda ?? null}, ${d.ocorre_em ?? null},
              ${d.divisao}, ${d.estimado}, ${d.nota ?? null}, ${d.ordem}, now())
      on conflict (id) do update set
        categoria_id = excluded.categoria_id, traveler_id = excluded.traveler_id,
        descricao = excluded.descricao, valor_centavos = excluded.valor_centavos,
        moeda = excluded.moeda, ocorre_em = excluded.ocorre_em, divisao = excluded.divisao,
        estimado = excluded.estimado, nota = excluded.nota, ordem = excluded.ordem,
        updated_at = now()
    `,
    // Divisão não é apontada por ninguém: trocar por inteiro é mais simples e
    // mais barato do que casar linha a linha.
    sql`delete from expense_shares where expense_id = ${id}`,
    ...divisoes.map(
      (x) => sql`
        insert into expense_shares (id, expense_id, traveler_id, peso, valor_centavos)
        values (${randomUUID()}, ${id}, ${x.traveler_id}, ${x.peso}, ${x.valor_centavos})
      `,
    ),
    ...parcelas.map(
      (p) => sql`
        insert into installments (id, expense_id, numero, vence_em, valor_centavos, updated_at)
        values (${randomUUID()}, ${id}, ${p.numero}, ${p.vence_em}, ${p.valor_centavos}, now())
        on conflict (expense_id, numero) do update set
          vence_em = excluded.vence_em, valor_centavos = excluded.valor_centavos, updated_at = now()
      `,
    ),
    // Encurtou o parcelamento: as sobras saem.
    sql`delete from installments where expense_id = ${id} and numero > ${parcelas.length}`,
  ])

  if (criando) {
    await registrarAlteracao(
      tripId,
      acesso.participanteId,
      'custo',
      id,
      '(registro)',
      null,
      'criado',
    )
  } else {
    for (const c of ['descricao', 'valor_centavos', 'traveler_id', 'divisao'] as const) {
      if (String(anterior?.[c] ?? '') !== String(d[c] ?? '')) {
        await registrarAlteracao(tripId, acesso.participanteId, 'custo', id, c, anterior?.[c], d[c])
      }
    }
  }
  return true
}

/**
 * Confere que todo id que a operação referencia é DESTA viagem.
 *
 * É o mesmo recorte de `recorte()`, do outro lado: ali o registro editado é
 * preso à viagem da sessão; aqui os registros que ele aponta. Sem os dois, um id
 * chutado num campo de vínculo (o voo de uma escala, a pessoa de um reembolso)
 * costura dados de duas viagens diferentes.
 *
 * Na criação o vínculo é obrigatório. Na edição só é conferido se veio no lote —
 * um `editar` que não menciona o pai não deve exigir que ele seja reenviado.
 */
async function conferirPai(
  entidade: Entidade,
  tripId: string,
  campos: Record<string, unknown>,
  criando: boolean,
) {
  const vinculo = async (
    campo: string,
    consulta: (id: string) => Promise<Record<string, unknown>[]>,
    erro: string,
  ) => {
    const bruto = campos[campo]
    const id = bruto === null || bruto === undefined ? '' : String(bruto)
    if (!id) {
      if (criando) throw new Error(erro)
      return
    }
    if ((await consulta(id)).length === 0) throw new Error(erro)
  }

  if (entidade === 'escala') {
    await vinculo(
      'flight_id',
      (id) => sql`select 1 from flights where id = ${id} and trip_id = ${tripId}`,
      'voo não encontrado nesta viagem',
    )
  }
  if (entidade === 'porto') {
    await vinculo(
      'cruise_id',
      (id) => sql`select 1 from cruises where id = ${id} and trip_id = ${tripId}`,
      'cruzeiro não encontrado nesta viagem',
    )
  }
  if (entidade === 'opcao') {
    await vinculo(
      'event_id',
      (id) => sql`select 1 from itinerary_events where id = ${id} and trip_id = ${tripId}`,
      'item do roteiro nao encontrado nesta viagem',
    )
  }
  if (entidade === 'parcela') {
    await vinculo(
      'expense_id',
      (id) => sql`select 1 from expenses where id = ${id} and trip_id = ${tripId}`,
      'despesa não encontrada nesta viagem',
    )
  }
  if (entidade === 'entrega') {
    await vinculo(
      'requirement_id',
      (id) => sql`select 1 from document_requirements where id = ${id} and trip_id = ${tripId}`,
      'requisito nao encontrado nesta viagem',
    )
    await conferirParticipantes(tripId, [campos.traveler_id])
    // O arquivo anexado tem que ser desta viagem tambem: sem isto, uma entrega
    // apontaria para o passaporte guardado em OUTRA viagem, e /api/documento
    // (que confere o trip do documento, nao o da entrega) o serviria.
    if (campos.documento_id) {
      await vinculo(
        'documento_id',
        (id) => sql`select 1 from documents where id = ${id} and trip_id = ${tripId}`,
        'documento nao encontrado nesta viagem',
      )
    }
  }
  if (entidade === 'pagamento') {
    await conferirParticipantes(tripId, [campos.de_id, campos.para_id])
    if (campos.parcela_id) {
      await vinculo(
        'parcela_id',
        (id) => sql`
          select 1 from installments i join expenses e on e.id = i.expense_id
          where i.id = ${id} and e.trip_id = ${tripId}
        `,
        'parcela não encontrada nesta viagem',
      )
    }
  }
}

/** Todo participante citado precisa ser desta viagem. Nulos são ignorados. */
async function conferirParticipantes(tripId: string, ids: unknown[]) {
  const alvo = [...new Set(ids.filter(Boolean).map(String))]
  if (alvo.length === 0) return
  const r = await sql`select id from travelers where trip_id = ${tripId} and id = any(${alvo})`
  if (r.length !== alvo.length) throw new Error('participante não encontrado nesta viagem')
}

/** Aplica uma operação. Devolve false quando o LWW descarta a escrita. */
export async function aplicar(
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

  await conferirPai(op.entidade, tripId, op.campos, op.op === 'criar')

  // Uma despesa, a sua divisão e as suas parcelas são um fato só. Gravá-las em
  // três idas separadas deixaria uma despesa sem divisão na tela se a segunda
  // falhasse — e uma despesa sem divisão é dinheiro que ninguém deve.
  if (op.entidade === 'custo' && op.op !== 'remover') {
    return gravarDespesa(acesso, op)
  }

  const meta = TABELA[op.entidade]

  // ---------------------------------------------------------------- remover
  //
  // Antes de validar os campos, de propósito: para apagar só o id importa, e
  // exigir um registro válido para destruí-lo é pedir o que quem apaga não tem.
  // (A despesa é o caso que denunciou isto: o schema dela não é parcial, então
  // um `remover` com campos vazios era recusado em silêncio.)
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

  const v = validarCampos(op.entidade, op.campos)
  if (!v.sucesso) throw new Error(v.erro)
  const campos: Record<string, unknown> = { ...(v.dados as Record<string, unknown>) }

  // Campos aninhados vêm no mesmo objeto por conveniência do formulário; cada um
  // é gravado pela sua própria entidade.
  delete campos.escalas
  delete campos.portos

  // Quem revisou e quando: carimbado pelo SERVIDOR, nunca aceito do cliente. Um
  // `revisado_por` vindo do navegador deixaria qualquer aprovacao assinada por
  // qualquer pessoa, e a assinatura e o unico registro de quem conferiu.
  if (op.entidade === 'entrega') {
    delete campos.revisado_por
    delete campos.revisado_em
    if (['aprovado', 'rejeitado', 'correcao'].includes(String(campos.status ?? ''))) {
      campos.revisado_por = acesso.participanteId
      campos.revisado_em = new Date().toISOString()
    }
    // Reenviar depois de uma recusa limpa o veredito anterior: manter o
    // comentario "foto ilegivel" ao lado da foto nova e dizer a pessoa que ela
    // errou de novo sem ninguem ter olhado.
    if (campos.status === 'enviado') {
      campos.comentario = null
      campos.revisado_por = null
      campos.revisado_em = null
    }
  }

  // `email` no participante liga o registro a uma conta existente. Sem conta com
  // esse e-mail, o participante fica como nome na lista — que é o comportamento
  // correto para quem viaja junto mas não usa o app.
  if (op.entidade === 'participante' && 'email' in campos) {
    const email = campos.email ? String(campos.email).trim().toLowerCase() : null
    campos.email = email
    const achado = email ? await sql`select id from users where email = ${email}` : []
    campos.user_id = (achado[0] as { id: string } | undefined)?.id ?? null
  }

  // ---------------------------------------------------------------- criar
  if (op.op === 'criar') {
    if (op.entidade === 'viagem') throw new ErroHttp(400, 'Use /api/viagens para criar viagem.')

    // O pai de escala, porto e parcela vem dos campos; os demais penduram no trip_id.
    if (meta.via === 'flight') campos.flight_id = op.campos.flight_id
    if (meta.via === 'cruise') campos.cruise_id = op.campos.cruise_id
    if (meta.via === 'expense') campos.expense_id = op.campos.expense_id
    if (meta.via === 'event') campos.event_id = op.campos.event_id

    const id = op.id ?? randomUUID()
    const cols = Object.keys(campos)
    const vinculo = meta.via === 'trip' ? ['trip_id'] : []
    const nomes = ['id', ...vinculo, ...cols]
    const valores = [id, ...(vinculo.length ? [tripId] : []), ...cols.map((c) => campos[c])]
    // O dia do roteiro é o único upsert: a tela edita "02 de janeiro" sem saber
    // se já existe linha para ele, e (trip_id, dia) é unique. Sem o on conflict,
    // anotar um dia duas vezes viraria 409 em vez de salvar.
    // Dois upserts, pela mesma razao: a tela edita sem saber se a linha ja existe.
    // O dia do roteiro e unique por (trip_id, dia); a entrega, por (requisito,
    // pessoa). Sem o on conflict, reenviar o passaporte pela fila offline viraria
    // 409 em vez de atualizar a entrega que ja estava la.
    const CHAVE_UPSERT: Partial<Record<Entidade, string[]>> = {
      dia: ['dia'],
      entrega: ['requirement_id', 'traveler_id'],
    }
    const chave = CHAVE_UPSERT[op.entidade]
    const conflito = chave
      ? ` on conflict (${chave.join(', ')}) do update set ${cols
          .filter((c) => !chave.includes(c))
          .map((c) => `${c} = excluded.${c}`)
          .concat('updated_at = now()')
          .join(', ')}`
      : ''
    await sql.query(
      `insert into ${meta.nome} (${nomes.join(', ')})
       values (${nomes
         .map((_, i) => `$${i + 1}${Array.isArray(valores[i]) ? '::text[]' : ''}`)
         .join(', ')})${conflito}`,
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
  const sets = cols
    .map((c, i) => `${c} = $${i + 2}${Array.isArray(campos[c]) ? '::text[]' : ''}`)
    .join(', ')
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
