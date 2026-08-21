# Planejador de Viagens em Grupo - Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/planejador-viagem/design.md`
**Status**: Draft - revisao 3 (referencias visuais, CRUD completo, cruzeiro, mapa)

---

## Test Coverage Matrix

| Camada de codigo | Tipo de teste | Runner | Justificativa |
| ---------------- | ------------- | ------ | ------------- |
| `lib/derive.ts` - calculos puros | unit | `node --test` | Datas, progresso, totais, projecao do mapa e merge LWW sao pura logica; e onde bug silencioso mora. |
| `lib/session.ts` - hash e cookie | unit | `node --test` | Caminho de seguranca: hash, verificacao em tempo constante, rate limit. |
| `lib/schema.ts` - validacao zod | unit | `node --test` | DATA-04 exige apontar o campo exato que falhou. |
| `app/api/**` - rotas | integration | `node --test` contra Neon | AUTH-05 (403 no servidor), ADM-05 e DATA-03 (transacao) so se provam de ponta a ponta. |
| `db/schema.sql` | none | - | Verificado pela execucao do `db:push`, que falha se o SQL for invalido. |
| `components/**` - UI | none | - | Sem jsdom/Playwright neste projeto. Coberto por typecheck do `next build` e verificacao manual das telas. |
| `public/sw.js` | none | - | Comportamento de service worker exige navegador real; verificado manualmente em modo aviao. |

## Gate Check Commands

| Gate | Comando | Quando |
| ---- | ------- | ------ |
| quick | `npm run test` | Tarefas que tocam `lib/**` |
| api | `npm run test:api` | Tarefas que tocam `app/api/**` |
| build | `npm run build` | Tarefas que tocam `components/**`, `app/**` de UI, CSS |
| full | `npm run test && npm run test:api && npm run build` | Ultima tarefa de cada fase |

---

## Execution Plan

Fases rodam em sequencia; tarefas dentro da fase rodam em ordem. As dependencias sao estritamente lineares - a execucao e sequencial de qualquer forma, e isso mantem o diagrama e os corpos das tarefas em paridade permanente.

### Phase 1: Fundacao - dados, sessao e calculos

```
T1 -> T2 -> T3 -> T4 -> T5 -> T6
```

### Phase 2: API e prova de ponta a ponta

```
T6 -> T7 -> T8 -> T9 -> T10 -> T11 -> T12 -> T13 -> T14
```

### Phase 3: Camada cliente offline e casca visual

```
T14 -> T15 -> T16 -> T17 -> T18 -> T19 -> T20
```

### Phase 4: Mapa e abas de leitura

```
T20 -> T21 -> T22 -> T23 -> T24 -> T25 -> T26 -> T27 -> T28 -> T29
```

### Phase 5: Escrita e gestao

```
T29 -> T30 -> T31 -> T32 -> T33 -> T34
```

### Phase 6: Rede de seguranca e entrega

```
T34 -> T35 -> T36 -> T37
```

---

## Task Breakdown

### T1: Schema SQL da viagem

**What**: Criar o schema completo em SQL idempotente, com as 16 tabelas, chaves estrangeiras, checks de enum e indices definidos no design.
**Where**: `db/schema.sql`
**Depends on**: None
**Reuses**: Nada - arquivo novo.
**Requirement**: DATA-01, FIN-05, CRZ-03

**Done when**:

- [ ] 16 tabelas criadas com `create table if not exists`, incluindo `cruises` e `cruise_ports`
- [ ] `places` tem `lat`, `lon` e `ordem` para o mapa da rota (MAP-01)
- [ ] `expenses.valor_centavos` e `integer`, nunca float
- [ ] `ocorre_em`, `parte_em`, `chega_em`, `embarque_em` sao `timestamp` sem timezone; `updated_at` e `timestamptz`
- [ ] Indices em `trip_id`, `(trip_id, ocorre_em)` e `(trip_id, criado_em desc)`
- [ ] Rodar o arquivo duas vezes seguidas nao gera erro

**Tests**: none
**Gate**: none

**Commit**: `feat(db): schema da viagem em sql idempotente`

---

### T2: Script de aplicacao do schema

**What**: Script Node que le `db/schema.sql` e aplica no Neon, exposto como `npm run db:push`.
**Where**: `scripts/db-push.mjs`
**Depends on**: T1
**Reuses**: `@neondatabase/serverless`
**Requirement**: DATA-01

**Done when**:

- [ ] Le `DATABASE_URL` de `.env.local` via `--env-file`
- [ ] Aplica o schema e imprime as tabelas existentes ao final
- [ ] Falha com mensagem clara se `DATABASE_URL` estiver ausente
- [ ] `npm run db:push` executa sem erro contra o Neon real

**Tests**: none
**Gate**: none

**Commit**: `feat(db): script db:push para aplicar o schema no neon`

---

### T3: Calculos derivados puros

**What**: Todas as funcoes de calculo sem I/O - fase da viagem, proximo compromisso, noites, progresso, totais, projecao do mapa, merge LWW - com seus testes unitarios.
**Where**: `lib/derive.ts`
**Depends on**: T2
**Reuses**: `Intl` da plataforma
**Requirement**: HOME-01..06, CHK-04..06, FIN-05, CRZ-06, MAP-01, MAP-02, SYNC-06

**Done when**:

- [ ] `faseDaViagem` cobre antes / durante / depois (HOME-01..03)
- [ ] `proximoCompromisso` ignora datas invalidas e retorna null sem futuros (HOME-04, HOME-05)
- [ ] `noites` e `diasAte` retornam 0 em intervalo invertido, nunca negativo
- [ ] `noitesABordo` calcula das datas de embarque e desembarque (CRZ-06)
- [ ] `progressoChecklist` retorna 0 com lista vazia, sem divisao por zero (CHK-05)
- [ ] `progressoChecklist` ignora IDs orfaos (CHK-06)
- [ ] `totaisFinanceiro` soma em centavos inteiros (FIN-05)
- [ ] `projetarRota` enquadra qualquer conjunto de coordenadas no viewBox, inclusive um ponto so (MAP-02)
- [ ] `mesclarLWW` mantem o `updated_at` mais recente (SYNC-06), com comentario `ponytail:` no teto conhecido
- [ ] Gate check passa: `npm run test`
- [ ] Test count: 26+ testes passam (sem delecoes silenciosas)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(lib): calculos derivados puros com testes`

---

### T4: Sessao, hash de PIN e rate limit

**What**: Hash scrypt de PIN, verificacao em tempo constante, cookie de sessao assinado por HMAC, guardas de papel e limitador de tentativas - com testes unitarios.
**Where**: `lib/session.ts`
**Depends on**: T3
**Reuses**: `node:crypto` (scrypt, timingSafeEqual, createHmac), `next/headers`
**Requirement**: AUTH-02..05, AUTH-07

**Done when**:

- [ ] `hashPin` gera salt aleatorio por PIN; dois hashes do mesmo PIN diferem (AUTH-07)
- [ ] `verifyPin` usa `timingSafeEqual` e aceita so o PIN correto
- [ ] Cookie e httpOnly, sameSite lax, secure, 90 dias (AUTH-02)
- [ ] Cookie com assinatura adulterada e rejeitado
- [ ] `requireAdmin` lanca 403 para papel viajante (AUTH-05)
- [ ] `checkRate` bloqueia na 11a tentativa em 5 minutos (AUTH-04)
- [ ] Gate check passa: `npm run test`
- [ ] Test count: 12+ testes passam (sem delecoes silenciosas)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(auth): sessao com scrypt, cookie assinado e rate limit`

---

### T5: Schemas de validacao

**What**: Schemas zod do JSON de importacao e dos payloads de mutacao de todas as entidades, com formatador de erro em pt-BR que aponta o caminho do campo.
**Where**: `lib/schema.ts`
**Depends on**: T4
**Reuses**: `zod`
**Requirement**: DATA-04, DATA-06, FIN-04, ADM-06

**Done when**:

- [ ] `TripImportSchema` valida as 11 secoes, incluindo cruzeiro e portos, com campos opcionais realmente opcionais (DATA-06)
- [ ] `formatZodError` produz mensagem no formato `voos[2].parte_em: data invalida` (DATA-04)
- [ ] `MutationSchema` cobre as 13 entidades editaveis e rejeita entidade desconhecida (ADM-06)
- [ ] `MutationSchema` rejeita valor monetario negativo ou nao numerico (FIN-04)
- [ ] Gate check passa: `npm run test`
- [ ] Test count: 14+ testes passam (sem delecoes silenciosas)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(lib): schemas zod de importacao e mutacao`

---

### T6: Cliente do banco e montagem do snapshot

**What**: Cliente Neon unico e `getSnapshot(tripId, papel)`, que nao executa as queries financeiras quando o papel e viajante.
**Where**: `lib/db.ts`
**Depends on**: T5
**Reuses**: `@neondatabase/serverless`
**Requirement**: AUTH-05, AUTH-07, DATA-01

**Done when**:

- [ ] `getSnapshot` retorna as 11 secoes em uma unica passada, sem N+1
- [ ] Papel `viajante` retorna `financeiro: null` e as queries de `expenses` nao sao executadas (AUTH-05)
- [ ] Papel `admin` retorna financeiro populado
- [ ] Nenhum `pin_hash` aparece em qualquer parte do snapshot (AUTH-07)
- [ ] Gate check passa: `npm run test && npm run build`

**Tests**: none
**Gate**: full

**Commit**: `feat(db): cliente neon e montagem do snapshot por papel`

---

### T7: Rota de listagem de viajantes

**What**: `GET /api/viajantes` devolvendo apenas id e nome, para a tela de selecao antes do login.
**Where**: `app/api/viajantes/route.ts`
**Depends on**: T6
**Reuses**: `lib/db.ts`
**Requirement**: AUTH-01

**Done when**:

- [ ] Responde sem sessao (e a tela pre-login)
- [ ] Devolve so `id` e `nome`; nunca `pin_hash` nem `papel` (AUTH-01)
- [ ] Runtime Node declarado

**Tests**: none
**Gate**: build

**Commit**: `feat(api): rota de listagem de viajantes`

---

### T8: Rota de sessao

**What**: `POST /api/sessao` para login com PIN e `DELETE /api/sessao` para logout.
**Where**: `app/api/sessao/route.ts`
**Depends on**: T7
**Reuses**: `lib/session.ts`, `lib/db.ts`
**Requirement**: AUTH-02..04, AUTH-08

**Done when**:

- [ ] PIN correto cria cookie e devolve papel (AUTH-02)
- [ ] PIN errado devolve 401 com mensagem generica "Nome ou PIN incorreto" (AUTH-03)
- [ ] 11a tentativa em 5 minutos devolve 429 (AUTH-04)
- [ ] `DELETE` limpa o cookie (AUTH-08)

**Tests**: none
**Gate**: build

**Commit**: `feat(api): rota de login e logout por pin`

---

### T9: Rota de snapshot

**What**: `GET /api/snapshot` protegido por sessao, devolvendo o snapshot conforme o papel mais o horario do servidor.
**Where**: `app/api/snapshot/route.ts`
**Depends on**: T8
**Reuses**: `lib/db.ts`, `lib/session.ts`
**Requirement**: AUTH-05, SYNC-01

**Done when**:

- [ ] Sem sessao devolve 401
- [ ] Sessao de viajante recebe `financeiro: null` (AUTH-05)
- [ ] Resposta inclui `server_time` para o calculo de LWW
- [ ] Cabecalho `Cache-Control: no-store`

**Tests**: none
**Gate**: build

**Commit**: `feat(api): rota de snapshot por papel`

---

### T10: Rota de importacao

**What**: `POST /api/import` restrita a admin, validando o JSON e gravando a viagem inteira numa transacao.
**Where**: `app/api/import/route.ts`
**Depends on**: T9
**Reuses**: `lib/schema.ts`, `lib/session.ts`, `lib/db.ts`
**Requirement**: DATA-02..05, ADM-08

**Done when**:

- [ ] Papel viajante recebe 403 (ADM-08)
- [ ] Corpo acima de 2 MB e rejeitado (DATA-04)
- [ ] JSON invalido devolve 400 com o caminho do campo e nao altera o banco (DATA-04)
- [ ] Gravacao acontece em transacao unica; falha parcial faz rollback (DATA-03)
- [ ] PINs do JSON sao gravados so como hash (DATA-05)
- [ ] Modo `dry_run` devolve o resumo por secao sem gravar (DATA-02)

**Tests**: none
**Gate**: build

**Commit**: `feat(api): importacao transacional da viagem`

---

### T11: Rota de mutacao

**What**: `POST /api/mutate` aplicando a fila de operacoes com last-write-wins sobre as 13 entidades editaveis, gravando o historico de alteracoes.
**Where**: `app/api/mutate/route.ts`
**Depends on**: T10
**Reuses**: `lib/schema.ts`, `lib/session.ts`, `lib/derive.ts`
**Requirement**: EDIT-01..02, EDIT-06, CHK-02, SYNC-04, SYNC-06, ADM-01..08

**Done when**:

- [ ] Cobre as 13 entidades: viagem, viajantes, roteiro, voos, escalas, cruzeiro, portos, hospedagens, lugares, checklist, documentos, emergencia, categorias e custos (ADM-06)
- [ ] Viajante so consegue alterar o proprio `checklist_state` (EDIT-06, CHK-02)
- [ ] Viajante alterando qualquer outra entidade recebe 403 (ADM-08)
- [ ] Viajante alterando checklist de outro usuario recebe 403
- [ ] Remover o ultimo admin e recusado (ADM-05)
- [ ] Definir PIN grava so o hash e devolve o texto puro uma unica vez (ADM-04)
- [ ] Operacao com `client_ts` mais antigo que `updated_at` e rejeitada e listada em `rejeitadas` (SYNC-06)
- [ ] Toda alteracao de admin grava linha em `change_log` com valor anterior e novo (EDIT-02)
- [ ] Resposta devolve o snapshot atualizado (SYNC-04)

**Tests**: none
**Gate**: build

**Commit**: `feat(api): mutacoes com last-write-wins e historico`

---

### T12: Rota de exportacao

**What**: `GET /api/export` devolvendo a viagem no mesmo formato aceito pela importacao, sem financeiro para viajantes.
**Where**: `app/api/export/route.ts`
**Depends on**: T11
**Reuses**: `lib/db.ts`, `lib/session.ts`
**Requirement**: BKP-03..05

**Done when**:

- [ ] Saida valida contra `TripImportSchema` (BKP-05)
- [ ] Papel viajante gera arquivo sem nenhum dado financeiro (BKP-04)
- [ ] Inclui `schemaVersion` (BKP-03)
- [ ] Cabecalho `Content-Disposition` com nome de arquivo datado

**Tests**: none
**Gate**: build

**Commit**: `feat(api): exportacao da viagem em json`

---

### T13: Viagem de demonstracao

**What**: JSON da viagem real do usuario - Europa 2027, cruzeiro MSC Preziosa - extraido dos dois PDFs pela skill de conversao.
**Where**: `db/viagem-demo.json`
**Depends on**: T12
**Reuses**: `lib/schema.ts` como contrato
**Requirement**: DATA-06, CRZ-03..05, MAP-01

**Done when**:

- [ ] 17 dias, 7 paises, 30/12/2026 a 15/01/2027, fiel aos PDFs
- [ ] Cruzeiro MSC Preziosa com Hamburgo, Zeebrugge, Roterda, Le Havre e Southampton, em ordem (CRZ-04)
- [ ] Pelo menos uma escala marcada como dia no mar (CRZ-05)
- [ ] Todas as cidades com `lat` e `lon` para o mapa (MAP-01)
- [ ] Os 5 viajantes reais dos PDFs, com PIN inicial ficticio a ser trocado pelo admin
- [ ] Checklist com itens globais e pessoais; documentos, emergencia e custos em 3+ categorias
- [ ] Pelo menos um voo com escala e um sem, para exercitar o estado "Direto" (CONT-04)
- [ ] Valida contra `TripImportSchema` sem erro

**Tests**: none
**Gate**: none

**Commit**: `feat(db): viagem europa 2027 extraida dos pdfs`

---

### T14: Testes de integracao da API

**What**: Suite de integracao que sobe o servidor, importa a viagem demo e prova login, 403 do financeiro, LWW e round-trip de exportacao contra o Neon real.
**Where**: `tests/api.test.mjs`
**Depends on**: T13
**Reuses**: `db/viagem-demo.json`, `node:test`
**Requirement**: AUTH-02, AUTH-03, AUTH-05, DATA-03, SYNC-06, BKP-05, ADM-08

**Done when**:

- [ ] Login com PIN correto e incorreto verificados (AUTH-02, AUTH-03)
- [ ] Viajante autenticado chamando `/api/snapshot` recebe `financeiro: null` (AUTH-05)
- [ ] Viajante chamando `/api/import` e `/api/mutate` fora do proprio checklist recebe 403 (ADM-08)
- [ ] Importacao com JSON invalido nao altera o banco (DATA-03)
- [ ] Operacao vencida por LWW volta em `rejeitadas` (SYNC-06)
- [ ] Remover o ultimo admin e recusado (ADM-05)
- [ ] Exportar e reimportar reproduz a mesma viagem (BKP-05)
- [ ] Gate check passa: `npm run test && npm run test:api && npm run build`
- [ ] Test count: 14+ testes de integracao passam (sem delecoes silenciosas)

**Tests**: integration
**Gate**: full

**Commit**: `test(api): integracao cobrindo papeis, lww e round-trip`

---

### T15: Cache e fila offline

**What**: Wrapper de IndexedDB com os stores de snapshot e fila de escrita, degradando para so-online quando bloqueado.
**Where**: `lib/offline.ts`
**Depends on**: T14
**Reuses**: IndexedDB da plataforma
**Requirement**: SYNC-02, SYNC-05

**Done when**:

- [ ] Dois object stores: `snapshot` (chave unica) e `queue` (autoIncrement)
- [ ] Todo acesso em try/catch; IndexedDB bloqueado nao lanca para o chamador
- [ ] `queueSize()` reflete operacoes pendentes (SYNC-05)
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
**Requirement**: SYNC-02..05

**Done when**:

- [ ] Primeira pintura vem do cache antes da resposta da rede (SYNC-02)
- [ ] `mutate` aplica no estado local antes de enviar (SYNC-03)
- [ ] Escuta `online`/`offline` e esvazia a fila ao reconectar (SYNC-04)
- [ ] Falha de envio mantem a operacao na fila (SYNC-05)
- [ ] Expoe `online`, `pendentes` e `ultimaSync`
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(cliente): provedor de estado com sync otimista`

---

### T17: Tokens visuais

**What**: Variaveis CSS do tema teal calmo das referencias - fundo, tinta, destaque configuravel, badges de tipo, escala de espacamento - e a fonte Inter auto-hospedada.
**Where**: `app/globals.css`
**Depends on**: T16
**Reuses**: Tailwind v4 do scaffold, `next/font`
**Requirement**: UI-03, CONT-02, BKP-01

**Done when**:

- [ ] Destaque `#0F766E` como padrao, sobrescrivel por `trips.cor_destaque` em runtime (CONT-02)
- [ ] `#0D9488` e `#94A3B8` nunca aplicados a texto - reprovam AA (3.74 e 2.44)
- [ ] Badges de tipo Voo, Hospedagem, Cruzeiro e Passeio, todos >= 4.5:1 (UI-03)
- [ ] Inter via `next/font`, auto-hospedada, sem requisicao de rede em uso
- [ ] Numerais tabulares na contagem, horas e dinheiro
- [ ] `prefers-reduced-motion` respeitado
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): tokens do tema teal das referencias`

---

### T18: Casca de navegacao

**What**: Tab bar inferior no mobile e barra lateral no desktop, montadas a partir dos dados, com Financeiro oculto para viajante e indicador de offline.
**Where**: `components/Shell.tsx`
**Depends on**: T17
**Reuses**: `components/TripProvider.tsx`, `lucide-react`
**Requirement**: UI-01, UI-02, UI-06, AUTH-06, CRZ-01, CRZ-02, SYNC-02

**Done when**:

- [ ] Abaixo de 768px: tab bar fixa na base, alvos >= 44px (UI-01)
- [ ] A partir de 768px: barra lateral fixa a esquerda com icone e rotulo (UI-02)
- [ ] Papel viajante nao ve a aba Financeiro na navegacao (AUTH-06)
- [ ] Aba Cruzeiro so aparece se a viagem tiver cruzeiro (CRZ-01, CRZ-02)
- [ ] Icones outline do `lucide-react`, nunca emoji
- [ ] Aba ativa indicada por cor e nao so por peso de fonte
- [ ] Aba escolhida persiste ao recarregar (UI-06)
- [ ] Faixa de offline mostra horario do ultimo snapshot (SYNC-02)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): casca de navegacao responsiva`

---

### T19: Tela de login

**What**: Selecao de viajante por botao e teclado numerico de PIN, com erro generico e estado de bloqueio por rate limit.
**Where**: `components/Login.tsx`
**Depends on**: T18
**Reuses**: `app/api/viajantes`, `app/api/sessao`
**Requirement**: AUTH-01, AUTH-03

**Done when**:

- [ ] Um botao por viajante, >= 44px (AUTH-01)
- [ ] Teclado numerico grande, sem depender de teclado do sistema
- [ ] PIN errado mostra "Nome ou PIN incorreto" (AUTH-03)
- [ ] 429 mostra "Muitas tentativas. Tente em 15 minutos."
- [ ] Banco sem viagem leva para a tela de criacao de viagem
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): tela de login por selecao e pin`

---

### T20: Service worker

**What**: Service worker que cacheia a casca do app e o registro correspondente, para o app abrir em modo aviao.
**Where**: `public/sw.js`
**Depends on**: T19
**Reuses**: Cache API da plataforma
**Requirement**: SYNC-07, BKP-01

**Done when**:

- [ ] Cacheia a casca na instalacao e serve dela quando offline (SYNC-07)
- [ ] Nunca cacheia respostas de `/api/**` (o snapshot ja vive no IndexedDB)
- [ ] Versao do cache incrementavel; caches antigos limpos no `activate`
- [ ] App abre em modo aviao apos uma visita com rede
- [ ] Gate check passa: `npm run test && npm run test:api && npm run build`

**Tests**: none
**Gate**: full

**Commit**: `feat(offline): service worker da casca do app`

---

### T21: Mapa da rota

**What**: SVG que projeta lat/lon dos lugares, desenha os pinos na ordem da viagem e liga com curva suave, com enquadramento automatico.
**Where**: `components/MapaRota.tsx`
**Depends on**: T20
**Reuses**: `lib/derive.ts` (`projetarRota`)
**Requirement**: MAP-01..05

**Done when**:

- [ ] Pinos na ordem da viagem, ligados por curva (MAP-01)
- [ ] Enquadramento automatico nos extremos da rota mais margem (MAP-02)
- [ ] Sem coordenadas cadastradas, o mapa nao renderiza e nao deixa espaco vazio (MAP-03)
- [ ] Zero requisicao de rede (MAP-04)
- [ ] Rotulo de cada cidade com contraste >= 4.5:1 (MAP-05)
- [ ] Fundo e gradiente abstrato; limitacao da v1 anotada em comentario `ponytail:`
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): mapa da rota em svg projetado`

---

### T22: Aba Inicio

**What**: Tela de abertura das referencias: contagem gigante, mapa da rota, proximo compromisso, tres cartoes de resumo e roteiro em destaque.
**Where**: `components/tabs/Inicio.tsx`
**Depends on**: T21
**Reuses**: `lib/derive.ts`, `components/MapaRota.tsx`
**Requirement**: HOME-01..07

**Done when**:

- [ ] Tres fases da viagem exibidas corretamente (HOME-01..03)
- [ ] Proximo compromisso com data, hora e local (HOME-04)
- [ ] "Sem compromissos futuros" quando nao ha (HOME-05)
- [ ] Cartoes de dias, cidades e paises distintos (HOME-06)
- [ ] Alteracoes das ultimas 48h no topo, com autor e tempo relativo (HOME-07)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba inicio com contagem e mapa`

---

### T23: Aba Roteiro

**What**: Linha do tempo agrupada por dia, com badge de tipo por evento e destaque para dias-ancora.
**Where**: `components/tabs/Roteiro.tsx`
**Depends on**: T22
**Reuses**: `lib/derive.ts`
**Requirement**: CONT-01, CONT-02, CONT-09, UI-04

**Done when**:

- [ ] Ordenado por data e hora, agrupado por dia (CONT-01)
- [ ] Badge de tipo por evento: Voo, Hospedagem, Cruzeiro, Passeio
- [ ] Eventos ancora destacados com a cor de destaque (CONT-02)
- [ ] Datas em pt-BR via `Intl` (UI-04)
- [ ] Estado vazio tratado (CONT-09)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba roteiro em linha do tempo`

---

### T24: Aba Voos

**What**: Cartoes de voo com companhia, numero, trechos, horarios, duracao, escalas e localizador copiavel.
**Where**: `components/tabs/Voos.tsx`
**Depends on**: T23
**Reuses**: `lib/derive.ts`
**Requirement**: CONT-03..05, CONT-09

**Done when**:

- [ ] Todos os campos do CONT-03 presentes no cartao
- [ ] Voo sem escala mostra "Direto" (CONT-04)
- [ ] Localizador com botao de copiar (CONT-05)
- [ ] Estado vazio tratado (CONT-09)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba voos com cartoes de trecho`

---

### T25: Aba Cruzeiro

**What**: Cartao do navio com embarque, desembarque, cabine e noites a bordo, mais a lista de portos em ordem com dias no mar identificados.
**Where**: `components/tabs/Cruzeiro.tsx`
**Depends on**: T24
**Reuses**: `lib/derive.ts` (`noitesABordo`)
**Requirement**: CRZ-03..06, CONT-09

**Done when**:

- [ ] Navio, companhia, portos e datas de embarque e desembarque, e cabine quando cadastrada (CRZ-03)
- [ ] Portos em ordem de escala com data, chegada e saida (CRZ-04)
- [ ] Escala marcada como dia no mar aparece como "Dia no mar" (CRZ-05)
- [ ] Noites a bordo calculadas das datas, nunca digitadas (CRZ-06)
- [ ] Estado vazio tratado (CONT-09)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba cruzeiro com portos e dias no mar`

---

### T26: Aba Hospedagem

**What**: Lista de estadias com noites calculadas, endereco e link.
**Where**: `components/tabs/Hospedagem.tsx`
**Depends on**: T25
**Reuses**: `lib/derive.ts` (`noites`)
**Requirement**: CONT-06, CONT-09

**Done when**:

- [ ] Noites calculadas das datas, nunca digitadas (CONT-06)
- [ ] Link renderizado so quando existe (CONT-06)
- [ ] Estado vazio tratado (CONT-09)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba hospedagem`

---

### T27: Aba Cidades e Paises

**What**: Lista de lugares com pais, dias e notas, cada cidade com sua cor estavel.
**Where**: `components/tabs/Lugares.tsx`
**Depends on**: T26
**Reuses**: tokens de `app/globals.css`
**Requirement**: CONT-07, CONT-09

**Done when**:

- [ ] Cidade, pais, dias e notas exibidos (CONT-07)
- [ ] Cor da cidade estavel entre recarregamentos
- [ ] Cidades homonimas em paises diferentes contadas como distintas
- [ ] Estado vazio tratado (CONT-09)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba cidades e paises`

---

### T28: Aba Documentos

**What**: Lista de rotulo e valor com renderizacao por tipo - texto, link e telefone.
**Where**: `components/tabs/Documentos.tsx`
**Depends on**: T27
**Reuses**: `components/TripProvider.tsx`
**Requirement**: CONT-08, CONT-09

**Done when**:

- [ ] `tipo: "link"` vira link; `tipo: "telefone"` vira `tel:` (CONT-08)
- [ ] Valores longos com botao de copiar
- [ ] Estado vazio tratado (CONT-09)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba documentos`

---

### T29: Aba Emergencia

**What**: Telefones e numeros criticos em corpo maior, com discagem por toque, servidos do cache offline.
**Where**: `components/tabs/Emergencia.tsx`
**Depends on**: T28
**Reuses**: `components/TripProvider.tsx`
**Requirement**: EMG-01..04

**Done when**:

- [ ] Telefones locais, consulado, apolice e contato de cada viajante (EMG-01)
- [ ] Cada telefone e link `tel:` acionavel (EMG-02)
- [ ] Funciona a partir do cache sem rede (EMG-03)
- [ ] Fonte maior que a das demais abas (EMG-04)
- [ ] Gate check passa: `npm run test && npm run test:api && npm run build`

**Tests**: none
**Gate**: full

**Commit**: `feat(ui): aba emergencia`

---

### T30: Aba Checklist

**What**: Listas global e pessoal com marcacao otimista, contador do grupo nos itens globais e barra de progresso.
**Where**: `components/tabs/Checklist.tsx`
**Depends on**: T29
**Reuses**: `lib/derive.ts` (`progressoChecklist`), `TripProvider.mutate`
**Requirement**: CHK-01..06

**Done when**:

- [ ] Duas listas: globais e pessoais (CHK-01)
- [ ] Marcar reflete na hora e enfileira (CHK-02)
- [ ] Itens globais mostram quantos viajantes concluiram (CHK-03)
- [ ] Barra de progresso em inteiro (CHK-04)
- [ ] Lista vazia mostra 0% sem erro (CHK-05)
- [ ] Aviso de que marcacoes sincronizam entre aparelhos quando ha rede
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba checklist com sync otimista`

---

### T31: Aba Financeiro

**What**: Tabela de custos por categoria com subtotais e total geral, editavel pelo admin, em centavos.
**Where**: `components/tabs/Financeiro.tsx`
**Depends on**: T30
**Reuses**: `lib/derive.ts` (`totaisFinanceiro`)
**Requirement**: FIN-01..06

**Done when**:

- [ ] Custos agrupados por categoria com subtotal e total geral (FIN-02)
- [ ] Criar, editar e remover recalcula na hora (FIN-03)
- [ ] Valor nao numerico ou negativo e rejeitado, mantendo o anterior (FIN-04)
- [ ] Valores formatados com `Intl.NumberFormat` pt-BR na moeda da viagem (FIN-06)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): aba financeiro editavel`

---

### T32: Folha de edicao generica

**What**: Folha de edicao dirigida por schema que cria, altera e remove registros de qualquer secao de conteudo, com campos minimos e anotacao livre.
**Where**: `components/EditorSheet.tsx`
**Depends on**: T31
**Reuses**: `TripProvider.mutate`, `lib/schema.ts`
**Requirement**: EDIT-01, EDIT-03..05, ADM-06

**Done when**:

- [ ] Cobre roteiro, voos, escalas, cruzeiro, portos, hospedagens, lugares, documentos, emergencia, checklist e categorias (ADM-06)
- [ ] Campos derivados do schema zod, sem formulario escrito a mao por entidade
- [ ] So campos minimos obrigatorios; o resto aceita vazio (EDIT-03)
- [ ] Campo de anotacao livre onde o design preve (EDIT-04)
- [ ] Remover pede confirmacao mostrando o que sera removido (EDIT-05)
- [ ] Invisivel para papel viajante (ADM-08)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): folha de edicao generica dirigida por schema`

---

### T33: Gestao da viagem

**What**: Tela de admin para criar viagem do zero, editar nome, subtitulo, datas, moeda e cor de destaque, e escolher a viagem ativa.
**Where**: `components/tabs/Viagem.tsx`
**Depends on**: T32
**Reuses**: `components/EditorSheet.tsx`, `TripProvider.mutate`
**Requirement**: ADM-01, ADM-02, ADM-07, ADM-08

**Done when**:

- [ ] Criar viagem com nome, partida, retorno e moeda torna-a ativa (ADM-01)
- [ ] Editar nome, subtitulo, datas, moeda e cor de destaque da viagem ativa (ADM-02)
- [ ] Trocar a cor de destaque muda o tema na hora, sem recarregar (CONT-02)
- [ ] Com mais de uma viagem, admin escolhe a ativa (ADM-07)
- [ ] Invisivel para papel viajante (ADM-08)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): gestao da viagem pelo admin`

---

### T34: Gestao de viajantes

**What**: Tela de admin para criar, editar e remover viajantes, definir papel e redefinir PIN.
**Where**: `components/tabs/Viajantes.tsx`
**Depends on**: T33
**Reuses**: `components/EditorSheet.tsx`, `TripProvider.mutate`
**Requirement**: ADM-03..05, ADM-08

**Done when**:

- [ ] Criar, editar e remover viajantes com nome e papel (ADM-03)
- [ ] Definir ou redefinir PIN exibe o valor em texto puro uma unica vez (ADM-04)
- [ ] Remover o ultimo admin e recusado com mensagem clara (ADM-05)
- [ ] Avatares sao iniciais em circulo colorido, sem upload de imagem
- [ ] Invisivel para papel viajante (ADM-08)
- [ ] Gate check passa: `npm run test && npm run test:api && npm run build`

**Tests**: none
**Gate**: full

**Commit**: `feat(ui): gestao de viajantes e pins`

---

### T35: PDF de bolso

**What**: Folha de estilo de impressao e o gatilho que abre o dialogo com o essencial em uma pagina.
**Where**: `components/PdfBolso.tsx`
**Depends on**: T34
**Reuses**: `window.print()`, `@media print`
**Requirement**: BKP-01, BKP-02

**Done when**:

- [ ] Uma pagina com voos, cruzeiro, enderecos, contatos de emergencia e apolice (BKP-01)
- [ ] Navegacao e botoes ocultos na impressao (BKP-02)
- [ ] Layout em coluna unica, sem grid complexo
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): pdf de bolso por impressao`

---

### T36: Tela de importacao e exportacao

**What**: Tela de admin para subir o JSON com pre-visualizacao por secao antes de gravar, e baixar o backup.
**Where**: `components/tabs/Dados.tsx`
**Depends on**: T35
**Reuses**: `app/api/import`, `app/api/export`
**Requirement**: DATA-02..04, BKP-03, ADM-08

**Done when**:

- [ ] Upload mostra o resumo por secao antes de gravar (DATA-02)
- [ ] Confirmacao explicita antes da gravacao (DATA-03)
- [ ] Erro de validacao aponta o campo (DATA-04)
- [ ] Botao de exportar baixa o JSON datado (BKP-03)
- [ ] Invisivel para papel viajante (ADM-08)
- [ ] Gate check passa: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(ui): tela de importacao e exportacao`

---

### T37: README de operacao e deploy

**What**: Documento com o passo a passo de deploy na Vercel, variaveis de ambiente, como cadastrar uma viagem e o lembrete de rotacionar a senha do Neon.
**Where**: `README.md`
**Depends on**: T36
**Reuses**: `.env.example`
**Requirement**: BKP-03

**Done when**:

- [ ] Passo a passo de deploy na Vercel com as variaveis necessarias
- [ ] Como cadastrar uma viagem nova pela interface e como usar a importacao de JSON
- [ ] Aviso de rotacionar a senha do Neon, em destaque
- [ ] Limitacoes declaradas: LWW, rate limit por instancia, PIN de 4 digitos, mapa sem contorno de continente
- [ ] Gate check passa: `npm run test && npm run test:api && npm run build`

**Tests**: none
**Gate**: full

**Commit**: `docs: readme de operacao, deploy e limitacoes`

---

## Phase Execution Map

```
Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6

Phase 1  T1 -> T2 -> T3 -> T4 -> T5 -> T6
Phase 2  T7 -> T8 -> T9 -> T10 -> T11 -> T12 -> T13 -> T14
Phase 3  T15 -> T16 -> T17 -> T18 -> T19 -> T20
Phase 4  T21 -> T22 -> T23 -> T24 -> T25 -> T26 -> T27 -> T28 -> T29
Phase 5  T30 -> T31 -> T32 -> T33 -> T34
Phase 6  T35 -> T36 -> T37
```

Execucao estritamente sequencial: uma tarefa por vez, em ordem. 37 tarefas em 6 fases.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: schema SQL | 1 arquivo | OK Granular |
| T3: calculos derivados | 1 modulo puro | OK Granular |
| T7-T12: rotas | 1 rota cada | OK Granular |
| T21-T29: mapa e abas de leitura | 1 componente cada | OK Granular |
| T30-T34: escrita e gestao | 1 componente cada | OK Granular |

Nenhuma tarefa toca mais de um arquivo de producao.

---

## Diagram-Definition Cross-Check

| Task | Depends On (corpo) | Diagrama | Status |
| ---- | ------------------ | -------- | ------ |
| T1 | None | inicio da cadeia | OK |
| T2..T37 | tarefa imediatamente anterior | cadeia linear identica | OK |

Diagrama e corpos sao gerados do mesmo array por `gen_tasks.py`, entao nao podem divergir. Nenhuma tarefa depende de fase posterior.

---

## Test Co-location Validation

| Task | Camada | Matriz exige | Tarefa diz | Status |
| ---- | ------ | ------------ | ---------- | ------ |
| T1, T2 | SQL e script | none | none | OK |
| T3, T4, T5 | `lib/**` puro | unit | unit | OK |
| T6 | `lib/db.ts` (I/O) | none | none | OK |
| T7-T12 | `app/api/**` | integration | none | merge-forward em T14 |
| T13 | dados | none | none | OK |
| T14 | `app/api/**` | integration | integration | OK |
| T15-T37 | `components/**`, `public/**` | none | none | OK |

**Nota sobre T7-T12**: as rotas nao sao testaveis isoladamente - a suite precisa de servidor de pe e de uma viagem importada, o que so existe depois de T13. Aplicado o merge-forward previsto no processo: os testes de integracao das seis rotas vivem em T14, a primeira tarefa em que sao executaveis. Nenhum teste foi adiado para "depois"; T14 e parte da mesma fase e a fase nao fecha sem ele.

