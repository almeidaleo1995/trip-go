// POST /api/import - cria uma viagem a partir do JSON padrão.
//
// Importar sempre CRIA uma viagem nova, nunca substitui. Na versão de viagem
// única isso arquivava a anterior; com várias viagens por conta, substituir seria
// destruição silenciosa — a pessoa passa a ter duas e escolhe qual manter.
import { exigirUsuario } from '@/lib/auth.ts'
import { gravarViagemAtual, ErroHttp, LIMITES_ESCRITA } from '@/lib/session.ts'
import { validarImportacao, resumirImportacao } from '@/lib/schema.ts'
import { importarViagem } from '@/lib/importar.ts'
import { rota, lerJson, limitar } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = rota(async (req) => {
  const u = await exigirUsuario()
  // Cada importação bem-sucedida CRIA uma viagem com tudo dentro. Sem limite, um
  // laço com o mesmo arquivo enche o banco de viagens legítimas do ponto de vista
  // do schema — e é a conta que responde por elas, então a chave é a conta.
  limitar(`escrita:${u.id}`, LIMITES_ESCRITA, 'Muitas importações seguidas. Tente em instantes.')

  const bruto = (await lerJson(req)) as Record<string, unknown>
  const dryRun = bruto?.dry_run === true
  const payload = (bruto?.arquivo ?? bruto) as unknown

  const r = validarImportacao(payload)
  if (!r.sucesso) throw new ErroHttp(400, r.erro)

  const resumo = resumirImportacao(r.dados)

  // Pré-visualização: mostra o que vai entrar sem tocar no banco.
  if (dryRun) return { dryRun: true, resumo, viagem: r.dados.viagem.nome }

  const { tripId } = await importarViagem(r.dados, u.id)
  await gravarViagemAtual(tripId)
  return { ok: true, id: tripId, resumo, viagem: r.dados.viagem.nome }
})
