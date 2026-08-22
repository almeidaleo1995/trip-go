'use client'

// O formulário de despesa. É onde a regra do módulo aparece para a pessoa:
// quem PAGOU o fornecedor é um campo, quem DIVIDE é outro, e a conta entre os
// dois o app faz sozinho.
//
// A prévia embaixo de cada bloco não é enfeite: divisão por peso e parcelamento
// são exatamente as duas coisas que ninguém acerta de cabeça. Mostrar o
// resultado enquanto se digita é o que faz a pessoa confiar no número — e é a
// mesma função pura que o servidor vai rodar ao gravar, então a prévia não é uma
// aproximação que muda depois de salvar.
import { useMemo, useState } from 'react'
import { Check, Scale, Users, Wallet } from 'lucide-react'
import {
  AppModal,
  Avatar,
  Botao,
  Campo,
  Interruptor,
  RotuloCampo,
  Rotulo,
  Selecao,
  CLASSE_CAMPO,
} from './ui.tsx'
import { useTrip } from './TripProvider.tsx'
import {
  formatarDinheiro,
  formatarData,
  paraCentavos,
  paraCampoDinheiro,
  diasAte,
} from '@/lib/derive.ts'
import { resolverDivisao, gerarParcelas, paraDia, type Frequencia } from '@/lib/financeiro.ts'
import { DIVISOES } from '@/lib/schema.ts'

const agora = () => new Date().toISOString()

type Modo = (typeof DIVISOES)[number]

const COMO_DIVIDIR: { valor: Modo; nome: string; explica: string; icone: React.ElementType }[] = [
  {
    valor: 'igual',
    nome: 'Igual',
    explica: 'Todo mundo paga a mesma coisa.',
    icone: Users,
  },
  {
    valor: 'peso',
    nome: 'Por peso',
    explica: 'O peso é quantas partes da despesa a pessoa assume — um casal são duas.',
    icone: Scale,
  },
  {
    valor: 'personalizado',
    nome: 'Valor exato',
    explica: 'Você digita quanto cabe a cada um. A soma tem que fechar com o total.',
    icone: Wallet,
  },
]

export function FormDespesa({
  despesa,
  aoFechar,
}: {
  /** Registro existente para editar, ou null para criar. */
  despesa: Record<string, any> | null
  aoFechar: () => void
}) {
  const { snapshot, mutate } = useTrip()
  const fin = snapshot?.financeiro
  const pessoas = (snapshot?.participantes ?? []) as Record<string, any>[]
  const moeda = String(snapshot?.viagem?.moeda ?? 'BRL')

  const categorias = (fin?.admin ? fin.categorias : []) as Record<string, any>[]
  const divisoesAtuais = ((fin?.admin ? fin.divisoes : []) as Record<string, any>[]).filter(
    (d) => d.expense_id === despesa?.id,
  )
  const parcelasAtuais = ((fin?.admin ? fin.parcelas : []) as Record<string, any>[])
    .filter((p) => p.expense_id === despesa?.id)
    .sort((a, b) => Number(a.numero) - Number(b.numero))

  const editando = Boolean(despesa?.id)

  const [descricao, setDescricao] = useState(String(despesa?.descricao ?? ''))
  const [categoria, setCategoria] = useState(String(despesa?.categoria_id ?? ''))
  const [valor, setValor] = useState(
    despesa ? paraCampoDinheiro(Number(despesa.valor_centavos)) : '',
  )
  const [data, setData] = useState(paraDia(despesa?.ocorre_em) ?? '')
  const [pagador, setPagador] = useState(String(despesa?.traveler_id ?? pessoas[0]?.id ?? ''))
  const [nota, setNota] = useState(String(despesa?.nota ?? ''))
  const [estimado, setEstimado] = useState(despesa ? Boolean(despesa.estimado) : false)

  const [divisao, setDivisao] = useState<Modo>((despesa?.divisao as Modo) ?? 'igual')
  // Numa despesa nova todo mundo entra: é o caso comum, e desmarcar é mais
  // rápido do que marcar cinco pessoas uma a uma.
  const [dentro, setDentro] = useState<string[]>(
    editando ? divisoesAtuais.map((d) => String(d.traveler_id)) : pessoas.map((p) => String(p.id)),
  )
  const [pesos, setPesos] = useState<Record<string, string>>(
    Object.fromEntries(divisoesAtuais.map((d) => [String(d.traveler_id), String(d.peso ?? 1)])),
  )
  const [exatos, setExatos] = useState<Record<string, string>>(
    Object.fromEntries(
      divisoesAtuais.map((d) => [
        String(d.traveler_id),
        paraCampoDinheiro(Number(d.valor_centavos)),
      ]),
    ),
  )

  const [parcelado, setParcelado] = useState(parcelasAtuais.length > 1)
  const [quantidade, setQuantidade] = useState(String(Math.max(1, parcelasAtuais.length)))
  const [primeira, setPrimeira] = useState(paraDia(parcelasAtuais[0]?.vence_em) ?? '')
  const [frequencia, setFrequencia] = useState<Frequencia>(() => frequenciaDe(parcelasAtuais))

  const [erros, setErros] = useState<Record<string, string>>({})

  const total = paraCentavos(valor) ?? 0

  // A prévia usa exatamente as funções que o servidor usa para gravar.
  const linhas = useMemo(
    () =>
      dentro.map((id) => ({
        traveler_id: id,
        peso: Number(pesos[id] ?? '1') || 0,
        valor_centavos: paraCentavos(exatos[id]) ?? 0,
      })),
    [dentro, pesos, exatos],
  )
  const previa = useMemo(() => resolverDivisao(total, divisao, linhas), [total, divisao, linhas])
  const somaPrevia = previa.reduce((s, x) => s + x.valor_centavos, 0)

  const qtd = Math.max(1, Math.trunc(Number(quantidade) || 1))
  const previaParcelas = useMemo(
    () => (parcelado ? gerarParcelas(total, qtd, primeira || data || null, frequencia) : []),
    [parcelado, total, qtd, primeira, data, frequencia],
  )

  const nomeDe = (id: string) => String(pessoas.find((p) => String(p.id) === id)?.nome ?? '—')

  function salvar() {
    const novos: Record<string, string> = {}
    if (!descricao.trim()) novos.descricao = 'Escreva o nome da despesa.'
    if (paraCentavos(valor) === null) novos.valor = 'Informe um valor, ex: 1.250,00'
    else if (total <= 0) novos.valor = 'O valor precisa ser maior que zero.'
    if (dentro.length === 0) novos.dentro = 'Escolha pelo menos uma pessoa.'
    if (parcelado && (qtd < 1 || qtd > 120)) novos.quantidade = 'Entre 1 e 120 parcelas.'
    if (divisao === 'personalizado' && dentro.length > 0 && somaPrevia !== total) {
      novos.divisao = `A divisão precisa totalizar ${formatarDinheiro(total, moeda)}. Faltam ${formatarDinheiro(Math.abs(total - somaPrevia), moeda)}.`
    }
    setErros(novos)
    if (Object.keys(novos).length > 0) return

    void mutate({
      op: editando ? 'editar' : 'criar',
      entidade: 'custo',
      id: editando ? String(despesa!.id) : crypto.randomUUID(),
      campos: {
        descricao: descricao.trim(),
        categoria_id: categoria || null,
        traveler_id: pagador || null,
        valor_centavos: total,
        ocorre_em: data || null,
        divisao,
        estimado,
        nota: nota.trim() || null,
        ordem: Number(despesa?.ordem ?? 0),
        divisoes: linhas,
        parcelas_quantidade: parcelado ? qtd : 1,
        parcelas_primeira_em: (parcelado ? primeira : data) || null,
        parcelas_frequencia: frequencia,
      },
      client_ts: agora(),
    })
    aoFechar()
  }

  return (
    <AppModal
      titulo={editando ? 'Editar despesa' : 'Adicionar despesa'}
      descricao="Quem pagou e quem divide podem ser pessoas diferentes — o app faz a conta entre os dois."
      tamanho="grande"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar}>{editando ? 'Salvar despesa' : 'Adicionar despesa'}</Botao>
        </>
      }
    >
      <div className="space-y-5 pb-2">
        {/* ------------------------------------------------ o que foi */}
        <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Campo
              rotulo="Nome da despesa"
              valor={descricao}
              aoMudar={setDescricao}
              erro={erros.descricao}
              placeholder="Passagem aérea"
              obrigatorio
            />
          </div>
          <Campo
            rotulo="Valor total"
            dica="da despesa inteira"
            valor={valor}
            aoMudar={setValor}
            inputMode="decimal"
            placeholder="4.800,00"
            erro={erros.valor}
            obrigatorio
          />
          <Campo rotulo="Data" valor={data} aoMudar={setData} tipo="date" />
          <Selecao
            rotulo="Categoria"
            valor={categoria}
            aoMudar={setCategoria}
            opcoes={[
              { valor: '', nome: 'Sem categoria' },
              ...categorias.map((c) => ({ valor: String(c.id), nome: String(c.nome) })),
            ]}
          />
          <Selecao
            rotulo="Quem pagou"
            dica="quem adiantou o dinheiro"
            valor={pagador}
            aoMudar={setPagador}
            opcoes={[
              { valor: '', nome: 'Ninguém ainda' },
              ...pessoas.map((p) => ({ valor: String(p.id), nome: String(p.nome) })),
            ]}
          />
        </section>

        {/* ------------------------------------------------ quem divide */}
        <section className="border-t border-(--color-borda) pt-4">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <Rotulo>Quem participa desta despesa</Rotulo>
            <div className="flex gap-1">
              <Botao
                variante="fantasma"
                tamanho="pequeno"
                onClick={() => setDentro(pessoas.map((p) => String(p.id)))}
              >
                Todos
              </Botao>
              <Botao variante="fantasma" tamanho="pequeno" onClick={() => setDentro([])}>
                Nenhum
              </Botao>
            </div>
          </div>

          <div className="space-y-1.5">
            {pessoas.map((p) => {
              const id = String(p.id)
              const marcado = dentro.includes(id)
              const parte = previa.find((x) => x.traveler_id === id)
              return (
                <div
                  key={id}
                  className="flex items-center gap-3 rounded-xl border border-(--color-borda) px-3 py-2"
                  style={marcado ? { background: 'var(--color-destaque-tenue)' } : undefined}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={marcado}
                    onClick={() =>
                      setDentro((a) => (marcado ? a.filter((x) => x !== id) : [...a, id]))
                    }
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
                  >
                    <span
                      aria-hidden
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2"
                      style={{
                        borderColor: marcado ? 'var(--destaque)' : 'var(--color-borda-forte)',
                        background: marcado ? 'var(--destaque)' : 'transparent',
                      }}
                    >
                      {marcado && <Check size={13} strokeWidth={3} className="text-white" />}
                    </span>
                    <Avatar nome={String(p.nome)} url={p.avatar_url} tamanho={26} />
                    <span className="truncate text-sm font-medium">{String(p.nome)}</span>
                  </button>

                  {marcado && divisao === 'peso' && (
                    <label className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[12px] text-(--color-tinta-3)">partes</span>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={pesos[id] ?? '1'}
                        onChange={(e) => setPesos((v) => ({ ...v, [id]: e.target.value }))}
                        aria-label={`Partes de ${String(p.nome)}`}
                        className={`${CLASSE_CAMPO} w-16 px-2 py-1.5 text-center`}
                      />
                    </label>
                  )}

                  {marcado && divisao === 'personalizado' && (
                    <input
                      inputMode="decimal"
                      value={exatos[id] ?? ''}
                      placeholder="0,00"
                      onChange={(e) => setExatos((v) => ({ ...v, [id]: e.target.value }))}
                      aria-label={`Valor de ${String(p.nome)}`}
                      className={`${CLASSE_CAMPO} w-28 px-2 py-1.5 text-right`}
                    />
                  )}

                  {marcado && divisao !== 'personalizado' && (
                    <span className="tab-num shrink-0 text-sm font-semibold">
                      {formatarDinheiro(parte?.valor_centavos ?? 0, moeda)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {erros.dentro && (
            <p role="alert" className="mt-1.5 text-[13px] text-(--color-perigo-ink)">
              {erros.dentro}
            </p>
          )}
        </section>

        {/* ------------------------------------------------ como dividir */}
        <section className="border-t border-(--color-borda) pt-4">
          <Rotulo>Como dividir</Rotulo>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {COMO_DIVIDIR.map((o) => {
              const ativo = divisao === o.valor
              const Icone = o.icone
              return (
                <button
                  key={o.valor}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => setDivisao(o.valor)}
                  className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-colors"
                  style={{
                    borderColor: ativo ? 'var(--destaque)' : 'var(--color-borda)',
                    background: ativo ? 'var(--color-destaque-tenue)' : 'transparent',
                  }}
                >
                  <Icone
                    size={17}
                    strokeWidth={1.75}
                    style={{ color: ativo ? 'var(--destaque)' : 'var(--color-tinta-3)' }}
                  />
                  <span className="text-[13px] font-medium">{o.nome}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[12px] text-(--color-tinta-2)">
            {COMO_DIVIDIR.find((o) => o.valor === divisao)!.explica}
          </p>

          {dentro.length > 0 && (
            <div
              className="tab-num mt-2.5 flex items-baseline justify-between rounded-xl px-3 py-2 text-sm"
              style={{
                background:
                  divisao === 'personalizado' && somaPrevia !== total
                    ? 'var(--color-atencao-bg)'
                    : 'var(--color-superficie-2)',
                color:
                  divisao === 'personalizado' && somaPrevia !== total
                    ? 'var(--color-atencao-ink)'
                    : 'var(--color-tinta-2)',
              }}
            >
              <span className="font-medium">
                Soma da divisão
                {divisao === 'peso' && (
                  <span className="ml-1.5 font-normal">
                    · {linhas.reduce((s, l) => s + l.peso, 0)} partes
                  </span>
                )}
              </span>
              <span className="font-bold">{formatarDinheiro(somaPrevia, moeda)}</span>
            </div>
          )}
          {erros.divisao && (
            <p role="alert" className="mt-1.5 text-[13px] text-(--color-perigo-ink)">
              {erros.divisao}
            </p>
          )}
        </section>

        {/* ------------------------------------------------ pagamento */}
        <section className="border-t border-(--color-borda) pt-4">
          <Rotulo>Forma de pagamento</Rotulo>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[
              { v: false, nome: 'À vista' },
              { v: true, nome: 'Parcelado' },
            ].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                role="radio"
                aria-checked={parcelado === o.v}
                onClick={() => setParcelado(o.v)}
                className="toque cursor-pointer rounded-xl border text-[13px] font-medium transition-colors"
                style={{
                  borderColor: parcelado === o.v ? 'var(--destaque)' : 'var(--color-borda)',
                  background: parcelado === o.v ? 'var(--color-destaque-tenue)' : 'transparent',
                }}
              >
                {o.nome}
              </button>
            ))}
          </div>

          {parcelado && (
            <>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Campo
                  rotulo="Parcelas"
                  valor={quantidade}
                  aoMudar={setQuantidade}
                  inputMode="numeric"
                  erro={erros.quantidade}
                />
                <Campo
                  rotulo="Primeira vence em"
                  valor={primeira}
                  aoMudar={setPrimeira}
                  tipo="date"
                />
                <Selecao
                  rotulo="Frequência"
                  valor={frequencia}
                  aoMudar={(v) => setFrequencia(v as Frequencia)}
                  opcoes={[
                    { valor: 'mensal', nome: 'Mensal' },
                    { valor: 'quinzenal', nome: 'Quinzenal' },
                    { valor: 'semanal', nome: 'Semanal' },
                  ]}
                />
              </div>

              {previaParcelas.length > 0 && total > 0 && (
                <div className="mt-3 rounded-xl bg-(--color-superficie-2) p-3">
                  <p className="t-legenda mb-2">As parcelas ficam assim</p>
                  <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
                    {previaParcelas.map((p) => (
                      <div
                        key={p.numero}
                        className="tab-num flex items-baseline justify-between text-[13px]"
                      >
                        <span className="text-(--color-tinta-2)">
                          {p.numero}/{previaParcelas.length}
                          {p.vence_em && (
                            <span className="ml-2 text-(--color-tinta-3)">
                              {formatarData(p.vence_em, {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                              })}
                            </span>
                          )}
                        </span>
                        <span className="font-semibold">
                          {formatarDinheiro(p.valor_centavos, moeda)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {dentro.length > 0 && (
                    <p className="mt-2 border-t border-(--color-borda) pt-2 text-[12px] text-(--color-tinta-2)">
                      Cada pessoa reembolsa a parte dela em {previaParcelas.length} vezes.
                    </p>
                  )}
                </div>
              )}

              {editando && (
                <p className="mt-2 text-[12px] text-(--color-tinta-3)">
                  Salvar refaz o calendário de parcelas a partir destes campos. O que já foi pago em
                  cada parcela é preservado.
                </p>
              )}
            </>
          )}
        </section>

        {/* ------------------------------------------------ extras */}
        <section className="border-t border-(--color-borda) pt-4">
          <label className="block">
            <RotuloCampo>Observação</RotuloCampo>
            <textarea
              value={nota}
              rows={2}
              onChange={(e) => setNota(e.target.value)}
              className={`mt-1 ${CLASSE_CAMPO}`}
            />
          </label>
          <Interruptor
            rotulo="Valor ainda é estimativa"
            descricao="Marque enquanto o preço não estiver fechado."
            ligado={estimado}
            aoMudar={setEstimado}
          />
        </section>

        {pagador && dentro.includes(pagador) && dentro.length > 1 && total > 0 && (
          <p className="rounded-xl bg-(--color-info-bg) px-3 py-2.5 text-[13px] text-(--color-info-ink)">
            {nomeDe(pagador)} adiantou {formatarDinheiro(total, moeda)} e assume{' '}
            {formatarDinheiro(
              previa.find((x) => x.traveler_id === pagador)?.valor_centavos ?? 0,
              moeda,
            )}
            . As outras {dentro.length - 1} pessoas reembolsam o resto.
          </p>
        )}
      </div>
    </AppModal>
  )
}

/**
 * Deduz a frequência de um parcelamento já gravado pelo intervalo entre a
 * primeira e a segunda parcela. Serve só para reabrir o formulário com o que a
 * pessoa escolheu antes — o valor gravado é sempre a data de cada parcela.
 */
function frequenciaDe(parcelas: Record<string, any>[]): Frequencia {
  if (parcelas.length < 2) return 'mensal'
  const dias = diasAte(paraDia(parcelas[0].vence_em), paraDia(parcelas[1].vence_em))
  if (dias > 0 && dias <= 10) return 'semanal'
  if (dias > 10 && dias <= 20) return 'quinzenal'
  return 'mensal'
}
