// Contrato de dados do app: o formato do JSON de importacao, o das mutacoes e o
// dos formularios de conta.
//
// Este arquivo e a fonte da verdade do formato. O seed gera exatamente isto, a
// folha de edicao monta os campos a partir daqui em vez de ter 16 formularios
// escritos a mao, e o servidor valida contra os mesmos schemas antes de gravar.
import { z } from 'zod'
import { SENHA_MINIMA } from './session.ts'

export const SCHEMA_VERSION = 2

// ---------------------------------------------------------------- primitivos

/** "2026-12-30" — data de calendario, sem hora e sem fuso. */
// Os refines abaixo precisam ser defensivos: no zod v4 todos os checks de uma string
// rodam mesmo quando o `.regex` anterior falhou. Sem a guarda, "quinze horas" faria
// split('T')[1] ser undefined e estourar TypeError - virando 500 no import em vez do
// 400 com o nome do campo.
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
const Url = z.string().trim().url('link invalido').nullish()

export const PAPEIS = ['proprietario', 'editor', 'visualizador'] as const

// ---------------------------------------------------------------- conta

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'informe o e-mail')
  .email('e-mail invalido')
  .max(254)

const Senha = z.string().min(SENHA_MINIMA, `use pelo menos ${SENHA_MINIMA} caracteres`).max(200)

export const LoginSchema = z.object({
  email: Email,
  // No login a senha nao passa pelo piso: uma conta antiga com senha curta ainda
  // precisa conseguir entrar. O piso vale no cadastro e na troca.
  senha: z.string().min(1, 'informe a senha').max(200),
})

export const CadastroSchema = z
  .object({
    nome: Texto.max(120),
    email: Email,
    senha: Senha,
    confirmacao: z.string(),
  })
  .refine((d) => d.senha === d.confirmacao, {
    message: 'as senhas nao sao iguais',
    path: ['confirmacao'],
  })

export const PerfilSchema = z.object({
  nome: Texto.max(120),
  avatar_url: Url,
})

export const TrocaSenhaSchema = z
  .object({ atual: z.string().min(1, 'informe a senha atual'), nova: Senha, confirmacao: z.string() })
  .refine((d) => d.nova === d.confirmacao, {
    message: 'as senhas nao sao iguais',
    path: ['confirmacao'],
  })

// ---------------------------------------------------------------- secoes

export const ViagemSchema = z.object({
  id: Id.optional(),
  nome: Texto,
  subtitulo: TextoOpc,
  descricao: TextoOpc,
  data_partida: Data,
  data_retorno: Data,
  moeda: z.string().length(3, 'use o codigo de 3 letras, ex: BRL').default('BRL'),
  cor_destaque: Cor.default('#0F766E'),
  capa_url: Url,
  arquivada: z.boolean().default(false),
})

export const ParticipanteSchema = z.object({
  id: Id.optional(),
  nome: Texto,
  /** Vincula o participante a uma conta existente. Sem isso ele e so um nome. */
  email: TextoOpc,
  papel: z.enum(PAPEIS).default('visualizador'),
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
  terminal: TextoOpc,
  portao: TextoOpc,
  assento: TextoOpc,
  bagagem: TextoOpc,
  nota: TextoOpc,
  ordem: z.number().int().default(0),
  escalas: z.array(EscalaSchema).default([]),
})

export const TIPOS_RESERVA = [
  'hospedagem',
  'restaurante',
  'passeio',
  'ingresso',
  'carro',
  'transporte',
  'outro',
] as const

export const ReservaSchema = z.object({
  id: Id.optional(),
  tipo: z.enum(TIPOS_RESERVA).default('hospedagem'),
  nome: Texto,
  cidade: TextoOpc,
  inicio_em: DataHora.nullish(),
  fim_em: DataHora.nullish(),
  endereco: TextoOpc,
  link: TextoOpc,
  telefone: TextoOpc,
  localizador: TextoOpc,
  valor_centavos: Centavos.nullish(),
  nota: TextoOpc,
  ordem: z.number().int().default(0),
})

export const LugarSchema = z.object({
  id: Id.optional(),
  cidade: Texto,
  pais: TextoOpc,
  dias: z.number().int().min(0).nullish(),
  status: z.enum(['planejada', 'visitada']).default('planejada'),
  chega_em: Data.nullish(),
  sai_em: Data.nullish(),
  notas: TextoOpc,
  /** Sem lat/lon a cidade some do mapa, mas continua na lista. */
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
  tipo: z.enum(['texto', 'link', 'telefone', 'arquivo']).default('texto'),
  categoria: TextoOpc,
  arquivo_url: TextoOpc,
  arquivo_mime: TextoOpc,
  arquivo_bytes: z.number().int().min(0).nullish(),
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
  moeda: TextoOpc,
  /** Quantas pessoas o valor por pessoa multiplica. */
  pessoas: z.number().int().min(1, 'precisa ser pelo menos 1').default(1),
  ocorre_em: Data.nullish(),
  pago: z.boolean().default(false),
  /** Estimativa de planejamento vs. valor efetivamente cotado. */
  estimado: z.boolean().default(true),
  nota: TextoOpc,
  ordem: z.number().int().default(0),
})

export const MensagemSchema = z.object({
  texto: Texto.max(2000, 'mensagem longa demais'),
})

// ---------------------------------------------------------------- importacao

export const TripImportSchema = z.object({
  schemaVersion: z.number().int().max(SCHEMA_VERSION, 'arquivo de uma versao mais nova do app'),
  viagem: ViagemSchema,
  // Toda secao de lista e opcional: uma viagem so com roteiro e valida.
  participantes: z.array(ParticipanteSchema).default([]),
  roteiro: z.array(EventoSchema).default([]),
  voos: z.array(VooSchema).default([]),
  cruzeiros: z.array(CruzeiroSchema).default([]),
  reservas: z.array(ReservaSchema).default([]),
  lugares: z.array(LugarSchema).default([]),
  checklist: z.array(ChecklistItemSchema).default([]),
  documentos: z.array(DocumentoSchema).default([]),
  emergencia: z.array(EmergenciaSchema).default([]),
  categorias: z.array(CategoriaSchema).default([]),
  custos: z.array(CustoSchema).default([]),
})

export type TripImport = z.infer<typeof TripImportSchema>

// ---------------------------------------------------------------- mutacoes

/** As entidades editaveis pela interface. */
export const ENTIDADES = [
  'viagem',
  'participante',
  'roteiro',
  'voo',
  'escala',
  'cruzeiro',
  'porto',
  'reserva',
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
  trip_id: Id,
  ops: z.array(MutationSchema).max(500, 'lote grande demais; divida em partes'),
})

/** Valida os campos de uma mutacao contra o schema da entidade correspondente. */
const POR_ENTIDADE: Partial<Record<Entidade, z.ZodTypeAny>> = {
  viagem: ViagemSchema.partial(),
  participante: ParticipanteSchema.partial(),
  roteiro: EventoSchema.partial(),
  voo: VooSchema.partial(),
  escala: EscalaSchema.partial(),
  cruzeiro: CruzeiroSchema.partial(),
  porto: PortoSchema.partial(),
  reserva: ReservaSchema.partial(),
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
 * nao tem como saber onde.
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

/** Primeiro erro por campo. E o que o formulario precisa para marcar o input. */
export function errosPorCampo(erro: z.ZodError): Record<string, string> {
  const saida: Record<string, string> = {}
  for (const i of erro.issues) {
    const chave = String(i.path[0] ?? '_')
    if (!saida[chave]) saida[chave] = i.message
  }
  return saida
}

/** Valida um arquivo de importacao inteiro. */
export function validarImportacao(dados: unknown) {
  const r = TripImportSchema.safeParse(dados)
  return r.success
    ? { sucesso: true as const, dados: r.data }
    : { sucesso: false as const, erro: formatarErroZod(r.error) }
}

/** Contagem por secao, para a pre-visualizacao antes de gravar. */
export function resumirImportacao(dados: TripImport): Record<string, number> {
  return {
    participantes: dados.participantes.length,
    roteiro: dados.roteiro.length,
    voos: dados.voos.length,
    cruzeiros: dados.cruzeiros.length,
    portos: dados.cruzeiros.reduce((s, c) => s + c.portos.length, 0),
    reservas: dados.reservas.length,
    lugares: dados.lugares.length,
    checklist: dados.checklist.length,
    documentos: dados.documentos.length,
    emergencia: dados.emergencia.length,
    categorias: dados.categorias.length,
    custos: dados.custos.length,
  }
}
