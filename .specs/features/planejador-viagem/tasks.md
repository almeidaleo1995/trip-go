# Planejador de Viagens em Grupo — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/planejador-viagem/design.md`
**Status**: Approved

---

## Test Coverage Matrix

| Camada de código | Tipo de teste | Runner | Justificativa |
| ---------------- | ------------- | ------ | ------------- |
| `lib/derive.ts` — cálculos puros | unit | `node --test` | Datas, progresso, totais e merge LWW são pura lógica; é aqui que bug silencioso mora. |
| `lib/session.ts` — hash e cookie | unit | `node --test` | Caminho de segurança: hash, verificação em tempo constante, rate limit. |
| `lib/schema.ts` — validação zod | unit | `node --test` | DATA-04 exige apontar o campo exato que falhou. |
| `app/api/**` — rotas | integration | `node --test` contra Neon | AUTH-05 (403 no servidor) e DATA-03 (transação) só se provam de ponta a ponta. |
| `db/schema.sql` | none | — | Verificado pela execução do `db:push`, que falha se o SQL for inválido. |
| `components/**` — UI | none | — | Sem jsdom/Playwright neste projeto. Coberto por typecheck do `next build` e verificação manual das telas. |
| `public/sw.js` | none | — | Comportamento de service worker exige navegador real; verificado manualmente em modo avião. |

## Gate Check Commands

| Gate | Comando | Quando |
| ---- | ------- | ------ |
| quick | `npm run test` | Tarefas que tocam `lib/**` |
| api | `npm run test:api` | Tarefas que tocam `app/api/**` |
| build | `npm run build` | Tarefas que tocam `components/**`, `app/**` de UI, CSS |
| full | `npm run test && npm run test:api && npm run build` | Última tarefa de cada fase |

---

## Execution Plan

Fases rodam em sequência; tarefas dentro da fase rodam em ordem. As dependências são estritamente lineares — a execução é sequencial de qualquer forma, e isso mantém o diagrama e os corpos das tarefas em paridade.

### Phase 1: Fundação — dados, sessão e cálculos

```
T1 → T2 → T3 → T4 → T5 → T6
```

### Phase 2: API e prova de ponta a ponta

```
T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14
```

### Phase 3: Camada cliente offline e casca visual

```
T14 → T15 → T16 → T17 → T18 → T19 → T20
```

### Phase 4: Abas de leitura

```
T20 → T21 → T22 → T23 → T24 → T25 → T26 → T27
```

### Phase 5: Abas de escrita

```
T27 → T28 → T29 → T30
```

### Phase 6: Rede de segurança e entrega

```
T30 → T31 → T32 → T33
```

---

## Task Breakdown

### T1: Schema SQL da viagem

**What**: Criar o schema completo em SQL idempotente, com as 14 tabelas, chaves estrangeiras, checks de enum e índices definidos no design.
**Where**: `db/schema.sql`
**Depends on**: None
**Reuses**: Nada — arquivo novo.
**Requirement**: DATA-01, FIN-05

**Done when**:

- [ ] 14 tabelas criadas com `create table if not exists`
- [ ] `expenses.valor_centavos` é `integer`, nunca float
- [ ] `ocorre_em`, `parte_em`, `chega_em` são `timestamp` sem timezone; `updated_at` é `timestamptz`
- [ ] Índices em `trip_id`, `(trip_id, ocorre_em)` e `(trip_id, criado_em desc)`
- [ ] Rodar o arquivo duas vezes seguidas não gera erro

**Tests**: none
**Gate**: none

**Commit**: `feat(db): schema da viagem em sql idempotente`

---

### T2: Script de aplicação do schema

**What**: Script Node que lê `db/schema.sql` e aplica no Neon, exposto como `npm run db:push`.
**Where**: `scripts/db-push.mjs`
**Depends on**: T1
**Reuses**: `@neondatabase/serverless`

**Done when**:

- [ ] Lê `DATABASE_URL` de `.env.local` via `--env-file`
- [ ] Aplica o schema e imprime as tabelas existentes ao final
- [ ] Falha com mensagem clara se `DATABASE_URL` estiver ausente
- [ ] `npm run db:push` executa sem erro contra o Neon real

**Tests**: none
**Gate**: none

**Commit**: `feat(db): script db:push para aplicar o schema no neon`

---

### T3: Cálculos derivados puros

**What**: Todas as funções de cálculo sem I/O — fase da viagem, próximo compromisso, noites, progresso, totais, merge LWW — com seus testes unitários.
**Where**: `lib/derive.ts`
**Depends on**: T2
**Reuses**: `Intl` da plataforma

**Done when**:

- [ ] `faseDaViagem` cobre antes / durante / depois (HOME-01..03)
- [ ] `proximoCompromisso` ignora datas inválidas e retorna null sem futuros (HOME-04, HOME-05)
- [ ] `noites` e `diasAte` retornam 0 em intervalo invertido, nunca negativo
- [ ] `progressoChecklist` retorna 0 com lista vazia, sem divisão por zero (CHK-05)
- [ ] `progressoChecklist` ignora IDs órfãos (CHK-06)
- [ ] `totaisFinanceiro` soma em centavos inteiros (FIN-05)
- [ ] `mesclarLWW` mantém o `updated_at` mais recente (SYNC-06), com comentário `ponytail:` no teto conhecido
- [ ] Gate check passa: `npm run test`
- [ ] Test count: 20+ testes passam (sem deleções silenciosas)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(lib): calculos derivados puros com testes`

---

### T4: Sessão, hash de PIN e rate limit

**What**: Hash scrypt de PIN, verificação em tempo constante, cookie de sessão assinado por HMAC, guardas de papel e limitador de tentativas — com testes unitários.
**Where**: `lib/session.ts`
**Depends on**: T3
**Reuses**: `node:crypto` (scrypt, timingSafeEqual, createHmac), `next/headers`

**Done when**:

- [ ] `hashPin` gera salt aleatório por PIN; dois hashes do mesmo PIN diferem (AUTH-07)
- [ ] `verifyPin` usa `timingSafeEqual` e aceita só o PIN correto
- [ ] Cookie é httpOnly, sameSite lax, secure, 90 dias (AUTH-02)
- [ ] Cookie com assinatura adulterada é rejeitado
- [ ] `requireAdmin` lança 403 para papel viajante (AUTH-05)
- [ ] `checkRate` bloqueia na 11ª tentativa em 5 minutos (AUTH-04)
- [ ] Gate check passa: `npm run test`
- [ ] Test count: 12+ testes passam (sem deleções silenciosas)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(auth): sessao com scrypt, cookie assinado e rate limit`

---

### T5: Schemas de validação

**What**: Schemas zod do JSON de importação e dos payloads de mutação, com formatador de erro em pt-BR que aponta o caminho do campo.
**Where**: `lib/schema.ts`
**Depends on**: T4
**Reuses**: `zod`

**Done when**:

- [ ] `TripImportSchema` valida as 9 seções, com campos opcionais realmente opcionais (DATA-06)
- [ ] `formatZodError` produz mensagem no formato `voos[2].parte_em: data inválida` (DATA-04)
- [ ] `MutationSchema` rejeita entidade desconhecida e valor negativo (FIN-04)
- [ ] Gate check passa: `npm run test`
- [ ] Test count: 10+ testes passam (sem deleções silenciosas)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(lib): schemas zod de importacao e mutacao`

---

### T6: Cliente do banco e montagem do snapshot

**What**: Cliente Neon único e `getSnapshot(tripId, papel)`, que não executa as queries financeiras quando o papel é viajante.
**Where**: `lib/db.ts`
**Depends on**: T5
**Reuses**: `@neondatabase/serverless`

**Done when**:

- [ ] `getSnapshot` retorna as 9 seções em uma única passada, sem N+1
- [ ] Papel `viajante` retorna `financeiro: null` e as queries de `expenses` não são executadas (AUTH-05)
- [ ] Papel `admin` retorna financeiro populado
- [ ] Nenhum `pin_hash` aparece em qualquer parte do snapshot (AUTH-07)
- [ ] Gate check passa: `npm run test && npm run build`

**Tests**: none
**Gate**: full

**Commit**: `feat(db): cliente neon e montagem do snapshot por papel`

---

### T7: Rota de listagem de viajantes

**What**: `GET /api/viajantes` devolvendo apenas id e nome, para a tela de seleção antes do login.
**Where**: `app/api/viajantes/route.ts`
**Depends on**: T6
**Reuses**: `lib/db.ts`

**Done when**:

- [ ] Responde sem sessão (é a tela pré-login)
- [ ] Devolve só `id` e `nome`; nunca `pin_hash` nem `papel` (AUTH-01)
- [ ] Runtime Node declarado

**Tests**: none
**Gate**: build

**Commit**: `feat(api): rota de listagem de viajantes`

---

### T8: Rota de sessão

**What**: `POST /api/sessao` para login com PIN e `DELETE /api/sessao` para logout.
**Where**: `app/api/sessao/route.ts`
**Depends on**: T7
**Reuses**: `lib/session.ts`, `lib/db.ts`

**Done when**:

- [ ] PIN correto cria cookie e devolve papel (AUTH-02)
- [ ] PIN errado devolve 401 com mensagem genérica "Nome ou PIN incorreto" (AUTH-03)
- [ ] 11ª tentativa em 5 minutos devolve 429 (AUTH-04)
- [ ] `DELETE` limpa o cookie (AUTH-08)

**Tests**: none
**Gate**: build

**Commit**: `feat(api): rota de login e logout por pin`

---

### T9: Rota de snapshot

**What**: `GET /api/snapshot` protegido por sessão, devolvendo o snapshot conforme o papel mais o horário do servidor.
**Where**: `app/api/snapshot/route.ts`
**Depends on**: T8
**Reuses**: `lib/db.ts`, `lib/session.ts`

**Done when**:

- [ ] Sem sessão devolve 401
- [ ] Sessão de viajante recebe `financeiro: null` (AUTH-05)
- [ ] Resposta inclui `server_time` para o cálculo de LWW
- [ ] Cabeçalho `Cache-Control: no-store`

**Tests**: none
**Gate**: build

**Commit**: `feat(api): rota de snapshot por papel`

---

### T10: Rota de importação

**What**: `POST /api/import` restrita a admin, validando o JSON e gravando a viagem inteira numa transação.
**Where**: `app/api/import/route.ts`
**Depends on**: T9
**Reuses**: `lib/schema.ts`, `lib/session.ts`, `lib/db.ts`

**Done when**:

- [ ] Papel viajante recebe 403 (EDIT-06)
- [ ] Corpo acima de 2 MB é rejeitado (DATA-04)
- [ ] JSON inválido devolve 400 com o caminho do campo e não altera o banco (DATA-04)
- [ ] Gravação acontece em transação única; falha parcial faz rollback (DATA-03)
- [ ] PINs do JSON são gravados só como hash (DATA-05)
- [ ] Modo `dry_run` devolve o resumo por seção sem gravar (DATA-02)

**Tests**: none
**Gate**: build

**Commit**: `feat(api): importacao transacional da viagem`

---

### T11: Rota de mutação

**What**: `POST /api/mutate` aplicando a fila de operações com last-write-wins e gravando o histórico de alterações.
**Where**: `app/api/mutate/route.ts`
**Depends on**: T10
**Reuses**: `lib/schema.ts`, `lib/session.ts`, `lib/derive.ts`

**Done when**:

- [ ] Viajante só consegue alterar o próprio `checklist_state` (EDIT-06, CHK-02)
- [ ] Viajante alterando qualquer outra entidade recebe 403 (EDIT-06)
- [ ] Viajante alterando checklist de outro usuário recebe 403
- [ ] Operação com `client_ts` mais antigo que `updated_at` é rejeitada e listada em `rejeitadas` (SYNC-06)
- [ ] Toda alteração de admin grava linha em `change_log` com valor anterior e novo (EDIT-02)
- [ ] Resposta devolve o snapshot atualizado (SYNC-04)

**Tests**: none
**Gate**: build

**Commit**: `feat(api): mutacoes com last-write-wins e historico`

---

### T12: Rota de exportação

**What**: `GET /api/export` devolvendo a viagem no mesmo formato aceito pela importação, sem financeiro para viajantes.
**Where**: `app/api/export/route.ts`
**Depends on**: T11
**Reuses**: `lib/db.ts`, `lib/session.ts`

**Done when**:

- [ ] Saída valida contra `TripImportSchema` (BKP-05)
- [ ] Papel viajante gera arquivo sem nenhum dado financeiro (BKP-04)
- [ ] Inclui `schemaVersion` (BKP-03)
- [ ] Cabeçalho `Content-Disposition` com nome de arquivo datado

**Tests**: none
**Gate**: build

**Commit**: `feat(api): exportacao da viagem em json`

---

### T13: Viagem de demonstração

**What**: JSON de exemplo com dados fictícios curtos preenchendo as 9 seções, para ver todas as telas antes dos dados reais.
**Where**: `db/viagem-demo.json`
**Depends on**: T12
**Reuses**: `lib/schema.ts` como contrato

**Done when**:

- [ ] 3 dias, 2 cidades, 2 países, 2 voos, 2 hospedagens
- [ ] 1 admin e 4 viajantes com PIN fictício
- [ ] Checklist com itens globais e pessoais
- [ ] Documentos, contatos de emergência e custos em pelo menos 3 categorias
- [ ] Pelo menos um voo com escala e um sem, para exercitar o estado "Direto" (CONT-04)
- [ ] Valida contra `TripImportSchema` sem erro

**Tests**: none
**Gate**: none

**Commit**: `feat(db): viagem de demonstracao com dados ficticios`

---

### T14: Testes de integração da API

**What**: Suíte de integração que sobe o servidor, importa a viagem demo e prova login, 403 do financeiro, LWW e round-trip de exportação contra o Neon real.
**Where**: `tests/api.test.mjs`
**Depends on**: T13
**Reuses**: `db/viagem-demo.json`, `node:test`

**Done when**:

- [ ] Login com PIN correto e incorreto verificados (AUTH-02, AUTH-03)
- [ ] Viajante autenticado chamando `/api/snapshot` recebe `financeiro: null` (AUTH-05)
- [ ] Viajante chamando `/api/import` recebe 403 (EDIT-06)
- [ ] Importação com JSON inválido não altera o banco (DATA-03)
- [ ] Operação vencida por LWW volta em `rejeitadas` (SYNC-06)
- [ ] Exportar e reimportar reproduz a mesma viagem (BKP-05)
- [ ] Gate check passa: `npm run test && npm run test:api && npm run build`
- [ ] Test count: 12+ testes de integração passam (sem deleções silenciosas)

**Tests**: integration
**Gate**: full

**Commit**: `test(api): integracao cobrindo papeis, lww e round-trip`

---

### T15: Cache e fila offline

**What**: Wrapper de IndexedDB com os stores de snapshot e fila de escrita, degradando para só-online quando bloqueado.
**Where**: `lib/offline.ts`
**Depends on**: T14
**Reuses**: IndexedDB da plataforma

**Done when**:

- [ ] Dois object stores: `snapshot` (chave única) e `queue` (autoIncrement)
- [ ] Todo acesso em try/catch; IndexedDB bloqueado não lança para o chamador
- [ ] `queueSize()` reflete operações pendentes (SYNC-05)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(offline): cache de snapshot e fila de escrita no indexeddb`

---

### T16: Provedor de estado da viagem

**What**: Contexto React que pinta pelo cache, revalida pela rede, aplica escritas otimistas e esvazia a fila ao reconectar.
**Where**: `components/TripProvider.tsx`
**Depends on**: T15
**Reuses**: `lib/offline.ts`, `lib/derive.ts`

**Done when**:

- [ ] Primeira pintura vem do cache antes da resposta da rede (SYNC-02)
- [ ] `mutate` aplica no estado local antes de enviar (SYNC-03)
- [ ] Escuta `online`/`offline` e esvazia a fila ao reconectar (SYNC-04)
- [ ] Falha de envio mantém a operação na fila (SYNC-05)
- [ ] Expõe `online`, `pendentes` e `ultimaSync`
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(cliente): provedor de estado com sync otimista`

---

### T17: Tokens visuais

**What**: Variáveis CSS do tema — fundo, tinta, cor de destaque configurável, oito pares categóricos, escala de densidade — e as fontes Fira Sans/Fira Code.
**Where**: `app/globals.css`
**Depends on**: T16
**Reuses**: Tailwind v4 do scaffold

**Done when**:

- [ ] Todos os pares categóricos presentes como `--cat-N-fill` e `--cat-N-ink`
- [ ] `--destaque` sobrescrevível em runtime a partir de `trips.cor_destaque` (CONT-02)
- [ ] Contraste de texto sobre fundo ≥ 4.5:1 (UI-03)
- [ ] `prefers-reduced-motion` respeitado
- [ ] Numerais tabulares em horas, códigos e dinheiro
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): tokens de tema vibrante e alto contraste`

---

### T18: Casca de navegação

**What**: Tab bar inferior no mobile e barra lateral no desktop, com a aba Financeiro omitida para viajante e indicador de offline.
**Where**: `components/Shell.tsx`
**Depends on**: T17
**Reuses**: `components/TripProvider.tsx`, `lucide-react`

**Done when**:

- [ ] Abaixo de 768px: tab bar fixa na base, alvos ≥ 44px (UI-01)
- [ ] A partir de 768px: barra lateral fixa à esquerda (UI-02)
- [ ] Papel viajante não vê a aba Financeiro na navegação (AUTH-06)
- [ ] Aba ativa indicada por cor e não só por peso de fonte
- [ ] Aba escolhida persiste ao recarregar (UI-06)
- [ ] Faixa de offline mostra horário do último snapshot (SYNC-02)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): casca de navegacao responsiva`

---

### T19: Tela de login

**What**: Seleção de viajante por botão e teclado numérico de PIN, com erro genérico e estado de bloqueio por rate limit.
**Where**: `components/Login.tsx`
**Depends on**: T18
**Reuses**: `app/api/viajantes`, `app/api/sessao`

**Done when**:

- [ ] Um botão por viajante, ≥ 44px (AUTH-01)
- [ ] Teclado numérico grande, sem depender de teclado do sistema
- [ ] PIN errado mostra "Nome ou PIN incorreto" (AUTH-03)
- [ ] 429 mostra "Muitas tentativas. Tente em 15 minutos."
- [ ] Banco sem viagem leva para a tela de importação
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): tela de login por selecao e pin`

---

### T20: Service worker

**What**: Service worker que cacheia a casca do app e o registro correspondente, para o app abrir em modo avião.
**Where**: `public/sw.js`
**Depends on**: T19
**Reuses**: Cache API da plataforma

**Done when**:

- [ ] Cacheia a casca na instalação e serve dela quando offline (SYNC-07)
- [ ] Nunca cacheia respostas de `/api/**` (o snapshot já vive no IndexedDB)
- [ ] Versão do cache incrementável; caches antigos limpos no `activate`
- [ ] App abre em modo avião após uma visita com rede
- [ ] Gate check passa: `npm run test && npm run test:api && npm run build`

**Tests**: none
**Gate**: full

**Commit**: `feat(offline): service worker da casca do app`

---

### T21: Aba Início

**What**: Painel denso com contagem regressiva, próximo compromisso, resumo, linha do dia e avisos de alteração recente.
**Where**: `components/tabs/Inicio.tsx`
**Depends on**: T20
**Reuses**: `lib/derive.ts`, `components/TripProvider.tsx`

**Done when**:

- [ ] Três fases da viagem exibidas corretamente (HOME-01..03)
- [ ] Próximo compromisso com data, hora e local (HOME-04)
- [ ] "Sem compromissos futuros" quando não há (HOME-05)
- [ ] Resumo com dias, cidades e países distintos (HOME-06)
- [ ] Alterações das últimas 48h no topo, com autor e tempo relativo (HOME-07)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba inicio com painel denso`

---

### T22: Aba Roteiro

**What**: Linha do tempo agrupada por dia, com destaque para dias-âncora.
**Where**: `components/tabs/Roteiro.tsx`
**Depends on**: T21
**Reuses**: `lib/derive.ts`

**Done when**:

- [ ] Ordenado por data e hora, agrupado por dia (CONT-01)
- [ ] Eventos âncora destacados com a cor de destaque e rótulo de tipo (CONT-02)
- [ ] Datas em pt-BR via `Intl` (UI-04)
- [ ] Estado vazio tratado (CONT-09)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba roteiro em linha do tempo`

---

### T23: Aba Voos

**What**: Cartões de voo com companhia, número, trechos, horários, duração, escalas e localizador copiável.
**Where**: `components/tabs/Voos.tsx`
**Depends on**: T22
**Reuses**: `lib/derive.ts`

**Done when**:

- [ ] Todos os campos do CONT-03 presentes no cartão
- [ ] Voo sem escala mostra "Direto" (CONT-04)
- [ ] Localizador com botão de copiar (CONT-05)
- [ ] Estado vazio tratado (CONT-09)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba voos com cartoes de trecho`

---

### T24: Aba Hospedagem

**What**: Lista de estadias com noites calculadas, endereço e link.
**Where**: `components/tabs/Hospedagem.tsx`
**Depends on**: T23
**Reuses**: `lib/derive.ts` (`noites`)

**Done when**:

- [ ] Noites calculadas das datas, nunca digitadas (CONT-06)
- [ ] Link renderizado só quando existe (CONT-06)
- [ ] Estado vazio tratado (CONT-09)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba hospedagem`

---

### T25: Aba Cidades e Países

**What**: Lista de lugares com país, dias e notas, cada cidade com sua cor categórica estável.
**Where**: `components/tabs/Lugares.tsx`
**Depends on**: T24
**Reuses**: tokens categóricos de `app/globals.css`

**Done when**:

- [ ] Cidade, país, dias e notas exibidos (CONT-07)
- [ ] Cor da cidade estável entre recarregamentos
- [ ] Cidades homônimas em países diferentes contadas como distintas
- [ ] Estado vazio tratado (CONT-09)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba cidades e paises`

---

### T26: Aba Documentos

**What**: Lista de rótulo e valor com renderização por tipo — texto, link e telefone.
**Where**: `components/tabs/Documentos.tsx`
**Depends on**: T25
**Reuses**: `components/TripProvider.tsx`

**Done when**:

- [ ] `tipo: "link"` vira link; `tipo: "telefone"` vira `tel:` (CONT-08)
- [ ] Valores longos com botão de copiar
- [ ] Estado vazio tratado (CONT-09)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba documentos`

---

### T27: Aba Emergência

**What**: Telefones e números críticos em corpo maior, com discagem por toque, servidos do cache offline.
**Where**: `components/tabs/Emergencia.tsx`
**Depends on**: T26
**Reuses**: `components/TripProvider.tsx`

**Done when**:

- [ ] Telefones locais, consulado, apólice e contato de cada viajante (EMG-01)
- [ ] Cada telefone é link `tel:` acionável (EMG-02)
- [ ] Funciona a partir do cache sem rede (EMG-03)
- [ ] Fonte maior que a das demais abas (EMG-04)
- [ ] Gate check passa: `npm run test && npm run test:api && npm run build`

**Tests**: none
**Gate**: full

**Commit**: `feat(ui): aba emergencia`

---

### T28: Aba Checklist

**What**: Listas global e pessoal com marcação otimista, contador do grupo nos itens globais e barra de progresso.
**Where**: `components/tabs/Checklist.tsx`
**Depends on**: T27
**Reuses**: `lib/derive.ts` (`progressoChecklist`), `TripProvider.mutate`

**Done when**:

- [ ] Duas listas: globais e pessoais (CHK-01)
- [ ] Marcar reflete na hora e enfileira (CHK-02)
- [ ] Itens globais mostram quantos viajantes concluíram (CHK-03)
- [ ] Barra de progresso em inteiro (CHK-04)
- [ ] Lista vazia mostra 0% sem erro (CHK-05)
- [ ] Aviso de que marcações sincronizam entre aparelhos quando há rede
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba checklist com sync otimista`

---

### T29: Aba Financeiro

**What**: Tabela de custos por categoria com subtotais e total geral, editável pelo admin, em centavos.
**Where**: `components/tabs/Financeiro.tsx`
**Depends on**: T28
**Reuses**: `lib/derive.ts` (`totaisFinanceiro`)

**Done when**:

- [ ] Custos agrupados por categoria com subtotal e total geral (FIN-02)
- [ ] Criar, editar e remover recalcula na hora (FIN-03)
- [ ] Valor não numérico ou negativo é rejeitado, mantendo o anterior (FIN-04)
- [ ] Valores formatados com `Intl.NumberFormat` pt-BR na moeda da viagem (FIN-06)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba financeiro editavel`

---

### T30: Editor do admin

**What**: Folha de edição genérica para criar, alterar e remover registros de qualquer seção, com campos mínimos e anotação livre.
**Where**: `components/EditorSheet.tsx`
**Depends on**: T29
**Reuses**: `TripProvider.mutate`, `lib/schema.ts`

**Done when**:

- [ ] Cobre roteiro, voos, hospedagens, lugares, documentos, emergência e checklist (EDIT-01)
- [ ] Só campos mínimos obrigatórios; o resto aceita vazio (EDIT-03)
- [ ] Campo de anotação livre presente onde o design prevê (EDIT-04)
- [ ] Remover pede confirmação mostrando o que será removido (EDIT-05)
- [ ] Invisível para papel viajante
- [ ] Gate check passa: `npm run test && npm run test:api && npm run build`

**Tests**: none
**Gate**: full

**Commit**: `feat(ui): folha de edicao do admin`

---

### T31: PDF de bolso

**What**: Folha de estilo de impressão e o gatilho que abre o diálogo com o essencial em uma página.
**Where**: `components/PdfBolso.tsx`
**Depends on**: T30
**Reuses**: `window.print()`, `@media print`

**Done when**:

- [ ] Uma página com voos, endereços, contatos de emergência e apólice (BKP-01)
- [ ] Navegação e botões ocultos na impressão (BKP-02)
- [ ] Layout em coluna única, sem grid complexo
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): pdf de bolso por impressao`

---

### T32: Tela de importação e exportação

**What**: Tela de admin para subir o JSON com pré-visualização por seção antes de gravar, e baixar o backup.
**Where**: `components/tabs/Dados.tsx`
**Depends on**: T31
**Reuses**: `app/api/import`, `app/api/export`

**Done when**:

- [ ] Upload mostra o resumo por seção antes de gravar (DATA-02)
- [ ] Confirmação explícita antes da gravação (DATA-03)
- [ ] Erro de validação aponta o campo (DATA-04)
- [ ] Botão de exportar baixa o JSON datado (BKP-03)
- [ ] Invisível para papel viajante
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): tela de importacao e exportacao`

---

### T33: README de operação e deploy

**What**: Documento com o passo a passo de deploy na Vercel, variáveis de ambiente, como trocar de viagem e o lembrete de rotacionar a senha do Neon.
**Where**: `README.md`
**Depends on**: T32
**Reuses**: `.env.example`

**Done when**:

- [ ] Passo a passo de deploy na Vercel com as variáveis necessárias
- [ ] Como gerar e subir o JSON de uma viagem nova
- [ ] Aviso de rotacionar a senha do Neon, em destaque
- [ ] Limitações declaradas: LWW, rate limit por instância, PIN de 4 dígitos
- [ ] Gate check passa: `npm run test && npm run test:api && npm run build`

**Tests**: none
**Gate**: full

**Commit**: `docs: readme de operacao, deploy e limitacoes`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6

Phase 1:  T1 → T2 → T3 → T4 → T5 → T6
Phase 2:  T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14
Phase 3:  T15 → T16 → T17 → T18 → T19 → T20
Phase 4:  T21 → T22 → T23 → T24 → T25 → T26 → T27
Phase 5:  T28 → T29 → T30
Phase 6:  T31 → T32 → T33
```

Execução estritamente sequencial: uma tarefa por vez, em ordem.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: schema SQL | 1 arquivo | ✅ Granular |
| T3: cálculos derivados | 1 módulo puro | ✅ Granular |
| T4: sessão | 1 módulo | ✅ Granular |
| T7–T12: rotas | 1 rota cada | ✅ Granular |
| T21–T29: abas | 1 componente cada | ✅ Granular |
| T30: editor | 1 componente | ✅ Granular |

Nenhuma tarefa toca mais de um arquivo de produção.

---

## Diagram-Definition Cross-Check

| Task | Depends On (corpo) | Diagrama | Status |
| ---- | ------------------ | -------- | ------ |
| T1 | None | início | ✅ |
| T2..T33 | tarefa imediatamente anterior | cadeia linear | ✅ |

Dependências são estritamente lineares e apontam sempre para trás. Nenhuma tarefa depende de fase posterior.

---

## Test Co-location Validation

| Task | Camada | Matriz exige | Tarefa diz | Status |
| ---- | ------ | ------------ | ---------- | ------ |
| T1 | `db/schema.sql` | none | none | ✅ |
| T2 | script | none | none | ✅ |
| T3 | `lib/derive.ts` | unit | unit | ✅ |
| T4 | `lib/session.ts` | unit | unit | ✅ |
| T5 | `lib/schema.ts` | unit | unit | ✅ |
| T6 | `lib/db.ts` (I/O) | none | none | ✅ |
| T7–T12 | `app/api/**` | integration | none | ⚠️ resolvido por merge-forward em T14 |
| T13 | dados | none | none | ✅ |
| T14 | `app/api/**` | integration | integration | ✅ |
| T15–T33 | `components/**` | none | none | ✅ |

**Nota sobre T7–T12**: as rotas não são testáveis isoladamente — a suíte precisa de servidor de pé e de uma viagem importada, o que só existe depois de T13. Aplicado o merge-forward previsto no processo: os testes de integração das seis rotas vivem em T14, a primeira tarefa em que são executáveis. Nenhum teste foi adiado para "depois"; T14 é parte da mesma fase e a fase não fecha sem ele.
