// Camada de acesso: quem esta pedindo, e o que essa pessoa pode ver.
//
// Toda leitura e toda escrita de dado de viagem passa por `exigirViagem`. O
// proxy.ts na raiz redireciona quem nao tem cookie, mas isso e otimista - ele so
// olha o cookie, nunca o banco. A barreira real esta aqui, colada na fonte do dado.
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { lerSessao, lerViagemAtual, ErroHttp } from './session.ts'
import { papelNaViagem, participanteDoUsuario, usuarioPorId, viagemPadrao } from './db.ts'
import { papelAlcanca, type Papel } from '@/config/navigation.ts'

/** Deduplicado por requisicao: layout e page chamam sem pagar duas consultas. */
export const usuarioAtual = cache(async () => {
  const s = await lerSessao()
  if (!s) return null
  return usuarioPorId(s.userId)
})

/** Para rotas de API: 401 com corpo em pt-BR. */
export async function exigirUsuario() {
  const u = await usuarioAtual()
  if (!u) throw new ErroHttp(401, 'Entre para continuar.')
  return u
}

/** Para paginas: manda para o login em vez de estourar erro na tela. */
export async function exigirUsuarioOuLogin() {
  const u = await usuarioAtual()
  if (!u) redirect('/login')
  return u
}

export type Acesso = {
  userId: string
  tripId: string
  papel: Papel
  /** Registro em `travelers`. Chave do checklist pessoal e do historico. */
  participanteId: string
}

/**
 * Confere que a conta participa da viagem com pelo menos `minimo`.
 *
 * 404, nao 403, quando a conta nao participa: dizer "voce nao tem permissao"
 * confirmaria que a viagem existe para quem estivesse chutando ids.
 */
export async function exigirViagem(
  userId: string,
  tripId: string,
  minimo: Papel = 'visualizador',
): Promise<Acesso> {
  const participante = await participanteDoUsuario(userId, tripId)
  if (!participante) throw new ErroHttp(404, 'Viagem não encontrada.')
  if (!papelAlcanca(participante.papel, minimo)) {
    throw new ErroHttp(403, MENSAGEM_PAPEL[minimo])
  }
  return { userId, tripId, papel: participante.papel, participanteId: participante.id }
}

const MENSAGEM_PAPEL: Record<Papel, string> = {
  visualizador: 'Você não tem acesso a esta viagem.',
  editor: 'Você entrou como visualizador e não pode alterar esta viagem.',
  proprietario: 'Só quem criou a viagem pode fazer isso.',
}

/** Papel sem lancar. Usado pela interface para decidir o que mostrar. */
export async function papelDe(userId: string, tripId: string) {
  return papelNaViagem(userId, tripId)
}

/**
 * A viagem aberta agora: o cookie de preferencia, validado contra a lista da
 * conta. Devolve null quando a conta ainda nao tem nenhuma viagem.
 */
export const viagemAtual = cache(async (userId: string) => {
  return viagemPadrao(userId, await lerViagemAtual())
})
