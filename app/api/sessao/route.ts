// POST /api/sessao   -> entrar com e-mail e senha
// DELETE /api/sessao -> sair
import { usuarioPorEmail } from '@/lib/db.ts'
import {
  verifySenha,
  criarToken,
  gravarCookie,
  limparCookie,
  registrarFalha,
  estaBloqueado,
  limparFalhas,
  ErroHttp,
} from '@/lib/session.ts'
import { LoginSchema, formatarErroZod } from '@/lib/schema.ts'
import { rota, lerJson, chaveOrigem } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = rota(async (req) => {
  const chave = chaveOrigem(req)

  // Checa o bloqueio ANTES de gastar CPU com scrypt: caso contrário o rate limit
  // vira ele próprio um vetor de carga.
  if (estaBloqueado(chave)) {
    throw new ErroHttp(429, 'Muitas tentativas. Tente de novo em 15 minutos.')
  }

  const parsed = LoginSchema.safeParse(await lerJson(req, 4096))
  if (!parsed.success) throw new ErroHttp(400, formatarErroZod(parsed.error))

  const usuario = await usuarioPorEmail(parsed.data.email)

  // Mensagem idêntica para "conta não existe" e "senha errada": dizer qual dos
  // dois falhou transforma o login em um verificador de e-mails cadastrados.
  const ok = usuario !== null && (await verifySenha(parsed.data.senha, usuario.senha_hash))

  if (!ok) {
    const { bloqueado } = registrarFalha(chave)
    if (bloqueado) throw new ErroHttp(429, 'Muitas tentativas. Tente de novo em 15 minutos.')
    throw new ErroHttp(401, 'E-mail ou senha incorretos.')
  }

  limparFalhas(chave)
  await gravarCookie(criarToken(usuario.id))
  return { ok: true, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email } }
})

export const DELETE = rota(async () => {
  await limparCookie()
  return { ok: true }
})
