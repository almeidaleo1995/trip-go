// Gera um KML com as coordenadas conferidas das paradas da Europa 2027, com o
// nome de cada ponto igual ao título da parada — assim o casamento por nome em
// "Localizar paradas" acerta todas de primeira. Só lê o banco.
import { neon } from '@neondatabase/serverless'
import { writeFileSync } from 'node:fs'

const sql = neon(process.env.DATABASE_URL)

const COORDS = {
  '1cbd0555-a91e-4696-9b51-2356d2ab5f5a': [-33.38927, -70.79],
  'c3696ce8-1613-4010-9bce-5ac11033655d': [40.49136, -3.59213],
  '15314075-e16b-417d-8b02-974182457028': [40.49136, -3.59213],
  '66de25c3-2ef3-4509-9568-4bfd7b7ec48d': [40.49523, -3.57337],
  'a21907fe-3080-40c3-a420-128e83fa1fda': [53.63636, 9.99455],
  '61a5669c-596a-40c5-9b4c-df7761e58959': [53.55086, 9.9929],
  'd05d356e-aad4-42f3-bc92-e6d68bc11c84': [51.20871, 3.2244],
  'cdbba8ac-0c1b-4f8b-af8d-423dee3daa68': [52.3789, 4.90058],
  '6d022794-2b04-45e6-96ca-3fc3b75ec12a': [48.85889, 2.32004],
  '0b9d36ca-e94e-4191-8aab-426d4d8e75b8': [51.50745, -0.12777],
  'ce5a78b4-4abd-434e-87a3-7e6ca61bfd53': [41.81539, 12.22648],
  '4bb7ef7d-082c-4f74-a9ba-85cc1ce2c02d': [41.90496, 12.45466],
  '8d9a2f7e-ce5f-4f78-be54-55577d5a9c80': [41.29694, 2.07905],
  'ae520ac6-575d-4d78-9bb0-3ce5e154702f': [41.41423, 2.15246],
  '34c3f93b-13cf-423c-bfba-07a6b3a2e923': [40.49523, -3.57337],
}

const itens = await sql`select id, titulo from itinerary_events`
const porId = new Map(itens.map((i) => [i.id, i.titulo]))

const marcas = Object.entries(COORDS).map(([id, [lat, lon]]) => {
  const titulo = porId.get(id)
  if (!titulo) throw new Error(`parada sumiu do banco: ${id}`)
  // CDATA porque os títulos têm →, ·, acento e parêntese.
  return `  <Placemark>
    <name><![CDATA[${titulo}]]></name>
    <Point><coordinates>${lon},${lat},0</coordinates></Point>
  </Placemark>`
})

writeFileSync(
  'europa-2027-locais.kml',
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Europa 2027 — locais das paradas</name>
${marcas.join('\n')}
</Document>
</kml>
`,
  'utf8',
)

console.log(`europa-2027-locais.kml com ${marcas.length} lugares.`)
