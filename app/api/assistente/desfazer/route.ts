// POST /api/assistente/desfazer - reverte um lote aceito do assistente.
//
// O `change_log` já guarda tudo que o desfazer precisa, com uma exceção que
// manda no desenho: ele registra que uma linha FOI removida, nunca o conteúdo
// dela. Remoção não volta — nem aqui, nem pela tela. Por isso a revisão avisa
// antes, e por isso este endpoint conta quantas remoções ficaram de fora em vez
// de fingir que reverteu o lote inteiro.
//
// O replay é de trás para frente: a última alteração é a primeira a ser
// desfeita, senão duas edições no mesmo campo restaurariam o valor errado.
import { sql, envelope } from '@/lib/db.ts'
import { exigirUsuario, exigirViagem } from '@/lib/auth.ts'
import { ErroHttp } from '@/lib/session.ts'
import { rota, lerJson } from '@/lib/api.ts'
import { TABELA, recorte, autorizar, colunaValida } from '@/lib/escrita.ts'
import { type Entidade } from '@/lib/schema.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Registro = {
  entidade: string
  entidade_id: string | null
  campo: string
  de: string | null
  para: string | null
}

export const POST = rota(async (req) => {
  const u = await exigirUsuario()
  const corpo = (await lerJson(req)) as { trip_id?: string; lote?: string }
  if (!corpo.trip_id || !corpo.lote) throw new ErroHttp(400, 'Lote não informado.')

  // Só participar basta para CHEGAR aqui; o que decide cada reversão é o
  // `autorizar` de cada linha, abaixo. Exigir 'editor' na porta seria a barreira
  // errada nos dois sentidos: impediria um visualizador de desfazer o próprio
  // documento pessoal, e deixaria um editor reverter o documento pessoal alheio.
  const acesso = await exigirViagem(u.id, corpo.trip_id)

  const linhas = (await sql`
    select entidade, entidade_id, campo, de, para
    from change_log
    where trip_id = ${acesso.tripId} and lote = ${corpo.lote} and origem = 'assistente'
    order by criado_em desc, id desc
  `) as unknown as Registro[]

  if (linhas.length === 0) throw new ErroHttp(404, 'Esse lote não existe mais.')

  let revertidas = 0
  let remocoesIrreversiveis = 0
  let negadas = 0

  for (const l of linhas) {
    const entidade = l.entidade as Entidade
    const meta = TABELA[entidade]
    if (!meta || !l.entidade_id) continue

    if (l.para === 'removido') {
      remocoesIrreversiveis += 1
      continue
    }

    // Desfazer é escrita, e por isso passa pela MESMA barreira da escrita.
    //
    // Sem isto existe uma escalada real: `change_log` inteiro vai no snapshot
    // (`select l.*`), então qualquer participante enxerga o `lote` — e um editor
    // reverteria com ele o documento `pessoal` de outro participante, que
    // `autorizar` proíbe explicitamente de editar. Uma linha que este papel não
    // pode escrever é pulada, não revertida.
    const campos = l.para === 'criado' ? {} : { [l.campo]: l.de }
    const op = l.para === 'criado' ? 'remover' : 'editar'
    try {
      await autorizar(acesso, entidade, op, campos, l.entidade_id)
    } catch {
      negadas += 1
      continue
    }

    const rec = recorte(entidade, acesso.tripId, 2)

    if (l.para === 'criado') {
      await sql.query(`delete from ${meta.nome} where id = $1 ${rec.sql}`, [
        l.entidade_id,
        ...rec.params,
      ])
      revertidas += 1
      continue
    }

    // `campo` vem do banco e entraria CRU no SQL. A lista branca vem do mesmo
    // schema que valida a escrita: o que não é coluna da entidade não vira SQL.
    if (!colunaValida(entidade, l.campo)) {
      negadas += 1
      continue
    }

    // Edição: devolve o valor anterior. `de` vem como texto do log; null volta
    // como null de verdade, não como a string "null".
    const rec2 = recorte(entidade, acesso.tripId, 3)
    await sql.query(
      `update ${meta.nome} set ${l.campo} = $2, updated_at = now() where id = $1 ${rec2.sql}`,
      [l.entidade_id, l.de, ...rec2.params],
    )
    revertidas += 1
  }

  // Só apaga do histórico o que foi de fato revertido. Uma linha negada continua
  // valendo — apagá-la esconderia do dono que a reversão não aconteceu inteira.
  if (negadas === 0) {
    await sql`
      delete from change_log
      where trip_id = ${acesso.tripId} and lote = ${corpo.lote} and origem = 'assistente'
    `
  }

  return {
    revertidas,
    remocoesIrreversiveis,
    negadas,
    snapshot: await envelope(acesso),
  }
})
