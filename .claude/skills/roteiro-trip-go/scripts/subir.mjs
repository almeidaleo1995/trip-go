#!/usr/bin/env node
// Sobe a viagem montada aqui direto para o app. Nao escreve arquivo nenhum.
//
//   # viagem nova (cria e devolve o link)
//   node --env-file=.env.local <este script> viagem.json --nova --conta voce@exemplo.com
//
//   # somar numa viagem que JA existe (roteiro novo, voo novo, checklist novo)
//   node --env-file=.env.local <este script> viagem.json --viagem <tripId> --conta voce@exemplo.com
//
//   # ver o que aconteceria, sem gravar nada
//   node --env-file=.env.local <este script> viagem.json --viagem <tripId> --conta voce@… --conferir
//
// ESTE SCRIPT SO MEXE EM DADO. NUNCA EM CODIGO.
//
// Ele nao tem `writeFileSync`, nao cria arquivo, nao roda comando, nao toca em
// nada dentro de app/, lib/, components/, config/ ou db/. O que ele faz e ler um
// JSON e gravar LINHAS nas tabelas da viagem. `lib/skill.test.ts`, no projeto,
// falha se alguem acrescentar uma escrita de arquivo aqui — a regra e verificavel,
// nao uma promessa.
//
// E ELE NAO TEM PODER PROPRIO.
//
// Toda gravacao passa por `exigirViagem` + `autorizar` + `aplicar` de lib/, com o
// `Acesso` da conta que voce informou em `--conta`. Ou seja: a skill nao consegue
// fazer nada que essa pessoa ja nao pudesse fazer pela tela. Um `visualizador`
// recebe 403 aqui do mesmo jeito que receberia no navegador. O caminho e o MESMO
// de /api/mutate; o que muda e so quem chama.
//
// TUDO FICA MARCADO E DESFAZIVEL.
//
// Cada carga recebe um `lote` e grava `origem = 'skill'` no `change_log`. O numero
// do lote sai no fim, e `desfazer.mjs` reverte a carga inteira. Escrever numa
// viagem em uso sem deixar como voltar seria irresponsavel.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { carregar } from './projeto.mjs'

const { validarImportacao, resumirImportacao } = await carregar('lib', 'schema.ts')

// ---------------------------------------------------------------- argumentos

const argv = process.argv.slice(2)
const opcoes = {}
let arquivo
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const nome = argv[i].slice(2)
    // Sinalizador (--nova, --conferir) nao consome o proximo token.
    const proximo = argv[i + 1]
    opcoes[nome] = proximo && !proximo.startsWith('--') ? argv[++i] : true
  } else if (!arquivo) {
    arquivo = argv[i]
  }
}

const conta = typeof opcoes.conta === 'string' ? opcoes.conta.toLowerCase() : null
const alvo = typeof opcoes.viagem === 'string' ? opcoes.viagem : null
const nova = opcoes.nova === true
const conferir = opcoes.conferir === true
const forcar = opcoes.forcar === true
const comParticipantes = opcoes['com-participantes'] === true

function uso(msg) {
  console.error(`${msg}\n`)
  console.error('uso: subir.mjs <arquivo.json> --conta <email> (--nova | --viagem <tripId>)')
  console.error('     --conferir            mostra o que faria, sem gravar')
  console.error('     --forcar              grava mesmo o que parece ja existir')
  console.error('     --com-participantes   tambem cria participantes (pede papel proprietario)')
  process.exit(2)
}

if (!arquivo) uso('falta o arquivo JSON.')
if (!conta) uso('falta --conta <email>: e a conta em nome de quem a escrita acontece.')
if (nova === Boolean(alvo)) uso('escolha UM: --nova (cria viagem) ou --viagem <tripId> (soma na existente).')
if (!process.env.DATABASE_URL) uso('DATABASE_URL nao definida. Rode com: node --env-file=.env.local ...')

// ---------------------------------------------------------------- o arquivo

let bruto
try {
  bruto = JSON.parse(readFileSync(arquivo, 'utf8'))
} catch (e) {
  console.error(`JSON invalido em ${arquivo}: ${e.message}`)
  process.exit(1)
}

// A MESMA validacao de POST /api/import. O que o zod recusa aqui, recusaria la —
// e e melhor descobrir agora do que com meia viagem gravada.
const r = validarImportacao(bruto)
if (!r.sucesso) {
  console.error(`O arquivo nao passa no contrato do app:\n  ${r.erro}`)
  process.exit(1)
}
const dados = r.dados

const { sql } = await carregar('lib', 'db.ts')

const [usuario] = await sql`select id, nome from users where email = ${conta}`
if (!usuario) {
  console.error(`Nao existe conta com o e-mail ${conta}. Cadastre-se em /register primeiro.`)
  process.exit(1)
}

// ---------------------------------------------------------------- viagem nova

if (nova) {
  const resumo = resumirImportacao(dados)
  if (conferir) {
    console.log(`Criaria a viagem "${dados.viagem.nome}" para ${usuario.nome} (${conta}):`)
    for (const [secao, n] of Object.entries(resumo)) if (n > 0) console.log(`  ${secao.padEnd(16)} ${n}`)
    console.log('\n(--conferir: nada foi gravado)')
    process.exit(0)
  }
  // O MESMO importador de POST /api/import. Uma gravadora so: duplicar o
  // mapeamento aqui seria a copia que envelhece primeiro.
  const { importarViagem } = await carregar('lib', 'importar.ts')
  const { tripId } = await importarViagem(dados, usuario.id)
  console.log(`Viagem criada: ${dados.viagem.nome}`)
  for (const [secao, n] of Object.entries(resumo)) if (n > 0) console.log(`  ${secao.padEnd(16)} ${n}`)
  console.log(`\nAbra em /viagens/${tripId}`)
  process.exit(0)
}

// ---------------------------------------------------------------- viagem existente
//
// Aqui a escrita e OP A OP, pelo caminho autorizado. `importarViagem` nao serve:
// ele comeca com `randomUUID()` e cria uma viagem — somar numa existente e outro
// problema, e a diferenca entre os dois ja custou uma viagem duplicada pela metade.

const { exigirViagem } = await carregar('lib', 'auth.ts')
const { autorizar, aplicar } = await carregar('lib', 'escrita.ts')

let acesso
try {
  // O papel e conferido de verdade, contra a tabela `travelers`. Um visualizador
  // para aqui, com a mesma mensagem que veria no app.
  acesso = await exigirViagem(usuario.id, alvo, 'editor')
} catch (e) {
  console.error(`${conta} nao pode escrever nesta viagem: ${e.message}`)
  process.exit(1)
}

const viagem = (await sql`select nome from trips where id = ${alvo}`)[0]

// O de-para da viagem que JA existe. O arquivo cita tudo por nome; a viagem
// guarda ids. Nome que nao bate vira null e o vinculo simplesmente nao entra —
// nunca um id inventado, que seria uma FK apontando para outra viagem.
const mapa = async (consulta, chave) =>
  new Map((await consulta).map((l) => [String(l[chave]), String(l.id)]))

const idPorParticipante = await mapa(
  sql`select id, nome from travelers where trip_id = ${alvo}`, 'nome')
const idPorCategoria = await mapa(
  sql`select id, nome from expense_categories where trip_id = ${alvo}`, 'nome')
const idPorReserva = await mapa(
  sql`select id, nome from reservations where trip_id = ${alvo}`, 'nome')
const idPorDocumento = await mapa(
  sql`select id, titulo from documents where trip_id = ${alvo}`, 'titulo')
const idPorRequisito = await mapa(
  sql`select id, nome from document_requirements where trip_id = ${alvo}`, 'nome')

const nomes = (lista) => (lista ?? []).map((n) => idPorParticipante.get(n)).filter(Boolean)

// ---------------------------------------------------------------- o que ja esta la
//
// Somar numa viagem em uso pede a pergunta que a importacao nunca precisa fazer:
// isto ja existe? Sem ela, rodar o mesmo arquivo duas vezes dobra o roteiro. A
// chave de cada secao e o que uma PESSOA usaria para dizer "e o mesmo item".
const CHAVE = {
  roteiro: (e) => `${String(e.ocorre_em).slice(0, 16)}|${e.titulo}`,
  dias: (d) => String(d.dia),
  voos: (v) => `${v.companhia}|${v.numero ?? ''}|${String(v.parte_em ?? '').slice(0, 16)}`,
  cruzeiros: (c) => `${c.navio}|${String(c.embarque_em ?? '').slice(0, 16)}`,
  reservas: (x) => `${x.nome}|${String(x.inicio_em ?? '').slice(0, 16)}`,
  lugares: (l) => String(l.cidade),
  checklist: (c) => String(c.titulo),
  documentos: (d) => String(d.titulo),
  requisitos: (q) => String(q.nome),
  emergencia: (e) => String(e.titulo),
  categorias: (c) => String(c.nome),
  custos: (c) => `${c.descricao}|${c.valor_centavos}`,
}

const existentes = {
  roteiro: new Set((await sql`
    select to_char(ocorre_em, 'YYYY-MM-DD"T"HH24:MI') as q, titulo
      from itinerary_events where trip_id = ${alvo}`).map((l) => `${l.q}|${l.titulo}`)),
  dias: new Set((await sql`
    select to_char(dia, 'YYYY-MM-DD') as d from itinerary_days where trip_id = ${alvo}`)
    .map((l) => l.d)),
  voos: new Set((await sql`
    select companhia, numero, to_char(parte_em, 'YYYY-MM-DD"T"HH24:MI') as q
      from flights where trip_id = ${alvo}`)
    .map((l) => `${l.companhia}|${l.numero ?? ''}|${l.q ?? ''}`)),
  cruzeiros: new Set((await sql`
    select navio, to_char(embarque_em, 'YYYY-MM-DD"T"HH24:MI') as q
      from cruises where trip_id = ${alvo}`).map((l) => `${l.navio}|${l.q ?? ''}`)),
  reservas: new Set((await sql`
    select nome, to_char(inicio_em, 'YYYY-MM-DD"T"HH24:MI') as q
      from reservations where trip_id = ${alvo}`).map((l) => `${l.nome}|${l.q ?? ''}`)),
  lugares: new Set((await sql`select cidade from places where trip_id = ${alvo}`)
    .map((l) => l.cidade)),
  checklist: new Set((await sql`select titulo from checklist_items where trip_id = ${alvo}`)
    .map((l) => l.titulo)),
  documentos: new Set([...idPorDocumento.keys()]),
  requisitos: new Set([...idPorRequisito.keys()]),
  emergencia: new Set((await sql`select titulo from emergency_contacts where trip_id = ${alvo}`)
    .map((l) => l.titulo)),
  categorias: new Set([...idPorCategoria.keys()]),
  custos: new Set((await sql`select descricao, valor_centavos from expenses where trip_id = ${alvo}`)
    .map((l) => `${l.descricao}|${l.valor_centavos}`)),
}

// ---------------------------------------------------------------- as operacoes
//
// Ordem de dependencia: o que e citado vem antes de quem cita. Categoria antes da
// despesa, reserva antes do roteiro que aponta para ela, requisito antes da
// entrega. `importarViagem` grava nesta mesma ordem, e pela mesma razao.
const ops = []
const pulados = []
const avisos = []
const agora = new Date().toISOString()

/** Registra uma criacao, ou anota que ela ja existe. */
function criar(secao, entidade, item, campos, id = randomUUID()) {
  const chave = CHAVE[secao]?.(item)
  if (!forcar && chave !== undefined && existentes[secao]?.has(chave)) {
    pulados.push(`${secao}: "${chave.split('|')[0]}" ja esta na viagem`)
    return null
  }
  if (chave !== undefined) existentes[secao]?.add(chave)
  ops.push({ secao, op: { op: 'criar', entidade, id, campos, client_ts: agora } })
  return id
}

const limpo = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

if (comParticipantes) {
  for (const p of dados.participantes) {
    if (idPorParticipante.has(p.nome)) { pulados.push(`participantes: "${p.nome}" ja esta na viagem`); continue }
    const id = criar('participantes', 'participante', p, limpo({
      nome: p.nome, email: p.email ?? undefined, papel: p.papel,
      telefone: p.telefone ?? undefined, nascimento: p.nascimento ?? undefined, ordem: p.ordem,
    }))
    // Entra no de-para na hora: uma despesa do mesmo arquivo pode cita-lo.
    if (id) idPorParticipante.set(p.nome, id)
  }
} else if (dados.participantes.length > 0) {
  avisos.push(
    `${dados.participantes.length} participante(s) no arquivo NAO foram gravados. Nome de ` +
      'participante e chave de dinheiro e de documento pessoal — use --com-participantes ' +
      'so depois de conferir a grafia com quem organiza.',
  )
}

for (const c of dados.categorias) {
  const id = criar('categorias', 'categoria', c, { nome: c.nome, ordem: c.ordem })
  if (id) idPorCategoria.set(c.nome, id)
}

for (const x of dados.reservas) {
  const id = criar('reservas', 'reserva', x, limpo({
    tipo: x.tipo, nome: x.nome, cidade: x.cidade ?? undefined,
    inicio_em: x.inicio_em ?? undefined, fim_em: x.fim_em ?? undefined,
    endereco: x.endereco ?? undefined, link: x.link ?? undefined,
    telefone: x.telefone ?? undefined, localizador: x.localizador ?? undefined,
    valor_centavos: x.valor_centavos ?? undefined, nota: x.nota ?? undefined, ordem: x.ordem,
  }))
  if (id) idPorReserva.set(x.nome, id)
}

for (const l of dados.lugares) {
  criar('lugares', 'lugar', l, limpo({
    cidade: l.cidade, pais: l.pais ?? undefined, dias: l.dias ?? undefined, status: l.status,
    chega_em: l.chega_em ?? undefined, sai_em: l.sai_em ?? undefined,
    notas: l.notas ?? undefined, lat: l.lat ?? undefined, lon: l.lon ?? undefined, ordem: l.ordem,
  }))
}

for (const v of dados.voos) {
  const id = criar('voos', 'voo', v, limpo({
    companhia: v.companhia, numero: v.numero ?? undefined,
    origem_iata: v.origem_iata ?? undefined, origem_cidade: v.origem_cidade ?? undefined,
    destino_iata: v.destino_iata ?? undefined, destino_cidade: v.destino_cidade ?? undefined,
    parte_em: v.parte_em ?? undefined, chega_em: v.chega_em ?? undefined,
    duracao_min: v.duracao_min ?? undefined, localizador: v.localizador ?? undefined,
    terminal: v.terminal ?? undefined, portao: v.portao ?? undefined,
    assento: v.assento ?? undefined, bagagem: v.bagagem ?? undefined,
    nota: v.nota ?? undefined, ordem: v.ordem,
  }))
  if (!id) continue
  for (const e of v.escalas) {
    ops.push({ secao: 'escalas', op: { op: 'criar', entidade: 'escala', id: randomUUID(),
      campos: limpo({ flight_id: id, iata: e.iata ?? undefined, cidade: e.cidade ?? undefined,
        espera_min: e.espera_min ?? undefined, ordem: e.ordem }), client_ts: agora } })
  }
}

for (const c of dados.cruzeiros) {
  const id = criar('cruzeiros', 'cruzeiro', c, limpo({
    navio: c.navio, companhia: c.companhia ?? undefined,
    embarque_em: c.embarque_em ?? undefined, desembarque_em: c.desembarque_em ?? undefined,
    porto_embarque: c.porto_embarque ?? undefined, porto_desembarque: c.porto_desembarque ?? undefined,
    cabine: c.cabine ?? undefined, localizador: c.localizador ?? undefined,
    terminal: c.terminal ?? undefined, nota: c.nota ?? undefined,
  }))
  if (!id) continue
  for (const p of c.portos) {
    ops.push({ secao: 'portos', op: { op: 'criar', entidade: 'porto', id: randomUUID(),
      campos: limpo({ cruise_id: id, porto: p.porto ?? undefined, cidade: p.cidade ?? undefined,
        pais: p.pais ?? undefined, chega_em: p.chega_em ?? undefined, sai_em: p.sai_em ?? undefined,
        dia_no_mar: p.dia_no_mar, ordem: p.ordem, nota: p.nota ?? undefined }), client_ts: agora } })
  }
}

for (const d of dados.documentos) {
  const dono = d.dono_nome ? idPorParticipante.get(d.dono_nome) : null
  // Mesma regra de lib/importar.ts: pessoal sem dono cairia na constraint
  // `documento_pessoal_tem_dono`. Rebaixar e o unico caminho que nao derruba a
  // carga inteira — e aparece no relatorio, porque muda quem VE o documento.
  const escopo = d.escopo === 'pessoal' && dono ? 'pessoal' : 'global'
  if (d.escopo === 'pessoal' && !dono) {
    avisos.push(`documento "${d.titulo}" era pessoal e entrou como GLOBAL: dono_nome ` +
      `${d.dono_nome ? `"${d.dono_nome}" nao esta na viagem` : 'ausente'}. A viagem inteira ve.`)
  }
  const id = criar('documentos', 'documento', d, limpo({
    titulo: d.titulo, valor: d.valor ?? undefined, tipo: d.tipo,
    categoria: d.categoria ?? undefined, obs: d.obs ?? undefined, ordem: d.ordem,
    escopo, traveler_id: dono ?? undefined,
    assigned_to: nomes(d.assigned_to_nomes), tags: d.tags,
    importante: d.importante, offline: d.offline,
    validade: d.validade ?? undefined, pais: d.pais ?? undefined,
    cidade: d.cidade ?? undefined, dia: d.dia ?? undefined,
    reservation_id: d.reserva ? (idPorReserva.get(d.reserva) ?? undefined) : undefined,
  }))
  if (id) idPorDocumento.set(d.titulo, id)
}

for (const q of dados.requisitos) {
  const alvos = nomes(q.assigned_to_nomes)
  const paraTodos = q.aplica_todos !== false || alvos.length === 0
  const id = criar('requisitos', 'requisito', q, limpo({
    nome: q.nome, descricao: q.descricao ?? undefined, categoria: q.categoria ?? undefined,
    obrigatorio: q.obrigatorio, aplica_todos: paraTodos, assigned_to: paraTodos ? [] : alvos,
    exige_numero: q.exige_numero, exige_validade: q.exige_validade, exige_arquivo: q.exige_arquivo,
    campo_perfil: q.campo_perfil ?? undefined, prazo: q.prazo ?? undefined,
    obs: q.obs ?? undefined, ordem: q.ordem,
  }))
  if (id) idPorRequisito.set(q.nome, id)
}

for (const e of dados.entregas) {
  const requisito = e.requisito_nome ? idPorRequisito.get(e.requisito_nome) : null
  const dono = e.dono_nome ? idPorParticipante.get(e.dono_nome) : null
  // Entrega sem requisito ou sem pessoa nao e meia entrega: e entrega de ninguem,
  // e as duas colunas sao `not null`. lib/importar.ts descarta em silencio; aqui
  // o descarte APARECE, que e a diferenca de escrever numa viagem em uso.
  if (!requisito || !dono) {
    avisos.push(`entrega de "${e.dono_nome ?? '?'}" para "${e.requisito_nome ?? '?'}" ` +
      'descartada: requisito ou pessoa nao existe nesta viagem.')
    continue
  }
  ops.push({ secao: 'entregas', op: { op: 'criar', entidade: 'entrega', id: randomUUID(),
    campos: limpo({ requirement_id: requisito, traveler_id: dono,
      numero: e.numero ?? undefined, validade: e.validade ?? undefined,
      emitido_em: e.emitido_em ?? undefined, status: e.status,
      comentario: e.comentario ?? undefined }), client_ts: agora } })
}

for (const e of dados.roteiro) {
  const id = criar('roteiro', 'roteiro', e, limpo({
    ocorre_em: e.ocorre_em, fim_em: e.fim_em ?? undefined, cidade: e.cidade ?? undefined,
    local: e.local ?? undefined, endereco: e.endereco ?? undefined,
    lat: e.lat ?? undefined, lon: e.lon ?? undefined, titulo: e.titulo,
    descricao: e.descricao ?? undefined, tipo: e.tipo, ancora: e.ancora,
    distancia_m: e.distancia_m ?? undefined, duracao_min: e.duracao_min ?? undefined,
    transporte: e.transporte ?? undefined, como_chegar: e.como_chegar ?? undefined,
    dicas: e.dicas ?? undefined, links: e.links ?? undefined,
    custo_centavos: e.custo_centavos ?? undefined,
    reserva_id: e.reserva ? (idPorReserva.get(e.reserva) ?? undefined) : undefined,
    documento_id: e.documento ? (idPorDocumento.get(e.documento) ?? undefined) : undefined,
    nota: e.nota ?? undefined, ordem: e.ordem,
  }))
  if (!id) continue
  for (const o of e.opcoes) {
    ops.push({ secao: 'opcoes', op: { op: 'criar', entidade: 'opcao', id: randomUUID(),
      campos: limpo({ event_id: id, modo: o.modo, duracao_min: o.duracao_min ?? undefined,
        distancia_m: o.distancia_m ?? undefined, custo: o.custo ?? undefined,
        detalhe: o.detalhe ?? undefined, recomendado: o.recomendado, ordem: o.ordem }),
      client_ts: agora } })
  }
}

for (const d of dados.dias) {
  criar('dias', 'dia', d, limpo({
    dia: d.dia, titulo: d.titulo ?? undefined, cidade: d.cidade ?? undefined,
    pais: d.pais ?? undefined, resumo: d.resumo ?? undefined, ancora: d.ancora,
    alertas: d.alertas ?? undefined, antes_sair: d.antes_sair ?? undefined,
    antes_dormir: d.antes_dormir ?? undefined, links: d.links ?? undefined,
    mapa_url: d.mapa_url ?? undefined,
  }))
}

for (const c of dados.checklist) {
  criar('checklist', 'checklist_item', c, limpo({
    titulo: c.titulo, categoria: c.categoria ?? undefined, escopo: c.escopo,
    prazo_ideal: c.prazo_ideal ?? undefined, prazo_maximo: c.prazo_maximo ?? undefined,
    valor_estimado_centavos: c.valor_estimado_centavos ?? undefined,
    detalhe: c.detalhe ?? undefined, ordem: c.ordem,
    assigned_to: nomes(c.assigned_to_nomes), prioridade: c.prioridade,
    pais: c.pais ?? undefined, cidade: c.cidade ?? undefined, pendente: c.pendente,
    fonte_tipo: c.fonte_tipo ?? undefined, fonte_detalhe: c.fonte_detalhe ?? undefined,
    fonte_consultado_em: c.fonte_consultado_em ?? undefined,
  }))
}

for (const e of dados.emergencia) {
  criar('emergencia', 'emergencia', e, limpo({
    titulo: e.titulo, telefone: e.telefone ?? undefined,
    detalhe: e.detalhe ?? undefined, ordem: e.ordem,
  }))
}

for (const c of dados.custos) {
  const divisoes = c.divisoes
    .map((d) => ({ traveler_id: idPorParticipante.get(d.participante), peso: d.peso, valor_centavos: d.valor_centavos }))
    .filter((d) => d.traveler_id)
  if (divisoes.length < c.divisoes.length) {
    avisos.push(`despesa "${c.descricao}": ${c.divisoes.length - divisoes.length} pessoa(s) da ` +
      'divisao nao estao nesta viagem e ficaram de fora do rateio.')
  }
  if (c.pagador && !idPorParticipante.has(c.pagador)) {
    avisos.push(`despesa "${c.descricao}": pagador "${c.pagador}" nao esta nesta viagem; ` +
      'entrou como despesa SEM pagador.')
  }
  // As parcelas nao chegam prontas, de proposito: quem calcula valor de parcela e
  // o servidor (`gerarParcelas`), a partir do total, da quantidade e da primeira
  // data. E a mesma regra da tela — o cliente manda a INTENCAO. Consequencia
  // honesta: valor irregular entre parcelas e "ja pago" nao sobem por aqui.
  const parcelas = c.parcelas ?? []
  if (parcelas.some((p) => p.pago_centavos > 0)) {
    avisos.push(`despesa "${c.descricao}": parcela ja paga entra como EM ABERTO. ` +
      'Marque o pagamento na aba Financeiro.')
  }
  criar('custos', 'custo', c, limpo({
    descricao: c.descricao, valor_centavos: c.valor_centavos,
    categoria_id: c.categoria ? (idPorCategoria.get(c.categoria) ?? undefined) : undefined,
    traveler_id: c.pagador ? (idPorParticipante.get(c.pagador) ?? undefined) : undefined,
    moeda: c.moeda ?? undefined, ocorre_em: c.ocorre_em ?? undefined,
    divisao: c.divisao, estimado: c.estimado, nota: c.nota ?? undefined, ordem: c.ordem,
    divisoes,
    parcelas_quantidade: parcelas.length > 0 ? parcelas.length : 1,
    parcelas_primeira_em: parcelas[0]?.vence_em ?? c.ocorre_em ?? undefined,
  }))
}

if (dados.pagamentos.length > 0) {
  // O reembolso aponta para uma PARCELA, e a parcela so ganha id depois que a
  // despesa e gravada. Religar isso exigiria uma segunda passada no banco; ate
  // que alguem precise, e mais honesto dizer que nao sobe do que subir errado.
  avisos.push(`${dados.pagamentos.length} reembolso(s) nao sobem por este caminho ` +
    '(apontam para uma parcela que so existe depois de gravada). Lance-os na aba Financeiro.')
}

// ---------------------------------------------------------------- gravar

const porSecao = {}
for (const { secao } of ops) porSecao[secao] = (porSecao[secao] ?? 0) + 1

console.log(`Viagem: ${viagem?.nome ?? alvo}`)
console.log(`Conta:  ${usuario.nome} <${conta}>  (papel ${acesso.papel})\n`)

if (ops.length === 0) {
  console.log('Nada novo para gravar.')
} else {
  console.log(conferir ? 'Gravaria:' : 'Gravando:')
  for (const [secao, n] of Object.entries(porSecao)) console.log(`  ${secao.padEnd(16)} ${n}`)
}

if (pulados.length > 0) {
  console.log(`\nJa existia (pulado; use --forcar para inserir assim mesmo):`)
  for (const p of pulados) console.log(`  - ${p}`)
}
if (avisos.length > 0) {
  console.log('\nAvisos:')
  for (const a of avisos) console.log(`  ! ${a}`)
}

if (conferir) {
  console.log('\n(--conferir: nada foi gravado)')
  process.exit(0)
}
if (ops.length === 0) process.exit(0)

// O lote e o que torna esta carga desfazivel. Sem ele, voltar atras seria linha
// por linha, na mao, numa viagem que outras pessoas ja estao usando.
const lote = randomUUID()
const marca = { origem: 'skill', lote }
let gravadas = 0
const recusadas = []

for (const { secao, op } of ops) {
  try {
    // A MESMA porta de /api/mutate: autorizar decide se esta conta pode, aplicar
    // valida os campos e grava. A skill nao tem caminho proprio para o banco.
    await autorizar(acesso, op.entidade, op.op, op.campos, op.id)
    const ok = await aplicar(acesso, op, marca)
    if (ok) gravadas++
    else recusadas.push(`${secao}: descartada pelo last-write-wins`)
  } catch (e) {
    recusadas.push(`${secao} (${op.campos.titulo ?? op.campos.nome ?? op.campos.descricao ?? op.entidade}): ${e.message}`)
  }
}

console.log(`\n${gravadas} linha(s) gravada(s).`)
if (recusadas.length > 0) {
  console.log(`${recusadas.length} recusada(s):`)
  for (const m of recusadas) console.log(`  x ${m}`)
}
console.log(`\nLote: ${lote}`)
console.log(`Para desfazer esta carga inteira:`)
console.log(`  node --env-file=.env.local .claude/skills/roteiro-trip-go/scripts/desfazer.mjs \\`)
console.log(`    ${lote} --conta ${conta}`)
console.log(`\nAbra em /viagens/${alvo}`)
