// Acesso ao Neon e montagem do snapshot.
//
// Regra que rege este arquivo: o cliente nunca fala com o Postgres. A connection
// string vive so aqui, no servidor. O navegador conhece apenas /api/*.
//
// Leitura e por snapshot inteiro DE UMA VIAGEM, nao recurso a recurso: uma viagem
// cheia da algumas dezenas de KB, e buscar tudo de uma vez elimina N+1, deixa o
// cache offline trivial e dispensa gerenciar estado por endpoint. Trocar de viagem
// troca o snapshot; a conta pode ter quantas viagens quiser.
import { neon } from '@neondatabase/serverless'
import { papelAlcanca, type Papel } from '../config/navigation.ts'
import { resumoPessoal, type ResumoPessoal } from './financeiro.ts'

function conectar() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL nao definida - veja .env.example')
  return neon(url)
}

export const sql = conectar()

export type Usuario = {
  id: string
  nome: string
  email: string
  avatar_url: string | null
  telefone: string | null
  moeda_preferida: string
  notificacoes: boolean
}

export type ViagemResumo = {
  id: string
  nome: string
  subtitulo: string | null
  descricao: string | null
  data_partida: string
  data_retorno: string
  moeda: string
  cor_destaque: string
  capa_url: string | null
  arquivada: boolean
  papel: Papel
  participantes: number
  /** Contagens reais da viagem. A tela de Inicio nao inventa numero nenhum. */
  cidades: number
  paises: number
  compromissos: number
  reservas: number
  tarefas: number
  /** Itens do checklist que ESTA conta marcou. Base da barra de preparacao. */
  tarefas_feitas: number
  /** Ultima alteracao registrada na viagem, para "atualizada ontem". */
  atualizada_em: string
  /** Cidades e paises concatenados. Existe so para a busca de Minhas viagens
      encontrar "Roma" numa viagem chamada "Europa 2027". Nao vai para a tela. */
  destinos: string | null
}

/**
 * O financeiro de quem administra a viagem: tudo, linha por linha.
 *
 * `divisoes` diz quem arca com cada despesa, `parcelas` quando o dinheiro sai e
 * `pagamentos` quem ja reembolsou quem. Saldo e acerto sao calculados a partir
 * disto, nunca gravados.
 */
export type FinanceiroAdmin = {
  admin: true
  categorias: Record<string, unknown>[]
  despesas: Record<string, unknown>[]
  divisoes: Record<string, unknown>[]
  parcelas: Record<string, unknown>[]
  pagamentos: Record<string, unknown>[]
}

/**
 * O financeiro de um viajante comum: SO as obrigacoes dele.
 *
 * Nao e o pacote do admin filtrado no cliente — e uma resposta diferente. O
 * total da viagem, o orcamento, a despesa de que ele nao participa e o valor
 * cheio de uma parcela (que revelaria o total do grupo) nao existem neste
 * objeto, entao nao existem na rede.
 */
export type FinanceiroPessoal = { admin: false } & ResumoPessoal

export type Snapshot = {
  viagem: Record<string, unknown> | null
  participantes: Record<string, unknown>[]
  roteiro: Record<string, unknown>[]
  /** Só os dias com anotação. A lista de dias vem das datas da viagem. */
  dias: Record<string, unknown>[]
  voos: Record<string, unknown>[]
  cruzeiros: Record<string, unknown>[]
  reservas: Record<string, unknown>[]
  lugares: Record<string, unknown>[]
  checklist: Record<string, unknown>[]
  checklist_state: Record<string, unknown>[]
  documentos: Record<string, unknown>[]
  emergencia: Record<string, unknown>[]
  mensagens: Record<string, unknown>[]
  alteracoes: Record<string, unknown>[]
  /** Conteudo decidido pelo papel — veja `financeiroDaViagem`. */
  financeiro: FinanceiroAdmin | FinanceiroPessoal
  server_time: string
}

// ---------------------------------------------------------------- contas

/** Uso interno do login e da troca de senha: precisa do hash. Nunca vai na resposta. */
export async function usuarioPorEmail(email: string) {
  const r = await sql`
    select id, nome, email, senha_hash, avatar_url, telefone, moeda_preferida, notificacoes
    from users where email = ${email}
  `
  return (r[0] as (Usuario & { senha_hash: string }) | undefined) ?? null
}

/** Idem, por id. Existe separada de `usuarioPorId` para que o hash só saia
    do banco onde ele é de fato necessário — trocar senha, e nada mais. */
export async function hashDoUsuario(id: string): Promise<string | null> {
  const r = await sql`select senha_hash from users where id = ${id}`
  return (r[0] as { senha_hash: string } | undefined)?.senha_hash ?? null
}

export async function usuarioPorId(id: string): Promise<Usuario | null> {
  const r = await sql`
    select id, nome, email, avatar_url, telefone, moeda_preferida, notificacoes
    from users where id = ${id}
  `
  return (r[0] as Usuario | undefined) ?? null
}

/**
 * Cria a conta. Devolve null quando o e-mail ja existe.
 *
 * A checagem e o `on conflict`, nao um select antes: entre o select e o insert
 * cabe outro cadastro com o mesmo e-mail. O unique do banco e a unica garantia.
 */
export async function criarUsuario(
  nome: string,
  email: string,
  senhaHash: string,
): Promise<Usuario | null> {
  const r = await sql`
    insert into users (nome, email, senha_hash) values (${nome}, ${email}, ${senhaHash})
    on conflict (email) do nothing
    returning id, nome, email, avatar_url, telefone, moeda_preferida, notificacoes
  `
  return (r[0] as Usuario | undefined) ?? null
}

export async function trocarSenha(userId: string, senhaHash: string) {
  await sql`update users set senha_hash = ${senhaHash}, updated_at = now() where id = ${userId}`
}

/**
 * Grava o perfil e devolve o registro já atualizado — quem chamou não precisa
 * de um segundo select para pintar a tela com o que acabou de salvar.
 *
 * O e-mail NÃO está aqui de propósito: ele identifica a conta no login e liga
 * participantes convidados; trocá-lo é outra operação, com sua própria checagem
 * de unicidade e de senha.
 */
export async function atualizarPerfil(
  userId: string,
  dados: {
    nome: string
    avatar_url: string | null
    telefone: string | null
    moeda_preferida: string
    notificacoes: boolean
  },
): Promise<Usuario | null> {
  const r = await sql`
    update users set
      nome = ${dados.nome},
      avatar_url = ${dados.avatar_url},
      telefone = ${dados.telefone},
      moeda_preferida = ${dados.moeda_preferida},
      notificacoes = ${dados.notificacoes},
      updated_at = now()
    where id = ${userId}
    returning id, nome, email, avatar_url, telefone, moeda_preferida, notificacoes
  `
  return (r[0] as Usuario | undefined) ?? null
}

/**
 * Liga a conta recém-criada a participantes que já existiam só como nome (o
 * dono cadastrou "Leonardo" antes de Leonardo ter conta). Sem isto, quem se
 * cadastra com o mesmo e-mail de um convite fica de fora até alguém reabrir e
 * salvar aquele participante de novo pela tela.
 */
export async function vincularParticipantesPorEmail(userId: string, email: string) {
  await sql`update travelers set user_id = ${userId} where email = ${email} and user_id is null`
}

// ---------------------------------------------------------------- viagens da conta

/**
 * Papel da conta nesta viagem, ou null se ela nao participa.
 *
 * Esta funcao e a barreira de acesso entre contas. Toda leitura e toda escrita
 * passa por aqui antes de tocar em dado de viagem - sem ela, trocar o id na URL
 * daria acesso a viagem de qualquer pessoa.
 */
export async function papelNaViagem(userId: string, tripId: string): Promise<Papel | null> {
  const r = await sql`
    select papel from travelers where trip_id = ${tripId} and user_id = ${userId} limit 1
  `
  return ((r[0] as { papel: Papel } | undefined)?.papel as Papel) ?? null
}

/** O registro de participante da conta nesta viagem. Base do checklist pessoal. */
export async function participanteDoUsuario(userId: string, tripId: string) {
  const r = await sql`
    select id, papel from travelers where trip_id = ${tripId} and user_id = ${userId} limit 1
  `
  return (r[0] as { id: string; papel: Papel } | undefined) ?? null
}

/**
 * As viagens da conta, ja com os numeros que a tela de Inicio mostra.
 *
 * As contagens vem em subselect na MESMA consulta de proposito: a alternativa e
 * o cliente pedir o snapshot inteiro de cada viagem so para contar cidades, o
 * que traz megabytes para imprimir cinco numeros. Uma conta tem um punhado de
 * viagens, entao o custo dos subselects e irrelevante perto disso.
 *
 * `cidades` conta o par (cidade, pais) e nao so a cidade — duas Santiagos em
 * paises diferentes sao dois lugares. Mesma regra de `contarLugares` em derive.ts.
 */
export async function viagensDoUsuario(userId: string): Promise<ViagemResumo[]> {
  const r = await sql`
    select t.*, eu.papel,
           (select count(*)::int from travelers x where x.trip_id = t.id) as participantes,
           (select count(distinct (lower(l.cidade), lower(coalesce(l.pais, ''))))::int
              from places l where l.trip_id = t.id and l.cidade <> '') as cidades,
           (select count(distinct lower(l.pais))::int
              from places l where l.trip_id = t.id and coalesce(l.pais, '') <> '') as paises,
           (select count(*)::int from itinerary_events e where e.trip_id = t.id) as compromissos,
           (select count(*)::int from reservations rv where rv.trip_id = t.id) as reservas,
           (select count(*)::int from checklist_items c where c.trip_id = t.id) as tarefas,
           (select count(*)::int from checklist_items c
              join checklist_state s on s.item_id = c.id and s.traveler_id = eu.id
              where c.trip_id = t.id and s.feito) as tarefas_feitas,
           (select string_agg(distinct l.cidade || ' ' || coalesce(l.pais, ''), ' ')
              from places l where l.trip_id = t.id) as destinos,
           greatest(t.updated_at,
                    coalesce((select max(g.criado_em) from change_log g where g.trip_id = t.id),
                             t.updated_at)) as atualizada_em
    from trips t
    join travelers eu on eu.trip_id = t.id and eu.user_id = ${userId}
    order by t.arquivada, t.data_partida
  `
  return r as ViagemResumo[]
}

/**
 * A viagem que deve abrir: a preferida, se a conta ainda participa dela; senao a
 * proxima a acontecer. Nunca devolve viagem de outra conta.
 */
export async function viagemPadrao(userId: string, preferida?: string | null) {
  const viagens = await viagensDoUsuario(userId)
  const ativas = viagens.filter((v) => !v.arquivada)
  if (preferida) {
    const escolhida = viagens.find((v) => v.id === preferida)
    if (escolhida) return escolhida
  }
  const hoje = new Date().toISOString().slice(0, 10)
  return ativas.find((v) => v.data_retorno >= hoje) ?? ativas[0] ?? viagens[0] ?? null
}

// ---------------------------------------------------------------- snapshot

/**
 * Monta o snapshot de uma viagem conforme o papel.
 *
 * O financeiro nao e um bloco que se esconde: sao DUAS respostas diferentes,
 * escolhidas por `financeiroDaViagem`. Quem administra recebe as linhas todas;
 * um viajante comum recebe so as obrigacoes dele, e as despesas de que ele nao
 * participa nem chegam a sair do banco. Essa e a diferenca entre esconder na
 * interface e proteger de verdade.
 */
export async function getSnapshot(
  tripId: string,
  papel: Papel,
  participanteId: string,
): Promise<Snapshot> {
  const [
    viagem,
    participantes,
    roteiro,
    opcoes,
    dias,
    voos,
    escalas,
    cruzeiros,
    portos,
    reservas,
    lugares,
    checklist,
    estado,
    documentos,
    emergencia,
    mensagens,
    alteracoes,
  ] = await Promise.all([
    sql`select * from trips where id = ${tripId}`,
    sql`select p.id, p.trip_id, p.user_id, p.nome, p.email, p.papel, p.telefone,
               p.passaporte, p.ordem, p.updated_at, u.avatar_url
        from travelers p left join users u on u.id = p.user_id
        where p.trip_id = ${tripId} order by p.ordem, p.nome`,
    // `ocorre_em`/`fim_em` saem como TEXTO, não como Date — mesmo motivo do `dia`
    // do itinerary_days logo abaixo: `timestamp` sem fuso é lido pelo driver como
    // hora LOCAL DO SERVIDOR, e a serialização para JSON devolve UTC. Num servidor
    // rodando fora de UTC (qualquer dev fora de Greenwich) isso desloca a hora
    // exibida — e o roteiro é a aba que perde voo se a hora estiver errada. Mesma
    // correção do `dia`, extendida a toda coluna `timestamp` com hora do schema.
    sql`select id, trip_id, to_char(ocorre_em, 'YYYY-MM-DD"T"HH24:MI:SS') as ocorre_em,
               to_char(fim_em, 'YYYY-MM-DD"T"HH24:MI:SS') as fim_em,
               cidade, local, endereco, lat, lon, titulo, descricao, tipo, ancora,
               distancia_m, duracao_min, transporte, como_chegar, dicas, links,
               custo_centavos, reserva_id, documento_id, nota, ordem, updated_at
        from itinerary_events where trip_id = ${tripId} order by ocorre_em, ordem`,
    sql`select o.* from itinerary_options o
        join itinerary_events e on e.id = o.event_id
        where e.trip_id = ${tripId} order by o.ordem`,
    // `dia` sai como TEXTO, não como date.
    //
    // O driver materializa uma coluna `date` como Date na hora local do servidor,
    // e a serialização para JSON a converte para UTC — a leste de Greenwich isso
    // devolve o dia anterior, e o dia é a chave de agrupamento de toda a aba
    // Roteiro. Um to_char aqui é mais barato do que descobrir isso num fuso.
    sql`select id, trip_id, to_char(dia, 'YYYY-MM-DD') as dia, titulo, cidade, pais,
               resumo, ancora, alertas, antes_sair, antes_dormir, links, mapa_url, updated_at
        from itinerary_days where trip_id = ${tripId} order by dia`,
    sql`select id, trip_id, companhia, numero, origem_iata, origem_cidade, destino_iata,
               destino_cidade, to_char(parte_em, 'YYYY-MM-DD"T"HH24:MI:SS') as parte_em,
               to_char(chega_em, 'YYYY-MM-DD"T"HH24:MI:SS') as chega_em,
               duracao_min, localizador, terminal, portao, assento, bagagem, nota, ordem,
               updated_at
        from flights where trip_id = ${tripId} order by ordem, parte_em`,
    sql`select s.* from flight_stops s
        join flights f on f.id = s.flight_id
        where f.trip_id = ${tripId} order by s.ordem`,
    sql`select id, trip_id, navio, companhia,
               to_char(embarque_em, 'YYYY-MM-DD"T"HH24:MI:SS') as embarque_em,
               to_char(desembarque_em, 'YYYY-MM-DD"T"HH24:MI:SS') as desembarque_em,
               porto_embarque, porto_desembarque, cabine, localizador, terminal, nota, updated_at
        from cruises where trip_id = ${tripId}`,
    sql`select p.id, p.cruise_id, p.porto, p.cidade, p.pais,
               to_char(p.chega_em, 'YYYY-MM-DD"T"HH24:MI:SS') as chega_em,
               to_char(p.sai_em, 'YYYY-MM-DD"T"HH24:MI:SS') as sai_em,
               p.dia_no_mar, p.ordem, p.nota, p.updated_at
        from cruise_ports p
        join cruises c on c.id = p.cruise_id
        where c.trip_id = ${tripId} order by p.ordem`,
    sql`select id, trip_id, tipo, nome, cidade,
               to_char(inicio_em, 'YYYY-MM-DD"T"HH24:MI:SS') as inicio_em,
               to_char(fim_em, 'YYYY-MM-DD"T"HH24:MI:SS') as fim_em,
               endereco, link, telefone, localizador, valor_centavos, nota, ordem, updated_at
        from reservations where trip_id = ${tripId} order by inicio_em, ordem`,
    sql`select * from places where trip_id = ${tripId} order by ordem`,
    checklistDaViagem(tripId, papel, participanteId),
    sql`select e.* from checklist_state e
        join checklist_items i on i.id = e.item_id
        where i.trip_id = ${tripId}`,
    sql`select * from documents where trip_id = ${tripId} order by ordem`,
    sql`select * from emergency_contacts where trip_id = ${tripId} order by ordem`,
    sql`select m.*, u.nome as autor, u.avatar_url as autor_avatar from messages m
        left join users u on u.id = m.user_id
        where m.trip_id = ${tripId} order by m.criado_em desc limit 100`,
    sql`select l.*, t.nome as autor from change_log l
        left join travelers t on t.id = l.traveler_id
        where l.trip_id = ${tripId} order by l.criado_em desc limit 50`,
  ])

  // Aninha os filhos em uma passada, sem query por pai.
  const roteiroComOpcoes = roteiro.map((e) => ({
    ...e,
    opcoes: opcoes.filter((o) => o.event_id === e.id),
  }))
  const voosComEscalas = voos.map((v) => ({
    ...v,
    escalas: escalas.filter((e) => e.flight_id === v.id),
  }))
  const cruzeirosComPortos = cruzeiros.map((c) => ({
    ...c,
    portos: portos.filter((p) => p.cruise_id === c.id),
  }))

  const financeiro = await financeiroDaViagem(tripId, papel, participanteId, participantes)

  return {
    viagem: viagem[0] ?? null,
    participantes,
    roteiro: roteiroComOpcoes,
    dias,
    voos: voosComEscalas,
    cruzeiros: cruzeirosComPortos,
    reservas,
    lugares,
    checklist,
    checklist_state: estado,
    documentos,
    emergencia,
    mensagens: mensagens.reverse(),
    alteracoes,
    financeiro,
    server_time: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------- checklist

/**
 * O checklist que este papel pode ver — decidido na query, nao filtrado depois de
 * buscar (mesmo principio de `financeiroDaViagem`, adaptado: aqui a FORMA da linha
 * nao muda com o papel, so a contagem, entao uma query com WHERE condicional basta).
 *
 * `proprietario` ve tudo. `editor`/`visualizador` veem todo item `global` mais os
 * `pessoal` em que sao dono (CHK-01..04) — um item pessoal alheio nunca sai daqui.
 */
export async function checklistDaViagem(tripId: string, papel: Papel, participanteId: string) {
  if (papelAlcanca(papel, 'proprietario')) {
    return sql`select * from checklist_items where trip_id = ${tripId} order by ordem`
  }
  return sql`select * from checklist_items
      where trip_id = ${tripId}
        and (escopo = 'global' or ${participanteId} = any(assigned_to))
      order by ordem`
}

// ---------------------------------------------------------------- financeiro

/**
 * O financeiro que este papel pode ver. Duas consultas diferentes, nao uma
 * consulta com filtro na saida.
 *
 * Administrador (`editor` para cima) recebe as cinco listas cruas e faz as
 * contas na tela.
 *
 * Viajante comum (`visualizador`) recebe apenas as obrigacoes dele, ja
 * resolvidas. As proprias QUERIES ja o recortam: uma despesa em que ele nao
 * entra nao e lida do banco, e a linha de divisao de outra pessoa tambem nao. O
 * valor cheio da parcela e lido (para calcular a parte dele) mas nunca sai
 * daqui — `resumoPessoal` devolve so a fatia dele, entao o total do grupo nao
 * chega a existir na resposta.
 */
export async function financeiroDaViagem(
  tripId: string,
  papel: Papel,
  participanteId: string,
  participantes: Record<string, unknown>[],
): Promise<FinanceiroAdmin | FinanceiroPessoal> {
  if (papelAlcanca(papel, 'editor')) {
    const [categorias, despesas, divisoes, parcelas, pagamentos] = await Promise.all([
      sql`select * from expense_categories where trip_id = ${tripId} order by ordem, nome`,
      sql`select * from expenses where trip_id = ${tripId} order by ocorre_em nulls last, ordem`,
      sql`select s.* from expense_shares s
          join expenses e on e.id = s.expense_id
          where e.trip_id = ${tripId}`,
      sql`select i.* from installments i
          join expenses e on e.id = i.expense_id
          where e.trip_id = ${tripId} order by i.vence_em nulls last, i.numero`,
      sql`select * from payments where trip_id = ${tripId}
          order by ocorre_em desc nulls last, criado_em desc`,
    ])
    return { admin: true, categorias, despesas, divisoes, parcelas, pagamentos }
  }

  const meu = ` and exists (select 1 from expense_shares s
                            where s.expense_id = e.id and s.traveler_id = $2)`
  const [categorias, despesas, divisoes, parcelas, pagamentos] = await Promise.all([
    // So o nome, para rotular a obrigacao. Categoria nao carrega valor nenhum.
    sql`select id, nome from expense_categories where trip_id = ${tripId}`,
    sql.query(`select e.* from expenses e where e.trip_id = $1${meu}`, [tripId, participanteId]),
    sql`select s.* from expense_shares s
        join expenses e on e.id = s.expense_id
        where e.trip_id = ${tripId} and s.traveler_id = ${participanteId}`,
    sql.query(
      `select i.* from installments i join expenses e on e.id = i.expense_id
       where e.trip_id = $1${meu}`,
      [tripId, participanteId],
    ),
    // So os reembolsos que ELE fez. Quem recebeu o que de quem e conta do admin.
    sql`select * from payments where trip_id = ${tripId} and de_id = ${participanteId}`,
  ])

  return {
    admin: false,
    ...resumoPessoal(participanteId, {
      categorias: categorias as { id: string; nome: string }[],
      despesas: despesas as never,
      divisoes: divisoes as never,
      parcelas: parcelas as never,
      pagamentos: pagamentos as never,
      participantes: participantes as never,
    }),
  }
}

// ---------------------------------------------------------------- avisos

export async function notificacoesDoUsuario(userId: string) {
  return sql`
    select * from notifications where user_id = ${userId}
    order by lida, criado_em desc limit 30
  `
}

export async function marcarNotificacoesLidas(userId: string) {
  await sql`update notifications set lida = true where user_id = ${userId} and lida = false`
}

/** Avisa todo mundo da viagem, menos quem causou o aviso. */
export async function avisarParticipantes(
  tripId: string,
  excetoUserId: string,
  titulo: string,
  texto: string,
  href: string,
) {
  await sql`
    insert into notifications (user_id, trip_id, titulo, texto, href)
    select user_id, ${tripId}, ${titulo}, ${texto}, ${href}
    from travelers
    where trip_id = ${tripId} and user_id is not null and user_id <> ${excetoUserId}
  `
}

// ---------------------------------------------------------------- historico

/** Registra uma alteracao no historico. Chamado por /api/mutate. */
export async function registrarAlteracao(
  tripId: string,
  travelerId: string | null,
  entidade: string,
  entidadeId: string | null,
  campo: string,
  de: unknown,
  para: unknown,
) {
  const texto = (v: unknown) => (v === null || v === undefined ? null : String(v))
  await sql`
    insert into change_log (trip_id, traveler_id, entidade, entidade_id, campo, de, para)
    values (${tripId}, ${travelerId}, ${entidade}, ${entidadeId}, ${campo}, ${texto(de)}, ${texto(para)})
  `
}
