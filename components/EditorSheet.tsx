'use client'

// Folha de edição do admin: criar, alterar e remover qualquer registro.
//
// Um componente para treze entidades, dirigido por uma tabela de campos. A
// alternativa era treze formulários escritos à mão que envelheceriam em ritmos
// diferentes — e é justamente o que "CRUD pra tudo" costuma virar.
//
// Só o campo mínimo é obrigatório. Todo o resto aceita vazio, porque imprevisto
// em viagem raramente chega com a informação completa (EDIT-03).
import { useState, type ReactNode } from 'react'
import { Trash2, Pencil, Plus } from 'lucide-react'
import {
  AppModal,
  Botao,
  ConfirmarDialogo,
  GrupoCampos,
  RotuloCampo,
  CLASSE_CAMPO,
  tomDoTipo,
  useAviso,
} from './ui.tsx'
import { useTrip } from './TripProvider.tsx'
import { paraCampoDinheiro, paraCentavos, parseData } from '@/lib/derive.ts'
import { TIPOS_EVENTO, MODOS_TRANSPORTE, PRIORIDADES_CHECKLIST } from '@/lib/schema.ts'
import { type Papel } from '@/config/navigation.ts'

type TipoCampo =
  | 'texto'
  | 'area'
  | 'data'
  | 'datahora'
  | 'numero'
  | 'dinheiro'
  | 'bool'
  | 'opcao'
  | 'multiopcao'

type Campo = {
  chave: string
  rotulo: string
  tipo: TipoCampo
  obrigatorio?: boolean
  opcoes?: { valor: string; nome: string }[]
  dica?: string
  /**
   * Preenche as opções com registros da própria viagem em vez de uma lista
   * fixa. É o que transforma "reserva_id" de um campo de id digitado à mão —
   * inusável — numa seleção de "Motel One Hamburg · 01 jan".
   */
  fonte?: 'reservas' | 'documentos' | 'participantes' | 'roteiro' | 'voos' | 'cruzeiros'
  /**
   * Desenha as opções como grade de chips COLORIDOS em vez de um `<select>`.
   *
   * Só vale onde o valor já tem cor no sistema (`TONS`/`ALIAS_TOM`) — hoje o
   * `tipo` do item de roteiro. A linha do tempo pinta cada evento pelo tipo, e
   * até aqui a escolha era feita num dropdown cinza: escolhia-se "Passeio" sem
   * ver que passeio é roxo, e só depois de salvar a cor aparecia. O chip mostra
   * o resultado ANTES do clique.
   *
   * `<option>` não aceita cor de fundo de forma confiável em nenhum navegador —
   * daí a grade, e não um select estilizado.
   */
  cores?: boolean
  /** Seção do formulário. Campos sem grupo caem em "Informações básicas". */
  grupo?: string
}

// Nomes de seção. Constantes porque a mesma seção aparece em várias entidades e
// um typo silencioso criaria um grupo duplicado com nome quase igual.
const BASICO = 'Informações básicas'
const DATAS = 'Datas e horários'
const RESERVA = 'Reserva'
const CONTATO = 'Contato'
const OBS = 'Observações'
const LOCAL = 'Local'
const CHEGAR = 'Como chegar'
const VINCULOS = 'Reserva, documento e custo'
const DIA = 'O dia'
const RITUAIS = 'Antes de sair e antes de dormir'
const DESTINO = 'Destino'
const VINCULO_ROTEIRO = 'Vínculo com o roteiro'

/** Nome de exibição de cada tipo de item. Espelha NOMES em ui.tsx. */
const NOME_TIPO: Record<string, string> = {
  voo: 'Voo',
  trem: 'Trem',
  onibus: 'Ônibus',
  traslado: 'Transporte / traslado',
  caminhada: 'Caminhada',
  cruzeiro: 'Cruzeiro',
  hospedagem: 'Hospedagem',
  local: 'Local',
  passeio: 'Passeio',
  ponto: 'Ponto turístico',
  restaurante: 'Restaurante',
  refeicao: 'Refeição',
  compras: 'Compras',
  evento: 'Evento',
  tarefa: 'Tarefa',
  compromisso: 'Compromisso',
  dica: 'Dica',
  observacao: 'Observação',
  documento: 'Documento',
}

const NOME_MODO: Record<string, string> = {
  a_pe: 'A pé',
  metro: 'Transporte público / metrô',
  onibus: 'Ônibus',
  trem: 'Trem',
  taxi: 'Táxi / carro de app',
  carro: 'Carro',
  barco: 'Barco / balsa',
  aviao: 'Avião',
}

const NOME_PRIORIDADE: Record<string, string> = {
  obrigatorio: 'Obrigatório',
  importante: 'Importante',
  recomendado: 'Recomendado',
  opcional: 'Opcional',
}

/** Entidade -> campos editáveis. Espelha os schemas zod de lib/schema.ts. */
export const CAMPOS: Record<string, { nome: string; campos: Campo[] }> = {
  viagem: {
    nome: 'Viagem',
    campos: [
      { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
      { chave: 'subtitulo', rotulo: 'Subtítulo', tipo: 'texto' },
      { chave: 'data_partida', rotulo: 'Partida', tipo: 'data', obrigatorio: true, grupo: DATAS },
      { chave: 'data_retorno', rotulo: 'Retorno', tipo: 'data', obrigatorio: true, grupo: DATAS },
      { chave: 'moeda', rotulo: 'Moeda', tipo: 'texto', dica: 'BRL, EUR, USD', grupo: 'Aparência' },
      {
        chave: 'fuso',
        rotulo: 'Fuso do destino',
        tipo: 'texto',
        dica: 'Europe/Madrid — vazio usa o relógio do aparelho',
        grupo: DATAS,
      },
      {
        chave: 'cor_destaque',
        rotulo: 'Cor de destaque',
        tipo: 'texto',
        dica: '#0F766E',
        grupo: 'Aparência',
      },
    ],
  },
  participante: {
    nome: 'Participante',
    campos: [
      {
        chave: 'nome',
        rotulo: 'Nome',
        tipo: 'texto',
        obrigatorio: true,
        dica: 'igual ao passaporte',
      },
      {
        chave: 'email',
        rotulo: 'E-mail',
        tipo: 'texto',
        dica: 'liga a uma conta existente, se houver',
      },
      {
        chave: 'papel',
        rotulo: 'Papel',
        tipo: 'opcao',
        opcoes: [
          { valor: 'visualizador', nome: 'Visualizador' },
          { valor: 'editor', nome: 'Editor' },
          { valor: 'proprietario', nome: 'Dono da viagem' },
        ],
      },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto', grupo: CONTATO },
      { chave: 'documento', rotulo: 'CPF ou RG', tipo: 'texto', grupo: 'Documentos' },
      { chave: 'passaporte', rotulo: 'Passaporte', tipo: 'texto', grupo: 'Documentos' },
      { chave: 'nascimento', rotulo: 'Nascimento', tipo: 'data', grupo: 'Documentos' },
    ],
  },
  roteiro: {
    nome: 'Item do roteiro',
    campos: [
      { chave: 'titulo', rotulo: 'Título', tipo: 'texto', obrigatorio: true },
      {
        chave: 'tipo',
        rotulo: 'Tipo',
        tipo: 'opcao',
        // A cor do evento na linha do tempo sai daqui. Ver `cores` em `Campo`.
        cores: true,
        opcoes: TIPOS_EVENTO.map((v) => ({ valor: v, nome: NOME_TIPO[v] })),
      },
      { chave: 'ocorre_em', rotulo: 'Começa', tipo: 'datahora', obrigatorio: true, grupo: DATAS },
      { chave: 'fim_em', rotulo: 'Termina', tipo: 'datahora', grupo: DATAS },
      { chave: 'ancora', rotulo: 'Não pode ser perdido', tipo: 'bool', grupo: DATAS },
      { chave: 'local', rotulo: 'Nome do local', tipo: 'texto', grupo: LOCAL },
      { chave: 'endereco', rotulo: 'Endereço', tipo: 'texto', grupo: LOCAL },
      { chave: 'cidade', rotulo: 'Cidade', tipo: 'texto', grupo: LOCAL },
      { chave: 'lat', rotulo: 'Latitude', tipo: 'numero', dica: '53.5436', grupo: LOCAL },
      { chave: 'lon', rotulo: 'Longitude', tipo: 'numero', dica: '9.9885', grupo: LOCAL },
      {
        chave: 'transporte',
        rotulo: 'Como se chega aqui',
        tipo: 'texto',
        dica: 'a pé, metrô U3, táxi',
        grupo: CHEGAR,
      },
      { chave: 'distancia_m', rotulo: 'Distância (m)', tipo: 'numero', grupo: CHEGAR },
      { chave: 'duracao_min', rotulo: 'Duração (min)', tipo: 'numero', grupo: CHEGAR },
      {
        chave: 'como_chegar',
        rotulo: 'Instruções',
        tipo: 'area',
        dica: 'linha, estação, saída',
        grupo: CHEGAR,
      },
      {
        chave: 'dicas',
        rotulo: 'Dicas',
        tipo: 'area',
        dica: 'uma por linha',
        grupo: 'Dicas e links',
      },
      {
        chave: 'links',
        rotulo: 'Links úteis',
        tipo: 'area',
        dica: 'Site oficial|https://…  (um por linha)',
        grupo: 'Dicas e links',
      },
      {
        chave: 'reserva_id',
        rotulo: 'Reserva',
        tipo: 'opcao',
        fonte: 'reservas',
        grupo: VINCULOS,
      },
      {
        chave: 'documento_id',
        rotulo: 'Documento necessário',
        tipo: 'opcao',
        fonte: 'documentos',
        grupo: VINCULOS,
      },
      {
        chave: 'custo_centavos',
        rotulo: 'Custo estimado',
        tipo: 'dinheiro',
        dica: 'estimativa, não despesa',
        grupo: VINCULOS,
      },
      { chave: 'descricao', rotulo: 'Descrição', tipo: 'area', grupo: OBS },
      { chave: 'nota', rotulo: 'Anotação livre', tipo: 'area', grupo: OBS },
    ],
  },
  dia: {
    nome: 'Dia do roteiro',
    campos: [
      { chave: 'dia', rotulo: 'Data', tipo: 'data', obrigatorio: true },
      { chave: 'titulo', rotulo: 'Título do dia', tipo: 'texto', dica: 'Dia de exploração' },
      { chave: 'cidade', rotulo: 'Cidade', tipo: 'texto' },
      { chave: 'pais', rotulo: 'País', tipo: 'texto' },
      { chave: 'ancora', rotulo: 'Dia-âncora', tipo: 'bool' },
      { chave: 'resumo', rotulo: 'Resumo do dia', tipo: 'area', grupo: DIA },
      {
        chave: 'alertas',
        rotulo: 'Atenção hoje',
        tipo: 'area',
        dica: 'um alerta por linha',
        grupo: DIA,
      },
      { chave: 'mapa_url', rotulo: 'Link do mapa do dia', tipo: 'texto', grupo: DIA },
      {
        chave: 'links',
        rotulo: 'Links úteis do dia',
        tipo: 'area',
        dica: 'Rótulo|https://…  (um por linha)',
        grupo: DIA,
      },
      {
        chave: 'antes_sair',
        rotulo: 'Antes de sair',
        tipo: 'area',
        dica: 'um item por linha',
        grupo: RITUAIS,
      },
      {
        chave: 'antes_dormir',
        rotulo: 'Antes de dormir',
        tipo: 'area',
        dica: 'um item por linha',
        grupo: RITUAIS,
      },
    ],
  },
  opcao: {
    nome: 'Opção de transporte',
    campos: [
      {
        chave: 'modo',
        rotulo: 'Modo',
        tipo: 'opcao',
        opcoes: MODOS_TRANSPORTE.map((v) => ({ valor: v, nome: NOME_MODO[v] })),
      },
      { chave: 'duracao_min', rotulo: 'Duração (min)', tipo: 'numero' },
      { chave: 'distancia_m', rotulo: 'Distância (m)', tipo: 'numero' },
      // Texto, não centavos: aqui é a faixa que um guia informa ("€30–€40"),
      // não uma despesa que entra na divisão da viagem.
      { chave: 'custo', rotulo: 'Custo aproximado', tipo: 'texto', dica: '€30–€40' },
      { chave: 'detalhe', rotulo: 'Detalhe', tipo: 'texto', dica: 'Linha U3, saída Baumwall' },
      { chave: 'recomendado', rotulo: 'Recomendado', tipo: 'bool' },
    ],
  },
  voo: {
    nome: 'Voo',
    campos: [
      { chave: 'companhia', rotulo: 'Companhia', tipo: 'texto', obrigatorio: true },
      { chave: 'numero', rotulo: 'Número do voo', tipo: 'texto' },
      { chave: 'origem_iata', rotulo: 'Origem (IATA)', tipo: 'texto', grupo: 'Trecho' },
      { chave: 'origem_cidade', rotulo: 'Cidade de origem', tipo: 'texto', grupo: 'Trecho' },
      { chave: 'destino_iata', rotulo: 'Destino (IATA)', tipo: 'texto', grupo: 'Trecho' },
      { chave: 'destino_cidade', rotulo: 'Cidade de destino', tipo: 'texto', grupo: 'Trecho' },
      { chave: 'parte_em', rotulo: 'Parte em', tipo: 'datahora', grupo: DATAS },
      { chave: 'chega_em', rotulo: 'Chega em', tipo: 'datahora', grupo: DATAS },
      { chave: 'duracao_min', rotulo: 'Duração (min)', tipo: 'numero', grupo: DATAS },
      { chave: 'localizador', rotulo: 'Localizador', tipo: 'texto', grupo: RESERVA },
      { chave: 'nota', rotulo: 'Anotação livre', tipo: 'area', grupo: OBS },
    ],
  },
  cruzeiro: {
    nome: 'Cruzeiro',
    campos: [
      { chave: 'navio', rotulo: 'Navio', tipo: 'texto', obrigatorio: true },
      { chave: 'companhia', rotulo: 'Companhia', tipo: 'texto' },
      { chave: 'embarque_em', rotulo: 'Embarque', tipo: 'datahora', grupo: DATAS },
      { chave: 'desembarque_em', rotulo: 'Desembarque', tipo: 'datahora', grupo: DATAS },
      { chave: 'porto_embarque', rotulo: 'Porto de embarque', tipo: 'texto', grupo: 'Portos' },
      {
        chave: 'porto_desembarque',
        rotulo: 'Porto de desembarque',
        tipo: 'texto',
        grupo: 'Portos',
      },
      { chave: 'terminal', rotulo: 'Terminal', tipo: 'texto', grupo: 'Portos' },
      { chave: 'cabine', rotulo: 'Cabine', tipo: 'texto', grupo: RESERVA },
      { chave: 'localizador', rotulo: 'Reserva', tipo: 'texto', grupo: RESERVA },
      { chave: 'nota', rotulo: 'Anotação livre', tipo: 'area', grupo: OBS },
    ],
  },
  porto: {
    nome: 'Escala',
    campos: [
      { chave: 'porto', rotulo: 'Porto', tipo: 'texto' },
      { chave: 'cidade', rotulo: 'Cidade', tipo: 'texto' },
      { chave: 'pais', rotulo: 'País', tipo: 'texto' },
      { chave: 'dia_no_mar', rotulo: 'Dia no mar', tipo: 'bool' },
      { chave: 'chega_em', rotulo: 'Chega em', tipo: 'datahora', grupo: DATAS },
      { chave: 'sai_em', rotulo: 'Sai em', tipo: 'datahora', grupo: DATAS },
      { chave: 'ordem', rotulo: 'Ordem', tipo: 'numero', grupo: DATAS },
      { chave: 'nota', rotulo: 'Anotação livre', tipo: 'area', grupo: OBS },
    ],
  },
  reserva: {
    nome: 'Hospedagem',
    campos: [
      { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
      { chave: 'cidade', rotulo: 'Cidade', tipo: 'texto' },
      { chave: 'inicio_em', rotulo: 'Check-in', tipo: 'data', grupo: DATAS },
      { chave: 'fim_em', rotulo: 'Check-out', tipo: 'data', grupo: DATAS },
      { chave: 'endereco', rotulo: 'Endereço', tipo: 'area', grupo: CONTATO },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto', grupo: CONTATO },
      { chave: 'link', rotulo: 'Link da reserva', tipo: 'texto', grupo: RESERVA },
      { chave: 'nota', rotulo: 'Anotação livre', tipo: 'area', grupo: OBS },
    ],
  },
  lugar: {
    nome: 'Cidade',
    campos: [
      { chave: 'cidade', rotulo: 'Cidade', tipo: 'texto', obrigatorio: true },
      { chave: 'pais', rotulo: 'País', tipo: 'texto' },
      { chave: 'dias', rotulo: 'Dias', tipo: 'numero' },
      { chave: 'ordem', rotulo: 'Ordem na rota', tipo: 'numero' },
      {
        chave: 'lat',
        rotulo: 'Latitude',
        tipo: 'numero',
        dica: 'para aparecer no mapa',
        grupo: 'Coordenadas',
      },
      { chave: 'lon', rotulo: 'Longitude', tipo: 'numero', grupo: 'Coordenadas' },
      { chave: 'notas', rotulo: 'Notas', tipo: 'area', grupo: OBS },
    ],
  },
  checklist_item: {
    nome: 'Item do checklist',
    campos: [
      { chave: 'titulo', rotulo: 'Título', tipo: 'texto', obrigatorio: true },
      { chave: 'categoria', rotulo: 'Categoria', tipo: 'texto' },
      {
        chave: 'escopo',
        rotulo: 'Escopo',
        tipo: 'opcao',
        opcoes: [
          { valor: 'global', nome: 'Da viagem (todos)' },
          { valor: 'pessoal', nome: 'Pessoal (cada um)' },
        ],
      },
      {
        chave: 'prioridade',
        rotulo: 'Prioridade',
        tipo: 'opcao',
        opcoes: PRIORIDADES_CHECKLIST.map((v) => ({ valor: v, nome: NOME_PRIORIDADE[v] })),
      },
      {
        chave: 'assigned_to',
        rotulo: 'De quem é',
        tipo: 'multiopcao',
        fonte: 'participantes',
        dica: 'Ninguém marcado = todos (só faz sentido em item da viagem)',
      },
      { chave: 'prazo_ideal', rotulo: 'Prazo ideal', tipo: 'data', grupo: DATAS },
      { chave: 'prazo_maximo', rotulo: 'Prazo máximo', tipo: 'data', grupo: DATAS },
      {
        chave: 'valor_estimado_centavos',
        rotulo: 'Custo estimado',
        tipo: 'dinheiro',
        grupo: DATAS,
      },
      { chave: 'pais', rotulo: 'País', tipo: 'texto', grupo: DESTINO },
      { chave: 'cidade', rotulo: 'Cidade', tipo: 'texto', grupo: DESTINO },
      {
        chave: 'itinerary_event_id',
        rotulo: 'Passeio/hospedagem',
        tipo: 'opcao',
        fonte: 'roteiro',
        grupo: VINCULO_ROTEIRO,
      },
      { chave: 'flight_id', rotulo: 'Voo', tipo: 'opcao', fonte: 'voos', grupo: VINCULO_ROTEIRO },
      {
        chave: 'cruise_id',
        rotulo: 'Cruzeiro',
        tipo: 'opcao',
        fonte: 'cruzeiros',
        grupo: VINCULO_ROTEIRO,
      },
      {
        chave: 'documento_id',
        rotulo: 'Documento',
        tipo: 'opcao',
        fonte: 'documentos',
        grupo: VINCULO_ROTEIRO,
      },
      { chave: 'detalhe', rotulo: 'Detalhe', tipo: 'area', grupo: OBS },
    ],
  },
  documento: {
    nome: 'Documento',
    campos: [
      { chave: 'titulo', rotulo: 'Título', tipo: 'texto', obrigatorio: true },
      { chave: 'valor', rotulo: 'Valor', tipo: 'texto' },
      {
        chave: 'tipo',
        rotulo: 'Tipo',
        tipo: 'opcao',
        opcoes: [
          { valor: 'texto', nome: 'Texto' },
          { valor: 'link', nome: 'Link' },
          { valor: 'telefone', nome: 'Telefone' },
        ],
      },
      { chave: 'obs', rotulo: 'Observação', tipo: 'area' },
    ],
  },
  emergencia: {
    nome: 'Contato de emergência',
    campos: [
      { chave: 'titulo', rotulo: 'Título', tipo: 'texto', obrigatorio: true },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto' },
      { chave: 'detalhe', rotulo: 'Detalhe', tipo: 'area' },
      { chave: 'ordem', rotulo: 'Ordem', tipo: 'numero' },
    ],
  },
  categoria: {
    nome: 'Categoria de custo',
    campos: [
      { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
      { chave: 'ordem', rotulo: 'Ordem', tipo: 'numero' },
    ],
  },
}

/** Converte o valor do banco para o que o <input> espera. */
function paraInput(valor: unknown, tipo: TipoCampo): string {
  if (valor === null || valor === undefined) return ''
  if (tipo === 'dinheiro') return paraCampoDinheiro(Number(valor))
  if (tipo === 'data' || tipo === 'datahora') {
    // parseData e não o construtor de Date: ele lê "2027-01-02" como meia-noite
    // UTC e o campo abriria no dia 1 em qualquer fuso a oeste de Greenwich.
    const d = valor instanceof Date ? valor : parseData(String(valor))
    if (!d || Number.isNaN(d.getTime())) return String(valor)
    const p = (n: number) => String(n).padStart(2, '0')
    const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    return tipo === 'data' ? base : `${base}T${p(d.getHours())}:${p(d.getMinutes())}`
  }
  return String(valor)
}

export function EditorSheet({
  entidade,
  registro,
  aoFechar,
}: {
  entidade: string
  registro: Record<string, unknown> | null
  aoFechar: () => void
}) {
  const { mutate } = useTrip()
  const avisar = useAviso()
  const def = CAMPOS[entidade]
  const criando = !registro?.id

  const [valores, setValores] = useState<Record<string, string | boolean | string[]>>(() =>
    Object.fromEntries(
      def.campos.map((c) => [
        c.chave,
        c.tipo === 'bool'
          ? Boolean(registro?.[c.chave])
          : c.tipo === 'multiopcao'
            ? Array.isArray(registro?.[c.chave])
              ? (registro![c.chave] as string[])
              : []
            : paraInput(registro?.[c.chave], c.tipo),
      ]),
    ),
  )
  // Erro por campo, não uma faixa vermelha no rodapé: assim o problema aparece
  // colado no campo que o causou, mesmo com o formulário rolado.
  const [erros, setErros] = useState<Record<string, string>>({})
  const [confirmando, setConfirmando] = useState(false)

  // Como este registro se chama na tela. Cada entidade guarda o seu rótulo num
  // campo diferente — sem esta lista, a confirmação de remover um voo dizia só
  // "Voo sai da viagem", que não identifica qual.
  const nomeRegistro =
    [
      registro?.titulo,
      registro?.nome,
      registro?.navio,
      registro?.descricao,
      registro?.porto,
      registro?.cidade,
      [registro?.companhia, registro?.numero].filter(Boolean).join(' '),
    ]
      .map((v) => String(v ?? '').trim())
      .find(Boolean) || def.nome

  function salvar() {
    const campos: Record<string, unknown> = {}
    const novosErros: Record<string, string> = {}

    for (const c of def.campos) {
      const v = valores[c.chave]
      if (c.tipo === 'bool') {
        campos[c.chave] = Boolean(v)
        continue
      }
      if (c.tipo === 'multiopcao') {
        // Vazio aqui é dado de verdade ("todos"), não "campo não preenchido" —
        // por isso sempre entra no payload, ao contrário do texto vazio abaixo.
        campos[c.chave] = Array.isArray(v) ? v : []
        continue
      }
      const s = String(v ?? '').trim()
      if (!s) {
        if (c.obrigatorio) {
          novosErros[c.chave] = 'Não pode ficar vazio.'
          continue
        }
        // Campo vazio some do payload em vez de virar string vazia: no banco isso
        // é NULL, e é o que "não sei ainda" significa.
        if (!criando) campos[c.chave] = null
        continue
      }
      if (c.tipo === 'numero') {
        const n = Number(s.replace(',', '.'))
        if (!Number.isFinite(n)) novosErros[c.chave] = 'Precisa ser um número.'
        else campos[c.chave] = n
      } else if (c.tipo === 'dinheiro') {
        // `paraCentavos`, o MESMO parser do formulário de despesa. O que estava
        // aqui apagava TODO ponto antes de converter, então "1234.56" — o que o
        // teclado numérico do celular produz — virava 123456 e era gravado como
        // R$ 123.456,00: cem vezes o valor digitado, num campo de dinheiro.
        // `paraCentavos` distingue o ponto de milhar do ponto decimal, recusa o
        // que não é número e nunca passa por float (ver lib/derive.ts).
        const centavos = paraCentavos(s)
        if (centavos === null || centavos < 0) novosErros[c.chave] = 'Valor inválido.'
        else campos[c.chave] = centavos
      } else {
        campos[c.chave] = s
      }
    }

    // O vínculo com o pai (event_id de uma opção de transporte, flight_id de uma
    // escala) vem do registro semente, não de um campo digitado: quem adiciona
    // "de metrô, 18 min" já está dentro do item do roteiro. Sem isto o servidor
    // recusa a criação com "item do roteiro nao encontrado nesta viagem".
    if (criando) {
      for (const chave of ['event_id', 'flight_id', 'cruise_id', 'expense_id']) {
        if (registro?.[chave]) campos[chave] = registro[chave]
      }
    }

    // Espelha a constraint checklist_pessoal_tem_dono do banco (T3): barrar aqui
    // poupa a viagem até o servidor pro caso comum, não substitui a constraint.
    if (
      entidade === 'checklist_item' &&
      campos.escopo === 'pessoal' &&
      Array.isArray(campos.assigned_to) &&
      campos.assigned_to.length === 0
    ) {
      novosErros.assigned_to = 'Item pessoal precisa de pelo menos um dono.'
    }

    setErros(novosErros)
    if (Object.keys(novosErros).length > 0) {
      avisar('erro', 'Confira os campos marcados.')
      return
    }

    void mutate({
      op: criando ? 'criar' : 'editar',
      entidade,
      id: criando ? crypto.randomUUID() : String(registro!.id),
      campos,
      client_ts: new Date().toISOString(),
    })
    avisar('sucesso', criando ? `${def.nome} criado.` : 'Alterações salvas.')
    aoFechar()
  }

  // Campos curtos (data, número, dinheiro) ficam dois por linha no desktop —
  // é o que transforma um formulário de 11 campos empilhados (Voo) em algo que
  // não exige rolar a tela inteira para achar o botão Salvar.
  const MEIA_LARGURA = new Set<TipoCampo>(['numero', 'dinheiro', 'data', 'datahora'])

  // Agrupa preservando a ordem em que os grupos aparecem na definição.
  const grupos = new Map<string, Campo[]>()
  for (const c of def.campos) {
    const g = c.grupo ?? BASICO
    if (!grupos.has(g)) grupos.set(g, [])
    grupos.get(g)!.push(c)
  }

  if (confirmando) {
    return (
      <ConfirmarDialogo
        titulo={`Remover ${def.nome.toLowerCase()}?`}
        descricao={
          <>
            <strong className="text-(--color-tinta)">{nomeRegistro}</strong> sai da viagem. Não dá
            para desfazer pelo app.
          </>
        }
        aoCancelar={() => setConfirmando(false)}
        aoConfirmar={() => {
          void mutate({
            op: 'remover',
            entidade,
            id: String(registro!.id),
            campos: {},
            client_ts: new Date().toISOString(),
          })
          avisar('sucesso', 'Item removido.')
          aoFechar()
        }}
      />
    )
  }

  return (
    <AppModal
      titulo={criando ? `Novo ${def.nome.toLowerCase()}` : `Editar ${def.nome.toLowerCase()}`}
      tamanho="medio"
      aoFechar={aoFechar}
      acoes={
        <>
          {!criando && (
            <button
              onClick={() => setConfirmando(true)}
              className="mr-auto inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-(--color-tinta-3) transition-colors hover:bg-(--color-perigo-bg) hover:text-(--color-perigo-ink)"
            >
              <Trash2 size={14} /> Remover
            </button>
          )}
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar}>Salvar</Botao>
        </>
      }
    >
      <div className="space-y-5 pb-2">
        {[...grupos.entries()].map(([nome, campos]) => (
          <GrupoCampos key={nome} titulo={nome}>
            {campos.map((c) => (
              <div key={c.chave} className={MEIA_LARGURA.has(c.tipo) ? '' : 'sm:col-span-2'}>
                <CampoEditor
                  campo={c}
                  valor={valores[c.chave]}
                  erro={erros[c.chave]}
                  aoMudar={(v) => {
                    setValores((a) => ({ ...a, [c.chave]: v }))
                    // Erro some assim que a pessoa mexe no campo: deixá-lo na
                    // tela enquanto ela corrige é acusar de um erro já resolvido.
                    if (erros[c.chave]) {
                      setErros((r) =>
                        Object.fromEntries(Object.entries(r).filter(([k]) => k !== c.chave)),
                      )
                    }
                  }}
                />
              </div>
            ))}
          </GrupoCampos>
        ))}
      </div>
    </AppModal>
  )
}

/** As opções de um campo com `fonte`: registros desta viagem, com "—" na frente. */
function useOpcoesDaFonte(fonte: Campo['fonte']) {
  const { snapshot } = useTrip()
  if (!fonte) return null
  const vazio = { valor: '', nome: '— nenhum —' }
  if (fonte === 'reservas') {
    return [
      vazio,
      ...((snapshot?.reservas ?? []) as Record<string, unknown>[]).map((r) => ({
        valor: String(r.id),
        nome: [r.nome, r.localizador].filter(Boolean).join(' · '),
      })),
    ]
  }
  if (fonte === 'participantes') {
    // Sem "— nenhum —": aqui a lista É o conjunto de opções marcáveis, não a
    // escolha de um valor único (ver tipo 'multiopcao').
    return (snapshot?.participantes ?? []).map((p) => ({
      valor: String(p.id),
      nome: String(p.nome),
    }))
  }
  if (fonte === 'roteiro') {
    return [
      vazio,
      ...((snapshot?.roteiro ?? []) as { id: string; titulo: string }[]).map((e) => ({
        valor: String(e.id),
        nome: String(e.titulo),
      })),
    ]
  }
  if (fonte === 'voos') {
    return [
      vazio,
      ...(
        (snapshot?.voos ?? []) as { id: string; companhia: string; numero?: string | null }[]
      ).map((v) => ({
        valor: String(v.id),
        nome: [v.companhia, v.numero].filter(Boolean).join(' '),
      })),
    ]
  }
  if (fonte === 'cruzeiros') {
    return [
      vazio,
      ...((snapshot?.cruzeiros ?? []) as { id: string; navio: string }[]).map((c) => ({
        valor: String(c.id),
        nome: String(c.navio),
      })),
    ]
  }
  return [
    vazio,
    ...((snapshot?.documentos ?? []) as Record<string, unknown>[]).map((d) => ({
      valor: String(d.id),
      nome: String(d.titulo),
    })),
  ]
}

function CampoEditor({
  campo,
  valor,
  erro,
  aoMudar,
}: {
  campo: Campo
  valor: string | boolean | string[]
  erro?: string
  aoMudar: (v: string | boolean | string[]) => void
}) {
  const daFonte = useOpcoesDaFonte(campo.fonte)
  const idErro = `erro-${campo.chave}`
  const classe = `toque mt-1 ${CLASSE_CAMPO}`
  const estiloErro = erro ? { borderColor: 'var(--color-perigo-ink)' } : undefined
  const aria = {
    'aria-invalid': erro ? true : undefined,
    'aria-describedby': erro ? idErro : undefined,
  }

  if (campo.tipo === 'bool') {
    return (
      <label className="toque flex cursor-pointer items-center gap-3 rounded-xl border border-(--color-borda-forte) px-3 transition-colors hover:bg-(--color-superficie-2)">
        <input
          type="checkbox"
          checked={Boolean(valor)}
          onChange={(e) => aoMudar(e.target.checked)}
          className="h-5 w-5 accent-(--color-destaque)"
        />
        <span className="text-sm font-medium">{campo.rotulo}</span>
      </label>
    )
  }

  if (campo.tipo === 'multiopcao') {
    const selecionados = Array.isArray(valor) ? valor : []
    const opcoes = daFonte ?? campo.opcoes ?? []
    return (
      <div>
        <span className="flex items-baseline gap-2">
          <RotuloCampo>
            {campo.rotulo}
            {campo.obrigatorio ? ' *' : ''}
          </RotuloCampo>
          {campo.dica && <span className="text-[12px] text-(--color-tinta-3)">{campo.dica}</span>}
        </span>
        <div className="mt-1 space-y-1.5">
          {opcoes.length === 0 && (
            <span className="text-[13px] text-(--color-tinta-3)">Nenhuma opção disponível.</span>
          )}
          {opcoes.map((o) => (
            <label
              key={o.valor}
              className="toque flex cursor-pointer items-center gap-3 rounded-xl border border-(--color-borda-forte) px-3 transition-colors hover:bg-(--color-superficie-2)"
            >
              <input
                type="checkbox"
                checked={selecionados.includes(o.valor)}
                onChange={(e) =>
                  aoMudar(
                    e.target.checked
                      ? [...selecionados, o.valor]
                      : selecionados.filter((v) => v !== o.valor),
                  )
                }
                className="h-5 w-5 accent-(--color-destaque)"
              />
              <span className="text-sm">{o.nome}</span>
            </label>
          ))}
        </div>
        {erro && (
          <span id={idErro} className="mt-1 block text-[13px] text-(--color-perigo-ink)">
            {erro}
          </span>
        )}
      </div>
    )
  }

  return (
    <label className="block">
      <span className="flex items-baseline gap-2">
        <RotuloCampo>
          {campo.rotulo}
          {campo.obrigatorio ? ' *' : ''}
        </RotuloCampo>
        {campo.dica && <span className="text-[12px] text-(--color-tinta-3)">{campo.dica}</span>}
      </span>

      {campo.tipo === 'area' ? (
        <textarea
          rows={2}
          value={String(valor ?? '')}
          onChange={(e) => aoMudar(e.target.value)}
          style={estiloErro}
          className={classe}
          {...aria}
        />
      ) : campo.tipo === 'opcao' && campo.cores ? (
        // Grade de chips, cada um na cor que o valor vai ter na linha do tempo.
        // `radiogroup` e não `listbox`: é uma escolha única entre opções fixas, e
        // é assim que o leitor de tela anuncia "1 de 19".
        <div role="radiogroup" aria-label={campo.rotulo} className="flex flex-wrap gap-1.5">
          {(daFonte ?? campo.opcoes)?.map((o) => {
            const tom = tomDoTipo(o.valor)
            const ativo = String(valor ?? '') === o.valor
            return (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={ativo}
                onClick={() => aoMudar(o.valor)}
                // A cor é sempre a do tipo; o que a seleção muda é o ANEL em
                // volta. Apagar a cor dos não-escolhidos transformaria a grade
                // num seletor cinza de novo — e é a cor que se veio ver aqui.
                className="cursor-pointer rounded-xl px-2.5 py-1.5 text-[13px] font-medium transition-shadow"
                style={{
                  background: tom.bg,
                  color: tom.ink,
                  boxShadow: ativo ? `0 0 0 2px var(--destaque)` : undefined,
                }}
              >
                {o.nome}
              </button>
            )
          })}
        </div>
      ) : campo.tipo === 'opcao' ? (
        <select
          value={String(valor ?? '')}
          onChange={(e) => aoMudar(e.target.value)}
          style={estiloErro}
          className={classe}
          {...aria}
        >
          {(daFonte ?? campo.opcoes)?.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.nome}
            </option>
          ))}
        </select>
      ) : (
        <input
          // Usa os seletores nativos do navegador em vez de um date picker próprio.
          type={
            campo.tipo === 'data' ? 'date' : campo.tipo === 'datahora' ? 'datetime-local' : 'text'
          }
          inputMode={campo.tipo === 'numero' || campo.tipo === 'dinheiro' ? 'decimal' : undefined}
          value={String(valor ?? '')}
          onChange={(e) => aoMudar(e.target.value)}
          style={estiloErro}
          className={classe}
          {...aria}
        />
      )}

      {erro && (
        <span id={idErro} className="mt-1 block text-[13px] text-(--color-perigo-ink)">
          {erro}
        </span>
      )}
    </label>
  )
}

/** Papel mínimo pra escrever cada entidade — espelha a TABELA de app/api/mutate. */
const MINIMO: Record<string, Papel> = {
  participante: 'proprietario',
  checklist_state: 'visualizador',
}

/** Botão "adicionar" e "editar" que as abas usam. Some pra quem não alcança o papel mínimo. */
export function AdminAcoes({
  entidade,
  registro,
  children,
  permitirTambem = false,
}: {
  entidade: string
  registro?: Record<string, unknown> | null
  children?: ReactNode
  /** Libera o botão pra quem não alcança o papel mínimo em casos pontuais de
      dono do próprio registro (ex.: item pessoal do checklist) — o servidor
      é quem decide de verdade (`autorizar` em `/api/mutate`), isto é só a UI. */
  permitirTambem?: boolean
}) {
  const { posso } = useTrip()
  const [aberto, setAberto] = useState(false)
  if (!posso(MINIMO[entidade] ?? 'editor') && !permitirTambem) return null

  const criando = !registro?.id
  const nome = CAMPOS[entidade]?.nome.toLowerCase() ?? 'registro'

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        // Sem `children`, é o lápis de editar uma linha: ícone pequeno, rótulo
        // acessível dito por aria-label — nunca um ícone mudo.
        aria-label={children ? undefined : `Editar ${nome}`}
        title={children ? undefined : `Editar ${nome}`}
        className={`sem-impressao inline-flex cursor-pointer items-center gap-1.5 rounded-xl text-sm font-medium transition-colors ${
          children
            ? 'toque px-2.5 hover:bg-(--color-destaque-tenue)'
            : 'h-9 w-9 justify-center text-(--color-tinta-3) hover:bg-(--color-superficie-2) hover:text-(--destaque)'
        }`}
        style={children ? { color: 'var(--destaque)' } : undefined}
      >
        {children ? (
          <>
            {criando && <Plus size={15} />}
            {children}
          </>
        ) : (
          <Pencil size={15} />
        )}
      </button>
      {aberto && (
        <EditorSheet
          entidade={entidade}
          registro={registro ?? null}
          aoFechar={() => setAberto(false)}
        />
      )}
    </>
  )
}
