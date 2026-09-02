// Teste da ROTA, não do motor.
//
// Sem chave da Anthropic e sem banco real, um caminho continua totalmente
// exercitável — e é justamente o que a spec exige (P1-14): sem chave
// configurada, o assistente se declara indisponível em pt-BR e o resto do app
// segue de pé. Um 500 genérico aqui mandaria a pessoa procurar defeito na
// viagem dela.
//
// `DATABASE_URL` de fachada porque `lib/db.ts` conecta na avaliação do módulo;
// nenhuma consulta chega a ser feita, o teste para antes.
//
// `sec-fetch-site` em toda requisição porque `rota()` recusa POST que não veio
// desta aplicação (lib/api.ts → `exigirMesmaOrigem`). É o cabeçalho que o
// navegador escreve sozinho; aqui ele é escrito à mão para o dublê parecer o que
// realmente chega. O caso oposto tem teste próprio no fim do arquivo.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgresql://u:p@exemplo.neon.tech/db'
process.env.SESSION_SECRET ??= '0'.repeat(64)

test('sem ANTHROPIC_API_KEY a rota responde 503 em pt-BR, não 500', async () => {
  const anterior = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  try {
    const { POST } = await import('../app/api/assistente/route.ts')
    const r = await POST(
      new Request('http://localhost/api/assistente', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ modo: 'duvida', mensagens: [{ papel: 'pessoa', texto: 'oi' }] }),
      }),
    )
    assert.equal(r.status, 503, 'chave ausente é configuração faltando, não erro do servidor')
    const corpo = await r.json()
    assert.match(corpo.erro, /chave|configurado/i)
    // A mensagem tem de dizer o que fazer. "Algo deu errado" manda a pessoa
    // procurar defeito no lugar errado.
    assert.ok(corpo.erro.length > 20, 'a mensagem precisa explicar, não só falhar')
  } finally {
    if (anterior) process.env.ANTHROPIC_API_KEY = anterior
  }
})

test('POST vindo de outro site é recusado antes de qualquer trabalho', async () => {
  // CSRF. O cookie é SameSite=Lax e já barraria isto no navegador, mas quem
  // aplica o Lax é o navegador — o servidor não tem como saber se aplicou. Esta
  // é a mesma regra conferida do lado que a gente controla.
  //
  // Repare no que o teste NÃO precisa: chave, banco, sessão. A recusa acontece
  // na casca, antes de a rota existir — que é o ponto.
  const { POST } = await import('../app/api/assistente/route.ts')
  const r = await POST(
    new Request('http://localhost/api/assistente', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ modo: 'duvida', mensagens: [{ papel: 'pessoa', texto: 'oi' }] }),
    }),
  )
  assert.equal(r.status, 403)
  assert.match((await r.json()).erro, /não veio desta aplicação/i)
})

test('POST sem Origin nem Sec-Fetch-Site é recusado', async () => {
  // Não é navegador de ninguém: todo navegador em uso manda Origin em POST.
  // É curl, script e robô — o item "bot protection" resolvido pelo que já
  // distingue a nossa tela do resto.
  const { POST } = await import('../app/api/assistente/route.ts')
  const r = await POST(
    new Request('http://localhost/api/assistente', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  )
  assert.equal(r.status, 403)
})
