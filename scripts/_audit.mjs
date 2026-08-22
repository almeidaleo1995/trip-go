import { sql } from '../lib/db.ts'
const l = await sql`select entidade_id, campo, de, para, criado_em at time zone 'UTC' as utc from change_log where entidade = 'custo' order by criado_em asc`
for (const x of l) console.log(x.utc.toISOString(), x.entidade_id?.slice(0,8), x.campo, '|', String(x.de).slice(0,14), '->', String(x.para).slice(0,14))
const [n] = await sql`select now() at time zone 'UTC' as agora`
console.log('agora UTC:', n.agora.toISOString())
