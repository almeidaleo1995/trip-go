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
import { X, Trash2 } from 'lucide-react'
import { Botao, Rotulo } from './ui.tsx'
import { useTrip } from './TripProvider.tsx'

type TipoCampo = 'texto' | 'area' | 'data' | 'datahora' | 'numero' | 'dinheiro' | 'bool' | 'opcao'

type Campo = {
  chave: string
  rotulo: string
  tipo: TipoCampo
  obrigatorio?: boolean
  opcoes?: { valor: string; nome: string }[]
  dica?: string
}

/** Entidade -> campos editáveis. Espelha os schemas zod de lib/schema.ts. */
export const CAMPOS: Record<string, { nome: string; campos: Campo[] }> = {
  viagem: {
    nome: 'Viagem',
    campos: [
      { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
      { chave: 'subtitulo', rotulo: 'Subtítulo', tipo: 'texto' },
      { chave: 'data_partida', rotulo: 'Partida', tipo: 'data', obrigatorio: true },
      { chave: 'data_retorno', rotulo: 'Retorno', tipo: 'data', obrigatorio: true },
      { chave: 'moeda', rotulo: 'Moeda', tipo: 'texto', dica: 'BRL, EUR, USD' },
      { chave: 'cor_destaque', rotulo: 'Cor de destaque', tipo: 'texto', dica: '#0F766E' },
    ],
  },
  viajante: {
    nome: 'Viajante',
    campos: [
      {
        chave: 'nome',
        rotulo: 'Nome',
        tipo: 'texto',
        obrigatorio: true,
        dica: 'igual ao passaporte',
      },
      {
        chave: 'papel',
        rotulo: 'Papel',
        tipo: 'opcao',
        opcoes: [
          { valor: 'viajante', nome: 'Viajante' },
          { valor: 'admin', nome: 'Dono da viagem' },
        ],
      },
      {
        chave: 'pin',
        rotulo: 'PIN (4 dígitos)',
        tipo: 'texto',
        dica: 'deixe vazio para não alterar',
      },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto' },
      { chave: 'passaporte', rotulo: 'Passaporte', tipo: 'texto' },
    ],
  },
  roteiro: {
    nome: 'Evento do roteiro',
    campos: [
      { chave: 'titulo', rotulo: 'Título', tipo: 'texto', obrigatorio: true },
      { chave: 'ocorre_em', rotulo: 'Quando', tipo: 'datahora', obrigatorio: true },
      {
        chave: 'tipo',
        rotulo: 'Tipo',
        tipo: 'opcao',
        opcoes: [
          { valor: 'voo', nome: 'Voo' },
          { valor: 'hospedagem', nome: 'Hospedagem' },
          { valor: 'cruzeiro', nome: 'Cruzeiro' },
          { valor: 'passeio', nome: 'Passeio' },
          { valor: 'traslado', nome: 'Traslado' },
          { valor: 'documento', nome: 'Documento' },
          { valor: 'refeicao', nome: 'Refeição' },
        ],
      },
      { chave: 'cidade', rotulo: 'Cidade', tipo: 'texto' },
      { chave: 'local', rotulo: 'Local', tipo: 'texto' },
      { chave: 'descricao', rotulo: 'Descrição', tipo: 'area' },
      { chave: 'ancora', rotulo: 'Não pode ser perdido', tipo: 'bool' },
      { chave: 'nota', rotulo: 'Anotação livre', tipo: 'area' },
    ],
  },
  voo: {
    nome: 'Voo',
    campos: [
      { chave: 'companhia', rotulo: 'Companhia', tipo: 'texto', obrigatorio: true },
      { chave: 'numero', rotulo: 'Número do voo', tipo: 'texto' },
      { chave: 'origem_iata', rotulo: 'Origem (IATA)', tipo: 'texto' },
      { chave: 'origem_cidade', rotulo: 'Cidade de origem', tipo: 'texto' },
      { chave: 'destino_iata', rotulo: 'Destino (IATA)', tipo: 'texto' },
      { chave: 'destino_cidade', rotulo: 'Cidade de destino', tipo: 'texto' },
      { chave: 'parte_em', rotulo: 'Parte em', tipo: 'datahora' },
      { chave: 'chega_em', rotulo: 'Chega em', tipo: 'datahora' },
      { chave: 'duracao_min', rotulo: 'Duração (min)', tipo: 'numero' },
      { chave: 'localizador', rotulo: 'Localizador', tipo: 'texto' },
      { chave: 'nota', rotulo: 'Anotação livre', tipo: 'area' },
    ],
  },
  cruzeiro: {
    nome: 'Cruzeiro',
    campos: [
      { chave: 'navio', rotulo: 'Navio', tipo: 'texto', obrigatorio: true },
      { chave: 'companhia', rotulo: 'Companhia', tipo: 'texto' },
      { chave: 'embarque_em', rotulo: 'Embarque', tipo: 'datahora' },
      { chave: 'desembarque_em', rotulo: 'Desembarque', tipo: 'datahora' },
      { chave: 'porto_embarque', rotulo: 'Porto de embarque', tipo: 'texto' },
      { chave: 'porto_desembarque', rotulo: 'Porto de desembarque', tipo: 'texto' },
      { chave: 'terminal', rotulo: 'Terminal', tipo: 'texto' },
      { chave: 'cabine', rotulo: 'Cabine', tipo: 'texto' },
      { chave: 'localizador', rotulo: 'Reserva', tipo: 'texto' },
      { chave: 'nota', rotulo: 'Anotação livre', tipo: 'area' },
    ],
  },
  porto: {
    nome: 'Escala',
    campos: [
      { chave: 'porto', rotulo: 'Porto', tipo: 'texto' },
      { chave: 'cidade', rotulo: 'Cidade', tipo: 'texto' },
      { chave: 'pais', rotulo: 'País', tipo: 'texto' },
      { chave: 'chega_em', rotulo: 'Chega em', tipo: 'datahora' },
      { chave: 'sai_em', rotulo: 'Sai em', tipo: 'datahora' },
      { chave: 'dia_no_mar', rotulo: 'Dia no mar', tipo: 'bool' },
      { chave: 'ordem', rotulo: 'Ordem', tipo: 'numero' },
      { chave: 'nota', rotulo: 'Anotação livre', tipo: 'area' },
    ],
  },
  hospedagem: {
    nome: 'Hospedagem',
    campos: [
      { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
      { chave: 'cidade', rotulo: 'Cidade', tipo: 'texto' },
      { chave: 'checkin', rotulo: 'Check-in', tipo: 'data' },
      { chave: 'checkout', rotulo: 'Check-out', tipo: 'data' },
      { chave: 'endereco', rotulo: 'Endereço', tipo: 'area' },
      { chave: 'link', rotulo: 'Link da reserva', tipo: 'texto' },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto' },
      { chave: 'nota', rotulo: 'Anotação livre', tipo: 'area' },
    ],
  },
  lugar: {
    nome: 'Cidade',
    campos: [
      { chave: 'cidade', rotulo: 'Cidade', tipo: 'texto', obrigatorio: true },
      { chave: 'pais', rotulo: 'País', tipo: 'texto' },
      { chave: 'dias', rotulo: 'Dias', tipo: 'numero' },
      { chave: 'lat', rotulo: 'Latitude', tipo: 'numero', dica: 'para aparecer no mapa' },
      { chave: 'lon', rotulo: 'Longitude', tipo: 'numero' },
      { chave: 'notas', rotulo: 'Notas', tipo: 'area' },
      { chave: 'ordem', rotulo: 'Ordem na rota', tipo: 'numero' },
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
      { chave: 'prazo_ideal', rotulo: 'Prazo ideal', tipo: 'data' },
      { chave: 'prazo_maximo', rotulo: 'Prazo máximo', tipo: 'data' },
      { chave: 'valor_estimado_centavos', rotulo: 'Custo estimado', tipo: 'dinheiro' },
      { chave: 'detalhe', rotulo: 'Detalhe', tipo: 'area' },
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
  if (tipo === 'dinheiro') return String(Number(valor) / 100).replace('.', ',')
  if (tipo === 'data' || tipo === 'datahora') {
    const d = valor instanceof Date ? valor : new Date(String(valor).replace(' ', 'T'))
    if (Number.isNaN(d.getTime())) return String(valor)
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
  const def = CAMPOS[entidade]
  const criando = !registro?.id

  const [valores, setValores] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      def.campos.map((c) => [
        c.chave,
        c.tipo === 'bool' ? Boolean(registro?.[c.chave]) : paraInput(registro?.[c.chave], c.tipo),
      ]),
    ),
  )
  const [erro, setErro] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)

  function salvar() {
    const campos: Record<string, unknown> = {}
    for (const c of def.campos) {
      const v = valores[c.chave]
      if (c.tipo === 'bool') {
        campos[c.chave] = Boolean(v)
        continue
      }
      const s = String(v ?? '').trim()
      if (!s) {
        if (c.obrigatorio) return setErro(`${c.rotulo} não pode ficar vazio.`)
        // Campo vazio some do payload em vez de virar string vazia: no banco isso
        // é NULL, e é o que "não sei ainda" significa.
        if (!criando) campos[c.chave] = null
        continue
      }
      if (c.tipo === 'numero') {
        const n = Number(s.replace(',', '.'))
        if (!Number.isFinite(n)) return setErro(`${c.rotulo} precisa ser um número.`)
        campos[c.chave] = n
      } else if (c.tipo === 'dinheiro') {
        const n = Number(s.replace(/\./g, '').replace(',', '.'))
        if (!Number.isFinite(n) || n < 0) return setErro(`${c.rotulo} inválido.`)
        campos[c.chave] = Math.round(n * 100)
      } else {
        campos[c.chave] = s
      }
    }

    void mutate({
      op: criando ? 'criar' : 'editar',
      entidade,
      id: criando ? crypto.randomUUID() : String(registro!.id),
      campos,
      client_ts: new Date().toISOString(),
    })
    aoFechar()
  }

  return (
    <div className="sem-impressao fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
      <div className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[--color-cartao] p-5 md:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {criando ? `Novo · ${def.nome}` : `Editar · ${def.nome}`}
          </h2>
          <button
            onClick={aoFechar}
            aria-label="Fechar"
            className="toque cursor-pointer rounded-xl p-2 hover:bg-[--color-fundo]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          {def.campos.map((c) => (
            <CampoEditor
              key={c.chave}
              campo={c}
              valor={valores[c.chave]}
              aoMudar={(v) => setValores((a) => ({ ...a, [c.chave]: v }))}
            />
          ))}
        </div>

        {erro && (
          <p className="mt-3 rounded-xl bg-[--color-alerta-bg] px-3 py-2 text-sm text-[--color-alerta-ink]">
            {erro}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Botao onClick={salvar}>Salvar</Botao>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          {!criando && (
            <button
              onClick={() => setConfirmando(true)}
              className="toque ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 text-sm text-[--color-tinta-3] hover:bg-[--color-alerta-bg] hover:text-[--color-alerta-ink]"
            >
              <Trash2 size={15} /> Remover
            </button>
          )}
        </div>

        {confirmando && (
          <div className="mt-4 rounded-xl bg-[--color-alerta-bg] p-3">
            {/* Confirmação mostra O QUE será removido, não só "tem certeza?" */}
            <p className="text-sm text-[--color-alerta-ink]">
              Remover <strong>{String(registro?.titulo ?? registro?.nome ?? def.nome)}</strong>? Não
              dá para desfazer pelo app.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Botao
                variante="perigo"
                onClick={() => {
                  void mutate({
                    op: 'remover',
                    entidade,
                    id: String(registro!.id),
                    campos: {},
                    client_ts: new Date().toISOString(),
                  })
                  aoFechar()
                }}
              >
                Remover
              </Botao>
              <Botao variante="secundario" onClick={() => setConfirmando(false)}>
                Cancelar
              </Botao>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CampoEditor({
  campo,
  valor,
  aoMudar,
}: {
  campo: Campo
  valor: string | boolean
  aoMudar: (v: string | boolean) => void
}) {
  const classe =
    'toque mt-1 w-full rounded-xl border border-[--color-borda] bg-[--color-cartao] px-3 py-2'

  if (campo.tipo === 'bool') {
    return (
      <label className="toque flex cursor-pointer items-center gap-3 rounded-xl border border-[--color-borda] px-3">
        <input
          type="checkbox"
          checked={Boolean(valor)}
          onChange={(e) => aoMudar(e.target.checked)}
          className="h-5 w-5 accent-[--color-destaque]"
        />
        <span className="text-sm font-medium">{campo.rotulo}</span>
      </label>
    )
  }

  return (
    <label className="block">
      <span className="flex items-baseline gap-2">
        <Rotulo>
          {campo.rotulo}
          {campo.obrigatorio ? ' *' : ''}
        </Rotulo>
        {campo.dica && <span className="text-[11px] text-[--color-tinta-3]">{campo.dica}</span>}
      </span>

      {campo.tipo === 'area' ? (
        <textarea
          rows={2}
          value={String(valor ?? '')}
          onChange={(e) => aoMudar(e.target.value)}
          className={classe}
        />
      ) : campo.tipo === 'opcao' ? (
        <select
          value={String(valor ?? '')}
          onChange={(e) => aoMudar(e.target.value)}
          className={classe}
        >
          {campo.opcoes?.map((o) => (
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
          className={classe}
        />
      )}
    </label>
  )
}

/** Botão "adicionar" e "editar" que as abas usam. Some para viajante. */
export function AdminAcoes({
  entidade,
  registro,
  children,
}: {
  entidade: string
  registro?: Record<string, unknown> | null
  children?: ReactNode
}) {
  const { souAdmin } = useTrip()
  const [aberto, setAberto] = useState(false)
  if (!souAdmin) return null

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="toque sem-impressao inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium"
        style={{ color: 'var(--destaque)' }}
      >
        {children ?? 'Editar'}
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
