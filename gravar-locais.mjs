// Preenche coordenada E endereço das paradas da Europa 2027 que dá para
// localizar com um fato que já está no banco (IATA do voo, cidade da escala,
// campo `local` do item), e conserta a longitude de Hamburgo em `places`.
//
// O endereço é o que se cola no Uber; a coordenada é o que vira pino no mapa do
// dia. Os dois saíram da mesma resposta do Nominatim, já conferida contra a
// coordenada da cidade — nenhum foi digitado de cabeça.
//
// Descartável: roda uma vez e sai do repositório.
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

// [id, lat, lon, endereço, rótulo para o relatório]
const PARADAS = [
  ['1cbd0555-a91e-4696-9b51-2356d2ab5f5a', -33.38927, -70.79,
    'Aeroporto Internacional Arturo Merino Benítez, 1704, Armando Cortínez Oriente, Pudahuel, Provincia de Santiago, Chile',
    '30/12 Chegada em Santiago → aeroporto SCL'],
  ['c3696ce8-1613-4010-9bce-5ac11033655d', 40.49136, -3.59213,
    'Terminal 4, Aeropuerto Adolfo Suárez Madrid-Barajas, Barajas, Madrid, 28055, Espanha',
    '31/12 Chegada em Madri EES → Barajas T4'],
  ['15314075-e16b-417d-8b02-974182457028', 40.49136, -3.59213,
    'Terminal 4, Aeropuerto Adolfo Suárez Madrid-Barajas, Barajas, Madrid, 28055, Espanha',
    '31/12 Bagagem e Uber → Barajas T4'],
  ['66de25c3-2ef3-4509-9568-4bfd7b7ec48d', 40.49523, -3.57337,
    'Aeropuerto Adolfo Suárez Madrid-Barajas, Barajas, Madrid, 28042, Espanha',
    '01/01 Voo Madri→Hamburgo → Barajas'],
  ['a21907fe-3080-40c3-a420-128e83fa1fda', 53.63636, 9.99455,
    'Flughafen Hamburg, Niendorf, Eimsbüttel, Hamburgo, 22459, Alemanha',
    '01/01 Chegada em Hamburgo → aeroporto HAM'],
  ['61a5669c-596a-40c5-9b4c-df7761e58959', 53.55086, 9.9929,
    'Rathausmarkt, Altstadt, Hamburg-Mitte, Hamburgo, 20095, Alemanha',
    '02/01 Dia cheio → Rathausmarkt'],
  ['d05d356e-aad4-42f3-bc92-e6d68bc11c84', 51.20871, 3.2244,
    'Markt, Brugge-Centrum, Bruges, West-Vlaanderen, 8000, Bélgica',
    '05/01 Bruges → Markt'],
  ['cdbba8ac-0c1b-4f8b-af8d-423dee3daa68', 52.3789, 4.90058,
    'Amsterdam Centraal, Centrum, Amsterdã, Noord-Holland, 1012 AB, Países Baixos',
    '06/01 Amsterdã → Centraal'],
  ['6d022794-2b04-45e6-96ca-3fc3b75ec12a', 48.85889, 2.32004,
    'Paris, Ilha de França, França',
    '07/01 Paris'],
  ['0b9d36ca-e94e-4191-8aab-426d4d8e75b8', 51.50745, -0.12777,
    'Grande Londres, Inglaterra, Reino Unido',
    '08/01 Londres'],
  ['ce5a78b4-4abd-434e-87a3-7e6ca61bfd53', 41.81539, 12.22648,
    'Aeroporto di Roma-Fiumicino, Via Leonardo da Vinci, Fiumicino, Roma Capitale, 00054, Itália',
    '10/01 Chegada em Roma → Fiumicino'],
  ['4bb7ef7d-082c-4f74-a9ba-85cc1ce2c02d', 41.90496, 12.45466,
    'Museus Vaticanos, Cortile Ottagono, Cidade do Vaticano, 00120, Vaticano',
    '11/01 Museus Vaticanos'],
  ['8d9a2f7e-ce5f-4f78-be54-55577d5a9c80', 41.29694, 2.07905,
    'Aeroport Josep Tarradellas Barcelona-El Prat, el Prat de Llobregat, Barcelona, 08820, Espanha',
    '12/01 Chegada em Barcelona → El Prat'],
  ['ae520ac6-575d-4d78-9bb0-3ce5e154702f', 41.41423, 2.15246,
    'Parc Güell, Gràcia, Barcelona, Catalunha, Espanha',
    '13/01 Park Güell'],
  ['34c3f93b-13cf-423c-bfba-07a6b3a2e923', 40.49523, -3.57337,
    'Aeropuerto Adolfo Suárez Madrid-Barajas, Barajas, Madrid, 28042, Espanha',
    '14/01 Saída do Schengen → Barajas'],
]

// Uma transação só: meia viagem localizada é pior do que nenhuma.
//
// `coalesce` no endereço e a condição do pino protegem de rodar duas vezes por
// cima de algo que já foi corrigido na tela: o que alguém escreveu ganha.
await sql.transaction([
  ...PARADAS.map(
    ([id, lat, lon, endereco]) =>
      sql`update itinerary_events
             set lat = ${lat},
                 lon = ${lon},
                 endereco = coalesce(nullif(trim(endereco), ''), ${endereco}),
                 updated_at = now()
           where id = ${id} and (lat is null or lon is null)`,
  ),
  // 9.4979 punha Hamburgo 33 km a oeste da cidade, no meio do nada.
  sql`update places set lat = 53.55017, lon = 10.00132, updated_at = now() where cidade = 'Hamburgo'`,
])

for (const [, , , , rotulo] of PARADAS) console.log('  ok', rotulo)
console.log('  ok places: Hamburgo lon 9.4979 -> 10.00132')

const [r] = await sql`select count(*)::int total, count(lat)::int pino,
                             count(nullif(trim(endereco), ''))::int endereco
                        from itinerary_events`
console.log(`\n${r.pino} de ${r.total} paradas com pino, ${r.endereco} com endereço.`)
