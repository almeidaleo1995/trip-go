'use client'

// Minhas viagens — a mesa de trabalho da conta.
//
// Início inspira; esta tela administra. Aqui se busca, filtra, ordena, edita,
// duplica, arquiva e exclui. Nada do CONTEÚDO de uma viagem aparece: para isso
// existe /viagens/:id. É essa separação que impede o app de virar um painel
// gigante já na primeira tela.
//
// Busca, filtro e ordenação rodam no cliente sobre a lista que já veio: uma conta
// tem dezenas de viagens, não milhares, e filtrar no servidor custaria uma ida à
// rede por tecla digitada — além de parar de funcionar offline.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, ArrowUpDown, Archive } from 'lucide-react'
import { DashboardLayout } from '@/components/DashboardLayout.tsx'
import { CartaoViagem, type ViagemResumo } from '@/components/CartaoViagem.tsx'
import { AcoesViagem } from '@/components/AcoesViagem.tsx'
import { FormViagem } from '@/components/FormViagem.tsx'
import {
  Botao,
  Carregando,
  Falha,
  Titulo,
  Vazio,
  CLASSE_CAMPO,
  useAviso,
} from '@/components/ui.tsx'
import { statusViagem, type StatusViagem } from '@/lib/derive.ts'

type Filtro = 'todas' | StatusViagem

const FILTROS: { id: Filtro; nome: string }[] = [
  { id: 'todas', nome: 'Todas' },
  { id: 'planejando', nome: 'Planejando' },
  { id: 'proxima', nome: 'Próximas' },
  { id: 'andamento', nome: 'Em andamento' },
  { id: 'concluida', nome: 'Concluídas' },
  { id: 'arquivada', nome: 'Arquivadas' },
]

const ORDENS = {
  proximas: 'Mais próximas',
  recentes: 'Mexidas recentemente',
  antigas: 'Mais antigas',
  az: 'Nome (A-Z)',
  za: 'Nome (Z-A)',
} as const

type Ordem = keyof typeof ORDENS

const texto = (v: unknown) => String(v ?? '').toLowerCase()

function ordenar(lista: ViagemResumo[], ordem: Ordem): ViagemResumo[] {
  const pt = (a: string, b: string) => a.localeCompare(b, 'pt-BR')
  const copia = [...lista]
  switch (ordem) {
    case 'recentes':
      return copia.sort((a, b) => texto(b.atualizada_em).localeCompare(texto(a.atualizada_em)))
    case 'antigas':
      return copia.sort((a, b) => pt(String(a.data_partida), String(b.data_partida)))
    case 'az':
      return copia.sort((a, b) => pt(a.nome, b.nome))
    case 'za':
      return copia.sort((a, b) => pt(b.nome, a.nome))
    default: {
      // "Mais próximas": o que ainda vai acontecer primeiro, e o passado no fim,
      // do mais recente para o mais antigo. Ordenar só por data jogaria a viagem
      // de 2019 para o topo da tela de quem tem uma viagem marcada para 2027.
      const hoje = new Date().toISOString().slice(0, 10)
      const futura = (v: ViagemResumo) => String(v.data_retorno).slice(0, 10) >= hoje
      return copia.sort((a, b) => {
        if (futura(a) !== futura(b)) return futura(a) ? -1 : 1
        const d = pt(String(a.data_partida), String(b.data_partida))
        return futura(a) ? d : -d
      })
    }
  }
}

export default function Viagens() {
  const router = useRouter()
  const avisar = useAviso()
  const [viagens, setViagens] = useState<ViagemResumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [ordem, setOrdem] = useState<Ordem>('proximas')

  // Nada de setState no corpo síncrono: limpar o erro só quando a resposta chega
  // evita o render em cascata que o lint do React aponta.
  const carregar = useCallback(() => {
    return fetch('/api/viagens')
      .then((r) => r.json())
      .then((d) => {
        setViagens(d.viagens || [])
        setErro(null)
      })
      .catch(() => setErro('Não consegui carregar suas viagens.'))
      .finally(() => setCarregando(false))
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const arquivadas = viagens.filter((v) => v.arquivada).length

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const lista = viagens.filter((v) => {
      const status = statusViagem(new Date(), v.data_partida, v.data_retorno, v.arquivada)
      // "Todas" não inclui arquivada: arquivar existe para tirar da frente.
      if (filtro === 'todas' ? status === 'arquivada' : status !== filtro) return false
      if (!q) return true
      return [v.nome, v.subtitulo, v.descricao, v.destinos].some((c) => texto(c).includes(q))
    })
    return ordenar(lista, ordem)
  }, [viagens, busca, filtro, ordem])

  if (carregando) return <Carregando texto="Carregando suas viagens…" />

  return (
    <DashboardLayout>
      {/* Sem medida própria: quem limita e centra é o `DashboardLayout`. Uma
          grade de cartões não tem "linha de leitura" a respeitar — o `max-w-6xl`
          que estava aqui prendia três cartões no meio de um monitor de 2560 e
          deixava mil pixels de branco à direita. */}
      <div>
        <Titulo
          descricao="Todas as suas aventuras em um só lugar."
          acao={
            <Botao onClick={() => setCriando(true)}>
              <Plus size={16} /> Nova viagem
            </Botao>
          }
        >
          Minhas viagens
        </Titulo>

        {erro && <Falha texto={erro} aoTentar={() => void carregar()} />}

        {viagens.length === 0 && !erro ? (
          <Vazio
            titulo="Você ainda não tem nenhuma viagem"
            texto="Sua próxima aventura começa aqui. Crie a viagem e convide quem vai junto."
            acao={
              <Botao onClick={() => setCriando(true)}>
                <Plus size={16} /> Criar minha primeira viagem
              </Botao>
            }
          />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <label className="relative min-w-56 flex-1">
                <Search
                  size={16}
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--color-tinta-3)"
                />
                <input
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome, cidade ou país…"
                  aria-label="Buscar viagem"
                  className={`toque pl-9 ${CLASSE_CAMPO}`}
                />
              </label>

              <label className="flex shrink-0 items-center gap-2">
                <ArrowUpDown size={15} aria-hidden className="text-(--color-tinta-3)" />
                <span className="sr-only">Ordenar por</span>
                <select
                  value={ordem}
                  onChange={(e) => setOrdem(e.target.value as Ordem)}
                  aria-label="Ordenar viagens"
                  // Largura no style: `CLASSE_CAMPO` traz `w-full`, que sai
                  // depois de `w-auto` na folha e vencia — o seletor esticava
                  // pela linha inteira em vez de caber no nome da ordem.
                  style={{ width: 'auto' }}
                  className={`toque ${CLASSE_CAMPO}`}
                >
                  {Object.entries(ORDENS).map(([id, nome]) => (
                    <option key={id} value={id}>
                      {nome}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Rola na horizontal no celular em vez de quebrar em três linhas. */}
            <div
              role="tablist"
              aria-label="Filtrar por status"
              className="mb-5 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
            >
              {FILTROS.map((f) => {
                const ativo = filtro === f.id
                if (f.id === 'arquivada' && arquivadas === 0) return null
                return (
                  <button
                    key={f.id}
                    role="tab"
                    aria-selected={ativo}
                    onClick={() => setFiltro(f.id)}
                    style={
                      ativo
                        ? { background: 'var(--color-destaque)', color: '#fff' }
                        : {
                            background: 'var(--color-cartao)',
                            color: 'var(--color-tinta-2)',
                            borderColor: 'var(--color-borda-forte)',
                          }
                    }
                    className={`shrink-0 cursor-pointer rounded-full border border-transparent px-3.5 py-2 text-[13px] font-medium transition-colors ${
                      ativo ? '' : 'hover:bg-(--color-superficie-2)'
                    }`}
                  >
                    {f.id === 'arquivada' && <Archive size={13} className="mr-1.5 inline" />}
                    {f.nome}
                  </button>
                )
              })}
            </div>

            {visiveis.length === 0 ? (
              <Vazio
                titulo="Nenhuma viagem com esses critérios"
                texto={
                  busca
                    ? `Nada encontrado para “${busca}”. Tente outro nome, cidade ou país.`
                    : 'Nenhuma viagem neste status por enquanto.'
                }
                acao={
                  <Botao
                    variante="secundario"
                    onClick={() => {
                      setBusca('')
                      setFiltro('todas')
                    }}
                  >
                    Limpar filtros
                  </Botao>
                }
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visiveis.map((v) => (
                  <CartaoViagem
                    key={v.id}
                    viagem={v}
                    acoes={<AcoesViagem viagem={v} aoMudar={() => void carregar()} />}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {criando && (
        <FormViagem
          aoFechar={() => setCriando(false)}
          aoSalvar={(v) => {
            setCriando(false)
            avisar('sucesso', 'Viagem criada.')
            // Abre a viagem no roteiro: numa viagem recém-criada é a primeira
            // tela com trabalho a fazer, seja escrevendo à mão ou recebendo o
            // que a skill `roteiro-trip-go` montou a partir dos documentos.
            router.push(`/viagens/${v.id}?aba=roteiro`)
          }}
        />
      )}
    </DashboardLayout>
  )
}
