// Seed: demo@tripgo.com user + Hamburgo 2027 trip
// Run: DATABASE_URL=... node scripts/seed.mjs

import { neon } from '@neondatabase/serverless'
import { scryptSync, randomBytes } from 'node:crypto'

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida')
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)

// Hash de senha
function hashPin(pin) {
  const N = 16384
  const sal = randomBytes(16)
  const chave = scryptSync(String(pin), sal, 64)
  return `scrypt$${N}$${sal.toString('hex')}$${chave.toString('hex')}`
}

async function seed() {
  console.log('🌱 Seed iniciado...')

  // Usuário demo
  try {
    await sql`delete from users where email = 'demo@tripgo.com'`
  } catch {
    // Tabela pode não existir ainda
  }

  const hash = hashPin('123456')
  const [user] = await sql`
    insert into users (nome, email, senha_hash)
    values ('Demo TripGo', 'demo@tripgo.com', ${hash})
    on conflict (email) do update set senha_hash = excluded.senha_hash
    returning id
  `
  const userId = user.id
  console.log(`✓ Usuário: demo@tripgo.com / 123456`)

  // Viagem demo "Hamburgo 2027"
  const [trip] = await sql`
    insert into trips (owner_id, nome, data_partida, data_retorno, moeda, cor_destaque)
    values (
      ${userId},
      'Hamburgo 2027',
      '2026-12-30',
      '2027-01-15',
      'BRL',
      '#0F766E'
    )
    returning id
  `
  const tripId = trip.id
  console.log(`✓ Viagem: Hamburgo 2027`)

  // Adiciona o proprietário como participante
  await sql`
    insert into travelers (trip_id, user_id, nome, email, papel, ordem)
    values (${tripId}, ${userId}, 'Demo User', 'demo@tripgo.com', 'proprietario', 0)
  `

  // Alguns eventos de exemplo
  const eventos = [
    { titulo: 'Voo saída', data: '2026-12-30T10:00', cidade: 'Florianópolis', tipo: 'voo' },
    { titulo: 'Chegada em Madri', data: '2026-12-31T08:00', cidade: 'Madri', tipo: 'passeio' },
    { titulo: 'Voo Madri → Hamburgo', data: '2027-01-02T14:00', cidade: 'Hamburgo', tipo: 'voo' },
    { titulo: 'Embarque cruzeiro', data: '2027-01-03T18:00', cidade: 'Hamburgo', tipo: 'cruzeiro' },
  ]

  for (const e of eventos) {
    await sql`
      insert into itinerary_events (trip_id, ocorre_em, cidade, titulo, tipo)
      values (${tripId}, ${e.data}, ${e.cidade}, ${e.titulo}, ${e.tipo})
    `
  }
  console.log(`✓ ${eventos.length} eventos adicionados`)

  // Alguns lugares
  const lugares = [
    { cidade: 'Florianópolis', pais: 'Brasil', dias: 1, lat: -27.5969, lon: -48.5514 },
    { cidade: 'Madri', pais: 'Espanha', dias: 3, lat: 40.4168, lon: -3.7038 },
    { cidade: 'Hamburgo', pais: 'Alemanha', dias: 10, lat: 53.5511, lon: 9.4979 },
  ]

  for (const l of lugares) {
    await sql`
      insert into places (trip_id, cidade, pais, dias, lat, lon)
      values (${tripId}, ${l.cidade}, ${l.pais}, ${l.dias}, ${l.lat}, ${l.lon})
    `
  }
  console.log(`✓ ${lugares.length} cidades adicionadas`)

  console.log('✅ Seed completo!')
  console.log('\n📝 Login com:')
  console.log('   Email: demo@tripgo.com')
  console.log('   Senha: 123456')
}

seed().catch((e) => {
  console.error('❌ Erro:', e.message)
  process.exit(1)
})
