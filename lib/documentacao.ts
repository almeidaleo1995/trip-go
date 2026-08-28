// O motor da documentação exigida: o que cada pessoa precisa ter, o que já
// entregou, e o que o administrador ainda precisa cobrar.
//
// Tudo aqui é função pura. O que decide QUEM VÊ o quê está no servidor
// (`documentacaoDaViagem` em lib/db.ts), o que toca rede/IndexedDB está nas telas,
// e o cofre de arquivos continua em `lib/cofre.ts`. A divisão é a mesma de sempre:
// esta separação é o que permite testar o semáforo inteiro sem navegador.
//
// A diferença entre este arquivo e `cofre.ts` em uma linha: `cofre.ts` organiza o
// que EXISTE, este decide o que FALTA. Um requisito sem nenhuma entrega é
// exatamente o caso interessante, e é o que uma pasta de PDFs não sabe
// representar.
import { statusValidade, JANELA_VALIDADE, type Validade } from './cofre.ts'
import { diasAte } from './derive.ts'
import { normalizarTitulo } from './checklist.ts'

export { JANELA_VALIDADE }

// ---------------------------------------------------------------- tipos

/** A linha de `document_requirements` como ela chega no snapshot. */
export type Requisito = {
  id: string
  nome: string
  descricao?: string | null
  categoria?: string | null
  obrigatorio?: boolean
  aplica_todos?: boolean
  assigned_to?: string[] | null
  exige_numero?: boolean
  exige_validade?: boolean
  exige_arquivo?: boolean
  campo_perfil?: string | null
  prazo?: string | null
  obs?: string | null
  ordem?: number
}

/** A linha de `document_submissions`. Ausência de linha = ninguém entregou nada. */
export type Submissao = {
  id: string
  requirement_id: string
  traveler_id: string
  numero?: string | null
  validade?: string | null
  emitido_em?: string | null
  documento_id?: string | null
  /**
   * Existe arquivo anexado nesta entrega?
   *
   * Separado de `documento_id` porque o id e REDIGIDO para quem nao e dono do
   * documento (ver `documentacaoDaViagem` em lib/db.ts). Sem este campo, o painel
   * do administrador leria "sem id, logo sem arquivo" e mostraria toda a viagem
   * como pendente — a redacao de privacidade viraria um bug de status.
   */
  tem_arquivo?: boolean
  status?: string | null
  comentario?: string | null
  revisado_por?: string | null
  revisado_em?: string | null
  enviado_em?: string | null
}

/**
 * O perfil de viagem de um participante, como ele chega no snapshot.
 *
 * NÃO são os dados: são os campos que estão PREENCHIDOS. O número do passaporte
 * da Ana não precisa sair do banco para o app saber que ela já cadastrou o dela —
 * e mandá-lo publicaria um documento de identidade para toda a viagem só para
 * pintar uma bolinha verde. A validade é a única exceção, porque §22 pede
 * justamente que o vencimento seja acompanhado.
 */
export type PerfilResumo = {
  traveler_id: string
  /** 'cpf' | 'passaporte' | ... -> preenchido? */
  campos: Record<string, boolean>
  passaporte_validade?: string | null
}

export type Participante = { id: string; nome: string; papel?: string }

// ---------------------------------------------------------------- perfil

/**
 * Os campos do perfil que um requisito pode consumir (§9).
 *
 * Existe para o CPF não ser pedido de novo a cada viagem: o número é o mesmo em
 * Europa 2027 e num bate-volta a Buenos Aires. O requisito aponta para o campo,
 * a entrega desta viagem herda o dado, e a pessoa preenche uma vez só.
 *
 * `validade` nomeia o campo do perfil que carrega o vencimento, quando houver —
 * é o que permite ao §22 avisar "passaporte vence em 40 dias" sem que ninguém
 * redigite a data dentro da viagem.
 *
 * `coluna`/`emissao` nomeiam de onde o VALOR sai em `GET /api/perfil`, a única
 * rota que devolve o dado (o snapshot manda só "está preenchido?", ver
 * `PerfilResumo`). É o que deixa o formulário de entrega abrir já preenchido para
 * a própria pessoa em vez de pedir o número do passaporte de novo.
 */
export const CAMPOS_PERFIL: Record<
  string,
  { rotulo: string; coluna: string; validade?: string; emissao?: string; documento?: boolean }
> = {
  cpf: { rotulo: 'CPF', coluna: 'cpf' },
  rg: { rotulo: 'RG', coluna: 'rg' },
  passaporte: {
    rotulo: 'Passaporte',
    coluna: 'passaporte_numero',
    validade: 'passaporte_validade',
    emissao: 'passaporte_emissao',
    documento: true,
  },
  nascimento: { rotulo: 'Data de nascimento', coluna: 'nascimento' },
  nacionalidade: { rotulo: 'Nacionalidade', coluna: 'nacionalidade' },
  emergencia: { rotulo: 'Contato de emergência', coluna: 'emergencia_telefone' },
}

/** Rótulo do campo de perfil, sem quebrar diante de um valor legado ou digitado. */
export function fichaCampoPerfil(campo: string | null | undefined) {
  if (!campo) return null
  return CAMPOS_PERFIL[campo] ?? { rotulo: campo, coluna: campo }
}

// ---------------------------------------------------------------- estados

/**
 * O que a pessoa vê no lugar do documento (§12).
 *
 * A ordem desta lista é a ordem de URGÊNCIA, e é ela que ordena o painel do
 * administrador: quem abre a tela quer ver primeiro o que trava a viagem, não o
 * que já está resolvido. `vencido` vem antes de `pendente` de propósito — um
 * passaporte vencido é pior do que um que ainda não subiu, porque renovar leva
 * semanas e enviar leva um minuto.
 */
export const ORDEM_ESTADOS = [
  'vencido',
  'rejeitado',
  'atrasado',
  'correcao',
  'pendente',
  'proximo',
  'enviado',
  'aprovado',
] as const

export type EstadoRequisito = (typeof ORDEM_ESTADOS)[number]

/**
 * Rótulo, tom e a frase que diz o que fazer.
 *
 * `tom` é chave de `TONS` (components/ui.tsx), não um hex: nenhuma cor nova entra
 * por aqui, e o contraste medido do design system continua valendo. `acao` é o
 * texto do botão quando há algo a fazer — nulo quando não há.
 */
export const ESTADOS: Record<
  EstadoRequisito,
  { rotulo: string; curto: string; tom: string; acao: string | null; ativo: boolean }
> = {
  vencido: {
    rotulo: 'Documento vencido',
    curto: 'Vencido',
    tom: 'perigo',
    acao: 'Atualizar',
    ativo: true,
  },
  rejeitado: {
    rotulo: 'Recusado na revisão',
    curto: 'Recusado',
    tom: 'perigo',
    acao: 'Enviar de novo',
    ativo: true,
  },
  atrasado: {
    rotulo: 'Prazo de envio vencido',
    curto: 'Atrasado',
    tom: 'perigo',
    acao: 'Cadastrar',
    ativo: true,
  },
  correcao: {
    rotulo: 'Precisa de correção',
    curto: 'Corrigir',
    tom: 'atencao',
    acao: 'Corrigir',
    ativo: true,
  },
  pendente: {
    rotulo: 'Ainda não cadastrado',
    curto: 'Pendente',
    tom: 'neutro',
    acao: 'Cadastrar',
    ativo: true,
  },
  proximo: {
    rotulo: 'Perto do vencimento',
    curto: 'Vence logo',
    tom: 'atencao',
    acao: 'Atualizar',
    ativo: true,
  },
  enviado: {
    rotulo: 'Aguardando revisão',
    curto: 'Em revisão',
    tom: 'info',
    acao: null,
    ativo: false,
  },
  aprovado: { rotulo: 'Aprovado', curto: 'Aprovado', tom: 'sucesso', acao: null, ativo: false },
}

/** O que já pode ser considerado entregue. Base de toda porcentagem da tela. */
export function entregue(estado: EstadoRequisito): boolean {
  return estado === 'aprovado' || estado === 'enviado' || estado === 'proximo'
}

// ---------------------------------------------------------------- alcance

/**
 * Este requisito vale para esta pessoa? (§11)
 *
 * `aplica_todos` cobre quem entrar na viagem depois — a alternativa seria
 * reescrever a lista de cada requisito a cada participante novo, e quem esquecer
 * de fazer isso teria alguém viajando sem passaporte exigido.
 */
export function aplicaA(req: Requisito, travelerId: string): boolean {
  if (req.aplica_todos !== false) return true
  return (req.assigned_to ?? []).includes(travelerId)
}

/** As pessoas a quem um requisito se aplica, na ordem da viagem. */
export function alvosDe(req: Requisito, participantes: Participante[]): Participante[] {
  return participantes.filter((p) => aplicaA(req, p.id))
}

// ---------------------------------------------------------------- o que falta

export type Parte = 'numero' | 'validade' | 'arquivo'

export const PARTES: Record<Parte, string> = {
  numero: 'número',
  validade: 'validade',
  arquivo: 'arquivo',
}

/**
 * "número, validade e arquivo" — a lista como se escreve em português.
 *
 * `Intl.ListFormat` em vez de `join(' e ')`: com o join, duas faltas viram
 * "número e validade" (certo) e três viram "número e validade e arquivo"
 * (errado). É nativo, então não é dependência nova.
 */
const LISTA_PT = new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' })

export function textoFalta(partes: Parte[]): string {
  return LISTA_PT.format(partes.map((p) => PARTES[p]))
}

/**
 * O valor que satisfaz o requisito, venha do perfil da conta ou da entrega.
 *
 * O perfil ganha quando existe: é o dado canônico da pessoa. A entrega é o plano
 * B, e ele precisa existir porque nem todo participante tem conta — uma criança
 * cadastrada só como nome não tem perfil nenhum, e o passaporte dela ainda
 * precisa de um lugar.
 */
export function temNumero(
  req: Requisito,
  sub: Submissao | undefined,
  perfil: PerfilResumo | undefined,
): boolean {
  if (req.campo_perfil && perfil?.campos?.[req.campo_perfil]) return true
  return Boolean(sub?.numero)
}

export function validadeDe(
  req: Requisito,
  sub: Submissao | undefined,
  perfil: PerfilResumo | undefined,
): string | null {
  const campo = fichaCampoPerfil(req.campo_perfil)
  if (campo?.validade === 'passaporte_validade' && perfil?.passaporte_validade) {
    return perfil.passaporte_validade
  }
  return sub?.validade ?? null
}

/**
 * As partes que ainda faltam para este requisito estar cumprido.
 *
 * Um requisito que não exige nada (só "confirme que você tem") é cumprido pela
 * própria existência da entrega — é o caso de "Comprovante de vacinação" quando
 * o admin só quer o de-acordo, e ele não pode ficar pendente para sempre por não
 * ter campo nenhum a preencher.
 */
export function faltando(
  req: Requisito,
  sub: Submissao | undefined,
  perfil: PerfilResumo | undefined,
): Parte[] {
  const falta: Parte[] = []
  if (req.exige_numero && !temNumero(req, sub, perfil)) falta.push('numero')
  if (req.exige_validade && !validadeDe(req, sub, perfil)) falta.push('validade')
  if (req.exige_arquivo && !(sub?.documento_id || sub?.tem_arquivo)) falta.push('arquivo')

  const nadaExigido = !req.exige_numero && !req.exige_validade && !req.exige_arquivo
  if (nadaExigido && (!sub || sub.status === 'pendente')) falta.push('numero')
  return falta
}

// ---------------------------------------------------------------- prazo

export type Prazo = { dias: number; vencido: boolean }

/** Quanto falta para a data limite de ENVIO (§21). Nulo quando não há prazo. */
export function statusPrazo(
  prazo: string | null | undefined,
  hoje: string | Date = new Date(),
): Prazo | null {
  if (!prazo) return null
  // Duas chamadas porque `diasAte` faz clamp em 0: com uma só, todo prazo
  // estourado apareceria como "vence hoje". Mesma razão de `statusValidade`.
  const passaram = diasAte(prazo, hoje)
  if (passaram > 0) return { dias: passaram, vencido: true }
  return { dias: diasAte(hoje, prazo), vencido: false }
}

// ---------------------------------------------------------------- o semáforo

/** O estado de UM requisito para UMA pessoa, com tudo que a tela precisa dizer. */
export type Celula = {
  requisito: Requisito
  traveler_id: string
  submissao: Submissao | undefined
  estado: EstadoRequisito
  /** O que ainda falta entregar. Vazio quando está completo. */
  falta: Parte[]
  /** A revisão crua, para o painel dizer "entregue, mas ainda não revisado". */
  revisao: string
  validade: Validade | null
  prazo: Prazo | null
  /** O comentário do revisor, quando ele pediu correção ou recusou (§25). */
  comentario: string | null
}

/**
 * O estado de um requisito para uma pessoa (§37).
 *
 * A precedência responde sempre à mesma pergunta — "o que esta pessoa precisa
 * fazer AGORA?" — e é por isso que o vencimento ganha da revisão: um passaporte
 * aprovado que vence em 30 dias não é um assunto encerrado, é o assunto mais
 * urgente que existe. `revisao` continua disponível ao lado para o painel do
 * administrador não perder a informação que o estado resumiu.
 */
export function estadoDe(
  req: Requisito,
  sub: Submissao | undefined,
  perfil: PerfilResumo | undefined,
  hoje: string | Date = new Date(),
): Celula {
  const falta = faltando(req, sub, perfil)
  const revisao = sub?.status ?? 'pendente'
  const validade = statusValidade(validadeDe(req, sub, perfil), hoje)
  const prazo = statusPrazo(req.prazo, hoje)
  const comentario = sub?.comentario?.trim() || null

  const base = {
    requisito: req,
    traveler_id: sub?.traveler_id ?? '',
    submissao: sub,
    falta,
    revisao,
    validade,
    prazo,
    comentario,
  }

  // Falta alguma coisa: não há o que revisar nem o que vencer. "Atrasado" é o
  // mesmo pendente com a data limite já estourada — a diferença é que ele para
  // de ser um lembrete e passa a ser uma cobrança.
  if (falta.length > 0) {
    return { ...base, estado: prazo?.vencido ? 'atrasado' : 'pendente' }
  }

  if (validade?.nivel === 'vencido') return { ...base, estado: 'vencido' }
  if (revisao === 'rejeitado') return { ...base, estado: 'rejeitado' }
  if (revisao === 'correcao') return { ...base, estado: 'correcao' }
  if (validade?.nivel === 'proximo') return { ...base, estado: 'proximo' }
  return { ...base, estado: revisao === 'aprovado' ? 'aprovado' : 'enviado' }
}

// ---------------------------------------------------------------- a matriz

/**
 * A matriz inteira: uma célula por (requisito, pessoa a quem ele se aplica).
 *
 * É de propósito a MESMA estrutura para os dois relatórios que o brief pede em
 * telas separadas — "quem está devendo o quê" (§17) e "como está o fulano" (§19)
 * são a mesma tabela lida por linha ou por coluna. Duas estruturas divergiriam
 * na primeira regra nova de semáforo.
 */
export type Matriz = {
  celulas: Celula[]
  /** Índice por pessoa e por requisito. Evita varrer a lista em cada cartão. */
  porParticipante: Map<string, Celula[]>
  porRequisito: Map<string, Celula[]>
}

export function montarMatriz(
  requisitos: Requisito[],
  submissoes: Submissao[],
  participantes: Participante[],
  perfis: PerfilResumo[] = [],
  hoje: string | Date = new Date(),
): Matriz {
  const perfilDe = new Map(perfis.map((p) => [p.traveler_id, p]))
  const subDe = new Map(submissoes.map((s) => [`${s.requirement_id}:${s.traveler_id}`, s]))

  const celulas: Celula[] = []
  const porParticipante = new Map<string, Celula[]>()
  const porRequisito = new Map<string, Celula[]>()

  for (const req of ordenarRequisitos(requisitos)) {
    for (const p of participantes) {
      if (!aplicaA(req, p.id)) continue
      const c = {
        ...estadoDe(req, subDe.get(`${req.id}:${p.id}`), perfilDe.get(p.id), hoje),
        traveler_id: p.id,
      }
      celulas.push(c)
      if (!porParticipante.has(p.id)) porParticipante.set(p.id, [])
      if (!porRequisito.has(req.id)) porRequisito.set(req.id, [])
      porParticipante.get(p.id)!.push(c)
      porRequisito.get(req.id)!.push(c)
    }
  }

  return { celulas, porParticipante, porRequisito }
}

/** Obrigatório primeiro, depois a ordem manual, depois alfabética. */
export function ordenarRequisitos(requisitos: Requisito[]): Requisito[] {
  return [...requisitos].sort((a, b) => {
    const oa = a.obrigatorio !== false
    const ob = b.obrigatorio !== false
    if (oa !== ob) return oa ? -1 : 1
    if ((a.ordem ?? 0) !== (b.ordem ?? 0)) return (a.ordem ?? 0) - (b.ordem ?? 0)
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })
}

/** Da mais urgente para a mais tranquila. Ver `ORDEM_ESTADOS`. */
export function ordenarCelulas(celulas: Celula[]): Celula[] {
  const peso = (e: EstadoRequisito) => ORDEM_ESTADOS.indexOf(e)
  return [...celulas].sort((a, b) => {
    if (a.estado !== b.estado) return peso(a.estado) - peso(b.estado)
    const oa = a.requisito.obrigatorio !== false
    const ob = b.requisito.obrigatorio !== false
    if (oa !== ob) return oa ? -1 : 1
    return a.requisito.nome.localeCompare(b.requisito.nome, 'pt-BR')
  })
}

// ---------------------------------------------------------------- contagens

export type Resumo = {
  total: number
  completos: number
  revisando: number
  pendentes: number
  problemas: number
  pct: number
}

/**
 * O contador de qualquer recorte da matriz — a pessoa, o requisito ou a viagem
 * inteira, sempre com a mesma função.
 *
 * A porcentagem conta só os OBRIGATÓRIOS. Um "guia da cidade em PDF" marcado como
 * recomendado não pode empurrar alguém para 80% e fazê-lo parecer travado quando
 * a documentação que importa está completa. Sem nenhum obrigatório, o cálculo cai
 * para o conjunto todo — senão uma viagem só com recomendados mostraria 0% para
 * sempre.
 */
export function resumir(celulas: Celula[]): Resumo {
  const obrigatorias = celulas.filter((c) => c.requisito.obrigatorio !== false)
  const base = obrigatorias.length > 0 ? obrigatorias : celulas

  let completos = 0
  let revisando = 0
  let pendentes = 0
  let problemas = 0
  for (const c of celulas) {
    if (c.estado === 'aprovado') completos++
    else if (c.estado === 'enviado') revisando++
    else if (c.estado === 'pendente') pendentes++
    else problemas++
  }

  const feitas = base.filter((c) => entregue(c.estado)).length
  return {
    total: celulas.length,
    completos,
    revisando,
    pendentes,
    problemas,
    pct: base.length === 0 ? 100 : Math.round((feitas / base.length) * 100),
  }
}

/** O que esta pessoa ainda precisa resolver, da mais urgente para a menos (§20). */
export function pendenciasDe(matriz: Matriz, travelerId: string): Celula[] {
  return ordenarCelulas(
    (matriz.porParticipante.get(travelerId) ?? []).filter((c) => ESTADOS[c.estado].ativo),
  )
}

/**
 * O relatório do administrador (§17): por requisito, quem ainda está devendo.
 *
 * Requisito sem ninguém devendo não entra. Uma lista em que metade das linhas diz
 * "ninguém" é uma lista que ninguém lê até o fim.
 */
export function pendenciasPorRequisito(
  matriz: Matriz,
  requisitos: Requisito[],
): { requisito: Requisito; celulas: Celula[] }[] {
  return ordenarRequisitos(requisitos)
    .map((requisito) => ({
      requisito,
      celulas: ordenarCelulas(
        (matriz.porRequisito.get(requisito.id) ?? []).filter((c) => ESTADOS[c.estado].ativo),
      ),
    }))
    .filter((g) => g.celulas.length > 0)
}

// ---------------------------------------------------------------- busca e filtro

export type FiltrosDocumentacao = {
  busca?: string
  participantes?: string[]
  requisitos?: string[]
  categorias?: string[]
  estados?: EstadoRequisito[]
  /** true = só os obrigatórios. */
  obrigatorios?: boolean
  /** true = só o que tem prazo já vencido ou vencendo dentro da janela. */
  comPrazo?: boolean
}

/** Tudo que a busca do painel enxerga de uma célula: pessoa, requisito, estado. */
export function textoBuscavelCelula(c: Celula, nomePorParticipante: Map<string, string>): string {
  return normalizarTitulo(
    [
      c.requisito.nome,
      c.requisito.descricao,
      c.requisito.categoria,
      ESTADOS[c.estado].rotulo,
      nomePorParticipante.get(c.traveler_id) ?? '',
    ]
      .filter(Boolean)
      .join(' '),
  )
}

export function filtrarCelulas(
  celulas: Celula[],
  filtros: FiltrosDocumentacao,
  nomePorParticipante: Map<string, string> = new Map(),
): Celula[] {
  const termo = filtros.busca ? normalizarTitulo(filtros.busca) : ''
  const pessoas = new Set(filtros.participantes ?? [])
  const reqs = new Set(filtros.requisitos ?? [])
  const cats = new Set(filtros.categorias ?? [])
  const estados = new Set<string>(filtros.estados ?? [])

  return celulas.filter((c) => {
    if (termo && !textoBuscavelCelula(c, nomePorParticipante).includes(termo)) return false
    if (pessoas.size && !pessoas.has(c.traveler_id)) return false
    if (reqs.size && !reqs.has(c.requisito.id)) return false
    if (cats.size && !(c.requisito.categoria && cats.has(c.requisito.categoria))) return false
    if (estados.size && !estados.has(c.estado)) return false
    if (filtros.obrigatorios && c.requisito.obrigatorio === false) return false
    if (filtros.comPrazo && !(c.prazo && (c.prazo.vencido || c.prazo.dias <= 30))) return false
    return true
  })
}

// ---------------------------------------------------------------- integrações

/**
 * Os requisitos que valem para um dia do roteiro (§27).
 *
 * "Do dia" é mais largo do que uma data igual: quem embarca dia 30 precisa do
 * passaporte, que não tem data nenhuma presa a ele. Entram os requisitos com
 * prazo naquele dia ou antes dele e todos os obrigatórios — que é o conjunto que
 * alguém confere na véspera de sair de casa.
 */
export function requisitosDoDia(requisitos: Requisito[], dia: string): Requisito[] {
  return ordenarRequisitos(
    requisitos.filter((r) => r.obrigatorio !== false || (r.prazo && r.prazo <= dia)),
  )
}

/**
 * Os itens de checklist que a documentação exigida gera (§26).
 *
 * NÃO cria linha em `checklist_items`: devolve itens VIRTUAIS, com id derivado do
 * requisito. É o que o brief pede com "não criar duplicações" — marcar "cadastrar
 * passaporte" no checklist e depois cadastrá-lo de verdade deixaria duas verdades
 * sobre o mesmo fato, e a errada seria a que a pessoa marcou à mão. Aqui o item
 * fica feito quando o documento está entregue, e não tem como divergir.
 */
export type ItemDocumental = {
  id: string
  requisito_id: string
  titulo: string
  feito: boolean
  estado: EstadoRequisito
  prazo: string | null
  obrigatorio: boolean
}

export function checklistDaDocumentacao(matriz: Matriz, travelerId: string): ItemDocumental[] {
  return ordenarCelulas(matriz.porParticipante.get(travelerId) ?? []).map((c) => ({
    id: `requisito:${c.requisito.id}`,
    requisito_id: c.requisito.id,
    titulo: `Cadastrar ${c.requisito.nome.toLowerCase()}`,
    feito: entregue(c.estado),
    estado: c.estado,
    prazo: c.requisito.prazo ?? null,
    obrigatorio: c.requisito.obrigatorio !== false,
  }))
}
