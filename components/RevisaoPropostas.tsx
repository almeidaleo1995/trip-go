'use client'

// A revisão de propostas: o que o assistente sugeriu, antes de virar verdade.
//
// A ideia visual da tela inteira: uma proposta é um ESBOÇO. Ela chega com tinta
// reduzida, sem cor de tipo, sobre superfície rebaixada — do jeito que se
// desenha a lápis antes de passar a nanquim. Aceitar é entintar: o registro
// nasce na aba dele com a cor e o peso que todos os outros têm.
//
// O tracejado, que seria o gesto óbvio para "pendente", está deliberadamente
// fora: no Roteiro ele já significa "fio do tempo" (tabs/Roteiro.tsx), e repetir
// o mesmo traço com outro sentido a dois toques de distância ensina a pessoa a
// ler errado as duas telas.
//
// A remoção é a única coisa gritada nesta tela, e por um motivo que não é de
// estilo: ela não tem desfazer. O `change_log` guarda que a linha existia, nunca
// o conteúdo dela.
import { useState } from 'react'
import { Check, Trash2, Pencil, Plus, Undo2 } from 'lucide-react'
import { Botao, Badge } from './ui.tsx'

export type Proposta = {
  ref: string
  entidade: string
  op: 'criar' | 'editar' | 'remover'
  id?: string | null
  campos: Record<string, unknown>
  resumo: string
}

const VERBO: Record<Proposta['op'], { rotulo: string; Icone: typeof Plus }> = {
  criar: { rotulo: 'Novo', Icone: Plus },
  editar: { rotulo: 'Alterar', Icone: Pencil },
  remover: { rotulo: 'Remover', Icone: Trash2 },
}

const NOME_ENTIDADE: Record<string, string> = {
  roteiro: 'Roteiro',
  dia: 'Dia',
  opcao: 'Como chegar',
  voo: 'Voo',
  escala: 'Escala',
  cruzeiro: 'Cruzeiro',
  porto: 'Porto',
  reserva: 'Hospedagem',
  lugar: 'Cidade',
  checklist_item: 'Checklist',
  checklist_state: 'Checklist',
  documento: 'Documento',
  requisito: 'Documentação',
  entrega: 'Documentação',
  emergencia: 'Emergência',
  categoria: 'Categoria',
  custo: 'Despesa',
  parcela: 'Parcela',
  pagamento: 'Reembolso',
}

/** Os campos que valem a pena mostrar no esboço, na ordem em que se lê um item. */
const PREVIA = ['ocorre_em', 'titulo', 'nome', 'cidade', 'local', 'descricao', 'valor_centavos']

function previa(campos: Record<string, unknown>): string {
  const partes = PREVIA.map((c) => campos[c]).filter((v) => v !== undefined && v !== null && v !== '')
  if (partes.length > 0) return partes.slice(0, 3).map(String).join(' · ')
  const primeiro = Object.entries(campos).find(([, v]) => v !== null && v !== '')
  return primeiro ? String(primeiro[1]) : ''
}

export function RevisaoPropostas({
  propostas,
  aplicando,
  aoAplicar,
  aoDescartar,
}: {
  propostas: Proposta[]
  aplicando?: boolean
  aoAplicar: (escolhidas: Proposta[]) => void
  aoDescartar: () => void
}) {
  const [fora, setFora] = useState<Set<string>>(new Set())

  const escolhidas = propostas.filter((p) => !fora.has(p.ref))
  const removendo = escolhidas.filter((p) => p.op === 'remover').length

  function alternar(ref: string) {
    setFora((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(ref)) proximo.delete(ref)
      else proximo.add(ref)
      return proximo
    })
  }

  return (
    <section
      aria-label="Propostas do assistente"
      className="rounded-2xl border border-(--color-borda) bg-(--color-superficie-2) p-3"
    >
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold text-(--color-tinta-2)">
          {propostas.length === 1 ? 'Uma sugestão' : `${propostas.length} sugestões`}
          <span className="font-normal"> · nada foi salvo ainda</span>
        </p>
        {propostas.length > 1 && (
          <button
            onClick={() => setFora(fora.size ? new Set() : new Set(propostas.map((p) => p.ref)))}
            className="cursor-pointer text-[12px] font-medium text-(--destaque) underline-offset-2 hover:underline"
          >
            {fora.size ? 'Marcar todas' : 'Desmarcar todas'}
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {propostas.map((p) => {
          const dentro = !fora.has(p.ref)
          const { rotulo, Icone } = VERBO[p.op]
          const perigo = p.op === 'remover'
          const texto = previa(p.campos)

          return (
            <li key={p.ref}>
              <label
                className={`flex cursor-pointer gap-3 rounded-xl border bg-(--color-cartao) p-3 transition-opacity ${
                  dentro ? 'border-(--color-borda)' : 'border-(--color-borda) opacity-50'
                }`}
                style={
                  perigo && dentro
                    ? { borderColor: 'var(--color-perigo-ink)', borderLeftWidth: 3 }
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={dentro}
                  onChange={() => alternar(p.ref)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-(--destaque)"
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <Badge
                      tipo={perigo ? 'perigo' : 'neutro'}
                      texto={`${rotulo} · ${NOME_ENTIDADE[p.entidade] ?? p.entidade}`}
                      icone={<Icone size={11} />}
                    />
                  </div>
                  {/* Tinta reduzida: ainda é esboço. Ao aceitar, o registro
                      aparece na aba dele com o peso normal de tudo o mais. */}
                  <p className="text-[14px] leading-snug text-(--color-tinta-2)">{p.resumo}</p>
                  {texto && texto !== p.resumo && (
                    <p className="mt-0.5 truncate text-[12px] text-(--color-tinta-3)">{texto}</p>
                  )}
                </div>
              </label>
            </li>
          )
        })}
      </ul>

      {removendo > 0 && (
        <p
          role="status"
          className="mt-2.5 flex items-start gap-2 rounded-xl bg-(--color-perigo-bg) px-3 py-2 text-[12.5px] leading-snug text-(--color-perigo-ink)"
        >
          <Undo2 size={14} className="mt-px shrink-0" />
          <span>
            {removendo === 1 ? 'Uma remoção não tem desfazer.' : `${removendo} remoções não têm desfazer.`}{' '}
            O resto você desfaz num toque depois de salvar.
          </span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Botao
          onClick={() => aoAplicar(escolhidas)}
          carregando={aplicando}
          desabilitado={escolhidas.length === 0}
          tamanho="pequeno"
        >
          <Check size={15} />
          {escolhidas.length === propostas.length
            ? 'Salvar na viagem'
            : `Salvar ${escolhidas.length} de ${propostas.length}`}
        </Botao>
        <Botao onClick={aoDescartar} variante="fantasma" tamanho="pequeno">
          Descartar
        </Botao>
      </div>
    </section>
  )
}
