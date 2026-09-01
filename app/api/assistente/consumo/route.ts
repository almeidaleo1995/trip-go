// GET /api/assistente/consumo - quanto o guia custou.
//
// Duas metades, com disponibilidade diferente:
//
//   1. O que ESTE app gastou. Sempre funciona: cada resposta da API traz o
//      `usage`, e `ai_usage` guardou. Não depende de nada externo.
//   2. O gasto consolidado da organização. Depende da Admin API, que a
//      documentação oficial declara INDISPONÍVEL para conta individual. Se a
//      conta não for uma organização no Console, esta metade não tem como
//      funcionar — e isso não é erro nosso, é a tela precisando explicar.
//
// A credencial de admin é o ponto sensível da feature inteira: ela administra
// membros, workspaces e chaves da organização. Este é o único arquivo do
// projeto que a lê, ela nunca chega perto do módulo que monta prompt, e a rota
// devolve NÚMEROS AGREGADOS — nunca o corpo bruto da resposta da Anthropic, que
// carrega ids de workspace e de chave.
import { usoDaViagem } from '@/lib/db.ts'
import { exigirUsuario, exigirViagem } from '@/lib/auth.ts'
import { ErroHttp } from '@/lib/session.ts'
import { rota } from '@/lib/api.ts'
import { somar, agrupar, aproveitamentoCache, type LinhaUso } from '@/lib/consumo.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Cache em memória do consolidado. A doc recomenda no máximo 1 consulta/min e
 *  cache para painel; aqui é 1 hora, porque o número é da fatura, não do minuto. */
let cacheOrg: { em: number; dados: unknown } | null = null
const VALIDADE_MS = 60 * 60 * 1000

export const GET = rota(async (req) => {
  const u = await exigirUsuario()
  const url = new URL(req.url)
  const tripId = url.searchParams.get('trip')
  if (!tripId) throw new ErroHttp(400, 'Viagem não informada.')

  // Só o dono: o relatório mostra o que cada participante gastou, e isso é
  // informação de administração da viagem, não de uso pessoal.
  await exigirViagem(u.id, tripId, 'proprietario')

  const desde = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const linhas = (await usoDaViagem(tripId, desde)) as unknown as (LinhaUso & { nome: string })[]

  const total = somar(linhas)
  const porPessoa = agrupar(linhas, 'user_id').map((g) => ({
    ...g,
    nome: linhas.find((l) => l.user_id === g.valor)?.nome ?? '—',
  }))

  return {
    app: {
      total,
      cache: aproveitamentoCache(total),
      porPessoa,
      porModo: agrupar(linhas, 'modo'),
    },
    // O consolidado é do OPERADOR, não da viagem — ver `ehOperador`.
    organizacao: ehOperador(u.email) ? await consolidado() : FORA_DO_OPERADOR,
  }
})

/**
 * Quem pode ver a fatura da Anthropic.
 *
 * A metade de cima deste relatório é da VIAGEM e por isso é de quem a criou. A de
 * baixo não é: `cost_report` devolve o gasto da organização inteira, ou seja, de
 * quem HOSPEDA o aplicativo — todas as viagens de todas as contas somadas, e o
 * mês inteiro. Pendurá-la no mesmo `proprietario` da viagem entregava a conta de
 * luz do operador a qualquer pessoa: cadastro é aberto, criar viagem faz de você
 * proprietário dela, e pronto.
 *
 * A lista vem de `OPERADOR_EMAILS` porque não existe no banco o conceito de
 * "administrador da instalação", e inventar uma coluna `users.admin` seria criar
 * um papel novo — com tela, com migração e com quem promove quem — para uma
 * pergunta que a variável de ambiente responde. Vazia (o padrão) esconde a
 * metade de baixo de todo mundo, que é o comportamento certo para quem não sabe
 * que ela existe.
 */
function ehOperador(email: string | null | undefined): boolean {
  const lista = (process.env.OPERADOR_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return (
    lista.length > 0 &&
    lista.includes(
      String(email ?? '')
        .trim()
        .toLowerCase(),
    )
  )
}

/** O mesmo formato de indisponível que a tela já sabe desenhar. Nenhuma mudança
    de UI: o bloco explica por que não há número, como quando falta a chave. */
const FORA_DO_OPERADOR = {
  disponivel: false,
  motivo:
    'O gasto consolidado é da conta que hospeda o aplicativo, não desta viagem. ' +
    'Os números acima são o que esta viagem consumiu.',
} as const

type Consolidado =
  | { disponivel: false; motivo: string }
  | { disponivel: true; custoUsd: number; de: string; ate: string }

/**
 * O gasto da organização, quando ele existe.
 *
 * Nunca lança: uma falha aqui vira `disponivel: false` com o motivo em pt-BR. O
 * relatório do próprio app é a informação principal, e derrubá-lo porque a
 * metade opcional falhou seria trocar o certo pelo duvidoso.
 */
async function consolidado(): Promise<Consolidado> {
  const chave = process.env.ANTHROPIC_ADMIN_KEY
  if (!chave) {
    return {
      disponivel: false,
      motivo:
        'O gasto consolidado da conta na Anthropic precisa de uma chave de administrador, ' +
        'que só existe em contas de organização. Os números acima são do próprio aplicativo.',
    }
  }

  if (cacheOrg && Date.now() - cacheOrg.em < VALIDADE_MS) {
    return cacheOrg.dados as Consolidado
  }

  const ate = new Date()
  const de = new Date(ate.getFullYear(), ate.getMonth(), 1)

  try {
    // Endpoint fora dos SDKs — a documentação é explícita: relatórios de uso e
    // custo são só HTTP cru. Granularidade do cost_report é diária.
    const r = await fetch(
      'https://api.anthropic.com/v1/organizations/cost_report' +
        `?starting_at=${de.toISOString()}&ending_at=${ate.toISOString()}`,
      { headers: { 'anthropic-version': '2023-06-01', 'x-api-key': chave } },
    )

    if (!r.ok) {
      return {
        disponivel: false,
        motivo:
          r.status === 401 || r.status === 403
            ? 'A chave de administrador foi recusada. Contas individuais não têm acesso a esses relatórios.'
            : `A Anthropic respondeu ${r.status} ao relatório de custo.`,
      }
    }

    // Valores vêm como string decimal em CENTAVOS de dólar. Somamos os buckets
    // e devolvemos só o total — o corpo bruto traz ids de workspace e de chave,
    // que não têm por que sair deste processo.
    const corpo = (await r.json()) as { data?: { results?: { amount?: string }[] }[] }
    const centavos = (corpo.data ?? []).reduce(
      (soma, bucket) =>
        soma + (bucket.results ?? []).reduce((s, x) => s + Number(x.amount ?? 0), 0),
      0,
    )

    const dados: Consolidado = {
      disponivel: true,
      custoUsd: centavos / 100,
      de: de.toISOString().slice(0, 10),
      ate: ate.toISOString().slice(0, 10),
    }
    cacheOrg = { em: Date.now(), dados }
    return dados
  } catch {
    return { disponivel: false, motivo: 'Não consegui falar com a Anthropic agora.' }
  }
}
