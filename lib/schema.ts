// Contrato de dados do app: o formato do JSON de importacao e o das mutacoes.
//
// Este arquivo e a fonte da verdade do formato. A skill que converte PDF -> JSON
// gera exatamente isto, e a folha de edicao do admin monta os campos a partir daqui
// em vez de ter 13 formularios escritos a mao.
import { z } from 'zod'

export const SCHEMA_VERSION = 1

// ---------------------------------------------------------------- primitivos

/** "2026-12-30" — data de calendario, sem hora e sem fuso. */
// Os refines abaixo precisam ser defensivos: no zod v4 todos os checks de uma string
// rodam mesmo quando o `.regex` anterior falhou. Sem a guarda, "quinze horas" faria
// split('T')[1] ser undefined e estourar TypeError - virando 500 no import em vez do
// 400 com o nome do campo, que e exatamente o que DATA-04 exige.
const CAL = /^(\d{4})-(\d{2})-(\d{2})$/
const CAL_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/** Confere que os componentes sobrevivem a ida e volta pelo Date (barra rollover). */
function existeNoCalendario(v: unknown, comHora: boolean): boolean {
  if (typeof v !== 'string') return false
  const m = (comHora ? CAL_HORA : CAL).exec(v)
  if (!m) return true // o proprio .regex ja reportou; nao duplica a mensagem
  const [a, mes, d, h = 0, min = 0] = m.slice(1).map((x) => Number(x ?? 0))
  const dt = new Date(a, mes - 1, d, h, min)
  return (
    dt.getFullYear() === a &&
    dt.getMonth() === mes - 1 &&
    dt.getDate() === d &&
    (!comHora || (dt.getHours() === h && dt.getMinutes() === min))
  )
}

const Data = z
  .string()
  .regex(CAL, 'use o formato AAAA-MM-DD')
  .refine((v) => existeNoCalendario(v, false), 'data inexistente no calendario')

/** "2026-12-30T10:30" — hora LOCAL DO DESTINO. Sem Z, sem offset, de proposito. */
const DataHora = z
  .string()
  .regex(CAL_HORA, 'use o formato AAAA-MM-DDTHH:MM')
  .refine((v) => existeNoCalendario(v, true), 'data ou hora inexistente')

const Texto = z.string().trim().min(1, 'nao pode ficar vazio')
const TextoOpc = z.string().trim().nullish()
const Cor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use uma cor hexadecimal, ex: #0F766E')
/** Dinheiro sempre em centavos inteiros. Nunca float. */
const Centavos = z.number().int('use centavos inteiros, nao reais').min(0, 'nao pode ser negativo')
const Id = z.string().trim().min(1).max(64)

// ---------------------------------------------------------------- secoes

export const ViagemSchema = z.object({
  id: Id.optional(),
  nome: Texto,
  subtitulo: TextoOpc,
  data_partida: Data,
  data_retorno: Data,
  moeda: z.string().length(3, 'use o codigo de 3 letras, ex: EUR').default('EUR'),
  cor_destaque: Cor.default('#0F766E'),
})

export const ViajanteSchema = z.object({
  id: Id.optional(),
  nome: Texto,
  papel: z.enum(['admin', 'viajante']).default('viajante'),
  /** PIN em texto puro so na importacao. Vira hash antes de tocar no banco. */
  pin: z
    .string()
    .regex(/^\d{4}$/, 'o PIN precisa ter exatamente 4 digitos')
    .optional(),
  telefone: TextoOpc,
  passaporte: TextoOpc,
  ordem: z.number().int().default(0),
})

export const EventoSchema = z.object({
  id: Id.optional(),
  ocorre_em: DataHora,
  cidade: TextoOpc,
  local: TextoOpc,
  titulo: Texto,
  descricao: TextoOpc,
  tipo: z
    .enum(['voo', 'hospedagem', 'cruzeiro', 'passeio', 'traslado', 'documento', 'refeicao'])
    .default('passeio'),
  /** Dia-ancora: embarque, voo internacional, o que nao pode ser perdido. */
  ancora: z.boolean().default(false),
  nota: TextoOpc,
})

export const EscalaSchema = z.object({
  iata: TextoOpc,
  cidade: TextoOpc,
  espera_min: z.number().int().min(0).nullish(),
  ordem: z.number().int().default(0),
})

export const VooSchema = z.object({
  id: Id.optional(),
  companhia: Texto,
  numero: TextoOpc,
  origem_iata: TextoOpc,
  origem_cidade: TextoOpc,
  destino_iata: TextoOpc,
  destino_cidade: TextoOpc,
  parte_em: DataHora.nullish(),
  chega_em: DataHora.nullish(),
  duracao_min: z.number().int().min(0).nullish(),
  localizador: TextoOpc,
  nota: TextoOpc,
  ordem: z.number().int().default(0),
  escalas: z.array(EscalaSchema).default([]),
})

export const HospedagemSchema = z.object({
  id: Id.optional(),
  nome: Texto,
  cidade: TextoOpc,
  checkin: Data.nullish(),
  checkout: Data.nullish(),
  endereco: TextoOpc,
  link: TextoOpc,
  telefone: TextoOpc,
  nota: TextoOpc,
})

export const LugarSchema = z.object({
  id: Id.optional(),
  cidade: Texto,
  pais: TextoOpc,
  dias: z.number().int().min(0).nullish(),
  notas: TextoOpc,
  /** Sem lat/lon a cidade some do mapa, mas continua na aba Lugares. */
  lat: z.number().min(-90).max(90).nullish(),
  lon: z.number().min(-180).max(180).nullish(),
  ordem: z.number().int().default(0),
})

export const PortoSchema = z.object({
  porto: TextoOpc,
  cidade: TextoOpc,
  pais: TextoOpc,
  chega_em: DataHora.nullish(),
  sai_em: DataHora.nullish(),
  dia_no_mar: z.boolean().default(false),
  ordem: z.number().int().default(0),
  nota: TextoOpc,
})

export const CruzeiroSchema = z.object({
  id: Id.optional(),
  navio: Texto,
  companhia: TextoOpc,
  embarque_em: DataHora.nullish(),
  desembarque_em: DataHora.nullish(),
  porto_embarque: TextoOpc,
  porto_desembarque: TextoOpc,
  cabine: TextoOpc,
  localizador: TextoOpc,
  terminal: TextoOpc,
  nota: TextoOpc,
  portos: z.array(PortoSchema).default([]),
})

export const ChecklistItemSchema = z.object({
  id: Id.optional(),
  titulo: Texto,
  categoria: TextoOpc,
  escopo: z.enum(['global', 'pessoal']).default('global'),
  /** Os PDFs do usuario trazem duas datas por item: a recomendada e o limite. */
  prazo_ideal: Data.nullish(),
  prazo_maximo: Data.nullish(),
  valor_estimado_centavos: Centavos.nullish(),
  detalhe: TextoOpc,
  ordem: z.number().int().default(0),
})

export const DocumentoSchema = z.object({
  id: Id.optional(),
  titulo: Texto,
  valor: TextoOpc,
  tipo: z.enum(['texto', 'link', 'telefone']).default('texto'),
  obs: TextoOpc,
  ordem: z.number().int().default(0),
})

export const EmergenciaSchema = z.object({
  id: Id.optional(),
  titulo: Texto,
  telefone: TextoOpc,
  detalhe: TextoOpc,
  ordem: z.number().int().default(0),
})

export const CategoriaSchema = z.object({
  id: Id.optional(),
  nome: Texto,
  ordem: z.number().int().default(0),
})

export const CustoSchema = z.object({
  id: Id.optional(),
  categoria: TextoOpc,
  descricao: Texto,
  valor_centavos: Centavos,
  /** Quantas pessoas o valor por pessoa multiplica. */
  pessoas: z.number().int().min(1, 'precisa ser pelo menos 1').default(1),
  pago: z.boolean().default(false),
  /** Estimativa de planejamento vs. valor efetivamente cotado. */
  estimado: z.boolean().default(true),
  nota: TextoOpc,
  ordem: z.number().int().default(0),
})

// ---------------------------------------------------------------- importacao

export const TripImportSchema = z.object({
  schemaVersion: z.number().int().max(SCHEMA_VERSION, 'arquivo de uma versao mais nova do app'),
  viagem: ViagemSchema,
  // Toda secao de lista e opcional: uma viagem so com roteiro e valida.
  viajantes: z.array(ViajanteSchema).default([]),
  roteiro: z.array(EventoSchema).default([]),
  voos: z.array(VooSchema).default([]),
  cruzeiros: z.array(CruzeiroSchema).default([]),
  hospedagens: z.array(HospedagemSchema).default([]),
  lugares: z.array(LugarSchema).default([]),
  checklist: z.array(ChecklistItemSchema).default([]),
  documentos: z.array(DocumentoSchema).default([]),
  emergencia: z.array(EmergenciaSchema).default([]),
  categorias: z.array(CategoriaSchema).default([]),
  custos: z.array(CustoSchema).default([]),
})

export type TripImport = z.infer<typeof TripImportSchema>

// ---------------------------------------------------------------- mutacoes

/** As 13 entidades editaveis pela interface. */
export const ENTIDADES = [
  'viagem',
  'viajante',
  'roteiro',
  'voo',
  'escala',
  'cruzeiro',
  'porto',
  'hospedagem',
  'lugar',
  'checklist_item',
  'checklist_state',
  'documento',
  'emergencia',
  'categoria',
  'custo',
] as const

export type Entidade = (typeof ENTIDADES)[number]

export const MutationSchema = z.object({
  op: z.enum(['criar', 'editar', 'remover']),
  entidade: z.enum(ENTIDADES),
  id: Id.nullish(),
  /** Campos a gravar. Validados por entidade no servidor. */
  campos: z.record(z.string(), z.unknown()).default({}),
  /** Carimbo do cliente, base do last-write-wins. */
  client_ts: z.string().datetime({ offset: true }),
})

export const MutationBatchSchema = z.object({
  ops: z.array(MutationSchema).max(500, 'lote grande demais; divida em partes'),
})

/** Valida os campos de uma mutacao contra o schema da entidade correspondente. */
const POR_ENTIDADE: Partial<Record<Entidade, z.ZodTypeAny>> = {
  viagem: ViagemSchema.partial(),
  viajante: ViajanteSchema.partial(),
  roteiro: EventoSchema.partial(),
  voo: VooSchema.partial(),
  escala: EscalaSchema.partial(),
  cruzeiro: CruzeiroSchema.partial(),
  porto: PortoSchema.partial(),
  hospedagem: HospedagemSchema.partial(),
  lugar: LugarSchema.partial(),
  checklist_item: ChecklistItemSchema.partial(),
  documento: DocumentoSchema.partial(),
  emergencia: EmergenciaSchema.partial(),
  categoria: CategoriaSchema.partial(),
  custo: CustoSchema.partial(),
  checklist_state: z.object({ item_id: Id, feito: z.boolean() }).partial(),
}

export function validarCampos(entidade: Entidade, campos: unknown) {
  const schema = POR_ENTIDADE[entidade]
  if (!schema) return { sucesso: false as const, erro: `entidade sem schema: ${entidade}` }
  const r = schema.safeParse(campos)
  return r.success
    ? { sucesso: true as const, dados: r.data }
    : { sucesso: false as const, erro: formatarErroZod(r.error) }
}

// ---------------------------------------------------------------- erros legiveis

/**
 * Transforma o erro do zod em uma linha que aponta o campo exato:
 *   `voos[2].parte_em: use o formato AAAA-MM-DDTHH:MM`
 *
 * Sem isso, um JSON de 40 registros que falha vira "erro de validacao" e o usuario
 * nao tem como saber onde. Este e o requisito DATA-04.
 */
export function formatarErroZod(erro: z.ZodError, maximo = 5): string {
  const linhas = erro.issues.slice(0, maximo).map((i) => {
    const caminho = i.path
      .map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`))
      .join('')
      .replace(/^\./, '')
    return caminho ? `${caminho}: ${i.message}` : i.message
  })
  const resto = erro.issues.length - linhas.length
  return linhas.join('; ') + (resto > 0 ? ` (e mais ${resto})` : '')
}

/** Valida um arquivo de importacao inteiro. */
export function validarImportacao(dados: unknown) {
  const r = TripImportSchema.safeParse(dados)
  return r.success
    ? { sucesso: true as const, dados: r.data }
    : { sucesso: false as const, erro: formatarErroZod(r.error) }
}

/** Contagem por secao, para a pre-visualizacao antes de gravar (DATA-02). */
export function resumirImportacao(dados: TripImport): Record<string, number> {
  return {
    viajantes: dados.viajantes.length,
    roteiro: dados.roteiro.length,
    voos: dados.voos.length,
    cruzeiros: dados.cruzeiros.length,
    portos: dados.cruzeiros.reduce((s, c) => s + c.portos.length, 0),
    hospedagens: dados.hospedagens.length,
    lugares: dados.lugares.length,
    checklist: dados.checklist.length,
    documentos: dados.documentos.length,
    emergencia: dados.emergencia.length,
    categorias: dados.categorias.length,
    custos: dados.custos.length,
  }
}
