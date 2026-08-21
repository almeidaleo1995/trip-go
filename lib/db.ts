// Acesso ao Neon e montagem do snapshot.
//
// Regra que rege este arquivo: o cliente nunca fala com o Postgres. A connection
// string vive so aqui, no servidor. O navegador conhece apenas /api/*.
//
// Leitura e por snapshot inteiro, nao recurso a recurso: com 5 pessoas e uma viagem
// o payload e de dezenas de KB, e buscar tudo de uma vez elimina N+1, deixa o cache
// offline trivial e dispensa gerenciar estado por endpoint.
import { neon } from '@neondatabase/serverless'
import type { Papel } from './session.ts'

function conectar() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL nao definida - veja .env.example')
  return neon(url)
}

export const sql = conectar()

export type Snapshot = {
  viagem: Record<string, unknown> | null
  viajantes: Record<string, unknown>[]
  roteiro: Record<string, unknown>[]
  voos: Record<string, unknown>[]
  cruzeiros: Record<string, unknown>[]
  hospedagens: Record<string, unknown>[]
  lugares: Record<string, unknown>[]
  checklist: Record<string, unknown>[]
  checklist_state: Record<string, unknown>[]
  documentos: Record<string, unknown>[]
  emergencia: Record<string, unknown>[]
  alteracoes: Record<string, unknown>[]
  /** null para papel `viajante`. As queries financeiras nem chegam a rodar. */
  financeiro: { categorias: Record<string, unknown>[]; custos: Record<string, unknown>[] } | null
  server_time: string
}

/** A viagem ativa. Uma por vez; o schema ja suporta varias para o futuro. */
export async function viagemAtiva(): Promise<{ id: string } | null> {
  const r = await sql`select id from trips where ativo = true order by updated_at desc limit 1`
  return (r[0] as { id: string }) ?? null
}

/**
 * Lista para a tela de login: apenas id e nome.
 *
 * Nunca devolve pin_hash nem papel. O papel vazaria quem e o admin, que e uma
 * dica desnecessaria para quem for tentar adivinhar PIN.
 */
export async function listarViajantesPublico(tripId: string) {
  return sql`select id, nome from travelers where trip_id = ${tripId} order by ordem, nome`
}

/** Uso interno do login: precisa do hash e do papel. Nunca vai para a resposta. */
export async function viajantePorId(id: string) {
  const r = await sql`select id, trip_id, nome, papel, pin_hash from travelers where id = ${id}`
  return (
    (r[0] as {
      id: string
      trip_id: string
      nome: string
      papel: Papel
      pin_hash: string | null
    }) ?? null
  )
}

/**
 * Monta o snapshot conforme o papel.
 *
 * Para `viajante`, as duas queries financeiras nao sao executadas e o campo sai
 * null. Nao e filtro depois de buscar: o dado nao sai do banco. Essa e a diferenca
 * entre esconder na interface e proteger de verdade (AUTH-05).
 */
export async function getSnapshot(tripId: string, papel: Papel): Promise<Snapshot> {
  const [
    viagem,
    viajantes,
    roteiro,
    voos,
    escalas,
    cruzeiros,
    portos,
    hospedagens,
    lugares,
    checklist,
    estado,
    documentos,
    emergencia,
    alteracoes,
  ] = await Promise.all([
    sql`select * from trips where id = ${tripId}`,
    // pin_hash fica de fora por enumeracao explicita de colunas, nao por delete depois.
    sql`select id, trip_id, nome, papel, telefone, passaporte, ordem, updated_at
        from travelers where trip_id = ${tripId} order by ordem, nome`,
    sql`select * from itinerary_events where trip_id = ${tripId} order by ocorre_em`,
    sql`select * from flights where trip_id = ${tripId} order by ordem, parte_em`,
    sql`select s.* from flight_stops s
        join flights f on f.id = s.flight_id
        where f.trip_id = ${tripId} order by s.ordem`,
    sql`select * from cruises where trip_id = ${tripId}`,
    sql`select p.* from cruise_ports p
        join cruises c on c.id = p.cruise_id
        where c.trip_id = ${tripId} order by p.ordem`,
    sql`select * from stays where trip_id = ${tripId} order by checkin`,
    sql`select * from places where trip_id = ${tripId} order by ordem`,
    sql`select * from checklist_items where trip_id = ${tripId} order by ordem`,
    sql`select e.* from checklist_state e
        join checklist_items i on i.id = e.item_id
        where i.trip_id = ${tripId}`,
    sql`select * from documents where trip_id = ${tripId} order by ordem`,
    sql`select * from emergency_contacts where trip_id = ${tripId} order by ordem`,
    sql`select l.*, t.nome as autor from change_log l
        left join travelers t on t.id = l.traveler_id
        where l.trip_id = ${tripId} order by l.criado_em desc limit 50`,
  ])

  // Aninha os filhos em uma passada, sem query por pai.
  const voosComEscalas = voos.map((v) => ({
    ...v,
    escalas: escalas.filter((e) => e.flight_id === v.id),
  }))
  const cruzeirosComPortos = cruzeiros.map((c) => ({
    ...c,
    portos: portos.filter((p) => p.cruise_id === c.id),
  }))

  let financeiro: Snapshot['financeiro'] = null
  if (papel === 'admin') {
    const [categorias, custos] = await Promise.all([
      sql`select * from expense_categories where trip_id = ${tripId} order by ordem`,
      sql`select * from expenses where trip_id = ${tripId} order by ordem`,
    ])
    financeiro = { categorias, custos }
  }

  return {
    viagem: viagem[0] ?? null,
    viajantes,
    roteiro,
    voos: voosComEscalas,
    cruzeiros: cruzeirosComPortos,
    hospedagens,
    lugares,
    checklist,
    checklist_state: estado,
    documentos,
    emergencia,
    alteracoes,
    financeiro,
    server_time: new Date().toISOString(),
  }
}

/** Registra uma alteracao no historico. Chamado por /api/mutate. */
export async function registrarAlteracao(
  tripId: string,
  travelerId: string,
  entidade: string,
  entidadeId: string | null,
  campo: string,
  de: unknown,
  para: unknown,
) {
  const texto = (v: unknown) => (v === null || v === undefined ? null : String(v))
  await sql`
    insert into change_log (trip_id, traveler_id, entidade, entidade_id, campo, de, para)
    values (${tripId}, ${travelerId}, ${entidade}, ${entidadeId}, ${campo}, ${texto(de)}, ${texto(para)})
  `
}
