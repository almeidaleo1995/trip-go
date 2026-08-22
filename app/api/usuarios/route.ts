// POST /api/usuarios -> criar conta
//
// Quem se cadastra entra já logado: pedir para a pessoa fazer login logo depois
// de digitar a senha duas vezes é uma etapa sem propósito.
import { criarUsuario, vincularParticipantesPorEmail } from '@/lib/db.ts'
import { hashSenha, criarToken, gravarCookie, ErroHttp } from '@/lib/session.ts'
import { CadastroSchema, formatarErroZod } from '@/lib/schema.ts'
import { rota, lerJson } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = rota(async (req) => {
  const parsed = CadastroSchema.safeParse(await lerJson(req, 8192))
  if (!parsed.success) throw new ErroHttp(400, formatarErroZod(parsed.error))

  const { nome, email, senha } = parsed.data
  const usuario = await criarUsuario(nome, email, await hashSenha(senha))

  // `criarUsuario` devolve null quando o unique do e-mail barrou o insert. É a
  // única checagem de duplicidade que não tem corrida entre o select e o insert.
  if (!usuario) throw new ErroHttp(409, 'Já existe uma conta com esse e-mail.')

  await vincularParticipantesPorEmail(usuario.id, usuario.email)
  await gravarCookie(criarToken(usuario.id))
  return { ok: true, usuario }
})
