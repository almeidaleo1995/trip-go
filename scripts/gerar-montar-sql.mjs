// Gera `db/montar.sql` a partir do contrato do app. Rode: npm run sql:build
//
// POR QUE UM GERADOR, E NAO UM ARQUIVO ESCRITO A MAO
//
// `db/montar.sql` publica uma funcao SQL por secao do arquivo de importacao, com
// um argumento por campo. Escrita a mao, essa lista seria a QUINTA copia da mesma
// informacao (db/schema.sql, lib/schema.ts, lib/importar.ts, /api/export e ela) —
// e a unica sem ninguem olhando. O sintoma de esquece-la nao seria um erro: seria
// a SQL montando viagem sem o campo novo, em silencio, e o dado sumindo entre o
// script e a tela.
//
// Aqui a lista e LIDA de `SECOES_ARQUIVO` em lib/schema.ts na hora de gerar, e
// `lib/montar.test.ts` compara o arquivo commitado com o que este script produz.
// Campo novo no zod => o teste falha ate alguem rodar `npm run sql:build`. E isso
// que quer dizer "a SQL olha para o sistema e se atualiza".
//
// O que este gerador NAO faz: escrever nas tabelas do app. `montar.*` monta um
// RASCUNHO em jsonb e devolve o arquivo de importacao — quem grava viagem
// continua sendo `lib/importar.ts`, um caminho so, com a autorizacao e a validacao
// que ja existem. Uma segunda gravadora em PL/pgSQL seria a copia que envelhece.
import { z } from 'zod'
import { SECOES_ARQUIVO, ViagemSchema, SCHEMA_VERSION } from '@/lib/schema.ts'

// ---------------------------------------------------------------- nomes

/**
 * Secao (plural, como no arquivo) -> nome da funcao (singular, como se fala).
 *
 * Mapa explicito e nao uma regra de plural: "lugares" -> "lugar" e "dias" -> "dia"
 * nao saem da mesma regra, e uma regra que erra devolve `montar.lugare`. Secao sem
 * entrada aqui DERRUBA a geracao — e o aviso de que uma secao nova apareceu.
 */
const FUNCAO = {
  participantes: 'participante',
  roteiro: 'roteiro',
  dias: 'dia',
  voos: 'voo',
  cruzeiros: 'cruzeiro',
  reservas: 'reserva',
  lugares: 'lugar',
  checklist: 'checklist',
  documentos: 'documento',
  requisitos: 'requisito',
  entregas: 'entrega',
  emergencia: 'emergencia',
  categorias: 'categoria',
  custos: 'custo',
  pagamentos: 'pagamento',
}

/**
 * Campos que o arquivo aceita e a IMPORTACAO ignora — por isso nao viram argumento.
 *
 * Todos sao id de linha. Id nao sobrevive a uma importacao (ela cria a viagem do
 * zero, com ids novos), entao o arquivo liga as coisas por NOME: `assigned_to_nomes`
 * no lugar de `assigned_to`, `dono_nome` no lugar de `traveler_id`, `reserva` no
 * lugar de `reserva_id`. Publicar o par de id como argumento seria oferecer um
 * parametro que nao faz nada — o pior tipo de campo, porque quem preenche acha que
 * preencheu. Ver `lib/importar.ts`, que e quem de fato le o arquivo.
 *
 * A chave existe no zod? O gerador confere. Um campo renomeado no schema derruba o
 * `npm run sql:build` em vez de virar uma exclusao que nao exclui mais nada.
 */
const IGNORADOS = {
  // `id` vale para toda secao QUE O TEM -- `pagamentos` nao tem. Por isso a linha
  // do coringa e a unica tolerante: as listas por secao abaixo sao conferidas
  // campo a campo contra o zod.
  '*': ['id'],
  roteiro: ['reserva_id', 'documento_id'],
  checklist: ['assigned_to', 'itinerary_event_id', 'flight_id', 'cruise_id', 'documento_id'],
  documentos: [
    'assigned_to',
    'traveler_id',
    'itinerary_event_id',
    'flight_id',
    'reservation_id',
  ],
  requisitos: ['assigned_to'],
  entregas: ['requirement_id', 'traveler_id', 'documento_id'],
  // `pessoas` e `pago` sao campos de arquivo v2: `TripImportSchema` os converte na
  // leitura de um backup antigo e nunca os grava. Publicar os dois convidaria a
  // escrever v2 novo, que e o formato que a conversao existe para aposentar.
  custos: ['pessoas', 'pago'],
}

/** Ligacoes por NOME entre secoes. Viram as checagens de `montar.conferir`. */
const REFERENCIAS = [
  { secao: 'roteiro', campo: 'reserva', alvo: 'reservas', chave: 'nome', gravidade: 'aviso' },
  { secao: 'roteiro', campo: 'documento', alvo: 'documentos', chave: 'titulo', gravidade: 'aviso' },
  {
    secao: 'checklist',
    campo: 'assigned_to_nomes',
    alvo: 'participantes',
    chave: 'nome',
    lista: true,
    gravidade: 'erro',
  },
  {
    secao: 'documentos',
    campo: 'dono_nome',
    alvo: 'participantes',
    chave: 'nome',
    gravidade: 'erro',
  },
  {
    secao: 'documentos',
    campo: 'assigned_to_nomes',
    alvo: 'participantes',
    chave: 'nome',
    lista: true,
    gravidade: 'erro',
  },
  { secao: 'documentos', campo: 'reserva', alvo: 'reservas', chave: 'nome', gravidade: 'aviso' },
  {
    secao: 'requisitos',
    campo: 'assigned_to_nomes',
    alvo: 'participantes',
    chave: 'nome',
    lista: true,
    gravidade: 'erro',
  },
  {
    secao: 'entregas',
    campo: 'requisito_nome',
    alvo: 'requisitos',
    chave: 'nome',
    gravidade: 'erro',
  },
  { secao: 'entregas', campo: 'dono_nome', alvo: 'participantes', chave: 'nome', gravidade: 'erro' },
  { secao: 'custos', campo: 'pagador', alvo: 'participantes', chave: 'nome', gravidade: 'erro' },
  { secao: 'custos', campo: 'categoria', alvo: 'categorias', chave: 'nome', gravidade: 'aviso' },
  { secao: 'pagamentos', campo: 'de', alvo: 'participantes', chave: 'nome', gravidade: 'erro' },
  { secao: 'pagamentos', campo: 'para', alvo: 'participantes', chave: 'nome', gravidade: 'erro' },
]

/** Secoes com data que precisa cair dentro da viagem. Campo -> rotulo. */
const DATAS_NA_JANELA = [
  { secao: 'roteiro', campo: 'ocorre_em' },
  { secao: 'dias', campo: 'dia' },
  { secao: 'voos', campo: 'parte_em' },
  { secao: 'reservas', campo: 'inicio_em' },
  { secao: 'cruzeiros', campo: 'embarque_em' },
]

// ---------------------------------------------------------------- leitura do zod

const PADRAO_DATA = /^\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\$$/

/** JSON Schema de um campo -> a alternativa que nao e `null`. */
function util(prop) {
  const alts = prop.anyOf ?? [prop]
  const real = alts.find((a) => a.type !== 'null')
  if (!real) throw new Error('campo sem tipo utilizavel')
  return real
}

/** Tipo Postgres do argumento, e como ele vira JSON. */
function tipoDe(nome, prop) {
  const t = util(prop)
  if (t.type === 'string') {
    if (t.pattern && PADRAO_DATA.test(t.pattern)) return { sql: 'date', json: 'data' }
    // "2027-01-02T09:30": data COM hora, sempre local do destino, nunca UTC.
    if (t.pattern && t.pattern.includes('T(')) return { sql: 'timestamp', json: 'quando' }
    return { sql: 'text', json: 'direto' }
  }
  if (t.type === 'integer') return { sql: 'integer', json: 'direto' }
  if (t.type === 'number') return { sql: 'double precision', json: 'direto' }
  if (t.type === 'boolean') return { sql: 'boolean', json: 'direto' }
  if (t.type === 'array') {
    if (t.items?.type === 'string') return { sql: 'text[]', json: 'lista' }
    // Sub-objeto (escala, porto, opcao, divisao, parcela): entra como jsonb cru.
    // Uma funcao por sub-objeto multiplicaria a superficie por pouco: eles sao
    // sempre escritos junto do pai, e `montar.conferir` valida o conteudo.
    return { sql: 'jsonb', json: 'direto' }
  }
  throw new Error(`campo ${nome}: tipo ${t.type} sem equivalente em SQL`)
}

/** Os campos de um schema de secao, ja sem os ignorados e em ordem de argumento. */
function camposDe(secao, esquema) {
  const j = z.toJSONSchema(esquema, { io: 'input', unrepresentable: 'any' })
  const obrigatorios = new Set(j.required ?? [])
  const fora = new Set([...(IGNORADOS['*'] ?? []), ...(IGNORADOS[secao] ?? [])])

  for (const campo of IGNORADOS[secao] ?? []) {
    if (!(campo in (j.properties ?? {}))) {
      throw new Error(
        `IGNORADOS lista "${secao}.${campo}", que nao existe mais em lib/schema.ts. ` +
          'Se o campo foi renomeado, atualize a lista; se foi removido, tire a linha.',
      )
    }
  }

  const campos = Object.entries(j.properties ?? {})
    .filter(([nome]) => !fora.has(nome))
    .map(([nome, prop]) => {
      const t = util(prop)
      return {
        nome,
        ...tipoDe(`${secao}.${nome}`, prop),
        obrigatorio: obrigatorios.has(nome),
        enums: t.enum ?? null,
      }
    })

  // Argumento sem valor padrao nao pode vir depois de um com valor padrao.
  return [...campos.filter((c) => c.obrigatorio), ...campos.filter((c) => !c.obrigatorio)]
}

// ---------------------------------------------------------------- emissao

const aspas = (v) => `'${String(v).replaceAll("'", "''")}'`

/** O valor do campo dentro do `jsonb_build_object`. */
function valorJson(c) {
  const p = `p_${c.nome}`
  if (c.json === 'data') return `to_char(${p}, 'YYYY-MM-DD')`
  if (c.json === 'quando') return `to_char(${p}, 'YYYY-MM-DD"T"HH24:MI')`
  if (c.json === 'lista') return `to_jsonb(${p})`
  return `to_jsonb(${p})`
}

/** A checagem de enum, feita no banco: um typo para no psql, nao na importacao. */
function guardaEnum(secao, c) {
  if (!c.enums) return []
  const lista = c.enums.map(aspas).join(', ')
  return [
    `  if p_${c.nome} is not null and p_${c.nome} <> all (array[${lista}]) then`,
    `    raise exception '${secao}.${c.nome}: % nao esta na lista (${c.enums.join(', ')})', p_${c.nome};`,
    '  end if;',
  ]
}

function funcaoDeSecao(secao, esquema) {
  const nome = FUNCAO[secao]
  if (!nome) {
    throw new Error(
      `a secao "${secao}" apareceu em SECOES_ARQUIVO e nao tem nome de funcao em ` +
        'scripts/gerar-montar-sql.mjs. Escolha o singular e adicione em FUNCAO.',
    )
  }
  const campos = camposDe(secao, esquema)

  const args = [`  p_${'rascunho'.padEnd(22)} text`]
  for (const c of campos) {
    const padrao = c.obrigatorio ? '' : ' default null'
    args.push(`  p_${c.nome.padEnd(22)} ${c.sql}${padrao}`)
  }

  const guardas = campos.flatMap((c) => guardaEnum(secao, c))
  const pares = campos.map((c) => `    ${aspas(c.nome)}, ${valorJson(c)}`).join(',\n')

  return [
    `-- Acrescenta um item a secao "${secao}" do rascunho.`,
    `create or replace function montar.${nome}(`,
    args.join(',\n'),
    ') returns bigint',
    'language plpgsql as $fn$',
    'declare v_id bigint;',
    'begin',
    ...guardas,
    `  insert into montar.itens (rascunho_id, secao, dado)`,
    `  values (montar.__rascunho(p_rascunho), ${aspas(secao)}, jsonb_strip_nulls(jsonb_build_object(`,
    pares,
    '  )))',
    '  returning id into v_id;',
    '  return v_id;',
    'end $fn$;',
    '',
  ].join('\n')
}

function funcaoViagem() {
  const campos = camposDe('viagem', ViagemSchema)
  const args = [`  p_${'rascunho'.padEnd(22)} text`]
  for (const c of campos) {
    const padrao = c.obrigatorio ? '' : ' default null'
    args.push(`  p_${c.nome.padEnd(22)} ${c.sql}${padrao}`)
  }
  const guardas = campos.flatMap((c) => guardaEnum('viagem', c))
  const pares = campos.map((c) => `    ${aspas(c.nome)}, ${valorJson(c)}`).join(',\n')

  return [
    '-- Abre (ou REABRE) um rascunho. Chamar de novo apaga os itens do rascunho de',
    '-- mesmo nome: um script .sql precisa poder rodar duas vezes sem duplicar o',
    '-- roteiro inteiro, e "recomecar" e o unico significado seguro de rodar de novo.',
    'create or replace function montar.viagem(',
    args.join(',\n'),
    ') returns text',
    'language plpgsql as $fn$',
    'declare v_id text;',
    'begin',
    ...guardas,
    '  insert into montar.rascunhos (nome, viagem)',
    '  values (p_rascunho, jsonb_strip_nulls(jsonb_build_object(',
    pares,
    '  )))',
    '  on conflict (nome) do update',
    '     set viagem = excluded.viagem, atualizado_em = now()',
    '  returning id into v_id;',
    '  delete from montar.itens where rascunho_id = v_id;',
    '  return p_rascunho;',
    'end $fn$;',
    '',
  ].join('\n')
}

/** As checagens de referencia por nome, uma consulta por linha de REFERENCIAS. */
function conferirReferencias() {
  const partes = []
  for (const r of REFERENCIAS) {
    const alvoEsquema = SECOES_ARQUIVO[r.alvo]
    const campos = camposDe(r.secao, SECOES_ARQUIVO[r.secao]).map((c) => c.nome)
    const chaves = camposDe(r.alvo, alvoEsquema).map((c) => c.nome)
    if (!campos.includes(r.campo)) {
      throw new Error(`REFERENCIAS aponta para ${r.secao}.${r.campo}, que nao existe mais`)
    }
    if (!chaves.includes(r.chave)) {
      throw new Error(`REFERENCIAS aponta para ${r.alvo}.${r.chave}, que nao existe mais`)
    }
    const valor = r.lista
      ? `jsonb_array_elements_text(coalesce(i.dado -> ${aspas(r.campo)}, '[]'::jsonb))`
      : `i.dado ->> ${aspas(r.campo)}`
    partes.push(
      [
        '  union all',
        `  select ${aspas(r.gravidade)}, ${aspas(r.secao)},`,
        `         coalesce(i.dado ->> 'titulo', i.dado ->> 'nome', i.dado ->> 'descricao', '?'),`,
        `         '${r.campo} cita ' || quote_literal(v.valor) || ', que nao existe em ${r.alvo}.${r.chave}'`,
        '    from montar.itens i',
        `    cross join lateral (select ${valor} as valor) v`,
        `   where i.rascunho_id = v_id and i.secao = ${aspas(r.secao)} and v.valor is not null`,
        '     and not exists (',
        '       select 1 from montar.itens a',
        `        where a.rascunho_id = v_id and a.secao = ${aspas(r.alvo)}`,
        `          and a.dado ->> ${aspas(r.chave)} = v.valor`,
        '     )',
      ].join('\n'),
    )
  }
  return partes.join('\n')
}

function conferirDatas() {
  return DATAS_NA_JANELA.map((d) => {
    const campos = camposDe(d.secao, SECOES_ARQUIVO[d.secao]).map((c) => c.nome)
    if (!campos.includes(d.campo)) {
      throw new Error(`DATAS_NA_JANELA aponta para ${d.secao}.${d.campo}, que nao existe mais`)
    }
    return [
      '  union all',
      `  select 'aviso', ${aspas(d.secao)},`,
      `         coalesce(i.dado ->> 'titulo', i.dado ->> 'nome', i.dado ->> 'dia', '?'),`,
      `         '${d.campo} (' || (i.dado ->> ${aspas(d.campo)}) || ') cai fora da viagem'`,
      '    from montar.itens i',
      `   where i.rascunho_id = v_id and i.secao = ${aspas(d.secao)}`,
      `     and left(i.dado ->> ${aspas(d.campo)}, 10)::date`,
      "         not between (v_viagem ->> 'data_partida')::date and (v_viagem ->> 'data_retorno')::date",
    ].join('\n')
  }).join('\n')
}

// ---------------------------------------------------------------- o arquivo

export function gerarSql() {
  const secoes = Object.entries(SECOES_ARQUIVO)

  const cabecalho = `-- db/montar.sql — MONTAR UMA VIAGEM INTEIRA EM SQL.
--
-- ARQUIVO GERADO por scripts/gerar-montar-sql.mjs (npm run sql:build).
-- Nao edite a mao: lib/montar.test.ts compara este arquivo com o que o gerador
-- produz a partir de lib/schema.ts, e a proxima geracao apagaria a edicao.
--
-- O QUE ISTO E
--
-- Um jeito de escrever a viagem inteira — roteiro, voos, cruzeiro, hospedagem,
-- cidades, checklist, documentos, documentacao exigida, contatos e dinheiro — em
-- comandos SQL, e receber no fim o MESMO arquivo JSON que a tela ja importa.
-- Nao ha formato novo e nao ha segunda gravadora de viagem: o que sai daqui entra
-- pelo botao Importar (aba Participantes e dados) ou por \`npm run montar\`, e quem
-- grava continua sendo lib/importar.ts, com a validacao e a autorizacao de sempre.
--
-- COMO SE USA
--
--   1. select montar.viagem('europa-2027', 'Europa 2027', '2027-01-02', '2027-01-20');
--   2. select montar.participante('europa-2027', p_nome => 'Ana');
--      select montar.roteiro('europa-2027', p_ocorre_em => '2027-01-02T09:00',
--                            p_titulo => 'Chegada em Lisboa', p_cidade => 'Lisboa');
--      ... uma chamada por item, em qualquer ordem;
--   3. select * from montar.conferir('europa-2027');   -- o que esta errado ANTES
--   4. select montar.arquivo('europa-2027');           -- o JSON pronto
--
-- Chamar \`montar.viagem\` de novo com o mesmo nome RECOMECA o rascunho: rodar o
-- mesmo .sql duas vezes tem que produzir uma viagem, nao duas.
--
-- O rascunho e uma tabela comum (\`montar.itens\`). Corrigir um item ja escrito e
-- um \`update ... set dado = dado || jsonb_build_object(...)\`, e tirar um e um
-- \`delete\`. Nao ha funcao para isso porque nao precisa haver.
--
-- ONDE ELE NAO CHEGA
--
--   - Nao escreve nas tabelas do app. Este schema so monta jsonb; nenhuma funcao
--     aqui alcanca \`trips\`, \`travelers\` ou \`expenses\`. Uma gravadora em PL/pgSQL
--     seria uma segunda copia das regras de autorizacao — a que fica para tras.
--   - Importar sempre CRIA viagem nova. Para completar uma viagem que ja existe,
--     edite pela tela ou monte o arquivo, importe, e mova o que interessa.
--   - Id de linha nao vira argumento: o arquivo liga tudo por NOME
--     (\`assigned_to_nomes\`, \`dono_nome\`, \`reserva\`, \`categoria\`, \`pagador\`),
--     porque a importacao cria a viagem do zero e os ids antigos nao existem la.
--   - Bytes de documento nao passam por aqui, como nao passam pelo export: o
--     arquivo guarda a ficha do documento, e o PDF sobe pela tela do cofre.
--
-- SEGURANCA: quem roda isto tem a DATABASE_URL, ou seja, ja esta acima de
-- qualquer papel do app — o recorte por papel protege a REDE, nao o console do
-- banco. Por isso nada aqui LE tabela do app: um \`select\` que juntasse
-- \`travelers\` a um rascunho publicaria passaporte alheio para dentro de um jsonb
-- que depois vira arquivo e circula por e-mail. Para tirar dados de uma viagem
-- que ja existe, use GET /api/export, que corta por papel.

create schema if not exists montar;

-- O rascunho: a viagem (bloco unico) e os itens de cada secao.
--
-- Duas tabelas, e nao um jsonb so, porque \`insert\` e \`delete\` de UM item tem que
-- ser triviais — a metade do tempo de montar uma viagem e corrigir um horario. A
-- ordem de \`id\` e a ordem em que o item entra no arquivo.
create table if not exists montar.rascunhos (
  id            text primary key default gen_random_uuid()::text,
  nome          text not null unique,
  viagem        jsonb not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists montar.itens (
  id          bigint generated by default as identity primary key,
  rascunho_id text not null references montar.rascunhos(id) on delete cascade,
  secao       text not null,
  dado        jsonb not null
);

create index if not exists idx_montar_itens on montar.itens (rascunho_id, secao, id);

-- ---------------------------------------------------------------- apoio

-- Resolve o nome do rascunho. Erra alto: um nome errado devolvendo null faria o
-- item entrar em lugar nenhum e o script terminar "com sucesso" sem o passeio.
create or replace function montar.__rascunho(p_rascunho text) returns text
language plpgsql stable as $fn$
declare v_id text;
begin
  select id into v_id from montar.rascunhos where nome = p_rascunho;
  if v_id is null then
    raise exception 'rascunho "%" nao existe. Comece por montar.viagem(...).', p_rascunho;
  end if;
  return v_id;
end $fn$;

-- Os itens de uma secao, na ordem em que entraram.
create or replace function montar.__secao(p_id text, p_secao text) returns jsonb
language sql stable as $fn$
  select coalesce(jsonb_agg(dado order by id), '[]'::jsonb)
    from montar.itens where rascunho_id = p_id and secao = p_secao
$fn$;

-- ---------------------------------------------------------------- secoes
`

  const funcoes = [funcaoViagem(), ...secoes.map(([nome, esq]) => funcaoDeSecao(nome, esq))]

  const arquivo = `-- ---------------------------------------------------------------- saida

-- O arquivo de importacao, pronto para o botao Importar.
--
-- \`schemaVersion\` sai de lib/schema.ts na geracao: um numero digitado aqui viraria
-- a unica versao que nao acompanha o app.
create or replace function montar.arquivo(p_rascunho text) returns jsonb
language sql stable as $fn$
  select jsonb_build_object(
    'schemaVersion', ${SCHEMA_VERSION},
    'viagem', r.viagem,
${secoes.map(([n]) => `    ${aspas(n)}, montar.__secao(r.id, ${aspas(n)})`).join(',\n')}
  )
  -- Passa por __rascunho para que um nome errado ERRE, em vez de devolver null:
  -- null aqui viraria "arquivo vazio" tres passos adiante, longe de quem digitou.
  from montar.rascunhos r
  where r.id = montar.__rascunho(p_rascunho)
$fn$;

-- Le um arquivo exportado de volta para um rascunho, para editar em SQL e reemitir.
-- E o caminho de volta do round-trip: GET /api/export -> montar.carregar -> editar
-- -> montar.arquivo -> Importar.
create or replace function montar.carregar(p_rascunho text, p_arquivo jsonb) returns text
language plpgsql as $fn$
declare v_id text;
begin
  insert into montar.rascunhos (nome, viagem)
  values (p_rascunho, p_arquivo -> 'viagem')
  on conflict (nome) do update set viagem = excluded.viagem, atualizado_em = now()
  returning id into v_id;
  delete from montar.itens where rascunho_id = v_id;
${secoes
  .map(
    ([n]) =>
      `  insert into montar.itens (rascunho_id, secao, dado)\n` +
      `  select v_id, ${aspas(n)}, x from jsonb_array_elements(coalesce(p_arquivo -> ${aspas(n)}, '[]'::jsonb)) x;`,
  )
  .join('\n')}
  return p_rascunho;
end $fn$;

-- Apaga um rascunho inteiro. Os itens vao junto pelo \`on delete cascade\`.
create or replace function montar.apagar(p_rascunho text) returns void
language sql as $fn$
  delete from montar.rascunhos where nome = p_rascunho
$fn$;

-- O que existe no rascunho, em uma linha por secao. Primeira coisa a olhar.
create or replace function montar.resumo(p_rascunho text)
returns table(secao text, itens bigint)
language sql stable as $fn$
  select i.secao, count(*)
    from montar.itens i
    join montar.rascunhos r on r.id = i.rascunho_id
   where r.nome = p_rascunho
   group by i.secao
   order by i.secao
$fn$;

-- ---------------------------------------------------------------- conferencia

-- O que esta errado no rascunho, ANTES de gerar o arquivo.
--
-- Nao repete o zod: \`TripImportSchema\` ja recusa data inexistente, centavos
-- fracionado e enum fora da lista, e \`npm run montar\` valida contra ele. O que
-- mora aqui e o que o zod NAO tem como ver — uma secao olhando para a outra.
-- Cada linha destas ja custou uma importacao que passou verde e entregou viagem
-- errada: pagador que ninguem reconhece entra como despesa sem pagador, documento
-- pessoal sem dono e rebaixado para global (fica visivel para a viagem inteira),
-- e entrega orfa e descartada em SILENCIO por lib/importar.ts.
--
-- 'erro' = a importacao vai perder ou torcer esse dado.
-- 'aviso' = entra, mas provavelmente nao e o que voce quis dizer.
create or replace function montar.conferir(p_rascunho text)
returns table(gravidade text, secao text, item text, problema text)
language plpgsql stable as $fn$
declare
  v_id     text := montar.__rascunho(p_rascunho);
  v_viagem jsonb;
begin
  select r.viagem into v_viagem from montar.rascunhos r where r.id = v_id;

  return query
  -- a viagem em si
  select 'erro', 'viagem', coalesce(v_viagem ->> 'nome', '?'),
         'data_retorno e anterior a data_partida'
   where (v_viagem ->> 'data_retorno')::date < (v_viagem ->> 'data_partida')::date

  union all
  select 'aviso', 'participantes', '-', 'a viagem nao tem nenhum participante'
   where not exists (
     -- Alias obrigatorio: secao tambem e uma coluna de SAIDA desta funcao, e sem
     -- o prefixo x. o Postgres recusa a consulta inteira por ambiguidade.
     select 1 from montar.itens x where x.rascunho_id = v_id and x.secao = 'participantes'
   )

  -- nome repetido quebra TODA ligacao por nome deste arquivo
  union all
  select 'erro', 'participantes', d.nome,
         'nome repetido: as ligacoes por nome (pagador, dono_nome, assigned_to_nomes) ficam ambiguas'
    from (
      select i.dado ->> 'nome' as nome, count(*) as n
        from montar.itens i
       where i.rascunho_id = v_id and i.secao = 'participantes'
       group by 1 having count(*) > 1
    ) d

  -- documento pessoal sem dono: a importacao rebaixa para global, e o passaporte
  -- de uma pessoa fica visivel para a viagem inteira.
  union all
  select 'erro', 'documentos', coalesce(i.dado ->> 'titulo', '?'),
         'escopo pessoal sem dono_nome: a importacao rebaixa para global e o documento fica visivel para todos'
    from montar.itens i
   where i.rascunho_id = v_id and i.secao = 'documentos'
     and i.dado ->> 'escopo' = 'pessoal'
     and coalesce(i.dado ->> 'dono_nome', '') = ''

  -- divisao personalizada que nao fecha com o total
  union all
  select 'erro', 'custos', coalesce(i.dado ->> 'descricao', '?'),
         'divisao personalizada soma ' || s.soma || ' e a despesa e ' || (i.dado ->> 'valor_centavos')
    from montar.itens i
    cross join lateral (
      select coalesce(sum((x ->> 'valor_centavos')::bigint), 0) as soma
        from jsonb_array_elements(coalesce(i.dado -> 'divisoes', '[]'::jsonb)) x
    ) s
   where i.rascunho_id = v_id and i.secao = 'custos'
     and i.dado ->> 'divisao' = 'personalizado'
     and jsonb_array_length(coalesce(i.dado -> 'divisoes', '[]'::jsonb)) > 0
     and s.soma <> (i.dado ->> 'valor_centavos')::bigint

  -- parcelas que nao somam a despesa
  union all
  select 'erro', 'custos', coalesce(i.dado ->> 'descricao', '?'),
         'as parcelas somam ' || s.soma || ' e a despesa e ' || (i.dado ->> 'valor_centavos')
    from montar.itens i
    cross join lateral (
      select coalesce(sum((x ->> 'valor_centavos')::bigint), 0) as soma
        from jsonb_array_elements(coalesce(i.dado -> 'parcelas', '[]'::jsonb)) x
    ) s
   where i.rascunho_id = v_id and i.secao = 'custos'
     and jsonb_array_length(coalesce(i.dado -> 'parcelas', '[]'::jsonb)) > 0
     and s.soma <> (i.dado ->> 'valor_centavos')::bigint

  -- prazo maximo antes do ideal
  union all
  select 'aviso', 'checklist', coalesce(i.dado ->> 'titulo', '?'),
         'prazo_maximo e anterior a prazo_ideal'
    from montar.itens i
   where i.rascunho_id = v_id and i.secao = 'checklist'
     and (i.dado ->> 'prazo_maximo')::date < (i.dado ->> 'prazo_ideal')::date

  -- requisito restrito a ninguem: a importacao o abre para todo mundo
  union all
  select 'aviso', 'requisitos', coalesce(i.dado ->> 'nome', '?'),
         'aplica_todos = false sem assigned_to_nomes: a importacao volta a exigir de todos'
    from montar.itens i
   where i.rascunho_id = v_id and i.secao = 'requisitos'
     and (i.dado ->> 'aplica_todos') = 'false'
     and jsonb_array_length(coalesce(i.dado -> 'assigned_to_nomes', '[]'::jsonb)) = 0

${conferirDatas()}

${conferirReferencias()}
  ;
end $fn$;
`

  return [cabecalho, funcoes.join('\n'), arquivo].join('\n')
}

// Rodado direto: escreve db/montar.sql.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeFileSync } = await import('node:fs')
  const destino = new URL('../db/montar.sql', import.meta.url)
  writeFileSync(destino, gerarSql(), 'utf8')
  console.log(`db/montar.sql gerado a partir de lib/schema.ts (${Object.keys(SECOES_ARQUIVO).length} secoes + viagem).`)
}
