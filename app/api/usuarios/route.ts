// POST /api/usuarios -> criar conta
//
// Quem se cadastra entra já logado: pedir para a pessoa fazer login logo depois
// de digitar a senha duas vezes é uma etapa sem propósito.
import {
  criarUsuario,
  vincularParticipantesPorEmail,
  registrarTentativa,
  consultarBloqueio,
} from '@/lib/db.ts'
import { hashSenha, criarToken, gravarCookie, LIMITES_CADASTRO, ErroHttp } from '@/lib/session.ts'
import { CadastroSchema, formatarErroZod } from '@/lib/schema.ts'
import { rota, lerJson, chaveOrigem } from '@/lib/api.ts'
import { verificarTurnstile } from '@/lib/seguranca.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = rota(async (req) => {
  // Cadastro tem limite proprio, e ele conta TODA tentativa — nao so as que
  // falham, como no login. O abuso aqui e a conta criada com SUCESSO: sem isto,
  // um laco enche a tabela `users` de graca, e cada linha nova ainda dispara
  // `vincularParticipantesPorEmail`, que varre participantes por e-mail.
  //
  // Chave em namespace proprio: errar a senha no login nao pode consumir a cota
  // de quem esta se cadastrando da mesma rede.
  const chave = `cadastro:${chaveOrigem(req)}`

  // Antes do scrypt, que e caro de proposito — checar depois faria do proprio
  // limite um vetor de carga (mesma razao do /api/sessao).
  if (await consultarBloqueio(chave)) {
    throw new ErroHttp(429, 'Muitas contas criadas deste local. Tente de novo mais tarde.')
  }

  const corpo = (await lerJson(req, 8192)) as Record<string, unknown>
  const parsed = CadastroSchema.safeParse(corpo)
  if (!parsed.success) throw new ErroHttp(400, formatarErroZod(parsed.error))

  // Antes de contar a tentativa: um captcha recusado nao e uma conta criada, e
  // gastar a cota de quem nem passou do desafio castigaria a rede inteira do
  // hotel por causa de um bot. Aqui e onde o captcha vale mais — o abuso desta
  // rota e a conta criada COM SUCESSO, e mil IPs distintos passam por baixo de
  // qualquer limite por origem.
  if (!(await verificarTurnstile(corpo.captcha as string, chaveOrigem(req)))) {
    throw new ErroHttp(400, 'Refaça a verificação de segurança e tente de novo.')
  }

  const { bloqueado } = await registrarTentativa(chave, LIMITES_CADASTRO)
  if (bloqueado) {
    throw new ErroHttp(429, 'Muitas contas criadas deste local. Tente de novo mais tarde.')
  }

  const { nome, email, senha } = parsed.data
  const usuario = await criarUsuario(nome, email, await hashSenha(senha))

  // `criarUsuario` devolve null quando o unique do e-mail barrou o insert. É a
  // única checagem de duplicidade que não tem corrida entre o select e o insert.
  if (!usuario) throw new ErroHttp(409, 'Já existe uma conta com esse e-mail.')

  await vincularParticipantesPorEmail(usuario.id, usuario.email)
  await gravarCookie(criarToken(usuario.id))
  return { ok: true, usuario }
})
