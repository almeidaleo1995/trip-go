'use client'

// Criar e editar viagem no MESMO formulário. São a mesma decisão tomada duas
// vezes; separá-los em duas telas é como os dois divergem — uma ganha um campo
// e a outra não.
//
// Não é assistente de cinco passos de propósito. Criar viagem aqui é escrever um
// nome e escolher duas datas; o resto (cor, capa, moeda, descrição) fica atrás de
// "Personalizar" e pode esperar. Cinco telas para quatro campos é o cansaço que o
// próprio pedido manda evitar — e tudo isso continua editável depois.
import { useState } from 'react'
import { ChevronDown, Palette } from 'lucide-react'
import { AppModal, Botao, Campo, GrupoCampos, RotuloCampo, CLASSE_CAMPO } from './ui.tsx'
import type { ViagemResumo } from './CartaoViagem.tsx'
import { MOEDAS } from '@/lib/schema.ts'
import { theme } from '@/config/theme.ts'

const PADRAO = theme.paletaViagens[0].valor

/** Data que o driver devolve (Date ou ISO) -> "YYYY-MM-DD" que o <input date> aceita. */
function paraCampoData(v: unknown): string {
  if (!v) return ''
  return String(v instanceof Date ? v.toISOString() : v).slice(0, 10)
}

export function FormViagem({
  viagem,
  aoFechar,
  aoSalvar,
}: {
  /** Ausente = criar. Presente = editar aquela viagem. */
  viagem?: ViagemResumo | null
  aoFechar: () => void
  aoSalvar: (v: ViagemResumo) => void
}) {
  const editando = Boolean(viagem?.id)
  const [nome, setNome] = useState(viagem?.nome ?? '')
  const [subtitulo, setSubtitulo] = useState(viagem?.subtitulo ?? '')
  const [descricao, setDescricao] = useState(viagem?.descricao ?? '')
  const [dataPartida, setDataPartida] = useState(paraCampoData(viagem?.data_partida))
  const [dataRetorno, setDataRetorno] = useState(paraCampoData(viagem?.data_retorno))
  const [moeda, setMoeda] = useState(viagem?.moeda ?? 'BRL')
  const [cor, setCor] = useState(viagem?.cor_destaque || PADRAO)
  const [capa, setCapa] = useState(viagem?.capa_url ?? '')
  const [mais, setMais] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!nome.trim()) return setErro('Dê um nome para a viagem.')
    if (!dataPartida || !dataRetorno) return setErro('Informe as datas de partida e retorno.')
    if (dataRetorno < dataPartida) return setErro('O retorno não pode ser antes da partida.')

    setSalvando(true)
    setErro(null)
    try {
      const r = await fetch('/api/viagens', {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(editando ? { id: viagem!.id } : {}),
          nome: nome.trim(),
          subtitulo: subtitulo.trim() || null,
          descricao: descricao.trim() || null,
          data_partida: dataPartida,
          data_retorno: dataRetorno,
          moeda,
          cor_destaque: cor,
          capa_url: capa.trim() || null,
        }),
      })
      const d = await r.json()
      if (!r.ok) return setErro(d.erro || 'Não consegui salvar a viagem.')
      aoSalvar({ participantes: 1, ...(viagem ?? {}), ...d.viagem })
    } catch {
      setErro('Sem conexão. Tente de novo quando a internet voltar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <AppModal
      titulo={editando ? 'Editar viagem' : 'Nova viagem'}
      descricao={
        editando ? 'Muda só o que precisa mudar.' : 'Só o nome e as datas. O resto vem depois.'
      }
      tamanho="grande"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar} carregando={salvando}>
            {editando ? 'Salvar alterações' : 'Criar viagem'}
          </Botao>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <GrupoCampos titulo="O básico">
          <div className="sm:col-span-2">
            <Campo
              rotulo="Nome"
              valor={nome}
              aoMudar={setNome}
              obrigatorio
              placeholder="Europa 2027"
            />
          </div>
          <Campo
            rotulo="Partida"
            tipo="date"
            valor={dataPartida}
            aoMudar={setDataPartida}
            obrigatorio
          />
          <Campo
            rotulo="Retorno"
            tipo="date"
            valor={dataRetorno}
            aoMudar={setDataRetorno}
            obrigatorio
          />
          <div className="sm:col-span-2">
            <Campo
              rotulo="Destino"
              dica="opcional"
              valor={String(subtitulo ?? '')}
              aoMudar={setSubtitulo}
              placeholder="Itália, França e Espanha"
            />
          </div>
        </GrupoCampos>

        {/* Detalhes recolhidos: <details> nativo, sem estado de acordeão para manter. */}
        <details open={mais} onToggle={(e) => setMais(e.currentTarget.open)}>
          <summary className="toque flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-(--color-tinta-2)">
            <Palette size={15} />
            Personalizar
            <ChevronDown
              size={15}
              className="transition-transform"
              style={{ transform: mais ? 'rotate(180deg)' : 'none' }}
            />
          </summary>

          <div className="mt-3 space-y-4">
            <GrupoCampos titulo="Aparência">
              <div className="sm:col-span-2">
                <RotuloCampo>Cor da viagem</RotuloCampo>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {theme.paletaViagens.map((c) => (
                    <button
                      key={c.valor}
                      type="button"
                      onClick={() => setCor(c.valor)}
                      aria-label={c.nome}
                      aria-pressed={cor.toLowerCase() === c.valor.toLowerCase()}
                      title={c.nome}
                      style={{ background: c.valor }}
                      className={`h-9 w-9 cursor-pointer rounded-full transition-transform hover:scale-105 ${
                        cor.toLowerCase() === c.valor.toLowerCase()
                          ? 'ring-2 ring-(--color-tinta) ring-offset-2'
                          : ''
                      }`}
                    />
                  ))}
                  {/* Qualquer outra cor: seletor nativo do sistema, zero dependência. */}
                  <label className="toque flex cursor-pointer items-center gap-2 rounded-xl border border-(--color-borda-forte) px-3 text-[13px] text-(--color-tinta-2)">
                    Outra
                    <input
                      type="color"
                      value={cor}
                      onChange={(e) => setCor(e.target.value)}
                      aria-label="Escolher outra cor"
                      className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                  </label>
                </div>
              </div>
              <div className="sm:col-span-2">
                <Campo
                  rotulo="Capa"
                  dica="link de imagem — em branco, o app desenha uma"
                  tipo="url"
                  valor={capa}
                  aoMudar={setCapa}
                  placeholder="https://…"
                />
              </div>
            </GrupoCampos>

            <GrupoCampos titulo="Configurações">
              <label className="block">
                <RotuloCampo>Moeda principal</RotuloCampo>
                <select
                  value={moeda}
                  onChange={(e) => setMoeda(e.target.value)}
                  className={`toque mt-1 ${CLASSE_CAMPO}`}
                >
                  {MOEDAS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <div className="sm:col-span-2">
                <Campo
                  rotulo="Descrição"
                  dica="opcional"
                  valor={String(descricao ?? '')}
                  aoMudar={setDescricao}
                  placeholder="Réveillon em Roma e o resto do mês pela Europa"
                />
              </div>
            </GrupoCampos>
          </div>
        </details>

        {erro && (
          <p
            role="alert"
            className="rounded-xl bg-(--color-perigo-bg) px-3 py-2 text-sm text-(--color-perigo-ink)"
          >
            {erro}
          </p>
        )}
      </div>
    </AppModal>
  )
}
