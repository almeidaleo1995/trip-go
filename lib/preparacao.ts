// A Central de Preparação: uma pergunta só — "o que falta para a viagem estar
// pronta?" — respondida com o que os outros módulos já sabem.
//
// Este arquivo não tem dado próprio, e isso é a decisão inteira. Uma tarefa
// GRAVADA em tabela nova envelhece sozinha: "enviar o passaporte" continuaria
// aberta depois de o passaporte subir, porque ninguém volta para desmarcá-la, e
// a Central passaria a mentir justamente sobre o que ela existe para dizer.
// Tarefa DERIVADA não tem como divergir da fonte — ela some quando a fonte muda.
//
// As regras moram todas em `REGRAS` (§21). Espalhar `if` dentro da tela é o que
// faz uma inteligência dessas parar de evoluir na terceira condição nova.
//
// O que decide QUEM VÊ o quê continua no servidor: um `visualizador` recebe um
// snapshot que já não tem a despesa alheia nem o documento pessoal de ninguém
// (`financeiroDaViagem`, `documentosDaViagem` em lib/db.ts). A Central lê o que
// chegou — ela não filtra por permissão, e não teria como.
import { diasAte, parseData } from './derive.ts'
import {
  ESTADOS,
  resumir,
  montarMatriz,
  CAMPOS_PERFIL,
  type Celula,
  type Matriz,
  type Requisito,
  type Submissao,
  type PerfilResumo,
} from './documentacao.ts'
import { parcelasDaViagem } from './financeiro.ts'
import { temArquivo, type Documento } from './cofre.ts'

// ---------------------------------------------------------------- vocabulário

/** As abas para onde "Resolver" leva. Subconjunto de `AbaId` (components/Shell). */
export type Destino =
  | 'documentos'
  | 'documentacao'
  | 'checklist'
  | 'voos'
  | 'hospedagem'
  | 'financeiro'
  | 'roteiro'

export type Prioridade = 'urgente' | 'atencao' | 'info'

/** Tom do design system para cada prioridade. Nenhuma cor nova entra por aqui. */
export const TOM_PRIORIDADE: Record<Prioridade, string> = {
  urgente: 'perigo',
  atencao: 'atencao',
  info: 'neutro',
}

export type Fonte = 'documento' | 'perfil' | 'checklist' | 'voo' | 'hospedagem' | 'pagamento'

/**
 * O rótulo que a tarefa carrega e a aba que ela abre. Um lugar só.
 *
 * `plural` é escrito à mão porque em português ele não é "+s": são "perfis" e
 * "hospedagens", e uma contagem que diz "2 hospedagems" desmancha a confiança na
 * tela inteira mais rápido do que um número errado.
 */
export const FONTES: Record<Fonte, { rotulo: string; plural: string; destino: Destino }> = {
  documento: { rotulo: 'Documento', plural: 'documentos', destino: 'documentacao' },
  perfil: { rotulo: 'Perfil', plural: 'dados de perfil', destino: 'documentacao' },
  checklist: { rotulo: 'Checklist', plural: 'itens do checklist', destino: 'checklist' },
  voo: { rotulo: 'Voo', plural: 'voos', destino: 'voos' },
  hospedagem: { rotulo: 'Hospedagem', plural: 'hospedagens', destino: 'hospedagem' },
  pagamento: { rotulo: 'Pagamento', plural: 'pagamentos', destino: 'financeiro' },
}

/**
 * O que o botão da tarefa oferece.
 *
 * `resolver` é o que o app CONFERE sozinho: ele sabe quando o passaporte subiu e
 * a tarefa desaparece. `lembrete` é o que ele não tem como conferir — fazer
 * check-in acontece no site da companhia, e nada no banco muda quando acontece.
 * A distinção não é cosmética: só o que é verificável entra na porcentagem, para
 * a Central nunca dizer 100% apoiada em algo que ela apenas torceu para ter
 * acontecido.
 */
export type Acao = 'resolver' | 'lembrete'

export type Tarefa = {
  id: string
  titulo: string
  detalhe?: string | null
  fonte: Fonte
  prioridade: Prioridade
  acao: Acao
  /** Quando isto precisa estar resolvido. `null` = sem data própria. */
  prazo: string | null
  /** De qual regra saiu — a rastreabilidade que permite depurar sem ler a tela. */
  regra: string
}

// ---------------------------------------------------------------- entrada

/** O voo como a Central precisa dele. Um recorte de `flights`. */
export type Voo = {
  id: string
  companhia?: string | null
  numero?: string | null
  origem_iata?: string | null
  origem_cidade?: string | null
  destino_iata?: string | null
  destino_cidade?: string | null
  parte_em?: string | null
  chega_em?: string | null
  duracao_min?: number | null
  localizador?: string | null
  terminal?: string | null
  portao?: string | null
  bagagem?: string | null
}

/** Uma reserva (`reservations`); hospedagem é a que tem `tipo = 'hospedagem'`. */
export type Reserva = {
  id: string
  tipo?: string | null
  nome?: string | null
  cidade?: string | null
  inicio_em?: string | null
  fim_em?: string | null
  endereco?: string | null
  telefone?: string | null
  localizador?: string | null
}

export type ItemChecklist = {
  id: string
  titulo?: string | null
  categoria?: string | null
  prazo_ideal?: string | null
  prazo_maximo?: string | null
  prioridade?: string | null
}

/** Uma obrigação financeira desta pessoa, como `obrigacoesDe` devolve. */
export type Obrigacao = {
  id: string
  descricao?: string | null
  valor_centavos: number
  pago_centavos: number
  vence_em: string | null
  status?: string | null
}

/**
 * Tudo que a Central lê, já normalizado.
 *
 * É um objeto simples e não o snapshot para o motor rodar em `node --test` sem
 * banco nem navegador — o mesmo motivo de `lib/documentacao.ts` e `financeiro.ts`.
 */
export type Contexto = {
  hoje: Date
  partida: string | null
  retorno: string | null
  /** A matriz da documentação exigida, já montada pela tela. */
  matriz: Matriz
  /** O participante que está olhando. Vazio quando ele não é participante. */
  eu: string
  /** true para editor/proprietário: a Central cobra a viagem, não só a própria linha. */
  admin: boolean
  /** Campos do perfil que ESTA pessoa ainda não preencheu, e algum requisito pede. */
  perfilFaltando: { chave: string; rotulo: string }[]
  documentos: Documento[]
  checklist: ItemChecklist[]
  /** O estado do checklist desta pessoa: item_id -> feito. */
  feitos: Record<string, boolean>
  voos: Voo[]
  reservas: Reserva[]
  obrigacoes: Obrigacao[]
}

// ---------------------------------------------------------------- datas

/**
 * Dias de `de` até `para`, COM sinal. Negativo quando `para` já passou.
 *
 * `diasAte` corta em zero de propósito (um intervalo invertido é dado ruim, não
 * um número negativo). Aqui o sinal é a informação: "venceu há 3 dias" e "vence
 * em 3 dias" são a mesma conta com significados opostos. Duas chamadas em vez de
 * uma cópia de `numeroDoDia`, que é privado — uma delas é sempre zero.
 */
export function dias(de: string | Date | null, para: string | Date | null): number {
  return diasAte(de, para) - diasAte(para, de)
}

/** A data que fica N dias depois de `base`, no formato do banco. `null` se não der. */
export function deslocar(base: string | null, n: number): string | null {
  const d = parseData(base)
  if (!d) return null
  const alvo = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  const mes = String(alvo.getMonth() + 1).padStart(2, '0')
  const dia = String(alvo.getDate()).padStart(2, '0')
  return `${alvo.getFullYear()}-${mes}-${dia}`
}

// ---------------------------------------------------------------- momentos

/**
 * Os degraus da linha do tempo (§5), em ordem cronológica.
 *
 * Não são "01/02/03": cada um é uma data real, e a ordem é a única coisa que o
 * leitor precisa saber para decidir o que fazer hoje. `mes` some quando a viagem
 * está perto — a janela dele fecha antes de abrir, e um degrau vazio na escada
 * só faria a escada parecer maior.
 */
export const MOMENTOS = ['agora', 'mes', 'trinta', 'sete', 'dia'] as const

export type Momento = (typeof MOMENTOS)[number]

export const NOME_MOMENTO: Record<Momento, string> = {
  agora: 'Agora',
  mes: 'Nas próximas semanas',
  trinta: '30 dias antes',
  sete: '7 dias antes',
  dia: 'No dia da viagem',
}

/**
 * O ÚLTIMO dia de cada degrau. Uma tarefa cai no primeiro degrau que a comporta.
 *
 * `agora` termina uma semana depois de HOJE; os três seguintes são contados a
 * partir da PARTIDA. Misturar as duas âncoras é o que faz a escada continuar
 * verdadeira em qualquer distância: numa viagem daqui a um ano, "30 dias antes"
 * ainda é daqui a onze meses; numa viagem em dez dias, esse degrau já passou e
 * tudo cai em `agora`, que é onde precisa estar.
 */
export function limitesDosMomentos(
  partida: string | null,
  hoje: Date,
): Record<Exclude<Momento, 'dia'>, string | null> {
  return {
    agora: deslocar(paraDia(hoje), 7),
    mes: deslocar(partida, -30),
    trinta: deslocar(partida, -7),
    sete: partida,
  }
}

/**
 * A data que o degrau ESTAMPA — o começo da janela dele, não o fim.
 *
 * "30 dias antes" precisa mostrar o dia em que faltam 30, senão o rótulo e a
 * data ao lado dele contam histórias diferentes. `mes` não estampa nada: é uma
 * faixa larga, e datar uma faixa é prometer precisão que ela não tem.
 */
export function dataDoMomento(m: Momento, partida: string | null, hoje: Date): string | null {
  if (m === 'agora') return paraDia(hoje)
  if (m === 'trinta') return deslocar(partida, -30)
  if (m === 'sete') return deslocar(partida, -7)
  if (m === 'dia') return partida
  return null
}

/** `Date` -> 'YYYY-MM-DD' no fuso local. O banco fala nesse formato. */
export function paraDia(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/**
 * Em que degrau uma tarefa cai.
 *
 * Sem prazo próprio ela vai pelo que a urgência diz: o que é urgente é agora, e o
 * resto espera — inventar uma data para poder ordenar seria criar um dado que
 * ninguém cadastrou.
 */
export function momentoDe(t: Tarefa, partida: string | null, hoje: Date): Momento {
  if (!t.prazo) return t.prioridade === 'urgente' ? 'agora' : 'mes'

  const l = limitesDosMomentos(partida, hoje)
  // A ordem das comparações é a ordem da escada: o primeiro degrau em que o
  // prazo cabe é o dele. Sem partida cadastrada só existem "agora" e "depois".
  if (l.agora && t.prazo <= l.agora) return 'agora'
  if (!partida) return 'mes'
  if (l.mes && t.prazo <= l.mes) return 'mes'
  if (l.trinta && t.prazo <= l.trinta) return 'trinta'
  if (l.sete && t.prazo < l.sete) return 'sete'
  return 'dia'
}

// ---------------------------------------------------------------- regras

/**
 * Uma regra: uma pergunta feita a uma fonte, e as tarefas que a resposta gera.
 *
 * `condicao` é prosa e não código de propósito — ela existe para quem lê a lista
 * entender o que a Central procura sem abrir `gerar`. Regra nova é um item novo
 * neste array e nada mais; nenhuma tela precisa saber que ela existe.
 */
export type Regra = {
  id: string
  fonte: Fonte
  condicao: string
  gerar: (c: Contexto) => Tarefa[]
}

const nomeDoVoo = (v: Voo) =>
  [v.companhia, v.numero].filter(Boolean).join(' ').trim() ||
  [v.origem_iata, v.destino_iata].filter(Boolean).join('→') ||
  'Voo'

/** Quantas horas antes da partida a companhia costuma abrir o check-in. */
export const HORAS_CHECKIN = 48

export const REGRAS: Regra[] = [
  {
    id: 'documento-exigido',
    fonte: 'documento',
    condicao: 'requisito da viagem sem entrega, vencido, atrasado ou recusado na revisão',
    gerar: (c) => {
      // Quem organiza cobra a viagem inteira; quem viaja resolve a própria linha.
      // São a mesma célula lida por eixos diferentes — ver `montarMatriz`.
      const celulas: Celula[] = c.admin
        ? c.matriz.celulas.filter((x) => ESTADOS[x.estado].ativo)
        : (c.matriz.porParticipante.get(c.eu) ?? []).filter((x) => ESTADOS[x.estado].ativo)

      return celulas.map((x) => ({
        id: `documento:${x.requisito.id}:${x.traveler_id}`,
        titulo: ESTADOS[x.estado].acao
          ? `${ESTADOS[x.estado].acao}: ${x.requisito.nome}`
          : x.requisito.nome,
        detalhe: ESTADOS[x.estado].rotulo,
        fonte: 'documento',
        prioridade: ESTADOS[x.estado].tom === 'perigo' ? 'urgente' : 'atencao',
        acao: 'resolver',
        prazo: x.requisito.prazo ?? null,
        regra: 'documento-exigido',
      }))
    },
  },
  {
    id: 'perfil-incompleto',
    fonte: 'perfil',
    condicao: 'campo do perfil que algum requisito puxa e a pessoa ainda não preencheu',
    gerar: (c) =>
      c.perfilFaltando.map((campo) => ({
        id: `perfil:${campo.chave}`,
        titulo: `Completar ${campo.rotulo.toLowerCase()} no seu perfil`,
        detalhe: 'Preenchido uma vez, vale para todas as suas viagens',
        fonte: 'perfil',
        prioridade: 'atencao',
        acao: 'resolver',
        prazo: null,
        regra: 'perfil-incompleto',
      })),
  },
  {
    id: 'checklist-aberto',
    fonte: 'checklist',
    condicao: 'item do checklist que esta pessoa ainda não marcou',
    gerar: (c) =>
      c.checklist
        .filter((i) => !c.feitos[i.id])
        .map((i) => {
          const limite = i.prazo_maximo ?? i.prazo_ideal ?? null
          const estourou = limite ? dias(paraDia(c.hoje), limite) < 0 : false
          return {
            id: `checklist:${i.id}`,
            titulo: String(i.titulo ?? 'Item do checklist'),
            detalhe: i.categoria ? String(i.categoria) : null,
            fonte: 'checklist' as const,
            prioridade: (estourou || i.prioridade === 'critico'
              ? 'urgente'
              : 'atencao') as Prioridade,
            acao: 'resolver' as const,
            prazo: i.prazo_ideal ?? i.prazo_maximo ?? null,
            regra: 'checklist-aberto',
          }
        }),
  },
  {
    id: 'voo-sem-localizador',
    fonte: 'voo',
    condicao: 'voo cadastrado sem localizador — o código que o aeroporto pede',
    gerar: (c) =>
      c.voos
        .filter((v) => !String(v.localizador ?? '').trim())
        .map((v) => ({
          id: `voo-localizador:${v.id}`,
          titulo: `Guardar o localizador do voo ${nomeDoVoo(v)}`,
          detalhe: 'Sem ele não dá para fazer check-in nem resolver problema no balcão',
          fonte: 'voo' as const,
          prioridade: 'atencao' as Prioridade,
          acao: 'resolver' as const,
          prazo: deslocar(v.parte_em?.slice(0, 10) ?? null, -30),
          regra: 'voo-sem-localizador',
        })),
  },
  {
    id: 'voo-checkin',
    fonte: 'voo',
    condicao: 'voo que ainda não partiu — o check-in abre 48h antes',
    gerar: (c) =>
      c.voos
        .filter((v) => {
          const p = parseData(v.parte_em ?? null)
          return p ? p.getTime() >= c.hoje.getTime() : false
        })
        .map((v) => ({
          id: `voo-checkin:${v.id}`,
          titulo: `Fazer check-in do voo ${nomeDoVoo(v)}`,
          detalhe: `Abre ${HORAS_CHECKIN}h antes da partida, no site da companhia`,
          fonte: 'voo' as const,
          prioridade: 'atencao' as Prioridade,
          // O app não fica sabendo que o check-in foi feito: nada no banco muda.
          acao: 'lembrete' as const,
          prazo: deslocar(v.parte_em?.slice(0, 10) ?? null, -1),
          regra: 'voo-checkin',
        })),
  },
  {
    id: 'hospedagem-sem-confirmacao',
    fonte: 'hospedagem',
    condicao: 'estadia sem localizador de reserva',
    gerar: (c) =>
      c.reservas
        .filter((r) => r.tipo === 'hospedagem' && !String(r.localizador ?? '').trim())
        .map((r) => ({
          id: `hospedagem-reserva:${r.id}`,
          titulo: `Confirmar a reserva de ${String(r.nome ?? 'hospedagem')}`,
          detalhe: r.cidade ? String(r.cidade) : null,
          fonte: 'hospedagem' as const,
          prioridade: 'atencao' as Prioridade,
          acao: 'resolver' as const,
          prazo: deslocar(r.inicio_em?.slice(0, 10) ?? null, -30),
          regra: 'hospedagem-sem-confirmacao',
        })),
  },
  {
    id: 'documento-sem-offline',
    fonte: 'documento',
    condicao: 'documento importante com arquivo que a viagem ainda não pediu para levar offline',
    gerar: (c) =>
      c.documentos
        .filter((d) => d.importante && temArquivo(d) && !d.offline)
        .map((d) => ({
          id: `offline:${d.id}`,
          titulo: `Levar "${d.titulo}" para uso sem internet`,
          detalhe: 'Documento importante que hoje só abre com sinal',
          fonte: 'documento' as const,
          prioridade: 'atencao' as Prioridade,
          acao: 'resolver' as const,
          prazo: deslocar(c.partida, -7),
          regra: 'documento-sem-offline',
        })),
  },
  {
    id: 'pagamento-em-aberto',
    fonte: 'pagamento',
    condicao: 'parcela sua ainda não quitada',
    gerar: (c) =>
      c.obrigacoes
        .filter((o) => o.valor_centavos > o.pago_centavos)
        .map((o) => {
          const atrasada = o.vence_em ? dias(paraDia(c.hoje), o.vence_em) < 0 : false
          return {
            id: `pagamento:${o.id}`,
            titulo: String(o.descricao ?? 'Pagamento da viagem'),
            detalhe: atrasada ? 'Vencida' : null,
            fonte: 'pagamento' as const,
            prioridade: (atrasada ? 'urgente' : 'atencao') as Prioridade,
            acao: 'resolver' as const,
            prazo: o.vence_em,
            regra: 'pagamento-em-aberto',
          }
        }),
  },
]

/** Roda a lista inteira. A ordem final é urgência primeiro, prazo depois. */
export function gerarTarefas(c: Contexto): Tarefa[] {
  const todas = REGRAS.flatMap((r) => r.gerar(c))
  return ordenarTarefas(todas)
}

const PESO_PRIORIDADE: Record<Prioridade, number> = { urgente: 0, atencao: 1, info: 2 }

/**
 * Urgência, depois prazo, depois título.
 *
 * Prazo ausente vai para o fim do seu grupo, nunca para o topo: uma tarefa sem
 * data não é mais urgente do que uma que vence amanhã.
 */
export function ordenarTarefas(tarefas: Tarefa[]): Tarefa[] {
  return [...tarefas].sort((a, b) => {
    const p = PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade]
    if (p !== 0) return p
    if (a.prazo !== b.prazo) {
      if (!a.prazo) return 1
      if (!b.prazo) return -1
      return a.prazo < b.prazo ? -1 : 1
    }
    return a.titulo.localeCompare(b.titulo, 'pt-BR')
  })
}

// ---------------------------------------------------------------- progresso

export type Categoria = 'documentos' | 'passagens' | 'hospedagens' | 'pagamentos' | 'tarefas'

/**
 * O peso de cada módulo na porcentagem geral (§4).
 *
 * Documentação pesa mais porque é a única coisa aqui com prazo externo: renovar
 * um passaporte leva semanas e não há como correr no último dia. Um item de
 * checklist esquecido se resolve no aeroporto; um visto, não.
 */
export const PESOS: Record<Categoria, number> = {
  documentos: 3,
  passagens: 2,
  hospedagens: 2,
  pagamentos: 2,
  tarefas: 1,
}

export const NOME_CATEGORIA: Record<Categoria, string> = {
  documentos: 'Documentos',
  passagens: 'Passagens',
  hospedagens: 'Hospedagens',
  pagamentos: 'Pagamentos',
  tarefas: 'Tarefas',
}

export const DESTINO_CATEGORIA: Record<Categoria, Destino> = {
  documentos: 'documentacao',
  passagens: 'voos',
  hospedagens: 'hospedagem',
  pagamentos: 'financeiro',
  tarefas: 'checklist',
}

export type ResumoCategoria = {
  id: Categoria
  rotulo: string
  /** `null` quando a viagem não tem esse módulo — diferente de 0%. */
  pct: number | null
  feitos: number
  total: number
  /** A frase curta debaixo do rótulo: "Concluído", "3 pendentes". */
  nota: string
  tom: string
  destino: Destino
}

const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`

/**
 * Cada módulo medido pela sua própria régua.
 *
 * Módulo que a viagem não usa devolve `pct: null` e fica FORA da conta geral.
 * Contá-lo como zero diria que uma viagem sem cruzeiro está mal preparada — o
 * número precisa medir o que existe, não a ausência do que ninguém cadastrou.
 */
export function categorias(c: Contexto): ResumoCategoria[] {
  const celulas = c.admin ? c.matriz.celulas : (c.matriz.porParticipante.get(c.eu) ?? [])
  const doc = resumir(celulas)
  const emFalta = celulas.filter((x) => ESTADOS[x.estado].ativo).length

  const voosOk = c.voos.filter((v) => String(v.localizador ?? '').trim()).length
  const estadias = c.reservas.filter((r) => r.tipo === 'hospedagem')
  const estadiasOk = estadias.filter((r) => String(r.localizador ?? '').trim()).length

  const feitosChecklist = c.checklist.filter((i) => c.feitos[i.id]).length

  const devendo = c.obrigacoes.reduce(
    (s, o) => s + Math.max(0, o.valor_centavos - o.pago_centavos),
    0,
  )
  const pago = c.obrigacoes.reduce((s, o) => s + o.pago_centavos, 0)
  const abertas = c.obrigacoes.filter((o) => o.valor_centavos > o.pago_centavos).length
  const vencidas = c.obrigacoes.filter(
    (o) =>
      o.valor_centavos > o.pago_centavos &&
      o.vence_em &&
      dias(paraDia(c.hoje), o.vence_em) < 0,
  ).length

  const linhas: ResumoCategoria[] = [
    {
      id: 'documentos',
      rotulo: NOME_CATEGORIA.documentos,
      pct: celulas.length === 0 ? null : doc.pct,
      feitos: celulas.length - emFalta,
      total: celulas.length,
      nota:
        celulas.length === 0
          ? 'Nada exigido'
          : emFalta === 0
            ? 'Concluído'
            : plural(emFalta, 'pendente', 'pendentes'),
      tom: celulas.length === 0 ? 'neutro' : emFalta === 0 ? 'sucesso' : 'atencao',
      destino: DESTINO_CATEGORIA.documentos,
    },
    {
      id: 'passagens',
      rotulo: NOME_CATEGORIA.passagens,
      pct: c.voos.length === 0 ? null : Math.round((voosOk / c.voos.length) * 100),
      feitos: voosOk,
      total: c.voos.length,
      nota:
        c.voos.length === 0
          ? 'Nenhum voo cadastrado'
          : voosOk === c.voos.length
            ? 'Concluído'
            : `${plural(c.voos.length - voosOk, 'voo', 'voos')} sem localizador`,
      tom: c.voos.length === 0 ? 'neutro' : voosOk === c.voos.length ? 'sucesso' : 'atencao',
      destino: DESTINO_CATEGORIA.passagens,
    },
    {
      id: 'hospedagens',
      rotulo: NOME_CATEGORIA.hospedagens,
      pct: estadias.length === 0 ? null : Math.round((estadiasOk / estadias.length) * 100),
      feitos: estadiasOk,
      total: estadias.length,
      nota:
        estadias.length === 0
          ? 'Nenhuma estadia cadastrada'
          : estadiasOk === estadias.length
            ? 'Concluído'
            : `${plural(estadias.length - estadiasOk, 'reserva', 'reservas')} a confirmar`,
      tom:
        estadias.length === 0 ? 'neutro' : estadiasOk === estadias.length ? 'sucesso' : 'atencao',
      destino: DESTINO_CATEGORIA.hospedagens,
    },
    {
      id: 'pagamentos',
      rotulo: NOME_CATEGORIA.pagamentos,
      pct: pago + devendo === 0 ? null : Math.round((pago / (pago + devendo)) * 100),
      feitos: c.obrigacoes.length - abertas,
      total: c.obrigacoes.length,
      nota:
        c.obrigacoes.length === 0
          ? 'Nada a pagar'
          : vencidas > 0
            ? `${plural(vencidas, 'vencido', 'vencidos')}`
            : abertas === 0
              ? 'Concluído'
              : `${plural(abertas, 'em aberto', 'em aberto')}`,
      tom:
        c.obrigacoes.length === 0
          ? 'neutro'
          : vencidas > 0
            ? 'perigo'
            : abertas === 0
              ? 'sucesso'
              : 'atencao',
      destino: DESTINO_CATEGORIA.pagamentos,
    },
    {
      id: 'tarefas',
      rotulo: NOME_CATEGORIA.tarefas,
      pct:
        c.checklist.length === 0
          ? null
          : Math.round((feitosChecklist / c.checklist.length) * 100),
      feitos: feitosChecklist,
      total: c.checklist.length,
      nota:
        c.checklist.length === 0
          ? 'Não iniciada'
          : feitosChecklist === c.checklist.length
            ? 'Concluído'
            : plural(c.checklist.length - feitosChecklist, 'pendente', 'pendentes'),
      tom:
        c.checklist.length === 0
          ? 'neutro'
          : feitosChecklist === c.checklist.length
            ? 'sucesso'
            : 'atencao',
      destino: DESTINO_CATEGORIA.tarefas,
    },
  ]

  return linhas
}

/**
 * A porcentagem geral: média das categorias aplicáveis, pesada por `PESOS`.
 *
 * `null` quando a viagem ainda não tem nada medível — e aí a tela diz isso, em
 * vez de estampar 0% e sugerir que quem acabou de criar a viagem está atrasado.
 */
export function progresso(linhas: ResumoCategoria[]): number | null {
  const validas = linhas.filter((l) => l.pct !== null)
  if (validas.length === 0) return null
  const peso = validas.reduce((s, l) => s + PESOS[l.id], 0)
  const soma = validas.reduce((s, l) => s + l.pct! * PESOS[l.id], 0)
  return Math.round(soma / peso)
}

// ---------------------------------------------------------------- fase

export type Fase =
  | 'sem-data'
  | 'planejamento'
  | 'reservas'
  | 'revisao'
  | 'final'
  | 'viagem'
  | 'concluida'

/** O que a viagem está pedindo agora, em uma frase. Guia o tom da tela inteira. */
export const NOME_FASE: Record<Fase, { titulo: string; texto: string }> = {
  'sem-data': {
    titulo: 'Sem datas ainda',
    texto: 'Cadastre a ida e a volta para a preparação ganhar prazos.',
  },
  planejamento: {
    titulo: 'Planejamento inicial',
    texto: 'Hora de fechar o roteiro e reunir o que a viagem vai exigir de cada um.',
  },
  reservas: {
    titulo: 'Reservas e documentos',
    texto: 'É agora que passaporte, visto e seguro precisam sair do papel.',
  },
  revisao: {
    titulo: 'Revisão da viagem',
    texto: 'Confira reservas, vouchers e o roteiro final enquanto ainda dá para mudar.',
  },
  final: {
    titulo: 'Preparação final',
    texto: 'Check-in, mala e documentos baixados para abrir sem internet.',
  },
  viagem: {
    titulo: 'Viagem em andamento',
    texto: 'O que importa agora é o próximo compromisso.',
  },
  concluida: { titulo: 'Viagem concluída', texto: 'Nada mais a preparar. Boas lembranças.' },
}

/** Em que etapa a viagem está, pela distância até a partida (§17). */
export function faseDePreparacao(partida: string | null, retorno: string | null, hoje: Date): Fase {
  if (!partida) return 'sem-data'
  const hojeDia = paraDia(hoje)
  if (retorno && dias(hojeDia, retorno) < 0) return 'concluida'
  const faltam = dias(hojeDia, partida)
  if (faltam < 0) return 'viagem'
  if (faltam <= 7) return 'final'
  if (faltam <= 30) return 'revisao'
  if (faltam <= 90) return 'reservas'
  return 'planejamento'
}

// ---------------------------------------------------------------- montagem

export type Degrau = { momento: Momento; rotulo: string; data: string | null; tarefas: Tarefa[] }

export type Preparacao = {
  fase: Fase
  pct: number | null
  categorias: ResumoCategoria[]
  tarefas: Tarefa[]
  degraus: Degrau[]
  urgentes: Tarefa[]
  /** Contagem por fonte, para o cartão de pendências da lateral (§8). */
  porFonte: { fonte: Fonte; total: number; urgentes: number }[]
}

/** A Central inteira, em uma passada. É o que a tela consome. */
export function montarPreparacao(c: Contexto): Preparacao {
  const tarefas = gerarTarefas(c)
  const linhas = categorias(c)

  const porMomento = new Map<Momento, Tarefa[]>()
  for (const t of tarefas) {
    const m = momentoDe(t, c.partida, c.hoje)
    if (!porMomento.has(m)) porMomento.set(m, [])
    porMomento.get(m)!.push(t)
  }

  const degraus: Degrau[] = MOMENTOS.filter((m) => (porMomento.get(m)?.length ?? 0) > 0).map(
    (m) => ({
      momento: m,
      rotulo: NOME_MOMENTO[m],
      data: dataDoMomento(m, c.partida, c.hoje),
      tarefas: porMomento.get(m) ?? [],
    }),
  )

  const fontes = new Map<Fonte, { total: number; urgentes: number }>()
  for (const t of tarefas) {
    const atual = fontes.get(t.fonte) ?? { total: 0, urgentes: 0 }
    atual.total += 1
    if (t.prioridade === 'urgente') atual.urgentes += 1
    fontes.set(t.fonte, atual)
  }

  return {
    fase: faseDePreparacao(c.partida, c.retorno, c.hoje),
    pct: progresso(linhas),
    categorias: linhas,
    tarefas,
    degraus,
    urgentes: tarefas.filter((t) => t.prioridade === 'urgente'),
    porFonte: [...fontes.entries()]
      .map(([fonte, v]) => ({ fonte, ...v }))
      .sort((a, b) => b.urgentes - a.urgentes || b.total - a.total),
  }
}

// ---------------------------------------------------------------- dia da partida

export type Embarque = {
  voo: Voo
  /** Horário sugerido de sair de casa. Ver `SAIR_ANTES_MIN`. */
  sairAs: string | null
}

/**
 * Quanto antes da partida sair de casa. 3h para o aeroporto.
 *
 * É uma sugestão, não um cálculo de trajeto: o app não sabe onde a pessoa está
 * nem quanto trânsito tem. A tela escreve "sugerido" — um horário apresentado
 * como certeza é pior do que horário nenhum, porque se confia nele.
 */
export const SAIR_ANTES_MIN = 180

/**
 * O primeiro voo do dia da partida — o que o cartão do embarque mostra.
 *
 * `null` quando a viagem não começa de avião (cruzeiro, carro) ou quando o voo
 * do dia não está cadastrado. Nos dois casos a tela simplesmente não desenha o
 * cartão, em vez de desenhar uma moldura com trinta traços dentro.
 */
export function embarqueDe(voos: Voo[], partida: string | null): Embarque | null {
  const voo = voos
    .filter((v) => v.parte_em && (!partida || v.parte_em.slice(0, 10) === partida))
    .sort((a, b) => (a.parte_em! < b.parte_em! ? -1 : 1))[0]
  if (!voo) return null

  const p = parseData(voo.parte_em ?? null)
  if (!p) return { voo, sairAs: null }

  const saida = new Date(p.getTime() - SAIR_ANTES_MIN * 60_000)
  const doisDigitos = (n: number) => String(n).padStart(2, '0')
  return { voo, sairAs: `${doisDigitos(saida.getHours())}:${doisDigitos(saida.getMinutes())}` }
}

// ---------------------------------------------------------------- montagem

/**
 * O que `contextoDoSnapshot` precisa ler. Forma estrutural, nao o tipo
 * `Snapshot` do TripProvider: `lib/` nao importa de `components/`, e amarrar o
 * motor ao tipo de um componente cliente impediria o servidor de chama-lo.
 */
export type FonteSnapshot = {
  viagem?: { data_partida?: string | null; data_retorno?: string | null } | null
  participantes?: readonly Record<string, unknown>[]
  requisitos?: readonly unknown[]
  entregas?: readonly unknown[]
  perfis?: readonly unknown[]
  checklist?: readonly unknown[]
  checklist_state?: readonly Record<string, unknown>[]
  documentos?: readonly unknown[]
  voos?: readonly unknown[]
  reservas?: readonly unknown[]
  financeiro?: unknown
}

export type MontagemPreparacao = {
  contexto: Contexto
  participantes: { id: string; nome: string; avatar_url: string | null }[]
}

/**
 * Snapshot -> `Contexto` do motor. Uma montagem so, para os dois lados.
 *
 * Isto morava dentro de um `useMemo` em `components/tabs/Preparacao.tsx`, o que
 * deixava o servidor sem acesso: qualquer codigo de servidor que precisasse da
 * mesma lista teria de remontar o `Contexto` a mao, e passariam a existir DUAS
 * listas de pendencias divergindo em silencio — o mesmo erro que ja aconteceu
 * uma vez entre `/api/mutate` e `/api/snapshot`.
 *
 * O financeiro entra por dois caminhos porque sao duas respostas diferentes do
 * servidor, nao uma com filtro: quem administra recebe as parcelas da viagem,
 * quem viaja recebe so as proprias obrigacoes. As duas viram a MESMA forma aqui,
 * e e isso que deixa uma regra so atender aos dois papeis sem nunca ver o que
 * nao deveria.
 */
export function contextoDoSnapshot(
  s: FonteSnapshot | null | undefined,
  eu: string,
  admin: boolean,
  hoje: Date,
): MontagemPreparacao {
  const v = s?.viagem

  const participantes = (s?.participantes ?? []).map((p) => ({
    id: String(p.id),
    nome: String(p.nome),
    avatar_url: (p.avatar_url as string | null) ?? null,
  }))

  const requisitos = (s?.requisitos ?? []) as unknown as Requisito[]
  const perfis = (s?.perfis ?? []) as unknown as PerfilResumo[]
  const matriz = montarMatriz(
    requisitos,
    (s?.entregas ?? []) as unknown as Submissao[],
    participantes,
    perfis,
    hoje,
  )

  // Campo do perfil que ALGUM requisito puxa e que esta pessoa nao preencheu.
  // So os que a viagem pede: cobrar a nacionalidade de quem nunca vai precisar
  // dela e inventar trabalho, e e assim que uma lista de pendencias perde a
  // credibilidade toda.
  const meuPerfil = perfis.find((p) => p.traveler_id === eu)
  const pedidos = [...new Set(requisitos.map((r) => r.campo_perfil).filter(Boolean))] as string[]
  const perfilFaltando = pedidos
    .filter((c) => !meuPerfil?.campos?.[c])
    .map((c) => ({ chave: c, rotulo: CAMPOS_PERFIL[c]?.rotulo ?? c }))

  const feitos = Object.fromEntries(
    (s?.checklist_state ?? [])
      .filter((e) => String(e.traveler_id) === eu)
      .map((e) => [String(e.item_id), Boolean(e.feito)]),
  )

  const financeiro = s?.financeiro as
    | { admin: true; despesas: unknown; parcelas: unknown }
    | { admin: false; obrigacoes: Obrigacao[] }
    | null
    | undefined

  const obrigacoes: Obrigacao[] = !financeiro
    ? []
    : financeiro.admin
      ? parcelasDaViagem(financeiro.despesas as never, financeiro.parcelas as never, hoje).map(
          (pa) => ({
            id: String(pa.id),
            descricao: pa.descricao,
            valor_centavos: Number(pa.valor_centavos),
            pago_centavos: Number(pa.pago_centavos ?? 0),
            vence_em: pa.vence_em,
            status: pa.status,
          }),
        )
      : financeiro.obrigacoes

  const contexto: Contexto = {
    hoje,
    partida: v?.data_partida ?? null,
    retorno: v?.data_retorno ?? null,
    matriz,
    eu,
    admin,
    perfilFaltando,
    documentos: (s?.documentos ?? []) as never,
    checklist: (s?.checklist ?? []) as never,
    feitos,
    voos: (s?.voos ?? []) as unknown as Voo[],
    reservas: (s?.reservas ?? []) as never,
    obrigacoes,
  }

  return { contexto, participantes }
}
