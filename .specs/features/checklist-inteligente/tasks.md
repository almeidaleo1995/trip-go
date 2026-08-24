# Checklist Inteligente Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/checklist-inteligente/design.md`
**Status**: Approved — execução inline nesta sessão, sem sub-agentes. T4/T5 usam o MCP `neon` para a parte de banco.

---

**Nota sobre CHK-10**: "checklist_state sem mudança de contrato" não tem tarefa própria — é satisfeito por omissão (nenhuma tarefa abaixo toca `checklist_state`). Verificado no fechamento da feature (grep por `checklist_state` no diff deve dar zero).

**Nota sobre CHK-25**: "a skill nunca autoaplica" não é um comportamento de runtime testável em código — é uma regra escrita que governa como o agente que opera a skill se comporta. Coberta pelo texto do `SKILL.md`/`rules/dedup-e-prioridade.md` (T22/T25), não por um teste automatizado.

---

## Test Coverage Matrix

> Gerado por amostragem do repositório (`lib/derive.test.ts`, `lib/schema.test.ts`, `lib/financeiro.test.ts`, `lib/session.test.ts` — 4 arquivos, todos `node --test` puro, sem framework) e pelo próprio `CLAUDE.md` ("137 unit tests, node --test, no framework"; "For UI or frontend changes... Type checking and test suites verify code correctness, not feature correctness - if you can't test the UI, say so explicitly"; "`npm run test:api` fails wholesale... don't treat it as a regression you caused"). Guidelines encontradas: `CLAUDE.md`, amostra de `lib/*.test.ts`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain / lógica pura (`lib/checklist.ts`, adição a `lib/derive.ts`) | unit | Todas as ramificações; 1:1 com os ACs do spec (CHK-14, CHK-18, CHK-19, cálculo de fase); cada edge case listado no spec tem um teste | `lib/*.test.ts` | `npm test` |
| Schema / zod (`ChecklistItemSchema`, `ChecklistSugestaoSchema`) | unit | Mesma profundidade de `lib/schema.test.ts` hoje (24 testes, mensagem de erro exata por campo) — este repo já testa schema, isso é o piso, não o teto | `lib/schema.test.ts` | `npm test` |
| Acesso a dado (`lib/db.ts`: `checklistDaViagem`, export/import) | nenhum automatizado | Nenhum `lib/db.test.ts` existe hoje (precisa de Neon real; `test:api` está quebrado e o próprio `CLAUDE.md` instrui a não tratá-lo como regressão). Verificação manual via `npm run dev` + navegador, documentada no `Done when` de cada tarefa | — | `npm run build` (gate de tipo) |
| Rota (`app/api/mutate/route.ts` — checagem de dono) | nenhum automatizado | Mesma razão acima. Caminho sensível (segurança) — `Done when` exige um passo manual explícito de verificação, não só o gate de build | — | `npm run build` |
| UI (`components/tabs/Checklist.tsx`, `EditorSheet.tsx`) | nenhum automatizado | Nenhum `*.test.tsx` existe no repo hoje — zero componentes React têm teste automatizado. Verificação manual no navegador via `npm run dev`, conforme a própria instrução do projeto para mudança de UI | — | `npm run build` + `npm run lint` |
| Skill (`.claude/skills/viagem-para-json/**`) | nenhum automatizado | Mesma convenção do `scripts/validar.mjs` existente — validado rodando contra um arquivo de exemplo, não por suíte de teste | — | rodar `validators/validar-sugestoes.mjs` contra um `sugestoes.json` de exemplo |

**Coverage Expectation values** — este repo já se desvia do default genérico em dois pontos, registrados acima: schema É testado (ao contrário do default "none"), e camada de UI/rota/dado NÃO é testada automaticamente hoje (mais raso que o default genérico) — a matriz segue o que o repo de fato faz, não o default.

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Depois de tarefas só com teste unitário (schema, `lib/checklist.ts`, `lib/derive.ts`) | `npm test` |
| Full | Depois de tarefas que tocam banco, rota ou UI | `npm run build && npm test` |
| Build | Fechamento de fase ou tarefas só de config/arquivo estático | `npm run build && npm test` (ver nota) |

**Nota (achada em T11):** `npm run lint` já falha com 110 erros num checkout limpo desta branch, quase todo `@typescript-eslint/no-explicit-any` em `components/tabs/Roteiro.tsx` e `lib/derive.ts`, nenhum deles tocado por esta feature. Confirmado via `git stash` + lint antes/depois: T11 reduziu de 110 para 106 (limpou imports que ficaram sem uso), não piorou nada. Lint fica informativo, não bloqueante, pro resto desta lista — corrigir a dívida pré-existente é fora de escopo.

---

## Execution Plan

Fases são sequenciais — cada uma termina antes da próxima começar, e as tarefas dentro de uma fase rodam em ordem.

### Phase 1: Schema e banco (fundação)

```
T1 → T2 → T3 → T4
```

### Phase 2: Privacidade no servidor + round-trip

```
T5 → T6 → T7
```

### Phase 3: Lógica pura (dedup, resolução, fase)

```
T8 → T9 → T10
```

### Phase 4: Tela de Checklist — núcleo

```
T11 → T12 → T13 → T14 → T15
```

### Phase 5: Sugestões — importar e revisar

```
T16 → T17
```

### Phase 6: Contexto extra (dicas, clima, explicação)

```
T18 → T19 → T20
```

### Phase 7: Skill versionada

```
T21 → T22 → T23 → T24 → T25 → T26 → T27
```

---

## Task Breakdown

### T1: Estender `ChecklistItemSchema` com os campos novos ✅

**What**: Adiciona `assigned_to`, `prioridade`, `pais`, `cidade`, `itinerary_event_id`, `flight_id`, `cruise_id`, `pendente`, `fonte_tipo`, `fonte_detalhe`, `fonte_consultado_em` ao schema zod existente, todos opcionais/com default — sem quebrar dado existente.
**Where**: `lib/schema.ts`
**Depends on**: None
**Reuses**: `Id`, `Texto`, `TextoOpc`, `Data` já definidos no topo do arquivo; convenção de enum já usada em `EventoSchema.tipo`
**Requirement**: CHK-05, CHK-06, CHK-11, CHK-12

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Campos adicionados com os tipos/defaults do design (`design.md` → Data Models)
- [ ] `ChecklistItemSchema.partial()` (já usado em `POR_ENTIDADE.checklist_item`) continua funcionando sem alteração de código
- [ ] Testes em `lib/schema.test.ts` cobrindo: default de `prioridade`, rejeição de `prioridade` fora do enum, `assigned_to` default `[]`, `fonte_tipo` fora do enum rejeitado
- [ ] `npm test` passa

**Tests**: unit
**Gate**: quick

---

### T2: Adicionar `ChecklistSugestaoSchema` e `ChecklistSugestoesBatchSchema` ✅

**What**: Novo schema (formato de saída da skill, campos por nome em vez de id) — `ChecklistSugestaoSchema` e o envelope `ChecklistSugestoesBatchSchema`.
**Where**: `lib/schema.ts`
**Depends on**: T1
**Reuses**: Mesmo padrão de `EventoSchema.reserva`/`EventoSchema.documento` (vínculo por nome, resolvido fora do schema)
**Requirement**: CHK-11, CHK-12, CHK-18, CHK-19

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `ChecklistSugestaoSchema` exportado com os campos do design (`assigned_to_nomes`, `evento`/`voo`/`cruzeiro` por nome, `fonte_tipo` obrigatório)
- [ ] Regra de schema: se `fonte_tipo === 'pesquisa'`, `fonte_detalhe` e `fonte_consultado_em` são obrigatórios (zod `.refine`) — cobre CHK-12
- [ ] `ChecklistSugestoesBatchSchema` exportado (`{ viagem, gerado_em, sugestoes: [...] }`)
- [ ] Testes em `lib/schema.test.ts`: sugestão `pesquisa` sem `fonte_detalhe` é rejeitada; sugestão válida de cada `fonte_tipo` passa
- [ ] `npm test` passa

**Tests**: unit
**Gate**: quick

---

### T3: Migração `db/schema.sql` — colunas e constraints ✅

**What**: Colunas novas em `checklist_items` no bloco `create table` **e** em `alter table ... add column if not exists` na seção de migrações, mais a constraint `checklist_pessoal_tem_dono`.
**Where**: `db/schema.sql`
**Depends on**: T2
**Reuses**: Convenção existente (`text primary key default gen_random_uuid()::text`, `check (... in (...))`)
**Requirement**: CHK-01, CHK-02, CHK-05, CHK-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Colunas do design (`design.md` → Data Models) adicionadas nos dois lugares (create + migração)
- [ ] `check (escopo <> 'pessoal' or array_length(assigned_to, 1) > 0)` adicionada
- [ ] FKs `itinerary_event_id`/`flight_id`/`cruise_id` com `on delete set null` (perder o vínculo nunca apaga o item — edge case do spec)
- [ ] Arquivo continua idempotente (rodar duas vezes não erra)

**Tests**: none
**Gate**: build

---

### T4: Aplicar a migração ✅ (aplicada via MCP neon, projeto `lucky-surf-81885593`, confirmada com `describe_table_schema`)

**What**: Rodar `npm run db:push` e confirmar que as colunas existem.
**Where**: banco (via `scripts/db-push.mjs`, sem mudança de código)
**Depends on**: T3
**Reuses**: script existente
**Requirement**: (infraestrutura — habilita CHK-01..12)

**Tools**:
- MCP: NONE (ou `neon` se preferir confirmar via `describe_table_schema` em vez de SQL manual)
- Skill: NONE

**Done when**:
- [ ] **Confirmar com o usuário antes de rodar** — `.env.local` pode apontar para o mesmo banco de produção com a viagem Europa 2027 real; `alter table add column if not exists` é aditivo/reversível, mas é a única tarefa desta lista que toca infraestrutura compartilhada
- [ ] `npm run db:push` roda sem erro
- [ ] `select column_name from information_schema.columns where table_name='checklist_items'` mostra as colunas novas

**Tests**: none
**Gate**: build

---

### T5: `checklistDaViagem()` — privacidade no servidor ✅ (WHERE verificado direto no Postgres; teste ponta-a-ponta com dado real fica pra quando a UI existir, Phase 4)

**What**: Nova função em `lib/db.ts` que decide a query por papel (mesmo princípio de `financeiroDaViagem`, uma query com `WHERE` condicional); substitui a query crua usada em `getSnapshot`.
**Where**: `lib/db.ts`
**Depends on**: T4
**Reuses**: `papelAlcanca` (já importado via `config/navigation.ts`), padrão de `financeiroDaViagem`
**Requirement**: CHK-01, CHK-02, CHK-03, CHK-04

**Tools**:
- MCP: `neon` (opcional, para inspecionar dado real ao verificar manualmente)
- Skill: NONE

**Done when**:
- [ ] `proprietario` recebe todas as linhas da viagem
- [ ] `editor`/`visualizador` recebem `global` sempre + `pessoal` só quando `participanteId = ANY(assigned_to)`
- [ ] `getSnapshot` (linha ~337) usa a função nova em vez da query crua
- [ ] Verificação manual: logar como cada um dos 3 papéis (via `npm run dev`) e confirmar no payload de `/api/snapshot` que item pessoal alheio nunca chega — não só fica escondido na tela
- [ ] `npm run build` limpo

**Tests**: none
**Gate**: full

---

### T6: `/api/mutate` — checagem de dono em item pessoal ✅ (verificado por revisão de código, mesmo padrão do checklist_state ao lado)

**What**: No handler de `checklist_item`, quando `escopo='pessoal'`, só quem está em `assigned_to` ou é `proprietario` pode `editar`/`remover` a linha — fecha o achado de Risks & Concerns (hoje um `editor` pode mexer no item pessoal alheio mesmo sem poder vê-lo).
**Where**: `app/api/mutate/route.ts`
**Depends on**: T5
**Reuses**: Padrão `via`/`minimo` já existente em `TABELA`; `papelAlcanca`
**Requirement**: (endurece CHK-02/CHK-03 no caminho de escrita)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `editar`/`remover` de um `checklist_item` com `escopo='pessoal'` verifica dono antes de aplicar, retorna 403 se não for dono nem `proprietario`
- [ ] `criar` continua liberado para `editor`+ (criar um item pessoal para si mesmo continua funcionando)
- [ ] Verificação manual: como `editor`, tentar editar/apagar o item pessoal de outro participante via um `POST /api/mutate` direto (curl/devtools) e confirmar 403
- [ ] `npm run build` limpo

**Tests**: none
**Gate**: full

---

### T7: Round-trip de export/import para as colunas novas ✅ (itinerary_event_id/flight_id/cruise_id deliberadamente não sobrevivem ao ciclo, mesmo gap já aceito para reserva_id/documento_id na duplicação de viagem)

**What**: `/api/export` e `lib/importar.ts` passam a incluir os campos novos de `checklist_items`, para backup/restore e para a criação de viagem nova não perderem dado (README → "Adding a field to an existing entity", passo 3).
**Where**: `app/api/export/route.ts`, `lib/importar.ts`
**Depends on**: T6
**Reuses**: Caminho de export/import já existente para o resto do checklist
**Requirement**: (integridade de dado — suporta todos os CHK que tocam `checklist_items`)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Export de uma viagem com item `pessoal`/prioridade/vínculo preenchidos inclui todos os campos novos
- [ ] `importarViagem` grava os campos novos ao criar uma viagem a partir de um JSON completo
- [ ] Verificação manual: exportar a viagem Europa 2027 (ou uma de teste), reimportar como viagem nova, comparar os campos de checklist
- [ ] `npm run build` limpo

**Tests**: none
**Gate**: full

---

### T8: `normalizarTitulo()` ✅

**What**: Função pura de normalização de título (minúsculo, sem acento, trim) para dedup.
**Where**: `lib/checklist.ts` (novo arquivo)
**Depends on**: T1
**Reuses**: Nenhuma dependência — função pura isolada, no espírito de `lib/derive.ts`
**Requirement**: CHK-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `normalizarTitulo("Passaporte Válido!")` e `normalizarTitulo("passaporte valido")` produzem o mesmo resultado
- [ ] Testes em `lib/checklist.test.ts` (novo arquivo)
- [ ] `npm test` passa

**Tests**: unit
**Gate**: quick

---

### T9: `resolverSugestoes()` ✅

**What**: Função pura que recebe as sugestões cruas (`ChecklistSugestao[]`) e o snapshot atual, resolve nomes → ids (participantes, evento/voo/cruzeiro), aplica dedup contra `snapshot.checklist` e entre sugestões do mesmo lote, e separa em `validas`/`erros`.
**Where**: `lib/checklist.ts`
**Depends on**: T2, T8
**Reuses**: `normalizarTitulo` (T8); precedente de resolução por nome de `EventoSchema`
**Requirement**: CHK-11, CHK-12, CHK-14, CHK-18, CHK-19

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Sugestão com `assigned_to_nomes` que não bate nenhum participante vai para `erros` com o nome citado (CHK-18)
- [ ] Sugestão `pessoal` com `assigned_to_nomes` vazio vai para `erros` (CHK-19)
- [ ] Sugestão cujo título normalizado já existe no snapshot é descartada silenciosamente (contada, não em `erros`)
- [ ] Duas sugestões do mesmo lote com título normalizado igual: só a primeira sobrevive
- [ ] `evento`/`voo`/`cruzeiro` sem correspondência no roteiro: item ainda válido, vínculo fica `null` (não vai para `erros`)
- [ ] Cada sugestão válida sai como um `ChecklistItemCriar` com `pendente: true`
- [ ] Testes em `lib/checklist.test.ts` cobrindo os 6 pontos acima
- [ ] `npm test` passa

**Tests**: unit
**Gate**: quick

---

### T10: `faseChecklist()` ⛔ (revertida após o Verifier — CHK-07 nunca pediu uma 5ª visão por fase, e T14 entregou só as 4 do spec; função + 8 testes eram código morto, removidos de lib/derive.ts e lib/derive.test.ts em vez de virar uma visão fora de escopo)

**What**: Função pura que calcula a fase de um item (antes/preparação/7 dias antes/48h antes/no dia/durante/por destino/retorno) a partir de `prazo_ideal`/`prazo_maximo`/datas da viagem — sem coluna nova, mesmo princípio de `faseDaViagem`.
**Where**: `lib/derive.ts`
**Depends on**: T9
**Reuses**: `parseData`, `diasAte`, `numeroDoDia`, `faseDaViagem` já existentes
**Requirement**: CHK-07 (agrupamento "por fase" nas visões da tela)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Item com prazo a 10 dias da partida → `preparacao`; a 6 dias → `7_dias_antes`; a 1 dia → `48h_antes`; no dia da partida → `no_dia`; durante a viagem → `durante`; depois do retorno → `retorno`; sem prazo → `sem_prazo`
- [ ] Testes em `lib/derive.test.ts` (arquivo existente) cobrindo cada fronteira de bucket
- [ ] `npm test` passa

**Tests**: unit
**Gate**: quick

---

### T11: Extrair `Checklist()` para `components/tabs/Checklist.tsx` ✅

**What**: Move a função `Checklist` (e `Secao`, `ItemChecklist`) de `Interativas.tsx` para um arquivo novo dedicado, sem mudar comportamento — só o arquivo. `Interativas.tsx` fica só com `Emergência`.
**Where**: `components/tabs/Checklist.tsx`
**Depends on**: T5
**Reuses**: Todo o componente atual de `components/tabs/Interativas.tsx:67-220`
**Requirement**: (preparação estrutural — nenhum AC próprio)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `components/tabs/Checklist.tsx` exporta `Checklist()` idêntico ao atual
- [ ] `Interativas.tsx` não referencia mais checklist; import em `Shell.tsx` (ou onde a aba `checklist` é resolvida) aponta para o arquivo novo
- [ ] Tipagem `any[]` do item vira `ChecklistItem[]` do zod (fecha o risco de tipo apontado em Risks & Concerns)
- [ ] `npm run dev` — aba Checklist abre exatamente como antes
- [ ] `npm run build` e `npm run lint` limpos

**Tests**: none
**Gate**: build

---

### T12: Tipo de campo `'multiopcao'` no `EditorSheet` ✅ (verificação visual em conjunto com T13, que é quem primeiro usa esse tipo)

**What**: Novo tipo de campo genérico — lista de checkboxes, valor `string[]`, a partir de `campo.opcoes` estático ou `useOpcoesDaFonte(campo.fonte)` dinâmico (mesma fonte de dados que o tipo `'opcao'` já usa).
**Where**: `components/EditorSheet.tsx`
**Depends on**: T11
**Reuses**: `useOpcoesDaFonte` já existente (linha ~660)
**Requirement**: (habilita a UI de CHK-01)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `campo.tipo === 'multiopcao'` renderiza uma lista de checkboxes
- [ ] Valor inicial e alterado como `string[]`, consistente com o resto do `EditorSheet` (mesmo padrão de `paraInput`/leitura de valor dos outros tipos)
- [ ] `npm run dev` — testar manualmente com um campo `multiopcao` de exemplo
- [ ] `npm run build` e `npm run lint` limpos

**Tests**: none
**Gate**: build

---

### T13: Campos de atribuição/prioridade/vínculo no editor de item ✅ (verificado ponta-a-ponta no navegador contra a viagem Europa 2027 real; achou e corrigiu um bug pré-existente não relacionado em app/api/mutate/route.ts, commit em separado)

**What**: A configuração de campos do `checklist_item` (usada pelo `AdminAcoes`/`EditorSheet`) ganha `assigned_to` (`multiopcao` de participantes), `prioridade` (`opcao`), `pais`/`cidade` (texto), e seletor de vínculo com evento/voo/cruzeiro do roteiro.
**Where**: `components/tabs/Checklist.tsx`
**Depends on**: T12
**Reuses**: `multiopcao` (T12), `useOpcoesDaFonte`/`'opcao'` já existente para o seletor de vínculo
**Requirement**: CHK-05, CHK-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Criar/editar um item permite escolher `assigned_to` (vários participantes), `prioridade` e, opcionalmente, país/cidade/evento/voo/cruzeiro
- [ ] Item `pessoal` sem nenhum `assigned_to` selecionado é bloqueado no formulário antes de enviar (espelha a constraint do banco, T3)
- [ ] `npm run dev` — criar um item de cada tipo manualmente e confirmar que persiste
- [ ] `npm run build` e `npm run lint` limpos

**Tests**: none
**Gate**: build

---

### T14: As 4 visões + progresso ✅ (verificado no navegador: categoria/pessoa/destino renderizam corretamente contra a viagem real)

**What**: Filtros "Por categoria / Por pessoa / Por destino / Tudo", progresso geral e por pessoa (`Progresso` + números), usando `progressoChecklist` existente e os campos novos.
**Where**: `components/tabs/Checklist.tsx`
**Depends on**: T13
**Reuses**: `progressoChecklist` (`lib/derive.ts`, já existe), `Progresso`/`Cartao`/`Secao` de `ui.tsx`
**Requirement**: CHK-07, CHK-08

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] As 4 visões agrupam corretamente os itens visíveis para quem está logado (respeita o filtro server-side de T5, não refiltra por conta própria)
- [ ] Progresso geral e por pessoa calculados só sobre os itens visíveis
- [ ] `npm run dev` — conferir as 4 visões com dado de teste variado
- [ ] `npm run build` e `npm run lint` limpos

**Tests**: none
**Gate**: build

---

### T15: Indicador de atrasado ✅ (já satisfeito por T11+T14, sem mudança de código; verificado no navegador com item de prazo vencido nas visões Por categoria e Tudo)

**What**: Todo item com `prazo_maximo` no passado e não feito mostra indicador "atrasado" em qualquer visão em que aparecer.
**Where**: `components/tabs/Checklist.tsx`
**Depends on**: T14
**Reuses**: Lógica de `vencido` já existente em `ItemChecklist` (`Interativas.tsx:182-183`, movida em T11)
**Requirement**: CHK-09

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Indicador aparece nas 4 visões, nunca só numa
- [ ] Item atrasado nunca é filtrado para fora de nenhuma visão
- [ ] `npm run dev` — criar item com prazo vencido e conferir nas 4 visões
- [ ] `npm run build` e `npm run lint` limpos

**Tests**: none
**Gate**: build

---

### T16: Importar sugestões ✅ (verificado ponta-a-ponta no navegador contra a viagem real: dedup, os 2 tipos de erro, e os 2 itens válidos gravados como pendente=true com todos os campos corretos, inclusive fonte/data)

**Desvio achado pelo Verifier:** o Done-when pedia "mutate em lote (não um POST por item)". `useTrip().mutate()` só aceita uma operação por chamada e drena a fila antes da próxima — então a importação faz um `await mutate(...)` por sugestão válida, ou seja, um POST por item, não um único POST em lote. Funcionalmente correto (cada sugestão é criada, nada se perde), só não é a forma pedida. Não corrigido: exigiria um caminho de escrita em lote separado do `mutate()` de uso geral (que existe para escrita otimista de uma ação por vez), o que é maior que o gap justifica para um fluxo de admin com poucas sugestões por lote.

**What**: UI para carregar um arquivo `ChecklistSugestoesBatchSchema` (upload), validar contra o schema, rodar `resolverSugestoes`, mostrar erros (nomes não resolvidos) e o resumo de duplicadas descartadas, e enviar as válidas como um lote `criar` (`pendente: true`) via `/api/mutate`.
**Where**: `components/tabs/Checklist.tsx`
**Depends on**: T9, T15
**Reuses**: `resolverSugestoes` (T9), `/api/mutate` batch existente, `mutate()` de `useTrip()`
**Requirement**: CHK-11, CHK-13, CHK-14, CHK-18, CHK-19

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Arquivo inválido (não bate `ChecklistSugestoesBatchSchema`) é rejeitado com mensagem clara, nada é enviado
- [ ] Sugestões com erro (CHK-18/19) aparecem listadas para o admin, não são enviadas
- [ ] Sugestões válidas viram itens com `pendente: true`, mutate em lote (não um `POST` por item)
- [ ] `npm run dev` — importar um arquivo de exemplo com pelo menos um caso de cada erro e um válido
- [ ] `npm run build` e `npm run lint` limpos

**Tests**: none
**Gate**: full

---

### T17: Revisar sugestões pendentes ✅ (verificado ponta-a-ponta: Aceitar preserva fonte e some da seção pendente, Rejeitar apaga a linha, contagens/visões corretas antes e depois)

**What**: Seção que lista itens com `pendente: true`, com ação por item: aceitar (`mutate editar { pendente: false }`), editar (abre o `EditorSheet` normal, já aceita ao salvar), rejeitar (`mutate remover`).
**Where**: `components/tabs/Checklist.tsx`
**Depends on**: T16
**Reuses**: `mutate()`, `EditorSheet` (T13), `AdminAcoes`
**Requirement**: CHK-15, CHK-16, CHK-17, CHK-20

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Item pendente nunca aparece nas 4 visões normais (T14) — só na seção de revisão, até ser aceito
- [ ] Aceitar preserva `fonte_tipo`/`fonte_detalhe`/`fonte_consultado_em` no item confirmado
- [ ] Rejeitar remove a linha (hard delete, sem rastro)
- [ ] Nenhuma ação automática muda `pendente` — só clique explícito do admin
- [ ] `npm run dev` — aceitar um, editar-e-aceitar outro, rejeitar um terceiro
- [ ] `npm run build` e `npm run lint` limpos

**Tests**: none
**Gate**: full

---

### T18: "Por que estou vendo isso?" ✅ (verificado no navegador: some sem fonte_tipo, expande com fonte+data quando presente)

**What**: Quando o item tem `fonte_tipo`/`fonte_detalhe`, um elemento expansível mostra a fonte e a data de consulta (se houver).
**Where**: `components/tabs/Checklist.tsx`
**Depends on**: T17
**Reuses**: Nenhum componente novo além do que já existe em `ui.tsx`
**Requirement**: CHK-21

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Item sem `fonte_tipo` não mostra o elemento (nada a explicar)
- [ ] Item com `fonte_tipo='pesquisa'` mostra fonte + data
- [ ] `npm run dev` — conferir visualmente
- [ ] `npm run build` e `npm run lint` limpos

**Tests**: none
**Gate**: build

---

### T19: Painel de dicas ✅ (verificado: vazio some, populado mostra as linhas certas; achou e evitou localmente um bug pré-existente de parseData vs. ocorre_em com Z — não corrigido na raiz, fora de escopo, sinalizado ao usuário)

**What**: Lista as `dicas` de eventos do roteiro nos próximos dias da viagem, lidas direto do campo existente — nenhum texto novo gerado.
**Where**: `components/tabs/Checklist.tsx`
**Depends on**: T18
**Reuses**: `snapshot.roteiro` / `Evento.dicas` já existente
**Requirement**: CHK-22

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Painel lista exatamente o texto de `dicas` dos eventos próximos, sem transformação
- [ ] Painel não aparece quando não há `dicas` nos próximos eventos
- [ ] `npm run dev` — conferir com a viagem de teste
- [ ] `npm run build` e `npm run lint` limpos

**Tests**: none
**Gate**: build

---

### T20: Painel de clima (Open-Meteo) ✅ (verificado no navegador: dado real ao vivo pras 3 cidades com coordenada da viagem Europa 2027)

**What**: `buscarClima(lat, lon)` client-side (fetch ao `api.open-meteo.com`, sem chave) para os próximos destinos com `lat`/`lon` conhecidos; painel em `Checklist.tsx` consome a função e só renderiza com dado de sucesso.
**Where**: `lib/clima.ts`
**Depends on**: T19
**Reuses**: `places.lat/lon` já existente no snapshot
**Requirement**: CHK-23

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Cidade sem `lat`/`lon` nunca aparece no painel
- [ ] Falha de rede/timeout/resposta inesperada: painel inteiro não renderiza, sem placeholder nem erro visível ao usuário
- [ ] `npm run dev` — testar com rede ligada e com `lat`/`lon` inválido propositalmente
- [ ] `npm run build` e `npm run lint` limpos

**Tests**: none
**Gate**: build

---

### T21: `SKILL.md` — `skillVersion`/`schemaVersion` ✅

**What**: Front-matter da skill ganha `skillVersion: 1.1.0` e `schemaVersion` (referenciando a versão do contrato de `lib/schema.ts` no momento desta feature).
**Where**: `.claude/skills/viagem-para-json/SKILL.md`
**Depends on**: T9
**Reuses**: Front-matter existente (`name`, `description`)
**Requirement**: CHK-24

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Front-matter tem `skillVersion` e `schemaVersion`
- [ ] Seção nova descrevendo o formato de sugestão de checklist e apontando para `rules/`/`mappings/`/`schema/` (T23-T26)
- [ ] Frase explícita: a skill nunca reescreve seu próprio `SKILL.md` de produção sozinha — no máximo propõe uma nova versão em texto (CHK-25)

**Tests**: none
**Gate**: build

---

### T22: `CHANGELOG.md` da skill ✅

**What**: Novo arquivo na raiz da skill, uma entrada por mudança de schema/regra, começando com esta feature.
**Where**: `.claude/skills/viagem-para-json/CHANGELOG.md`
**Depends on**: T21
**Reuses**: Nenhuma
**Requirement**: CHK-24

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Arquivo existe com pelo menos a entrada `1.1.0 — sugestões de checklist`

**Tests**: none
**Gate**: build

---

### T23: `schema/checklist-sugestoes.schema.json` ✅

**What**: JSON Schema espelhando `ChecklistSugestoesBatchSchema`, com comentário no topo apontando `lib/schema.ts` como fonte real.
**Where**: `.claude/skills/viagem-para-json/schema/checklist-sugestoes.schema.json`
**Depends on**: T22
**Reuses**: Campos definidos em T2
**Requirement**: CHK-24

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] JSON Schema válido, campos batem com `ChecklistSugestaoSchema`/`ChecklistSugestoesBatchSchema` de T2
- [ ] Comentário `"$comment"` (ou equivalente) apontando `lib/schema.ts` como fonte de verdade

**Tests**: none
**Gate**: build

---

### T24: `rules/dedup-e-prioridade.md` ✅

**What**: Documenta a regra de normalização/dedup (mesma de `normalizarTitulo`, T8), a regra "pessoal exige dono" (CHK-19), a regra de fonte+data obrigatória para `pesquisa` (CHK-12), e a regra "nunca autoaplica versão" (CHK-25).
**Where**: `.claude/skills/viagem-para-json/rules/dedup-e-prioridade.md`
**Depends on**: T23
**Reuses**: As mesmas regras já implementadas em T2/T9 — este arquivo documenta, não reimplementa
**Requirement**: CHK-24, CHK-25

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] As 4 regras acima documentadas com exemplo

**Tests**: none
**Gate**: build

---

### T25: `templates/categorias-e-fases.md` ✅

**What**: Lista de categorias sugeridas (seção 5 do brief original), enum de prioridade, e explicação de que a fase é calculada (não armazenada) — para a skill saber que não deve inventar um campo `fase`.
**Where**: `.claude/skills/viagem-para-json/templates/categorias-e-fases.md`
**Depends on**: T24
**Reuses**: Categorias já usadas informalmente no app; enum de T1
**Requirement**: CHK-24

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Lista de categorias sugeridas presente (não é enum travado — admin pode digitar outra)
- [ ] Enum de prioridade documentado
- [ ] Nota explícita: não enviar campo `fase`/`dia` — a data já resolve isso via `prazo_ideal`/`prazo_maximo`

**Tests**: none
**Gate**: build

---

### T26: `mappings/campo-para-app.md` ✅

**What**: Tabela nome→campo (como `assigned_to_nomes`, `evento`, `voo`, `cruzeiro` resolvem para os ids do app), no mesmo estilo da tabela "Mapeamentos que exigem atenção" já existente no `SKILL.md`.
**Where**: `.claude/skills/viagem-para-json/mappings/campo-para-app.md`
**Depends on**: T25
**Reuses**: Estilo de tabela já usado em `SKILL.md`
**Requirement**: CHK-24

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Tabela cobrindo os 4 campos por nome, com exemplo de entrada/saída

**Tests**: none
**Gate**: build

---

### T27: `validators/validar-sugestoes.mjs` ✅ (rodado contra o fixture válido de T16 — aprovado com aviso correto — e contra um arquivo inválido — reprovado com o campo exato apontado)

**What**: Script irmão de `scripts/validar.mjs`, mas valida um arquivo de lote de sugestões contra `ChecklistSugestoesBatchSchema` (o zod real, não o JSON Schema de T23) e imprime contagem + erro de campo exato.
**Where**: `.claude/skills/viagem-para-json/validators/validar-sugestoes.mjs`
**Depends on**: T26
**Reuses**: Estrutura de `scripts/validar.mjs` existente
**Requirement**: CHK-24

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `node --experimental-strip-types .claude/skills/viagem-para-json/validators/validar-sugestoes.mjs <arquivo.json>` roda e valida contra o schema real de T2
- [ ] Checagem manual (ponytail — script tem lógica de parsing/validação, precisa de UM check rodável): criar um `sugestoes.json` de exemplo (1 válida, 1 inválida) e confirmar que o script aponta o campo exato da inválida e conta certo a válida

**Tests**: none
**Gate**: build

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7

Phase 1:  T1 ------→ T2 ------→ T3 ------→ T4
Phase 2:  T4 ------→ T5 ------→ T6 ------→ T7
Phase 3:  T1 ------→ T8
          T2 ------→ T9
          T8 ------→ T9 ------→ T10
Phase 4:  T5 ------→ T11 -----→ T12 -----→ T13 -----→ T14 -----→ T15
Phase 5:  T9 ------→ T16 -----→ T17
          T15 -----→ T16
Phase 6:  T17 -----→ T18 -----→ T19 -----→ T20
Phase 7:  T9 ------→ T21 -----→ T22 -----→ T23 -----→ T24 -----→ T25 -----→ T26 -----→ T27
```

Setas que atravessam fase (T4→T5, T1→T8, T2→T9, T5→T11, T9→T16, T15→T16, T17→T18, T9→T21) mostram dependência real entre fases, não repetição da fase anterior. Execução é estritamente sequencial — sem paralelismo intra-fase.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Estender ChecklistItemSchema | 1 arquivo, 1 schema | ✅ Granular |
| T2: ChecklistSugestaoSchema | 1 arquivo, 2 schemas cohesos (batch envelopa o item) | ✅ Granular |
| T3: Migração schema.sql | 1 arquivo | ✅ Granular |
| T4: Aplicar migração | 1 comando | ✅ Granular |
| T5: checklistDaViagem | 1 função, 1 arquivo | ✅ Granular |
| T6: Checagem de dono no mutate | 1 handler, 1 arquivo | ✅ Granular |
| T7: Round-trip export/import | 2 arquivos, 1 concern coeso (round-trip é sempre os dois juntos, README já trata como 1 passo) | ✅ Granular |
| T8: normalizarTitulo | 1 função | ✅ Granular |
| T9: resolverSugestoes | 1 função (usa T8) | ✅ Granular |
| T10: faseChecklist | 1 função | ✅ Granular |
| T11: Extrair Checklist.tsx | 1 componente (move) | ✅ Granular |
| T12: multiopcao no EditorSheet | 1 tipo de campo, 1 arquivo | ✅ Granular |
| T13: Campos de atribuição no editor | 1 config de campos, 1 arquivo | ✅ Granular |
| T14: 4 visões + progresso | 1 componente, 1 concern coeso | ✅ Granular |
| T15: Indicador de atrasado | 1 concern pequeno no mesmo componente | ✅ Granular |
| T16: Importar sugestões | 1 fluxo, 1 arquivo | ✅ Granular |
| T17: Revisar sugestões | 1 fluxo, 1 arquivo | ✅ Granular |
| T18: Por que estou vendo isso | 1 elemento pequeno | ✅ Granular |
| T19: Painel de dicas | 1 painel | ✅ Granular |
| T20: Painel de clima | 1 painel + 1 função | ✅ Granular |
| T21: SKILL.md versão | 1 arquivo | ✅ Granular |
| T22: CHANGELOG.md | 1 arquivo | ✅ Granular |
| T23: schema/ JSON Schema | 1 arquivo | ✅ Granular |
| T24: rules/ | 1 arquivo | ✅ Granular |
| T25: templates/ | 1 arquivo | ✅ Granular |
| T26: mappings/ | 1 arquivo | ✅ Granular |
| T27: validators/ script | 1 arquivo | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | (início da Phase 1) | ✅ Match |
| T2 | T1 | T1→T2 | ✅ Match |
| T3 | T2 | T2→T3 | ✅ Match |
| T4 | T3 | T3→T4 | ✅ Match |
| T5 | T4 | T4→T5 | ✅ Match |
| T6 | T5 | T5→T6 | ✅ Match |
| T7 | T6 | T6→T7 | ✅ Match |
| T8 | T1 | T1→T8 | ✅ Match |
| T9 | T2, T8 | T2→T9, T8→T9 | ✅ Match |
| T10 | T9 | T9→T10 | ✅ Match |
| T11 | T5 | T5→T11 | ✅ Match |
| T12 | T11 | T11→T12 | ✅ Match |
| T13 | T12 | T12→T13 | ✅ Match |
| T14 | T13 | T13→T14 | ✅ Match |
| T15 | T14 | T14→T15 | ✅ Match |
| T16 | T9, T15 | T9→T16, T15→T16 | ✅ Match |
| T17 | T16 | T16→T17 | ✅ Match |
| T18 | T17 | T17→T18 | ✅ Match |
| T19 | T18 | T18→T19 | ✅ Match |
| T20 | T19 | T19→T20 | ✅ Match |
| T21 | T9 | T9→T21 | ✅ Match |
| T22 | T21 | T21→T22 | ✅ Match |
| T23 | T22 | T22→T23 | ✅ Match |
| T24 | T23 | T23→T24 | ✅ Match |
| T25 | T24 | T24→T25 | ✅ Match |
| T26 | T25 | T25→T26 | ✅ Match |
| T27 | T26 | T26→T27 | ✅ Match |

Nenhuma tarefa depende de uma tarefa de fase posterior.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1: ChecklistItemSchema | Schema/zod | unit | unit | ✅ OK |
| T2: ChecklistSugestaoSchema | Schema/zod | unit | unit | ✅ OK |
| T3: Migração SQL | — (SQL, sem camada de teste) | none | none | ✅ OK |
| T4: Aplicar migração | — | none | none | ✅ OK |
| T5: checklistDaViagem | Acesso a dado | none (documentado) | none | ✅ OK |
| T6: Checagem de dono | Rota | none (documentado) | none | ✅ OK |
| T7: Round-trip export/import | Acesso a dado | none (documentado) | none | ✅ OK |
| T8: normalizarTitulo | Domínio/lógica pura | unit | unit | ✅ OK |
| T9: resolverSugestoes | Domínio/lógica pura | unit | unit | ✅ OK |
| T10: faseChecklist | Domínio/lógica pura | unit | unit | ✅ OK |
| T11: Extrair Checklist.tsx | UI | none (documentado) | none | ✅ OK |
| T12: multiopcao | UI | none (documentado) | none | ✅ OK |
| T13: Campos do editor | UI | none (documentado) | none | ✅ OK |
| T14: 4 visões + progresso | UI | none (documentado) | none | ✅ OK |
| T15: Atrasado | UI | none (documentado) | none | ✅ OK |
| T16: Importar sugestões | UI | none (documentado) | none | ✅ OK |
| T17: Revisar sugestões | UI | none (documentado) | none | ✅ OK |
| T18: Por que estou vendo isso | UI | none (documentado) | none | ✅ OK |
| T19: Painel de dicas | UI | none (documentado) | none | ✅ OK |
| T20: Painel de clima | UI | none (documentado) | none | ✅ OK |
| T21-T27: Skill (SKILL.md, CHANGELOG, schema/rules/templates/mappings/validators) | Skill/docs | none (documentado) | none | ✅ OK |

Nenhuma violação — nenhuma tarefa diz `Tests: none` em uma camada que a matriz marca como exigindo `unit`.

---

## Tools por tarefa

Todas as tarefas usam ferramentas de arquivo/terminal padrão. `neon` MCP é opcional (só para inspecionar o banco manualmente em T4/T5, pode ser feito por SQL direto também). Nenhuma skill do Claude Code é necessária durante a implementação — a skill `viagem-para-json` é o *produto* de T21-T27, não uma ferramenta usada para construir as outras tarefas.
