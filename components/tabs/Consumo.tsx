'use client'

// O que o guia custou. Só o dono da viagem chega aqui.
//
// A tela lidera com o número que resolve a pergunta real ("estou gastando
// muito?") e só depois abre por pessoa e por modo. O consolidado da organização
// vem por último e, quando não existe, explica o motivo em vez de mostrar erro:
// a Admin API não atende conta individual, e isso é uma condição da conta, não
// uma falha do aplicativo.
import { useEffect, useState } from 'react'
import { useTrip } from '../TripProvider.tsx'
import { Titulo, Cartao, Vazio, Esqueleto, Linha, Falha } from '../ui.tsx'
import { DOLAR } from '@/config/precos.ts'

type Resumo = {
  chamadas: number
  entrada: number
  saida: number
  dolar: number
  real: number
  buscas: number
  incompleto: boolean
}

type Dados = {
  app: {
    total: Resumo
    cache: number | null
    porPessoa: { valor: string; nome: string; resumo: Resumo }[]
    porModo: { valor: string; resumo: Resumo }[]
  }
  organizacao:
    | { disponivel: false; motivo: string }
    | { disponivel: true; custoUsd: number; de: string; ate: string }
}

const NOME_MODO: Record<string, string> = {
  duvida: 'Dúvidas',
  curiosidade: 'Curiosidades',
  criar_viagem: 'Montar viagem',
  preparacao: 'Preparação',
}

const reais = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

export function Consumo() {
  const { snapshot } = useTrip()
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState(false)
  const tripId = String(snapshot?.viagem?.id ?? '')

  useEffect(() => {
    if (!tripId) return
    let vivo = true
    fetch(`/api/assistente/consumo?trip=${encodeURIComponent(tripId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!vivo) return
        setDados(d)
        setErro(false)
      })
      .catch(() => vivo && setErro(true))
    return () => {
      vivo = false
    }
  }, [tripId])

  if (erro) return <Falha texto="Não consegui carregar o consumo do guia." />
  if (!dados) return <Esqueleto className="h-64" />

  const t = dados.app.total

  return (
    <div>
      <Titulo>Consumo do guia</Titulo>

      {t.chamadas === 0 ? (
        <Vazio
          titulo="O guia ainda não foi usado"
          texto="Quando alguém perguntar alguma coisa, o custo aparece aqui — por pessoa e por tipo de pergunta."
        />
      ) : (
        <div className="space-y-4">
          <Cartao>
            <p className="t-legenda">Últimos 90 dias</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight">{reais(t.real)}</p>
            <p className="t-aux mt-1">
              {t.chamadas} {t.chamadas === 1 ? 'pergunta' : 'perguntas'} · US$ {t.dolar.toFixed(2)}{' '}
              convertido a R$ {DOLAR.toFixed(2)}
            </p>
            {dados.app.cache !== null && (
              <p className="t-aux mt-2">
                {dados.app.cache}% da leitura veio do cache — quanto maior, mais barata fica cada
                pergunta.
              </p>
            )}
            {t.buscas > 0 && (
              <p className="t-aux mt-1">
                {t.buscas} {t.buscas === 1 ? 'busca' : 'buscas'} na internet, cobradas à parte e não
                incluídas neste total.
              </p>
            )}
            {t.incompleto && (
              <p className="t-aux mt-1 text-(--color-atencao-ink)">
                Algumas perguntas usaram um modelo sem preço cadastrado e ficaram de fora da conta.
              </p>
            )}
          </Cartao>

          <Cartao>
            <p className="t-cartao mb-2">Por pessoa</p>
            {dados.app.porPessoa.map((p) => (
              <Linha
                key={p.valor}
                rotulo={p.nome}
                valor={`${reais(p.resumo.real)} · ${p.resumo.chamadas}`}
              />
            ))}
          </Cartao>

          <Cartao>
            <p className="t-cartao mb-2">Por tipo de pergunta</p>
            {dados.app.porModo.map((m) => (
              <Linha
                key={m.valor}
                rotulo={NOME_MODO[m.valor] ?? m.valor}
                valor={`${reais(m.resumo.real)} · ${m.resumo.chamadas}`}
              />
            ))}
          </Cartao>
        </div>
      )}

      <Cartao className="mt-4">
        <p className="t-cartao mb-1">Conta na Anthropic</p>
        {dados.organizacao.disponivel ? (
          <>
            <p className="text-xl font-semibold">
              US$ {dados.organizacao.custoUsd.toFixed(2)}
            </p>
            <p className="t-aux mt-1">
              Gasto de toda a conta entre {dados.organizacao.de} e {dados.organizacao.ate}, não só
              deste aplicativo.
            </p>
          </>
        ) : (
          <p className="t-aux">{dados.organizacao.motivo}</p>
        )}
      </Cartao>
    </div>
  )
}
