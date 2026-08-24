// Contrato de dados do app: o formato do JSON de importacao, o das mutacoes e o
// dos formularios de conta.
//
// Este arquivo e a fonte da verdade do formato. O seed gera exatamente isto, a
// folha de edicao monta os campos a partir daqui em vez de ter 16 formularios
// escritos a mao, e o servidor valida contra os mesmos schemas antes de gravar.
import { z } from 'zod'

// v3: a despesa passou a guardar o valor TOTAL (era valor por pessoa x `pessoas`)
// e ganhou divisao por participante, parcelas e pagador. Arquivos v2 continuam
// sendo aceitos e sao convertidos na leitura — eles vivem no HD das pessoas.
export const SCHEMA_VERSION = 3

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

// Fonte da verdade do piso da senha -- lib/session.ts também importa daqui.
// Não pode ser o contrário: session.ts usa node:crypto e next/headers, então
// se este arquivo dependesse dele, formulário de conta (client component)
// levaria scrypt pro bundle do navegador junto.
export const SENHA_MINIMA = 6
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

/** Moedas que o app sabe formatar. Fora da lista, `formatarDinheiro` cairia
    num símbolo genérico — melhor barrar na entrada do que exibir errado. */
export const MOEDAS = ['BRL', 'EUR', 'USD', 'GBP', 'ARS', 'CLP'] as const

export const PerfilSchema = z.object({
  nome: Texto.max(120),
  avatar_url: Url,
  // Telefone fica livre de propósito: o app é usado em sete países e qualquer
  // máscara que eu inventasse recusaria um número legítimo lá fora.
  telefone: z.string().trim().max(40).nullish(),
  moeda_preferida: z.enum(MOEDAS).default('BRL'),
  notificacoes: z.boolean().default(true),
})

export const TrocaSenhaSchema = z
  .object({
    atual: z.string().min(1, 'informe a senha atual'),
    nova: Senha,
    confirmacao: z.string(),
  })
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
  /** Orcamento previsto. Nulo = ninguem definiu; a tela convida em vez de exibir zero. */
  orcamento_centavos: Centavos.nullish(),
})

export const ParticipanteSchema = z.object({
  id: Id.optional(),
  nome: Texto,
  /** Vincula o participante a uma conta existente. Sem isso ele e so um nome. */
  email: TextoOpc,
  papel: z.enum(PAPEIS).default('visualizador'),
  telefone: TextoOpc,
  passaporte: TextoOpc,
  /** CPF ou RG -- diferente de `passaporte` (documento de viagem internacional). */
  documento: TextoOpc,
  nascimento: Data.nullish(),
  ordem: z.number().int().default(0),
})

/**
 * Os tipos de item do roteiro. Nao sao so atividades turisticas: tarefa, dica e
 * observacao existem para o dia poder guardar o que nao tem hora marcada.
 *
 * Espelha o check de `itinerary_events.tipo`. Acrescentar um valor aqui sem
 * acrescentar la faz o insert estourar em producao com "violates check constraint".
 */
export const TIPOS_EVENTO = [
  'voo',
  'trem',
  'onibus',
  'traslado',
  'caminhada',
  'cruzeiro',
  'hospedagem',
  'local',
  'passeio',
  'ponto',
  'restaurante',
  'refeicao',
  'compras',
  'evento',
  'tarefa',
  'compromisso',
  'dica',
  'observacao',
  'documento',
] as const

/** Modos de transporte de uma opcao de "como chegar". Espelha itinerary_options.modo. */
export const MODOS_TRANSPORTE = [
  'a_pe',
  'metro',
  'onibus',
  'trem',
  'taxi',
  'carro',
  'barco',
  'aviao',
] as const

/**
 * Uma opcao de deslocamento ate um item: a pe, de metro, de taxi.
 *
 * `custo` e TEXTO ("30-40 EUR"), nao centavos, de proposito: e a faixa que um
 * guia informa, nao uma despesa. Dinheiro que entra na conta da viagem mora em
 * `expenses` e passa por resolverDivisao.
 */
export const OpcaoSchema = z.object({
  id: Id.optional(),
  modo: z.enum(MODOS_TRANSPORTE).default('a_pe'),
  duracao_min: z.number().int().min(0).nullish(),
  distancia_m: z.number().int().min(0).nullish(),
  custo: TextoOpc,
  detalhe: TextoOpc,
  recomendado: z.boolean().default(false),
  ordem: z.number().int().default(0),
})

export const EventoSchema = z.object({
  id: Id.optional(),
  ocorre_em: DataHora,
  fim_em: DataHora.nullish(),
  cidade: TextoOpc,
  local: TextoOpc,
  endereco: TextoOpc,
  lat: z.number().min(-90).max(90).nullish(),
  lon: z.number().min(-180).max(180).nullish(),
  titulo: Texto,
  descricao: TextoOpc,
  tipo: z.enum(TIPOS_EVENTO).default('passeio'),
  /** Dia-ancora: embarque, voo internacional, o que nao pode ser perdido. */
  ancora: z.boolean().default(false),
  /** O deslocamento ATE este item, nao a partir dele. */
  distancia_m: z.number().int().min(0).nullish(),
  duracao_min: z.number().int().min(0).nullish(),
  transporte: TextoOpc,
  como_chegar: TextoOpc,
  /** Uma dica por linha. */
  dicas: TextoOpc,
  /** "Rotulo|https://..." por linha. */
  links: TextoOpc,
  /** Custo ESTIMADO. Nao e despesa: nao entra em nenhuma divisao. */
  custo_centavos: z.number().int().min(0).nullish(),
  reserva_id: Id.nullish(),
  documento_id: Id.nullish(),
  /**
   * No ARQUIVO os dois vinculos acima viajam por nome, nao por id: nenhum id
   * sobrevive a uma importacao (todos sao recriados), e e o mesmo caminho que o
   * pagamento ja usa para reencontrar a parcela. Na mutacao eles sao removidos
   * pelo omit em POR_ENTIDADE — nao existem como coluna.
   */
  reserva: TextoOpc,
  documento: TextoOpc,
  nota: TextoOpc,
  ordem: z.number().int().default(0),
  opcoes: z.array(OpcaoSchema).default([]),
})

/**
 * Um dia com anotacao. So existe quando alguem escreveu algo sobre ele — a lista
 * de dias vem das datas da viagem, nao daqui.
 */
export const DiaSchema = z.object({
  id: Id.optional(),
  dia: Data,
  titulo: TextoOpc,
  cidade: TextoOpc,
  pais: TextoOpc,
  resumo: TextoOpc,
  ancora: z.boolean().default(false),
  /** Um item por linha, nas tres listas abaixo. */
  alertas: TextoOpc,
  antes_sair: TextoOpc,
  antes_dormir: TextoOpc,
  links: TextoOpc,
  mapa_url: TextoOpc,
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

export const PRIORIDADES_CHECKLIST = ['obrigatorio', 'importante', 'recomendado', 'opcional'] as const
export const FONTES_CHECKLIST = ['documento', 'pesquisa', 'sugestao', 'manual'] as const

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
  /** Donos do item (participante_id). Vazio = todos — so faz sentido em escopo global;
      em escopo pessoal a regra "precisa ter dono" e imposta pela constraint do banco,
      nao aqui, porque este schema tambem vira .partial() para edicao de um campo so. */
  assigned_to: z.array(Id).default([]),
  /** So no ARQUIVO: nomes de participante, resolvidos para assigned_to na
      importacao — mesmo padrao de EventoSchema.reserva/documento (id nao
      sobrevive a exportar/importar, nome sim). */
  assigned_to_nomes: z.array(Texto).nullish(),
  prioridade: z.enum(PRIORIDADES_CHECKLIST).default('importante'),
  pais: TextoOpc,
  cidade: TextoOpc,
  itinerary_event_id: Id.nullish(),
  flight_id: Id.nullish(),
  cruise_id: Id.nullish(),
  /** Sugestao da skill ainda nao revisada pelo admin (ve-se so na tela de revisao). */
  pendente: z.boolean().default(false),
  fonte_tipo: z.enum(FONTES_CHECKLIST).nullish(),
  fonte_detalhe: TextoOpc,
  fonte_consultado_em: Data.nullish(),
})

/**
 * Formato de saida da skill viagem-para-json para sugestoes de checklist — nunca
 * gravado como esta. `resolverSugestoes` (lib/checklist.ts) resolve os campos por
 * nome para os ids reais antes de criar um ChecklistItemSchema de verdade.
 */
export const ChecklistSugestaoSchema = z
  .object({
    titulo: Texto,
    categoria: TextoOpc,
    escopo: z.enum(['global', 'pessoal']).default('global'),
    /** Nomes de participantes, resolvidos para assigned_to na importacao. */
    assigned_to_nomes: z.array(Texto).default([]),
    prioridade: z.enum(PRIORIDADES_CHECKLIST).default('importante'),
    pais: TextoOpc,
    cidade: TextoOpc,
    /** Nome do passeio/hospedagem, voo ou cruzeiro no roteiro — por nome, mesmo
        padrao que EventoSchema.reserva/documento ja usa. */
    evento: TextoOpc,
    voo: TextoOpc,
    cruzeiro: TextoOpc,
    prazo_ideal: Data.nullish(),
    prazo_maximo: Data.nullish(),
    fonte_tipo: z.enum(FONTES_CHECKLIST),
    fonte_detalhe: TextoOpc,
    fonte_consultado_em: Data.nullish(),
  })
  .refine((d) => d.fonte_tipo !== 'pesquisa' || (d.fonte_detalhe && d.fonte_consultado_em), {
    message: 'sugestao de fonte pesquisa exige fonte_detalhe e fonte_consultado_em',
    path: ['fonte_detalhe'],
  })

export const ChecklistSugestoesBatchSchema = z.object({
  viagem: Texto,
  gerado_em: Data,
  sugestoes: z.array(ChecklistSugestaoSchema).default([]),
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

// ---------------------------------------------------------------- financeiro
//
// Tres papeis que nao podem ser confundidos: quem PAGOU o fornecedor
// (`traveler_id` na despesa), quem DEVE arcar com ela (`divisoes`) e quem
// REEMBOLSA quem (`pagamento`). Cada um tem o seu schema.

export const DIVISOES = ['igual', 'peso', 'personalizado'] as const

/** Quanto cabe a um participante numa despesa. `peso` 2 = duas partes (casal). */
export const DivisaoSchema = z.object({
  traveler_id: Id,
  peso: z.number().int().min(0).max(999).default(1),
  valor_centavos: Centavos.default(0),
})

/**
 * Uma parcela ja gravada, editada sozinha.
 *
 * Existe separada de `ParcelaSchema` porque marcar uma parcela como quitada e a
 * acao mais frequente da tela, e reenviar a despesa inteira para mudar um campo
 * de uma linha e o caminho mais curto para duas pessoas se atropelarem.
 */
export const ParcelaMutacaoSchema = z.object({
  expense_id: Id,
  numero: z.number().int().min(1),
  vence_em: Data.nullish(),
  valor_centavos: Centavos,
  pago_centavos: Centavos,
  pago_em: Data.nullish(),
})

/** Uma parcela. A vista e uma parcela unica — nunca um caminho separado. */
export const ParcelaSchema = z.object({
  numero: z.number().int().min(1, 'a primeira parcela e a 1'),
  vence_em: Data.nullish(),
  valor_centavos: Centavos,
  /** Quanto ja foi pago ao fornecedor. Reembolso entre pessoas e `pagamento`. */
  pago_centavos: Centavos.default(0),
  pago_em: Data.nullish(),
})

export const FREQUENCIAS = ['mensal', 'quinzenal', 'semanal'] as const

/**
 * Despesa, no formato das MUTACOES (ids, nao nomes).
 *
 * `valor_centavos` e o valor TOTAL. A divisao chega junto porque uma despesa e a
 * sua divisao sao um fato so — gravar em duas idas deixaria uma despesa sem
 * divisao na tela se a segunda falhasse, e despesa sem divisao e dinheiro que
 * ninguem deve.
 *
 * As parcelas NAO chegam prontas: o cliente manda a INTENCAO (quantas, a partir
 * de quando, com que frequencia) e quem calcula os valores e o servidor. Assim a
 * aritmetica que faz a soma fechar acontece num lugar so, testado, em vez de
 * depender de o navegador ter arredondado igual.
 *
 * Este schema NAO e parcial nas mutacoes: editar uma despesa reenvia a despesa
 * inteira. Meia despesa gravada e um numero errado na tela de outra pessoa.
 */
export const DespesaSchema = z.object({
  id: Id.optional(),
  categoria_id: Id.nullish(),
  /** Quem pagou o fornecedor. */
  traveler_id: Id.nullish(),
  descricao: Texto,
  valor_centavos: Centavos,
  moeda: TextoOpc,
  ocorre_em: Data.nullish(),
  divisao: z.enum(DIVISOES).default('igual'),
  /** Estimativa de planejamento vs. valor efetivamente cotado. */
  estimado: z.boolean().default(true),
  nota: TextoOpc,
  ordem: z.number().int().default(0),
  divisoes: z.array(DivisaoSchema).max(60, 'gente demais numa despesa so').default([]),
  parcelas_quantidade: z
    .number()
    .int()
    .min(1, 'precisa ser pelo menos 1')
    .max(120, 'parcelas demais')
    .default(1),
  parcelas_primeira_em: Data.nullish(),
  parcelas_frequencia: z.enum(FREQUENCIAS).default('mensal'),
})

/** Reembolso de uma pessoa para outra. */
export const PagamentoSchema = z.object({
  id: Id.optional(),
  de_id: Id.nullish(),
  para_id: Id.nullish(),
  /** Parcela a que se refere. Nulo = acerto avulso. */
  parcela_id: Id.nullish(),
  valor_centavos: Centavos,
  ocorre_em: Data.nullish(),
  referencia: TextoOpc,
  nota: TextoOpc,
})

/**
 * Despesa no formato do ARQUIVO de importacao: referencia pessoas e categorias
 * por NOME, porque ids nao sobrevivem a exportar de uma viagem e importar noutra.
 */
export const CustoSchema = z.object({
  id: Id.optional(),
  categoria: TextoOpc,
  descricao: Texto,
  /** Valor TOTAL da despesa. Em arquivos v2 isto era o valor por pessoa. */
  valor_centavos: Centavos,
  moeda: TextoOpc,
  ocorre_em: Data.nullish(),
  /** Nome do participante que pagou o fornecedor. */
  pagador: TextoOpc,
  divisao: z.enum(DIVISOES).default('igual'),
  estimado: z.boolean().default(true),
  nota: TextoOpc,
  ordem: z.number().int().default(0),
  divisoes: z
    .array(
      z.object({
        participante: Texto,
        peso: z.number().int().min(0).max(999).default(1),
        valor_centavos: Centavos.default(0),
      }),
    )
    .default([]),
  parcelas: z.array(ParcelaSchema).default([]),
  // Campos so do formato v2, lidos para converter arquivos antigos e nunca escritos.
  pessoas: z.number().int().min(1).optional(),
  pago: z.boolean().optional(),
})

/**
 * Reembolso no formato do arquivo: pessoas por nome.
 *
 * A parcela a que ele se refere e apontada por descricao da despesa + numero,
 * porque o id da parcela e recriado na importacao.
 *
 * ponytail: duas despesas com a MESMA descricao e um reembolso amarrado a uma
 * delas restauram com o reembolso na primeira. O saldo continua exato (ele so
 * depende de quem pagou quanto a quem); o que troca de lugar e o rotulo "pago
 * desta parcela". Se um dia isso incomodar, exporte tambem a ordem da despesa.
 */
export const PagamentoArquivoSchema = z.object({
  de: TextoOpc,
  para: TextoOpc,
  valor_centavos: Centavos,
  ocorre_em: Data.nullish(),
  despesa: TextoOpc,
  parcela: z.number().int().min(1).nullish(),
  referencia: TextoOpc,
  nota: TextoOpc,
})

/**
 * Categorias sugeridas quando a viagem ainda nao tem nenhuma. Ficam aqui, e nao
 * em config/, porque sao vocabulario de dado — a viagem grava as suas proprias
 * e pode renomear qualquer uma.
 */
export const CATEGORIAS_PADRAO = [
  'Passagens',
  'Hospedagem',
  'Transporte',
  'Alimentação',
  'Passeios',
  'Ingressos',
  'Seguro',
  'Documentos',
  'Compras',
  'Outros',
] as const

export const MensagemSchema = z.object({
  texto: Texto.max(2000, 'mensagem longa demais'),
})

// ---------------------------------------------------------------- importacao

const TripArquivoSchema = z.object({
  schemaVersion: z.number().int().max(SCHEMA_VERSION, 'arquivo de uma versao mais nova do app'),
  viagem: ViagemSchema,
  // Toda secao de lista e opcional: uma viagem so com roteiro e valida.
  participantes: z.array(ParticipanteSchema).default([]),
  roteiro: z.array(EventoSchema).default([]),
  dias: z.array(DiaSchema).default([]),
  voos: z.array(VooSchema).default([]),
  cruzeiros: z.array(CruzeiroSchema).default([]),
  reservas: z.array(ReservaSchema).default([]),
  lugares: z.array(LugarSchema).default([]),
  checklist: z.array(ChecklistItemSchema).default([]),
  documentos: z.array(DocumentoSchema).default([]),
  emergencia: z.array(EmergenciaSchema).default([]),
  categorias: z.array(CategoriaSchema).default([]),
  custos: z.array(CustoSchema).default([]),
  pagamentos: z.array(PagamentoArquivoSchema).default([]),
})

/**
 * Converte um arquivo v2 para o modelo v3, na leitura.
 *
 * Em v2 `valor_centavos` era o valor POR PESSOA e `pessoas` multiplicava; em v3
 * o campo e o total. Sem esta conversao, reimportar um backup antigo dividiria
 * o orcamento da viagem pelo numero de pessoas em silencio.
 *
 * O arquivo v2 nao diz QUEM dividia a despesa (so quantos eram), entao a divisao
 * fica vazia de proposito — inventar participante seria pior do que a viagem
 * abrir com as despesas marcadas como "a dividir".
 */
export const TripImportSchema = TripArquivoSchema.transform((d) => {
  if (d.schemaVersion >= 3) return d
  return {
    ...d,
    custos: d.custos.map((c) => {
      const total = c.valor_centavos * (c.pessoas ?? 1)
      return {
        ...c,
        valor_centavos: total,
        parcelas:
          c.parcelas.length > 0
            ? c.parcelas
            : [
                {
                  numero: 1,
                  vence_em: c.ocorre_em ?? null,
                  valor_centavos: total,
                  pago_centavos: c.pago ? total : 0,
                  pago_em: c.pago ? (c.ocorre_em ?? null) : null,
                },
              ],
      }
    }),
  }
})

export type TripImport = z.infer<typeof TripImportSchema>

// ---------------------------------------------------------------- mutacoes

/** As entidades editaveis pela interface. */
export const ENTIDADES = [
  'viagem',
  'participante',
  'roteiro',
  'dia',
  'opcao',
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
  // `custo` e a despesa. O nome ficou de quando ela era so um valor na lista;
  // renomear quebraria as operacoes que estao na fila offline de quem ja usa.
  'custo',
  'parcela',
  'pagamento',
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
  // `opcoes` chega junto por conveniencia do formulario e e gravado pela
  // entidade `opcao`; o omit evita que o insert generico tente escrever a
  // coluna inexistente `opcoes` em itinerary_events.
  roteiro: EventoSchema.omit({ opcoes: true, reserva: true, documento: true }).partial(),
  dia: DiaSchema.partial(),
  opcao: OpcaoSchema.partial(),
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
  // Despesa NÃO é parcial: editar reenvia o registro inteiro. Ver DespesaSchema.
  custo: DespesaSchema,
  parcela: ParcelaMutacaoSchema.partial(),
  pagamento: PagamentoSchema.partial(),
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
    dias: dados.dias.length,
    opcoes: dados.roteiro.reduce((s, e) => s + e.opcoes.length, 0),
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
    parcelas: dados.custos.reduce((s, c) => s + c.parcelas.length, 0),
    pagamentos: dados.pagamentos.length,
  }
}
