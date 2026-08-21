# Planejador de Viagens em Grupo

App de viagem para 5 pessoas: roteiro, voos, cruzeiro, hospedagem, checklist, documentos, emergência e financeiro. Funciona offline, sincroniza entre os aparelhos quando há rede.

Next.js (App Router) + Neon Postgres, feito para rodar na Vercel.

---

## ⚠️ Antes de qualquer outra coisa

**Rotacione a senha do Neon.** A connection string usada no desenvolvimento passou por uma conversa de chat e está no histórico dela. Leva 10 segundos:

1. Console do Neon → seu projeto → **Roles** → `neondb_owner` → **Reset password**
2. Copie a nova connection string
3. Atualize `.env.local` (local) e a variável de ambiente na Vercel (produção)

Enquanto isso não for feito, considere que qualquer pessoa com acesso àquele histórico tem acesso total ao banco.

---

## Rodar localmente

```bash
npm install
cp .env.example .env.local     # e preencha
npm run db:push                # cria as 16 tabelas (idempotente)
npm run dev
```

`.env.local`:

```
DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"
SESSION_SECRET="<64 hex>"      # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`.env.local` está no `.gitignore` e nunca deve ser commitado.

## Deploy na Vercel

1. `vercel` ou importe o repositório em vercel.com
2. Em **Settings → Environment Variables**, adicione `DATABASE_URL` e `SESSION_SECRET`
3. Deploy. O `db:push` **não** roda no build — aplique o schema você mesmo (`npm run db:push`) apontando para o mesmo banco

O free tier do Neon suspende o banco por inatividade: a primeira requisição depois de um tempo parado demora alguns segundos. O cache local cobre isso — o app pinta antes de a rede responder.

## Cadastrar uma viagem

**Pela interface** (sem terminal): entre como admin → aba **Dados** → *Importar viagem*. Mostra um resumo por seção e só grava depois que você confirma. Com o banco vazio, a própria tela de login oferece a importação — é o único caminho de bootstrap, já que ainda não existe admin.

**A partir de PDFs**: peça a conversão ao Claude Code neste repositório. A skill `viagem-para-json` extrai o texto, mapeia para o formato do app, valida contra o schema real e aponta contradições entre documentos em vez de escolher em silêncio.

```bash
node .claude/skills/viagem-para-json/scripts/validar.mjs db/europa-2027.json
```

**Do zero, na mão**: crie a viagem e os viajantes pela aba Dados, e cada seção pelo botão de adicionar da própria aba.

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção (inclui typecheck) |
| `npm run test` | 88 testes unitários (`node --test`, sem framework) |
| `npm run test:api` | 26 testes de integração — **precisa do `npm run dev` rodando** |
| `npm run db:push` | Aplica `db/schema.sql` no Neon |

## Como funciona

```
navegador
  ├─ IndexedDB      snapshot + fila de escritas offline
  ├─ service worker casca do app (nunca /api/**)
  └─ /api/*         Route Handlers (Node runtime)
        └─ Neon Postgres   ← a credencial vive só aqui
```

- **Leitura**: um snapshot inteiro por vez, não recurso a recurso. Elimina N+1 e torna o cache offline trivial.
- **Escrita**: otimista. A tela muda na hora, a operação vai para uma fila local e sobe quando há rede. Offline e online usam o mesmo caminho de código.
- **Papéis**: `admin` vê tudo e edita tudo; `viajante` vê tudo menos o Financeiro e só marca o próprio checklist.

## Limitações — leia antes de confiar

Nada aqui é surpresa escondida; são escolhas deliberadas com teto conhecido.

| Limitação | O que significa na prática |
| --- | --- |
| **PIN de 4 dígitos** | 10.000 combinações. O modelo de ameaça é "meu primo curioso", não invasor determinado. Passar para 6 dígitos é uma linha em `lib/schema.ts`. |
| **Rate limit por instância** | O contador de tentativas vive na memória do processo. Em serverless, cada instância tem o seu, então um atacante distribuído consegue mais que 10 tentativas por janela. Mitigação: mover o contador para uma tabela no Neon. |
| **Last-write-wins** | Duas pessoas editando o **mesmo registro** dentro da mesma janela de sync: a escrita mais antiga é descartada. O histórico de alterações guarda as duas, então nada some sem rastro. |
| **Mapa sem contorno de continente** | O mapa do Início desenha a rota e os pinos sobre um gradiente abstrato. Costa real exige um GeoJSON simplificado (~20–50 KB) de fonte confiável. |
| **PIN não vai no export** | O backup JSON não carrega PINs. Quem restaurar num banco vazio precisa definir os PINs de novo pela aba Dados. É intencional: o arquivo circula por e-mail e pen drive. |
| **Importar arquiva a viagem atual** | A viagem anterior fica no banco marcada como inativa, não é apagada — mas o app não tem tela para trazê-la de volta. Exporte antes. |

O Financeiro, ao contrário dos itens acima, **é** protegido de verdade: o endpoint devolve 403 para sessão de viajante e o snapshot dele nem executa as queries de custo. Há teste de integração cobrindo exatamente isso.

## Estrutura

```
app/api/          6 rotas (viajantes, sessao, snapshot, import, mutate, export)
components/       TripProvider (estado), Shell (navegação), tabs/ (10 abas)
lib/derive.ts     todo cálculo puro — é o que tem teste unitário de verdade
lib/schema.ts     contrato zod: formato de importação e das mutações
lib/session.ts    scrypt, cookie assinado, guardas de papel, rate limit
db/schema.sql     16 tabelas, idempotente
.specs/           spec (89 requisitos), design e as 37 tarefas
.claude/skills/   skill de conversão PDF → JSON
```

## Dependências

Quatro, além do scaffold do Next: `@neondatabase/serverless`, `zod`, `lucide-react`, `next`.

Deliberadamente **fora**: nenhuma biblioteca de PDF (`window.print()` + `@media print`), de hash (`node:crypto` scrypt), de auth (cookie assinado com HMAC), de IndexedDB, de datas (`Intl`) ou de service worker.
