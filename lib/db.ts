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
import { paraLog } from './seguranca.ts'
import { papelAlcanca, type Papel } from '../config/navigation.ts'
import { resumoPessoal, type ResumoPessoal } from './financeiro.ts'
import { registrarFalha, estaBloqueado, limparFalhas, type Limites } from './session.ts'
import { cifrar, decifrarPerfil } from './cripto.ts'

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
  /** O que a viagem EXIGE de cada pessoa. Ver `documentacaoDaViagem`. */
  requisitos: Record<string, unknown>[]
  /** O que cada pessoa entregou. Recortado e redigido pelo papel. */
  entregas: Record<string, unknown>[]
  /** Quais campos do perfil de cada participante estao preenchidos. Nunca os valores. */
  perfis: Record<string, unknown>[]
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
 * Liga a conta recem-criada a participantes que ja existiam so como nome (o
 * dono cadastrou "Leonardo" antes de Leonardo ter conta), e SO se quem se
 * cadastrou souber o codigo daquela viagem.
 *
 * O codigo e a barreira, e ela existe porque o e-mail nao e uma: o dono digita o
 * endereco de quem viaja junto dentro do app, muito antes da pessoa se cadastrar,
 * e ate aqui quem chegasse primeiro em /register com aquele endereco herdava a
 * vaga -- no papel que a linha carregasse, sem sessao nenhuma. Endereco de e-mail
 * nao e segredo; codigo combinado por fora e.
 *
 * Este e o unico caminho SEM sessao que escreve em dado de viagem. O outro
 * vinculo, em lib/escrita.ts, roda quando o PROPRIETARIO salva um participante
 * com e-mail de conta existente -- ali quem liga ja esta autenticado e autorizado,
 * entao nao pede codigo. E tambem a saida de quem se cadastrou sem o codigo, ou
 * de quem foi convidado para uma segunda viagem depois de ja ter conta: o dono
 * reabre o participante e salva.
 */
export async function vincularParticipantesPorEmail(
  userId: string,
  email: string,
  convite: string | null | undefined,
) {
  // Sem codigo nao ha vinculo. A comparacao abaixo ja recusaria (nenhum codigo e
  // vazio), mas voltar aqui deixa a regra legivel em vez de deduzida do SQL.
  if (!convite) return

  await sql`
    update travelers t
       set user_id = ${userId}
      from trips v
     where t.trip_id = v.id
       and t.email = ${email}
       and t.user_id is null
       and v.codigo_convite = ${convite}
  `
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
  // DOIS limiares, e a diferenca entre eles nao e detalhe.
  //
  // `administra` (editor) e o corte do DINHEIRO — o mesmo de `financeiroDaViagem`,
  // onde editor recebe a forma de admin. Vale para o orcamento da viagem.
  //
  // `veDadoPessoal` (proprietario) e o corte do DOCUMENTO, e ele e mais alto de
  // proposito: planejar o roteiro nao da direito de ler o passaporte de ninguem.
  // E a mesma regra que `documentosDaViagem`, `documentacaoDaViagem` e o
  // `documentoVisivel` de /api/documento ja aplicam — usar `editor` aqui daria a
  // um co-organizador exatamente o dado que essas tres funcoes se dao ao trabalho
  // de esconder dele, e por uma porta que nenhuma tela mostra.
  const administra = papelAlcanca(papel, 'editor')
  const veDadoPessoal = papelAlcanca(papel, 'proprietario')

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
    documentacao,
    emergencia,
    mensagens,
    alteracoes,
  ] = await Promise.all([
    // `orcamento_centavos` NAO sai para visualizador. Ele e o total da viagem, e
    // o total da viagem e exatamente o que `financeiroDaViagem` recusa a mandar
    // para quem nao administra — deixa-lo passar por dentro de `select *` em
    // `trips` publicaria pela porta dos fundos o numero que a outra consulta
    // protege pela porta da frente. A tela ja escondia (`if (!fin.admin) return
    // null` em Financeiro.tsx); esconder na tela nao e proteger.
    // `codigo_convite` corta em PROPRIETARIO, e nao em editor: ele e a credencial
    // que deixa alguem reivindicar uma vaga desta viagem no cadastro. Quem escreve
    // participante ja e o proprietario (`participante` tem minimo 'proprietario' na
    // TABELA de lib/escrita.ts), entao e o mesmo limiar dos dois lados -- e um
    // visualizador que recebesse o codigo poderia convidar quem quisesse para uma
    // viagem que ele nem edita.
    sql`select id, owner_id, nome, subtitulo, descricao, data_partida, data_retorno,
               moeda, fuso, cor_destaque, capa_url, arquivada, updated_at,
               case when ${administra}::boolean then orcamento_centavos end as orcamento_centavos,
               case when ${veDadoPessoal}::boolean then codigo_convite end as codigo_convite
        from trips where id = ${tripId}`,
    // Passaporte e telefone de participante saem so para o PROPRIETARIO e para o
    // dono da propria linha.
    //
    // A coluna existe porque o proprietario preenche a ficha de quem viaja junto
    // sem usar o app (`participante` tem minimo 'proprietario' na TABELA de
    // lib/escrita.ts) — mas quem ESCREVIA era o dono e quem LIA era a viagem
    // inteira, visualizador incluso. Duas coisas nesta consulta, e as duas
    // importam: o recorte e na CONSULTA, porque campo escondido no React continua
    // na aba de rede; e o limiar e `proprietario`, nao `editor`, porque e o mesmo
    // de `documentosDaViagem` — editar o roteiro nao da direito de ler passaporte.
    sql`select p.id, p.trip_id, p.user_id, p.nome, p.email, p.papel, p.ordem,
               p.updated_at, u.avatar_url,
               case when ${veDadoPessoal}::boolean or p.id = ${participanteId} then p.telefone end as telefone,
               case when ${veDadoPessoal}::boolean or p.id = ${participanteId} then p.passaporte end as passaporte
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
    documentosDaViagem(tripId, papel, participanteId),
    documentacaoDaViagem(tripId, papel, participanteId),
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
    requisitos: documentacao.requisitos,
    entregas: documentacao.entregas,
    perfis: documentacao.perfis,
    emergencia,
    mensagens: mensagens.reverse(),
    alteracoes,
    financeiro,
    server_time: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------- documentos

/**
 * O cofre que este papel pode ver — recortado na QUERY, nao filtrado depois de
 * buscar (mesmo principio de `financeiroDaViagem` e `checklistDaViagem`).
 *
 * `proprietario` ve tudo. Todo mundo mais ve os documentos `global` do grupo,
 * mais os `pessoal` de que e dono, mais os que o dono compartilhou com ele.
 * O passaporte de outra pessoa nunca sai daqui — esconder o campo no React
 * publicaria o arquivo para quem soubesse abrir a aba de rede.
 *
 * Editor NAO ve documento pessoal alheio de proposito: editar o roteiro nao da
 * direito de ler o passaporte de ninguem. Mesma regra do checklist pessoal.
 */
export async function documentosDaViagem(tripId: string, papel: Papel, participanteId: string) {
  if (papelAlcanca(papel, 'proprietario')) {
    return sql`select * from documents where trip_id = ${tripId} order by ordem`
  }
  return sql`select * from documents
      where trip_id = ${tripId}
        and (escopo = 'global'
             or traveler_id = ${participanteId}
             or ${participanteId} = any(assigned_to))
      order by ordem`
}

/**
 * "Meus documentos" da tela de perfil (§23): os documentos PESSOAIS desta conta,
 * em todas as viagens de que ela participa.
 *
 * O recorte e por `travelers.user_id`, nao por participante escolhido na tela: a
 * pessoa ve o que e dela, e nada mais. Documento do grupo nao entra — ele ja tem
 * lugar, que e o cofre da viagem. Os BYTES nao saem daqui; a tela busca por
 * /api/documento, que refaz a checagem de permissao por conta propria.
 */
export async function documentosPessoais(userId: string) {
  return sql`
    select d.id, d.titulo, d.tipo, d.categoria, d.arquivo_nome, d.arquivo_mime,
           d.arquivo_bytes, d.validade, d.offline, d.importante, d.valor,
           t.nome as viagem, t.id as trip_id
    from documents d
    join travelers p on p.id = d.traveler_id
    join trips t on t.id = d.trip_id
    where p.user_id = ${userId} and d.escopo = 'pessoal'
    order by t.nome, d.ordem, d.titulo
  `
}

// ---------------------------------------------------------------- documentacao exigida

/**
 * O centro de documentacao que este papel pode ver — recortado e REDIGIDO na
 * query, nunca escondido na tela.
 *
 * Tres coisas diferentes com tres regras diferentes:
 *
 *   requisitos  todo mundo ve. Saber o que a viagem exige nao expoe ninguem, e um
 *               viajante que nao enxerga a exigencia nao tem como cumpri-la.
 *
 *   entregas    `proprietario` ve tudo. `editor` ve o ESTADO de todo mundo (e o
 *               painel de cobranca do §14 nao existiria sem isso) mas NAO o numero
 *               do passaporte alheio nem o id do arquivo — ele cobra, nao le.
 *               `visualizador` ve so as proprias.
 *
 *   perfis      quais campos estao preenchidos, nunca os valores. Uma bolinha
 *               verde nao justifica mandar o CPF de cinco pessoas para o
 *               navegador de todas elas.
 *
 * `tem_arquivo` existe justamente por causa da redacao: sem ele, esconder o
 * `documento_id` do editor faria toda a viagem aparecer como pendente no painel —
 * a protecao de privacidade viraria um bug de status. Ver `Submissao` em
 * lib/documentacao.ts.
 */
export async function documentacaoDaViagem(tripId: string, papel: Papel, participanteId: string) {
  const dono = papelAlcanca(papel, 'proprietario')
  const revisor = papelAlcanca(papel, 'editor')

  const [requisitos, entregas, participantes] = await Promise.all([
    sql`select * from document_requirements where trip_id = ${tripId} order by ordem, nome`,

    // O `case` e a redacao, e ela roda no Postgres de proposito: apagar o campo em
    // JavaScript protegeria a tela e continuaria mandando o numero pela rede, onde
    // a aba de rede do navegador o mostra inteiro.
    dono
      ? sql`select s.*, (s.documento_id is not null) as tem_arquivo
            from document_submissions s
            join document_requirements r on r.id = s.requirement_id
            where r.trip_id = ${tripId}`
      : revisor
        ? sql`select s.id, s.requirement_id, s.traveler_id,
                   case when s.traveler_id = ${participanteId} then s.numero end as numero,
                   case when s.traveler_id = ${participanteId} then s.emitido_em end as emitido_em,
                   case when s.traveler_id = ${participanteId} then s.documento_id end as documento_id,
                   (s.documento_id is not null) as tem_arquivo,
                   s.validade, s.status, s.comentario, s.revisado_por, s.revisado_em,
                   s.enviado_em, s.updated_at
            from document_submissions s
            join document_requirements r on r.id = s.requirement_id
            where r.trip_id = ${tripId}`
        : sql`select s.*, (s.documento_id is not null) as tem_arquivo
            from document_submissions s
            join document_requirements r on r.id = s.requirement_id
            where r.trip_id = ${tripId} and s.traveler_id = ${participanteId}`,

    // `travelers.passaporte` e `travelers.documento` sao as colunas ANTIGAS, de
    // antes de o perfil existir. Continuam contando: uma viagem em uso ja tem esses
    // campos preenchidos, e ignora-los marcaria como pendente quem ja cadastrou.
    //
    // `to_char` na validade pela mesma razao do roteiro: o driver devolve `date`
    // como objeto Date, e `String(Date)` da "Wed Jan 05 2033 ...". O `.slice(0,10)`
    // que existia aqui recortava "Wed Jan 05" — string que `parseData` recusa, que
    // `formatarData` vira vazio ("Vence em ") e que `diasAte` conta como zero, ou
    // seja: TODO passaporte com validade cadastrada aparecia vencendo hoje.
    revisor
      ? sql`select p.id, u.cpf, u.rg, u.nacionalidade, u.nascimento,
                   u.passaporte_numero, u.emergencia_telefone,
                   to_char(u.passaporte_validade, 'YYYY-MM-DD') as passaporte_validade,
                   p.passaporte as passaporte_antigo, p.documento as documento_antigo,
                   p.nascimento as nascimento_antigo
            from travelers p left join users u on u.id = p.user_id
            where p.trip_id = ${tripId}`
      : sql`select p.id, u.cpf, u.rg, u.nacionalidade, u.nascimento,
                   u.passaporte_numero, u.emergencia_telefone,
                   to_char(u.passaporte_validade, 'YYYY-MM-DD') as passaporte_validade,
                   p.passaporte as passaporte_antigo, p.documento as documento_antigo,
                   p.nascimento as nascimento_antigo
            from travelers p left join users u on u.id = p.user_id
            where p.trip_id = ${tripId} and p.id = ${participanteId}`,
  ])

  const cheio = (v: unknown) => Boolean(v && String(v).trim())

  return {
    requisitos,
    entregas,
    perfis: participantes.map((p) => ({
      traveler_id: String(p.id),
      campos: {
        cpf: cheio(p.cpf) || cheio(p.documento_antigo),
        rg: cheio(p.rg),
        passaporte: cheio(p.passaporte_numero) || cheio(p.passaporte_antigo),
        nascimento: cheio(p.nascimento) || cheio(p.nascimento_antigo),
        nacionalidade: cheio(p.nacionalidade),
        emergencia: cheio(p.emergencia_telefone),
      },
      passaporte_validade: (p.passaporte_validade as string | null) ?? null,
    })),
  }
}

/** Os dados de viagem da conta (§6). Só a própria conta lê os próprios valores. */
export async function perfilDeViagem(userId: string) {
  const r = await sql`
    select nome_completo, nome_social, to_char(nascimento, 'YYYY-MM-DD') as nascimento,
           cpf, rg, nacionalidade, passaporte_numero, passaporte_nome,
           to_char(passaporte_emissao, 'YYYY-MM-DD') as passaporte_emissao,
           to_char(passaporte_validade, 'YYYY-MM-DD') as passaporte_validade,
           passaporte_pais, emergencia_nome, emergencia_telefone, emergencia_parentesco
    from users where id = ${userId}
  `
  // CPF, RG e passaporte saem do banco cifrados — ver lib/cripto.ts. A volta ao
  // texto puro acontece AQUI, no ponto mais fundo que ainda sabe que a resposta é
  // para o dono da conta: esta função só é chamada com o userId da sessão.
  return decifrarPerfil((r[0] as Record<string, unknown> | undefined) ?? null)
}

/**
 * Grava os dados de viagem da conta.
 *
 * Campo em branco vira NULL, nunca string vazia: no banco isso e "nao informado",
 * e e exatamente o que `documentacaoDaViagem` conta para decidir se o requisito
 * esta cumprido. Uma string vazia gravada faria uma bolinha verde mentir.
 */
export async function atualizarPerfilViagem(userId: string, d: Record<string, unknown>) {
  const v = (c: string) => {
    const x = d[c]
    return x === null || x === undefined || String(x).trim() === '' ? null : String(x).trim()
  }
  // Os três campos que identificam a pessoa vão cifrados para o banco. `cifrar`
  // devolve null para vazio, então "não informado" continua sendo NULL de verdade
  // — é disso que `documentacaoDaViagem` depende para saber o que falta.
  const c = (col: string) => cifrar(v(col))
  await sql`
    update users set
      nome_completo = ${v('nome_completo')},
      nome_social = ${v('nome_social')},
      nascimento = ${v('nascimento')},
      cpf = ${c('cpf')},
      rg = ${c('rg')},
      nacionalidade = ${v('nacionalidade')},
      passaporte_numero = ${c('passaporte_numero')},
      passaporte_nome = ${v('passaporte_nome')},
      passaporte_emissao = ${v('passaporte_emissao')},
      passaporte_validade = ${v('passaporte_validade')},
      passaporte_pais = ${v('passaporte_pais')},
      emergencia_nome = ${v('emergencia_nome')},
      emergencia_telefone = ${v('emergencia_telefone')},
      emergencia_parentesco = ${v('emergencia_parentesco')},
      updated_at = now()
    where id = ${userId}
  `
  return perfilDeViagem(userId)
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
  /**
   * Quem originou a escrita, e em que lote. `travelerId` continua sendo quem
   * assina. Hoje toda chamada usa o padrao (`pessoa`, sem lote): o par existe
   * porque agrupar as linhas de uma carga e o que a torna desfazivel, e esse
   * agrupamento so existe se for gravado na hora. Ver `Marca` em lib/escrita.ts.
   * Opcionais e no fim de proposito: as 7 chamadas que ja existiam seguem valendo.
   */
  origem: 'pessoa' | 'sql' = 'pessoa',
  lote: string | null = null,
) {
  const texto = (v: unknown) => (v === null || v === undefined ? null : String(v))
  await sql`
    insert into change_log (trip_id, traveler_id, entidade, entidade_id, campo, de, para, origem, lote)
    values (${tripId}, ${travelerId}, ${entidade}, ${entidadeId}, ${campo},
            ${texto(de)}, ${texto(para)}, ${origem}, ${lote})
  `
}

/**
 * O envelope que TODA rota de escrita devolve: snapshot + quem é você.
 *
 * Existe como função por um incidente registrado no README: `/api/mutate` e
 * `/api/snapshot` divergiram uma vez no campo `eu`, e "every write crashed the
 * next render" — a tela perdia o papel e o participanteId depois de qualquer
 * escrita. Com três rotas de escrita (mutate, aplicar, desfazer) a chance de
 * divergir triplicaria. Aqui é impossível: há um lugar só.
 */
export async function envelope(acesso: {
  userId: string
  tripId: string
  papel: Papel
  participanteId: string
}) {
  return {
    ...(await getSnapshot(acesso.tripId, acesso.papel, acesso.participanteId)),
    eu: {
      userId: acesso.userId,
      usuario: await usuarioPorId(acesso.userId),
      participanteId: acesso.participanteId,
      papel: acesso.papel,
    },
  }
}

// ---------------------------------------------------------------- limite de tentativas

/**
 * O rate limit no BANCO, compartilhado por todas as instancias.
 *
 * O contador em memoria de `lib/session.ts` funcionava numa maquina so. Na
 * Vercel cada instancia serverless tinha o seu, entao dez instancias davam dez
 * vezes o limite — e quem chuta senha nao precisa de mais do que isso. A decisao
 * (janela deslizante, quando bloquear, por quanto tempo) continua sendo a mesma;
 * o que muda e ONDE ela e contada.
 *
 * A conta inteira acontece dentro de `registrar_tentativa` no Postgres, sob
 * `for update`: ler, decidir e gravar em ida unica e sob trava. Fazer isso aqui
 * em tres consultas reabriria a corrida entre instancias que a tabela existe
 * para fechar.
 *
 * Falha de rede NAO derruba o login: cai para o contador em memoria, que limita
 * por instancia em vez de nada. Falhar fechado trancaria a viagem inteira para
 * fora por causa de um soluco do banco; falhar aberto tiraria o limite justo
 * quando o banco esta instavel. O meio-termo e o balde local.
 */
export async function registrarTentativa(
  chave: string,
  limites: Limites,
): Promise<{ bloqueado: boolean; restamMs: number }> {
  try {
    const r = await sql`
      select bloqueado, restam_ms from registrar_tentativa(
        ${chave},
        ${limites.limite},
        ${`${Math.round(limites.janelaMs / 1000)} seconds`}::interval,
        ${`${Math.round(limites.bloqueioMs / 1000)} seconds`}::interval
      )
    `
    const linha = r[0] as { bloqueado: boolean; restam_ms: string | number } | undefined
    if (!linha) return registrarFalha(chave, Date.now(), limites)
    return { bloqueado: Boolean(linha.bloqueado), restamMs: Number(linha.restam_ms) }
  } catch (e) {
    console.error('[rate-limit] caiu para o contador em memoria', paraLog(e))
    return registrarFalha(chave, Date.now(), limites)
  }
}

/** Consulta sem contar tentativa. Usado antes de gastar CPU com scrypt. */
export async function consultarBloqueio(chave: string): Promise<boolean> {
  try {
    const r = await sql`
      select bloqueado_ate from rate_limit where chave = ${chave} and bloqueado_ate > now()
    `
    return r.length > 0
  } catch {
    return estaBloqueado(chave)
  }
}

/**
 * Zera a janela. So o login chama: acertar a senha prova que nao era chute.
 *
 * O cadastro nunca chama, e por um motivo diferente: la o abuso E a conta criada
 * com sucesso, entao acertar nao perdoa nada. Ver os comentarios de LIMITES_* em
 * lib/session.ts.
 */
export async function limparTentativas(chave: string): Promise<void> {
  limparFalhas(chave)
  try {
    await sql`delete from rate_limit where chave = ${chave}`
  } catch {
    // A janela em memoria ja foi zerada acima; a linha no banco expira sozinha.
  }
}
