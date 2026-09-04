// Testes de ARQUITETURA: propriedades que valem por leitura de código, não por
// execução.
//
// Existem porque o app se apoia em afirmações que, se deixarem de ser verdade,
// não quebram nenhum teste comum e não aparecem em nenhuma tela — a próxima
// pessoa só descobre auditando. Um teste que lê o código é feio, e é a única
// coisa que trava isso.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { sep } from 'node:path'
import { TIPOS_EVENTO } from './schema.ts'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('a rota de escrita devolve o envelope montado num lugar só', () => {
  const a = 'app/api/mutate/route.ts'
  assert.ok(
    ler(a).includes('envelope(acesso)'),
    `${a} monta o envelope à mão. Os campos já divergiram uma vez entre mutate ` +
      'e snapshot e toda escrita quebrou a renderização seguinte.',
  )
})

// ---------------------------------------------------------------- vazamento

test('o snapshot nao manda passaporte de participante para quem nao administra', () => {
  const db = ler('lib/db.ts')
  const consulta = /from travelers p left join users u[\s\S]{0,200}/.exec(db)?.[0] ?? ''
  assert.ok(consulta, 'a consulta de participantes mudou de forma; confira o recorte a mao')
  assert.ok(
    !/p\.passaporte,/.test(db.slice(0, db.indexOf('from travelers p'))) ||
      /case when[^)]*then p\.passaporte end/.test(db),
    'a consulta de participantes voltou a mandar `passaporte` para todo mundo. ' +
      'Planejar o roteiro nao da direito de ler o passaporte de ninguem — mesma ' +
      'regra de documentosDaViagem, e o recorte tem que ser na QUERY.',
  )
  assert.ok(
    /case when[^)]*then p\.passaporte end/.test(db),
    'sumiu o recorte de papel do `passaporte` em getSnapshot',
  )
  assert.ok(
    /case when[^)]*then p\.telefone end/.test(db),
    'sumiu o recorte de papel do `telefone` em getSnapshot',
  )
})

test('o snapshot nao manda o orcamento da viagem para visualizador', () => {
  const db = ler('lib/db.ts')
  assert.ok(
    !/sql`select \* from trips where id = /.test(db),
    'getSnapshot voltou a fazer `select *` em trips. A tabela carrega ' +
      '`orcamento_centavos`, que e o total da viagem — exatamente o que ' +
      'financeiroDaViagem recusa a mandar para quem nao administra. Esconder no ' +
      'React (`if (!fin.admin) return null`) nao e proteger.',
  )
  assert.ok(
    /case when[^)]*then orcamento_centavos end/.test(db),
    'sumiu o recorte de papel do `orcamento_centavos` em getSnapshot',
  )
})

// ---------------------------------------------------------------- upload

test('o upload do cofre confere a assinatura do arquivo, nao so o MIME declarado', () => {
  const rota = ler('app/api/documento/route.ts')
  assert.ok(
    /assinaturaConfere\(/.test(rota),
    '/api/documento voltou a aceitar `arquivo.type` sozinho. Quem envia escolhe o ' +
      'que declarar: um HTML anunciado como application/pdf era gravado e servido ' +
      'de volta do proprio dominio para os outros viajantes.',
  )
  // O `nosniff` saiu da rota para `cabecalhosEstaticos`, que o next.config.ts
  // aplica a `/:caminho*` — /api/* incluso, que o proxy nao alcanca. O que fica
  // na resposta e a CSP proria dela.
  assert.ok(
    /'Content-Security-Policy': "default-src 'none'"/.test(rota),
    'a resposta do cofre perdeu a CSP propria. Ela serve arquivo que outra ' +
      'pessoa subiu, e o proxy nao cobre /api/*.',
  )
  assert.ok(
    /X-Content-Type-Options/.test(ler('lib/seguranca.ts')),
    'o `nosniff` sumiu de cabecalhosEstaticos: sem ele o navegador adivinha o ' +
      'tipo do arquivo do cofre pelo conteudo.',
  )
})

// ---------------------------------------------------------------- href

test('nenhum valor guardado vira href sem passar por hrefSeguro', () => {
  // `doc.valor` e `links` sao os dois campos livres que a tela transforma em
  // link. Os dois foram escritos por outro participante da viagem, e um
  // `javascript:` guardado ali roda com a sessao de quem clicar — numa pagina
  // que carrega o snapshot inteiro.
  const cofre = ler('components/CofreDocumento.tsx')
  assert.ok(
    !/href=\{doc\.valor\}/.test(cofre),
    'CofreDocumento voltou a jogar `doc.valor` direto no href',
  )
  assert.ok(/hrefSeguro\(doc\.valor\)/.test(cofre), 'CofreDocumento nao usa mais hrefSeguro')
  assert.ok(
    /hrefSeguro\(/.test(ler('lib/derive.ts')),
    'lerLinks parou de conferir o esquema por hrefSeguro',
  )
})

// ---------------------------------------------------------------- cabecalhos

test('os cabecalhos de seguranca chegam a configuracao do Next', () => {
  const config = ler('next.config.ts')
  assert.ok(
    /cabecalhosEstaticos/.test(config) && /async headers\(\)/.test(config),
    'next.config.ts parou de aplicar os cabecalhos de lib/seguranca.ts. Sem eles ' +
      'nao ha HSTS nem nosniff em rota nenhuma.',
  )
  // O CSP mora no proxy, e nao aqui, porque carrega nonce por requisicao — e
  // porque `headers()` e serializado no BUILD, o que faria qualquer parte
  // condicional depender do ambiente do build em vez do request.
  assert.ok(
    /politicaCsp\(/.test(ler('proxy.ts')),
    'o CSP saiu do proxy. Sem ele nao ha nonce, e `strict-dynamic` sem nonce ' +
      'bloqueia todo script da pagina.',
  )
})

// ---------------------------------------------------------------- CSRF

test('toda escrita passa pela conferencia de origem', () => {
  const api = ler('lib/api.ts')
  assert.ok(
    /mesmaOrigem\(\{/.test(api) && /exigirMesmaOrigem\(req\)/.test(api),
    '`rota()` parou de conferir a origem. Ela e a casca de TODAS as rotas: uma ' +
      'linha aqui cobre as dez de uma vez, e sem ela a unica defesa contra CSRF ' +
      'volta a ser o SameSite=Lax do cookie, herdado do padrao do navegador.',
  )
})

test('o passaporte de participante corta em proprietario, nao em editor', () => {
  const db = ler('lib/db.ts')
  // O erro que este teste existe para impedir ja foi cometido uma vez: o recorte
  // reusou `administra` (editor), que e o corte do DINHEIRO em
  // `financeiroDaViagem`, para o corte do DOCUMENTO. Sao regras diferentes, e a
  // do documento e mais alta — `documentosDaViagem`, `documentacaoDaViagem` e o
  // `documentoVisivel` de /api/documento usam todas `proprietario`.
  assert.ok(
    /const veDadoPessoal = papelAlcanca\(papel, 'proprietario'\)/.test(db),
    'sumiu o limiar `proprietario` do dado pessoal em getSnapshot',
  )
  assert.ok(
    /then p\.passaporte end/.test(db) && !/\$\{administra\}::boolean or p\.id/.test(db),
    'o passaporte voltou a cortar por `administra` (editor). Um co-organizador ' +
      'passaria a ler o passaporte de todo mundo — o dado que documentosDaViagem ' +
      'se da ao trabalho de esconder exatamente desse papel.',
  )
})

test('a marca do lote chega ao registro de uma EDICAO', () => {
  const escrita = ler('lib/escrita.ts')
  // Sem `marca.origem`/`marca.lote` aqui, uma edicao feita por um lote era gravada
  // como edicao humana sem lote, e o desfazer — que filtra por origem e lote — nao
  // a encontrava. Um lote so de edicoes respondia "esse lote nao existe mais"; um
  // lote misto revertia as criacoes e deixava as edicoes de pe. O desfazer e o que
  // torna seguro aplicar uma carga inteira de uma vez.
  const trecho = escrita.slice(escrita.indexOf('for (const c of cols) {'))
  assert.ok(
    /marca\.origem/.test(trecho) && /marca\.lote/.test(trecho),
    'o registro de edicao voltou a perder a marca: o desfazer de um lote ' +
      'reverteria pela metade, em silencio',
  )
})

test('o rate limit conta no banco, sob trava', () => {
  const schema = ler('db/schema.sql')
  assert.ok(
    /create or replace function registrar_tentativa/.test(schema),
    'sumiu a funcao do rate limit persistente',
  )
  assert.ok(
    /for update/.test(schema),
    'a funcao do rate limit perdeu o `for update`. Sem a trava, duas instancias ' +
      'leem o mesmo contador, cada uma soma 1, e o limite vale o dobro — que e o ' +
      'mesmo furo do contador em memoria, so mais dificil de enxergar.',
  )
  const db = ler('lib/db.ts')
  assert.ok(
    /registrar_tentativa\(/.test(db),
    'lib/db.ts parou de usar a funcao; o limite voltou a ser por instancia',
  )
})

test('login e cadastro conferem o captcha antes de gastar scrypt', () => {
  for (const a of ['app/api/sessao/route.ts', 'app/api/usuarios/route.ts']) {
    const rota = ler(a)
    assert.ok(
      /verificarTurnstile\(/.test(rota),
      `${a} parou de conferir o captcha. O rate limit barra volume de UMA origem; ` +
        'mil IPs tentando cinco senhas cada passam por baixo dele.',
    )
  }
})
test('a dona da entrega vem do banco, não do corpo do pedido', () => {
  const escrita = ler('lib/escrita.ts')
  // Enquanto o dono saía de `campos.traveler_id`, a autorização dependia de o zod
  // EXIGIR esse campo — e um desfazer monta `campos` com um campo só, então por ali
  // `traveler_id` sumia, `meu` virava true por ausência, e um visualizador revertia
  // o número do passaporte de outro participante.
  assert.ok(
    /from document_submissions s[\s\S]{0,200}join document_requirements/.test(escrita),
    'autorizar deixou de carregar a entrega do banco: a dona volta a ser quem o ' +
      'cliente disser que é, e o desfazer contorna o 403 da documentação alheia',
  )
  assert.ok(
    /entregaAlvo\?\.traveler_id \?\? campos\.traveler_id/.test(escrita),
    'a linha gravada precisa vencer o que veio no corpo ao decidir a dona da entrega',
  )
})

// ------------------------------------------------------- superficie sem sessao
//
// As quatro propriedades abaixo valem por leitura porque o que elas travam nao
// aparece em tela nenhuma: uma rota dispensada do proxy, um caminho listado que
// nao existe, uma mensagem de erro distinguivel e um layout sem guarda nao
// quebram nada visivel -- a proxima pessoa so descobre auditando.

test('o matcher do proxy dispensa caminhos, nunca extensoes', () => {
  const m = /matcher:\s*\[([^\]]*)\]/.exec(ler('proxy.ts'))?.[1] ?? ''
  assert.ok(m, 'nao achei o matcher em proxy.ts')
  assert.ok(
    !m.includes('$'),
    'o matcher do proxy voltou a casar pelo FIM da URL. Uma dispensa por extensao ' +
      'nao distingue /icone-192.png de /viagens/qualquer-coisa.png: a segunda sai ' +
      'sem checagem de sessao e sem CSP. Dispense caminho, nunca sufixo.',
  )
})

test('toda rota listada em navigation.ts tem pagina', () => {
  // Grupo de rota -- (auth), (dashboard) -- nao entra na URL: some do caminho.
  const paginas = new Set(
    readdirSync(new URL('../app', import.meta.url), { recursive: true })
      .map((p) => String(p).split(sep).join('/'))
      .filter((p) => p === 'page.tsx' || p.endsWith('/page.tsx'))
      .map((p) => '/' + p.replace(/\/?page\.tsx$/, '').replace(/\([^)]*\)\/?/g, '')),
  )
  const nav = ler('config/navigation.ts')
  for (const lista of ['rotasPrivadas', 'rotasPublicas']) {
    const trecho = nav.slice(nav.indexOf(lista + ' ='))
    const bruto = trecho.slice(trecho.indexOf('[') + 1, trecho.indexOf(']'))
    for (const aspas of bruto.match(/'([^']+)'/g) ?? []) {
      const r = aspas.slice(1, -1)
      assert.ok(
        paginas.has(r),
        lista +
          ' lista ' +
          r +
          ', que nao tem page.tsx. Nome sem pagina ensina a ' +
          'ler estas listas como intencao em vez de fato -- e a proxima entrada ' +
          'morta pode ser uma que devia estar em rotasPrivadas.',
      )
    }
  }
})

test('o cadastro nao denuncia e-mail ja cadastrado', () => {
  const rota = ler('app/api/usuarios/route.ts')
  assert.ok(
    !/ErroHttp\(409/.test(rota),
    'POST /api/usuarios voltou a responder diferente para e-mail duplicado. Isso faz ' +
      'do cadastro um verificador de e-mails cadastrados -- e como ' +
      'vincularParticipantesPorEmail transforma o e-mail de um participante em ' +
      'credencial, quem enumera aprende quais ainda estao livres para reivindicar. ' +
      'O /api/sessao paga o mesmo preco em "E-mail ou senha incorretos.".',
  )
})

test('as telas privadas tem guarda de servidor, alem do proxy', () => {
  assert.ok(
    ler('app/(dashboard)/layout.tsx').includes('exigirUsuarioOuLogin'),
    'o layout de (dashboard) parou de exigir sessao. As paginas do grupo sao ' +
      "'use client' e nao conseguem checar sozinhas; sem este layout a unica " +
      'barreira volta a ser o proxy, que so olha a assinatura do cookie e nunca o ' +
      'banco -- token assinado de conta ja apagada passa.',
  )
})

// ------------------------------------------------------- codigo do convite
//
// O codigo e o que separa "sei o e-mail de um participante" de "posso entrar
// nesta viagem". As tres propriedades abaixo sao invisiveis em tela: o recorte
// de papel, a condicao no vinculo e a coluna existir num banco JA EM USO.

test('o codigo do convite so sai para o proprietario', () => {
  const db = ler('lib/db.ts')
  assert.ok(
    /case when[^)]*then codigo_convite end/.test(db),
    'sumiu o recorte de papel do `codigo_convite` em getSnapshot. Ele e a ' +
      'credencial que deixa alguem reivindicar uma vaga desta viagem no cadastro: ' +
      'um visualizador que o recebesse convidaria quem quisesse para uma viagem ' +
      'que ele nem edita.',
  )
  const trecho = /then codigo_convite end/.exec(db)
  assert.ok(trecho, 'nao achei o recorte para conferir o limiar')
  const antes = db.slice(Math.max(0, trecho.index - 200), trecho.index)
  assert.ok(
    antes.includes('veDadoPessoal'),
    'o `codigo_convite` passou a cortar por `administra` (editor). O limiar e ' +
      'proprietario, o mesmo de quem pode ESCREVER participante na TABELA de ' +
      'lib/escrita.ts -- senao um editor convida gente para a viagem de outro.',
  )
})

test('o vinculo por e-mail exige o codigo do convite', () => {
  const db = ler('lib/db.ts')
  const i = db.indexOf('export async function vincularParticipantesPorEmail')
  assert.ok(i > 0, 'nao achei vincularParticipantesPorEmail')
  const corpo = db.slice(i, db.indexOf('\n}\n', i))
  assert.ok(
    corpo.includes('codigo_convite'),
    'vincularParticipantesPorEmail voltou a ligar a conta so pelo e-mail. Este e ' +
      'o unico caminho SEM sessao que escreve em dado de viagem, e o e-mail de um ' +
      'participante nao e segredo: o dono digita o endereco no app muito antes da ' +
      'pessoa se cadastrar, e quem chegasse primeiro em /register herdava a vaga.',
  )
  assert.ok(
    corpo.includes('t.user_id is null'),
    'sumiu o `user_id is null`: sem ele um cadastro novo rouba a vaga de quem ja entrou',
  )
})

test('o codigo do convite existe tambem para banco ja em uso', () => {
  const sql = ler('db/schema.sql')
  const criar = sql.slice(sql.indexOf('create table if not exists trips'))
  assert.ok(
    criar.slice(0, criar.indexOf(');')).includes('codigo_convite'),
    'o `codigo_convite` sumiu do create table de trips',
  )
  const migracoes = sql.slice(sql.indexOf('alter table trips'))
  assert.ok(
    /alter table trips add column if not exists codigo_convite/.test(migracoes),
    'o `codigo_convite` esta so na metade do `create table`. Widening no create ' +
      'nao faz NADA num banco que ja existe -- foi assim que documents.tipo deixou ' +
      'todo upload morrer no documents_tipo_check. A migracao tem que estar nas duas.',
  )
  assert.ok(
    /update trips set codigo_convite[\s\S]*where codigo_convite is null/.test(migracoes),
    'a migracao nao preenche as viagens que ja existem. Viagem sem codigo tranca ' +
      'para fora todo participante que ainda nao se cadastrou -- e as viagens reais ' +
      'ja estao no ar com gente por cadastrar.',
  )
})

// ------------------------------------------------------- barreiras que nao rodam
//
// Duas propriedades que nenhum teste comum pega: um minimo de papel errado numa
// rota que copia dados, e um limite de taxa que existe no codigo e nao executa.

test('duplicar viagem exige editor, nao o minimo padrao', () => {
  const rota = ler('app/api/viagens/duplicar/route.ts')
  assert.ok(
    /exigirViagem\([^)]*,\s*'editor'\s*\)/.test(rota),
    "POST /api/viagens/duplicar voltou ao minimo padrao ('visualizador'). A copia " +
      'carrega `orcamento_centavos`, todas as `expenses` e todas as `installments`, ' +
      'e quem duplica vira PROPRIETARIO dela -- entao um visualizador duplicava, ' +
      'abria a copia como dono e o financeiroDaViagem respondia {admin: true} com o ' +
      'razao inteiro. Regra: so se copia o que ja se pode ler.',
  )
})

test('a copia da viagem nao leva item de checklist pessoal', () => {
  const rota = ler('app/api/viagens/duplicar/route.ts')
  const i = rota.indexOf('insert into checklist_items')
  assert.ok(i > 0, 'nao achei a copia do checklist')
  const bloco = rota.slice(i, rota.indexOf('`', rota.indexOf('from checklist_items', i)))
  assert.ok(
    bloco.includes("escopo = 'global'"),
    'a copia do checklist parou de filtrar por escopo. `checklistDaViagem` esconde ' +
      'o item `pessoal` de quem nao e dono nem proprietario, e a copia nasce sem ' +
      'participante nenhum -- sem o filtro, duplicar e como um editor le o titulo, ' +
      'o detalhe e o valor estimado do item pessoal de outra pessoa.',
  )
})

test('toda chamada a limitar() e esperada', () => {
  for (const a of [
    'app/api/documento/route.ts',
    'app/api/import/route.ts',
    'app/api/mutate/route.ts',
    'app/api/perfil/route.ts',
  ]) {
    for (const linha of ler(a).split('\n')) {
      if (!/(^|[^a-zA-Z])limitar\(/.test(linha)) continue
      assert.ok(
        /await\s+limitar\(/.test(linha),
        a +
          ' chama limitar() sem await. limitar() e async e SINALIZA com throw: ' +
          'sem esperar, o 429 vira rejeicao solta que o try/catch de rota() nao ' +
          'pega, o handler segue e o pedido passa. O limite so aparece no log como ' +
          'unhandledRejection -- defesa que parece existir e nao roda.',
      )
    }
  }
})

test('o dono do checklist_state vem da sessao, nao do corpo', () => {
  const escrita = ler('lib/escrita.ts')
  const i = escrita.indexOf("if (op.entidade === 'checklist_state')")
  assert.ok(i > 0, 'nao achei o caminho de gravacao do checklist_state')
  const bloco = escrita.slice(i, escrita.indexOf('return true', i))

  assert.ok(
    /insert into checklist_state[\s\S]*values \(\$\{acesso\.participanteId\}/.test(bloco),
    'o INSERT do checklist_state parou de tirar o `traveler_id` de ' +
      '`acesso.participanteId`. E ali, e so ali, que mora a barreira: com o dono ' +
      'vindo da sessao, marcar o checklist alheio nao e proibido, e impossivel de ' +
      'expressar. Lendo do corpo, vira o mesmo furo que a `entrega` teve.',
  )
  // O bloco inteiro, e nao so o SQL: o que se quer impedir e alguem voltar a
  // consultar o campo homonimo do corpo em qualquer ponto deste caminho.
  assert.ok(
    !/campos\.traveler_id/.test(bloco),
    'o caminho do checklist_state passou a olhar o traveler_id vindo do corpo. ' +
      'Hoje ele nem chega -- o zod o descarta -- e o dono sai da sessao; ler o ' +
      'corpo devolve a pergunta "de quem e esta linha?" para quem escreve o pedido.',
  )

  const schema = ler('lib/schema.ts')
  const linha = schema.split('\n').find((l) => l.includes('checklist_state:')) ?? ''
  assert.ok(
    linha && !linha.includes('traveler_id'),
    'POR_ENTIDADE.checklist_state ganhou `traveler_id`. Hoje o zod descarta esse ' +
      'campo, que e o que torna o dono inegociavel; aceita-lo reabre a pergunta ' +
      '"de quem e esta linha?" para quem escreve o pedido.',
  )
})

test('a importacao so vincula a conta de quem importa', () => {
  const imp = ler('lib/importar.ts')
  assert.ok(
    !/from users where email = any/i.test(imp),
    'lib/importar.ts voltou a resolver QUALQUER conta pelos e-mails do arquivo. ' +
      'Subir um JSON com o endereco de outra pessoa prendia a conta dela a uma ' +
      'viagem que ela nunca aceitou, sem sessao dela e sem prova do endereco -- o ' +
      'mesmo pressuposto que o codigo_convite derrubou, pela porta oposta.',
  )
  assert.ok(
    /email === meuEmail/.test(imp),
    'sumiu a comparacao com o proprio e-mail: e ela que limita o vinculo a quem importa',
  )
})

test('todo participante citado numa escrita e conferido contra a viagem', () => {
  const escrita = ler('lib/escrita.ts')
  const i = escrita.indexOf('async function conferirPai')
  const corpo = escrita.slice(i, escrita.indexOf('async function conferirParticipantes'))
  for (const entidade of ['documento', 'checklist_item', 'requisito', 'pagamento']) {
    const j = corpo.indexOf(`entidade === '${entidade}'`)
    assert.ok(j > 0, `conferirPai parou de tratar ${entidade}`)
  }
  // Recorta o bloco do `documento` ate o proximo `if`: sem isso a checagem
  // alcanca a chamada do bloco seguinte e passa mesmo com esta removida.
  const inicio = corpo.indexOf("entidade === 'documento'")
  const bloco = corpo.slice(inicio, corpo.indexOf('if (entidade', inicio + 1))
  assert.ok(
    bloco.includes('conferirParticipantes') && bloco.includes('campos.traveler_id'),
    '`documento` parou de conferir os participantes citados. `traveler_id` decide a ' +
      'posse de um documento pessoal e `assigned_to` e um text[] que nenhuma chave ' +
      'estrangeira cobre: sem isto a referencia so garante que a linha `travelers` ' +
      'existe em ALGUMA viagem.',
  )
})

test('nenhum log imprime o objeto de erro cru', () => {
  const arquivos = [
    'lib/api.ts',
    'lib/db.ts',
    'app/api/mutate/route.ts',
  ]
  for (const a of arquivos) {
    for (const linha of ler(a).split('\n')) {
      if (linha.trim().startsWith('//') || linha.trim().startsWith('*')) continue
      if (!/console\.(error|warn|log)\(/.test(linha)) continue
      // `, e)` ou `, erro)` no fim: o objeto inteiro indo para o log.
      assert.ok(
        !/,\s*(e|erro|err)\s*\)/.test(linha),
        `${a} loga o erro cru: "${linha.trim()}". O NeonDbError carrega \`detail\` ` +
          '("Key (email)=(...)") e `internalQuery` como propriedades, e o console ' +
          'imprime as enumeraveis junto com o stack -- e-mail, codigo de convite e ' +
          'a chave do rate limit (um IP) iam para o log em texto. Use `paraLog(e)`.',
      )
    }
  }
})

// ---------------------------------------------------------------- cor por tipo

test('todo tipo de item do roteiro tem cor, direta ou por apelido', () => {
  // A linha do tempo pinta cada evento pela cor do tipo — círculo do ícone,
  // faixa lateral do cartão e chip do seletor. Um tipo NOVO no schema que
  // ninguém lembrou de colorir não quebra nada: cai no cinza neutro e some no
  // meio da lista, que é exatamente o efeito que a cor existe para evitar.
  // Nenhuma tela reclama, nenhum teste comum falha. Só este.
  const ui = ler('components/ui.tsx')
  const bloco = (nome: string) => {
    const i = ui.indexOf(`export const ${nome}`)
    assert.ok(i >= 0, `${nome} sumiu de components/ui.tsx`)
    return ui.slice(i, ui.indexOf('\n}', i))
  }
  const tons = bloco('TONS')
  const alias = bloco('ALIAS_TOM')

  // Por linha, e não por regex montada em template: `\s` dentro de uma template
  // string vira só "s", e a regex passa a casar nada — em silêncio.
  const chaves = new Set(
    [tons, alias]
      .join('\n')
      .split('\n')
      .map((l) => l.trim().split(':')[0].trim()),
  )
  const semCor = TIPOS_EVENTO.filter((t) => !chaves.has(t))
  assert.deepEqual(
    semCor,
    [],
    `tipo(s) sem cor: ${semCor.join(', ')}. Some em TONS (par próprio) ou em ` +
      'ALIAS_TOM (aponta para um par existente) em components/ui.tsx — senão o ' +
      'evento nasce cinza e a linha do tempo perde a única pista de cor que tem.',
  )
})

test('a cor de um tipo e resolvida num lugar so', () => {
  // `tomDoTipo` nasceu porque a busca estava copiada em três telas e um tipo
  // novo ganhava cor numa e cinza nas outras — a tela dizia duas coisas sobre o
  // mesmo evento. Se a cópia voltar, este teste é quem avisa.
  for (const arquivo of ['components/tabs/Roteiro.tsx', 'components/EditorSheet.tsx']) {
    assert.ok(
      !/TONS\[[^\]]+\]\s*\?\?\s*TONS\[/.test(ler(arquivo)),
      `${arquivo} resolve a cor do tipo à mão. Use tomDoTipo de components/ui.tsx.`,
    )
  }
})
