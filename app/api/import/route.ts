// POST /api/import - cria uma viagem a partir do JSON padrão.
//
// Importar sempre CRIA uma viagem nova, nunca substitui. Na versão de viagem
// única isso arquivava a anterior; com várias viagens por conta, substituir seria
// destruição silenciosa — a pessoa passa a ter duas e escolhe qual manter.
import { exigirUsuario } from '@/lib/auth.ts'
import { registrarTentativa } from '@/lib/db.ts'
import { gravarViagemAtual, LIMITES_IMPORTACAO, ErroHttp } from '@/lib/session.ts'
import { validarImportacao, resumirImportacao } from '@/lib/schema.ts'
import { importarViagem } from '@/lib/importar.ts'
import { rota, lerJson } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = rota(async (req) => {
  const u = await exigirUsuario()

  // Uma importacao cria uma viagem inteira — dezenas de tabelas, centenas de
  // linhas — e a rota e autenticada mas nao limitada. Uma conta valida em laco
  // enchia o banco de graca. O `dry_run` conta junto de proposito: ele valida o
  // arquivo inteiro, que e o mesmo trabalho, menos a escrita.
  const limite = await registrarTentativa(`importacao:${u.id}`, LIMITES_IMPORTACAO)
  if (limite.bloqueado) {
    throw new ErroHttp(429, 'Muitas importações seguidas. Tente de novo mais tarde.')
  }

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
