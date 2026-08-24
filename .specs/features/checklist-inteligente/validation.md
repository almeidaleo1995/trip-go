# Checklist Inteligente Validation

**Date**: 2026-08-24
**Spec**: `.specs/features/checklist-inteligente/spec.md`
**Diff range**: `main..HEAD` (`1a2c7c3..c7235d4`, 30 commits, 28 files)
**Verifier**: independent sub-agent (author ≠ verifier), read-only over the real tree

## Validation: FAIL

Todos os 25 ACs têm evidência `file:line` e o gate está verde (186/186, build limpo, 4/4 mutantes mortos). O que reprova não é um AC: é um **edge case listado no próprio spec que não foi implementado e quebra em runtime** — `VERSAO` em `lib/offline.ts` não subiu, e a tela nova chama `.length` num campo que não existe no cache do IndexedDB gravado pela versão anterior. Mais um arquivo obrigatório da skill que o `SKILL.md` referencia três vezes e não existe. Os dois são correções de poucas linhas; nenhum exige repensar o design.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1-T10 | ✅ Done | Marcadas ✅ em tasks.md; verificadas no código e nos testes |
| T11 | ⚠️ Sem marca de conclusão | Única tarefa sem `✅` no título em `tasks.md:332`. O trabalho **está feito** (`components/tabs/Checklist.tsx` existe, `app/(dashboard)/viagens/[id]/page.tsx:16` importa dele, `Interativas.tsx` perdeu 192 linhas). Só o bookkeeping ficou para trás. |
| T12-T27 | ✅ Done | Marcadas ✅ e confirmadas no diff |

Dois desvios de "Done when" dentro de tarefas marcadas ✅:

- **T16** — "mutate em lote (não um `POST` por item)". `components/tabs/Checklist.tsx:428-430` faz `for (…) await mutate(…)`; cada `mutate` chama `drenar()` (`components/TripProvider.tsx:123`), que esvazia a fila inteira antes do próximo enfileiramento. Resultado: **um POST por sugestão**. Funcionalmente correto, mas não é o lote pedido.
- **T11-T20** — "`npm run lint` limpo". Não está (ver Code Quality).

---

## Spec-Anchored Acceptance Criteria

### P1: Checklist contextual — modelo e tela

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + evidência | Result |
| --- | --- | --- | --- |
| CHK-01 · global + `assigned_to` vazio → visível a todos | linha volta no snapshot para qualquer papel | `lib/db.ts:403` - `and (escopo = 'global' or ${participanteId} = any(assigned_to))`; todo `global` passa pelo primeiro ramo do OR independentemente de `assigned_to`. Owner: `lib/db.ts:398-400` devolve tudo. Sem teste automatizado (matriz: camada de dado = `nenhum`) | ✅ PASS (código) |
| CHK-02 · pessoal → só `assigned_to` + proprietário, **no snapshot e no export** | linha ausente da resposta, não escondida | `lib/db.ts:397-406`; export deriva do mesmo caminho: `app/api/export/route.ts:52` - `getSnapshot(tripId, acesso.papel, acesso.participanteId)` | ✅ PASS (código) |
| CHK-03 · editor/visualizador não recebem pessoal de terceiro | exclusão server-side | `lib/db.ts:337` - `getSnapshot` agora chama `checklistDaViagem(...)` no lugar da query crua; WHERE em `lib/db.ts:403` | ✅ PASS (código) — **sensor M5 sobreviveu**, ver Discrimination Sensor |
| CHK-04 · global + `assigned_to` preenchido continua visível a todos | `assigned_to` só destaca | `lib/db.ts:403` (OR curto-circuita em `escopo = 'global'`); destaque na UI em `components/tabs/Checklist.tsx:42` (visão "Por pessoa" agrupa sob o dono, as outras 3 visões mostram o item a todos) | ✅ PASS (código) |
| CHK-05 · `prioridade` no enum, default `importante` | `'importante'` quando omitido; fora do enum rejeitado | `lib/schema.ts:387` - `z.enum(PRIORIDADES_CHECKLIST).default('importante')`; `lib/schema.test.ts:233` - `assert.equal(r.dados.checklist[0].prioridade, 'importante')`; `lib/schema.test.ts:238-239` - `sucesso === false` + `assert.match(r.erro, /prioridade/)`; DB `db/schema.sql:292-293` | ✅ PASS |
| CHK-06 · vínculos opcionais persistidos, nenhum obrigatório | qualquer combinação aceita | `lib/schema.ts:388-392` (`pais`/`cidade` `TextoOpc`, três FKs `Id.nullish()`); `db/schema.sql:294-299` (`on delete set null`); `lib/schema.test.ts:222-225` - `validarCampos('checklist_item', { titulo })` → `sucesso === true` prova que nenhum é obrigatório; editor em `components/EditorSheet.tsx:408-412` | ✅ PASS · desvio documentado: **não existe campo `dia`**; `design.md:269` substitui por `prazo_ideal`/`prazo_maximo` (regra do README de não duplicar sistema de tarefas por dia). Decisão aprovada, spec não foi emendado |
| CHK-07 · 4 visões (categoria/pessoa/destino/tudo) sobre itens visíveis | as 4 existem e nenhuma esconde item | `components/tabs/Checklist.tsx:21-26` (`VISOES`), `:31-56` (`agrupar`, sem nenhum `filter` que remova item), `:170-186` (seletor), `:188-200` (render) | ✅ PASS (código) |
| CHK-08 · progresso geral **e por pessoa**, só sobre itens visíveis | ambos mostrados a quem pede | Geral: `components/tabs/Checklist.tsx:76` - `progressoChecklist(itens, meus)` sobre `itens` já filtrado pelo servidor, exibido em `:129-133`. Por pessoa: `:143-162`, calculado sobre `itens.filter(escopo global \|\| assigned_to.includes(p.id))` | ⚠️ **Parcial** — o bloco por pessoa está atrás de `souProprietario` (`:141`). Editor e visualizador nunca veem progresso por pessoa. O comentário em `:139-140` justifica (calcular direito exigiria ver o item pessoal alheio), mas o AC diz "o sistema SHALL mostrar", sem recorte de papel |
| CHK-09 · atrasado sinalizado em toda visão, nunca ocultado | indicador presente; item nunca filtrado para fora | `components/tabs/Checklist.tsx:523` - `const vencido = !feito && limite !== null && limite.getTime() < Date.now()`; badge em `:569-573`; renderizado dentro de `ItemChecklist`, que **todas** as visões chamam pelo mesmo `grupos.map` em `:188-200` | ✅ PASS (código) |
| CHK-10 · `checklist_state` sem mudança de contrato | zero alteração | `git diff main..HEAD` não toca o DDL de `checklist_state` (`db/schema.sql:305+` inalterado) nem o payload: `components/tabs/Checklist.tsx:84-89` é a mesma op `{ item_id, feito }` movida de `Interativas.tsx`. Grep no diff confirma: só ocorrências movidas | ✅ PASS |

### P2: Sugestões da skill com revisão no app

| Criterion | Spec-defined outcome | `file:line` + evidência | Result |
| --- | --- | --- | --- |
| CHK-11 · forma da sugestão | todos os campos citados presentes; `fonte_tipo` no enum | `lib/schema.ts:405-429` (`ChecklistSugestaoSchema`: `assigned_to_nomes`, `evento`/`voo`/`cruzeiro` por nome, `fonte_tipo` obrigatório em `:422`); `lib/schema.test.ts:257-260` aceita `documento`; `lib/checklist.test.ts:42` - `assert.deepEqual(r.validas[0].assigned_to, ['p-leo'])` prova nome→id | ✅ PASS |
| CHK-12 · `pesquisa` exige fonte + data | rejeitado sem as duas | `lib/schema.ts:426-429` - `.refine((d) => d.fonte_tipo !== 'pesquisa' \|\| (d.fonte_detalhe && d.fonte_consultado_em))`; `lib/schema.test.ts:263-265` - `assert.equal(r.success, false)` + `assert.match(r.error.issues[0].path.join('.'), /fonte_detalhe/)`; `:267-274` aceita com as duas. Confirmado também ponta-a-ponta rodando `validators/validar-sugestoes.mjs` contra um fixture inválido → `REPROVADO … sugestoes[0].fonte_detalhe`, exit 1 | ✅ PASS |
| CHK-13 · importa como `pendente=true`, aditivo | nenhuma linha existente alterada/removida | `lib/checklist.ts:127` - `pendente: true` (literal, não parametrizável); `lib/checklist.test.ts:43` - `assert.equal(r.validas[0].pendente, true)`; UI só emite `op: 'criar'` (`components/tabs/Checklist.tsx:429`) — não há caminho de update/delete na importação | ✅ PASS |
| CHK-14 · dedup por título normalizado | duplicada descartada, não vira erro | `lib/checklist.ts:86,93-97`; `lib/checklist.test.ts:62-64` - `validas.length === 0`, `erros.length === 0`, `duplicadas === 1` | ✅ PASS |
| CHK-15 · aceitar / editar-e-aceitar / rejeitar | as três ações por item | `components/tabs/Checklist.tsx:321-328` (aceitar), `:359` (`AdminAcoes` abre o `EditorSheet`), `:330-337` (rejeitar) | ✅ PASS (código) |
| CHK-16 · aceitar preserva fonte | `fonte_tipo`/`fonte_detalhe`/`fonte_consultado_em` intactos | `components/tabs/Checklist.tsx:326` - `campos: { pendente: false }` e nada mais; o UPDATE só escreve as colunas enviadas (`app/api/mutate/route.ts:569-579`, `sets` derivado de `Object.keys(campos)`) | ✅ PASS (código) |
| CHK-17 · rejeitar apaga a linha | hard delete | `components/tabs/Checklist.tsx:332` - `op: 'remover'` → `app/api/mutate/route.ts:475` - `delete from checklist_items where id = $1 ${rec.sql}` | ✅ PASS (código) |
| CHK-18 · nome não resolvido rejeita a sugestão e lista o nome | sugestão em `erros`, nome citado | `lib/checklist.ts:100-109`; `lib/checklist.test.ts:48-50` - `validas.length === 0`, `erros.length === 1`, `assert.match(r.erros[0].motivo, /Fulano/)` | ✅ PASS |
| CHK-19 · pessoal sem `assigned_to` rejeita | sugestão em `erros` | `lib/checklist.ts:110-113`; `lib/checklist.test.ts:55-57` - `assert.match(r.erros[0].motivo, /pessoal/)`. Reforçado no banco: `db/schema.sql:305` `checklist_pessoal_tem_dono` | ✅ PASS |
| CHK-20 · nada vira confirmado sozinho | `pendente=false` só por ação do admin | `lib/checklist.ts:127` sempre `true`; `components/tabs/Checklist.tsx:66-67` separa pendentes de todas as visões; a **única** escrita de `pendente: false` no repo é `:326`, atrás do `onClick` em `:362` | ✅ PASS |

### P3: Contexto extra

| Criterion | Spec-defined outcome | `file:line` + evidência | Result |
| --- | --- | --- | --- |
| CHK-21 · "Por que estou vendo isso?" | só com fonte; mostra fonte + data | `components/tabs/Checklist.tsx:588` - `{item.fonte_tipo && <ExplicacaoFonte item={item} />}` (some sem fonte); `:594-613` renderiza `NOME_FONTE[fonte_tipo]`, `fonte_detalhe` e `fonte_consultado_em` | ✅ PASS (código) |
| CHK-22 · dicas do roteiro, sem gerar texto | texto de `dicas` literal; painel some se vazio | `components/tabs/Checklist.tsx:209-244` — lê `e.dicas`, faz `split('\n')`+`trim`, renderiza verbatim em `:238`; `:229` - `if (linhas.length === 0) return null`. Contorno de `parseData` em `:220` está documentado em `design.md:260` como achado fora de escopo, não silenciado | ✅ PASS (código) |
| CHK-23 · clima só com dado real, senão some | painel inteiro oculto, sem placeholder | `lib/clima.ts:53` (`!r.ok → null`), `:56` (forma inesperada → `null`), `:63-65` (`catch → null`); `components/tabs/Checklist.tsx:258` descarta lugar sem `lat`/`lon`, `:271-273` mantém só resultado não-nulo e não-vazio, `:283` - `if (cidades.length === 0) return null` | ✅ PASS (código) |
| CHK-24 · `skillVersion`/`schemaVersion` + changelog | declarados; uma entrada por mudança | `.claude/skills/viagem-para-json/SKILL.md:4-5` - `skillVersion: 1.1.0`, `schemaVersion: 3`, batendo com `lib/schema.ts:12` (`SCHEMA_VERSION = 3`); `.claude/skills/viagem-para-json/CHANGELOG.md` com a entrada `1.1.0` | ⚠️ **Parcial** — o spec diz `changelog/CHANGELOG.md`; `design.md:22` decidiu deliberadamente pela raiz. O desvio é aprovado, mas os links internos não acompanharam: `SKILL.md:14` e `SKILL.md:119` apontam para `changelog/CHANGELOG.md`, que não existe. E `reference/checklist-sugestoes.md` — citado 3× (inclusive no `description` do front-matter, `SKILL.md:3`, e como "o processo" em `:103`) — **não existe** |
| CHK-25 · proposta de versão nunca autoaplica | regra escrita, não runtime | `.claude/skills/viagem-para-json/SKILL.md:110-119` - "a skill **nunca edita este arquivo sozinha**", com o formato da proposta em texto; `rules/dedup-e-prioridade.md:69` - seção "Nunca autoaplica". `tasks.md:18` já registrava que este AC é regra escrita, não comportamento testável | ✅ PASS |

**Status**: 23/25 ✅ PASS · 2 ⚠️ parciais (CHK-08, CHK-24) · 0 ❌ sem evidência.

**Nota sobre "evidência de código" vs. teste**: 13 dos 25 ACs vivem em camadas que a Test Coverage Matrix (`tasks.md:26-33`) marca explicitamente como `nenhum automatizado` — dado (`lib/db.ts`), rota (`app/api/mutate`) e UI (`components/**`). Isso não é uma lacuna inventada por esta feature: o repo não tem nenhum `*.test.tsx` nem `lib/db.test.ts`, e `npm run test:api` já está quebrado por decisão anterior (CLAUDE.md). Para esses ACs a evidência é o código que satisfaz o comportamento, citado acima, mais a verificação manual registrada no `Done when` de cada tarefa. É evidência mais fraca que uma asserção, e o sensor M5 mede exatamente o quanto (ver abaixo).

---

## Discrimination Sensor

Scratch: `git worktree add` num diretório do scratchpad, junction para `node_modules`, mutação, `node --test`, `git checkout --`, `git worktree remove --force`. Baseline `git status --porcelain` da árvore real: vazio antes e vazio depois. **Nenhum `git stash` usado.**

| # | File:line | Mutação | Killed? |
| --- | --- | --- | --- |
| M1 | `lib/checklist.ts:19` | Removido `.replace(MARCAS_DIACRITICAS, '')` de `normalizarTitulo` | ✅ Killed (1 fail / 10) |
| M2 | `lib/checklist.ts:115` | Removido o efeito colateral `titulosVistos.add(tituloNorm)` (dedup intra-lote) | ✅ Killed (1 fail / 10) |
| M3 | `lib/checklist.ts:110` | Guarda CHK-19 neutralizada: `assignedTo.length === 0` → `assignedTo.length < 0` | ✅ Killed (1 fail / 10) |
| M4 | `lib/derive.ts:158` | Fronteira de bucket em `faseChecklist`: `faltam <= 7` → `faltam <= 6` | ✅ Killed (1 fail / 81) |
| M5 (sonda) | `lib/db.ts:403` | Cláusula de privacidade anulada: `and (escopo = 'global' or …)` → `and (true or …)` — todo item pessoal alheio passa a vazar | ❌ **Survived** (186/186 continuam passando) |

**Sensor depth**: lightweight (4 mutações dirigidas) + 1 sonda no caminho de segurança.
**Result**: **4/4 killed** no código coberto por teste automatizado.

M5 não é uma surpresa nem um mutante que exija strengthening de asserção existente — é a medida empírica do vão que a matriz já declara. Vale registrar o que ele significa: **a linha mais sensível desta feature (o limite de privacidade, motivo declarado do P1 em `design.md:10`) pode ser apagada inteira sem que um único teste reclame.** Ranqueado como gap #2.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ⚠️ `faseChecklist` (`lib/derive.ts:141-166`, 46 linhas + 8 testes) não é chamado por nenhum componente ou rota — grep só encontra a definição e o próprio teste. T10 o justificava por "agrupamento por fase nas visões", mas T14 entregou 4 visões e nenhuma é por fase; o spec nunca pediu a quinta. Código morto entregue |
| Surgical changes | ✅ Diff restrito ao necessário; `Interativas.tsx` perdeu exatamente o checklist e manteve `Emergência` |
| No scope creep | ✅ Os dois desvios são legítimos: `2aeddee` conserta uma regressão de `1a2c7c3` (o `$` faltando nos placeholders quebrava o `criar` de **toda** entidade do app — verifiquei que `1a2c7c3` é de fato a ponta de `main`, então a regressão bloqueava T13 e a correção era pré-requisito, não desvio); `design.md:260` registra o bug de `parseData`/`ocorre_em` como fora de escopo em vez de resolvê-lo em silêncio |
| Matches patterns | ✅ pt-BR em identificadores e comentários, imports com `.ts`, sem dependência nova (Open-Meteo é `fetch` cru), `financeiroDaViagem` como precedente de `checklistDaViagem` |
| Spec-anchored outcome check | ✅ 23/25; 2 parciais sinalizados, nenhum passado em silêncio |
| Per-layer Coverage Expectation met | ✅ para domínio (1:1 com CHK-14/18/19 + cada fronteira de fase); ⚠️ rota/dado/UI sem cobertura — desvio pré-existente e documentado em `tasks.md:26-35`, não introduzido aqui |
| Todo teste mapeia um requisito — sem teste órfão | ⚠️ Os 8 testes de `faseChecklist` mapeiam T10, mas T10 aponta para CHK-07, que a UI satisfaz sem essa função. São testes de código que ninguém usa |
| Guidelines seguidas | ✅ `CLAUDE.md`, `AGENTS.md`, `tasks.md` (Test Coverage Matrix). ❌ uma exceção: o gotcha do `CLAUDE.md` sobre `VERSAO` em `lib/offline.ts` |

**Lint** — a nota de `tasks.md:45` isenta a dívida pré-existente (110 erros em `Roteiro.tsx`/`derive.ts`, e T11 baixou para 106). Mas o total agora é **112 erros**, e o delta é desta feature:

- `components/tabs/Checklist.tsx:215` e `:257` — `Record<string, any>` novo, nos painéis `Dicas` e `Clima`. Contradiz a mitigação escrita em `design.md:258` ("Tela nova usa `ChecklistItem[]` tipado")
- `components/tabs/Checklist.tsx:213` — `react-hooks/purity`: `Date.now()` durante o render de `Dicas`, código novo (o de `:523` veio movido de `Interativas.tsx:183`, onde já errava)
- `components/EditorSheet.tsx:691,708,717,726` — `any` nos 4 ramos novos de `useOpcoesDaFonte` (`main` tinha 2 ocorrências, a branch tem 5); seguem o estilo do ramo pré-existente, o que os explica sem os desculpar

Nenhum é bug. Todos violam o "`npm run lint` limpo" que T11-T20 assinaram.

---

## Edge Cases

- [x] Item pessoal editado para ficar sem dono → rejeitado. `db/schema.sql:305` (`checklist_pessoal_tem_dono`) é o limite real; `components/EditorSheet.tsx:566-573` espelha no formulário com a mensagem "Item pessoal precisa de pelo menos um dono."
- [x] Duas sugestões do mesmo lote com título igual → só a primeira. `lib/checklist.ts:115` + `lib/checklist.test.ts:67-74` (`validas.length === 1`, `duplicadas === 1`)
- [ ] **`VERSAO` do snapshot NÃO foi bumped.** `lib/offline.ts:21` continua `const VERSAO = 3` — idêntico a `main` (confirmado com `git show main:lib/offline.ts`). A forma do snapshot mudou: todo item de checklist agora carrega `assigned_to`, `prioridade`, `pendente`, `fonte_*`. O cache do IndexedDB gravado pela versão anterior não tem esses campos, e a primeira pintura vem dele (`components/TripProvider.tsx:177`). `components/tabs/Checklist.tsx:42` faz `i.assigned_to.length` — `TypeError` no primeiro clique em "Por pessoa" para qualquer usuário com cache quente. `components/tabs/Checklist.tsx:148` (`i.assigned_to.includes(p.id)`) atinge o proprietário já no render, para qualquer item `pessoal` em cache. `normalizar` em `TripProvider.tsx:283` só conserta `financeiro`, não o checklist — e o próprio `CLAUDE.md` avisa que ele "é o cinto de segurança, não a correção"
- [x] `visualizador` editando item de terceiro → 403. `TABELA.checklist_item` exige `editor` (`app/api/mutate/route.ts:53`), e T6 acrescentou a checagem de dono em `:147-158` (`throw new ErroHttp(403, 'Este item pessoal é de outro participante.')`)
- [x] Vínculo removido do roteiro → item preservado. `db/schema.sql:296-299` usa `on delete set null` nas três FKs; a UI trata `null` como "— nenhum —"

---

## Gate Check

- **Gate command**: `npm run build && npm test` (nível Build, `tasks.md:43`)
- **Result**: build ✅ limpo (typecheck incluso, 18 rotas geradas) · testes **186 passed, 0 failed, 0 skipped, 0 todo**
- **Test count antes da feature**: 157 (medido rodando `node --test lib/*.test.ts` num worktree em `main`)
- **Test count depois**: 186
- **Delta**: **+29** (`lib/checklist.test.ts` +10 num arquivo novo, `lib/schema.test.ts` +11, `lib/derive.test.ts` +8)
- **Test Integrity**: nenhum teste apagado, nenhuma asserção enfraquecida — o diff dos arquivos de teste é 100% adição
- **Skipped**: nenhum
- **`npm run lint`**: fora do gate por decisão registrada (`tasks.md:45`). Rodado assim mesmo: 112 erros / 8 avisos, ~6 deles novos desta feature (ver Code Quality)
- **`validators/validar-sugestoes.mjs`**: rodado contra fixtures próprios — lote válido → `APROVADO`, contagem por `fonte_tipo` correta, exit 0; lote inválido → `REPROVADO`, `sugestoes[0].fonte_detalhe: sugestao de fonte pesquisa exige fonte_detalhe e fonte_consultado_em`, exit 1

---

## Fix Plans

### Fix 1: Subir `VERSAO` em `lib/offline.ts` — **Blocker**

- **Root cause**: a forma do snapshot mudou (11 campos novos em `checklist_items`) sem o bump que invalida o cache. `components/tabs/Checklist.tsx` assume `assigned_to` sempre array; num objeto cacheado pela versão anterior ele é `undefined`.
- **Fix task**: `lib/offline.ts:21` → `const VERSAO = 4`.
- **Verify**: com a aba Checklist aberta na versão anterior (cache gravado), atualizar para esta versão e clicar "Por pessoa" — sem `TypeError` no console. Antes do fix, reproduz.
- **Done when**: `VERSAO === 4` e o ciclo acima passa.

### Fix 2: Criar `reference/checklist-sugestoes.md` na skill — **Major**

- **Root cause**: `design.md:90` (Integration Points) exige o arquivo, mas nenhuma tarefa de T21-T27 o criou. `SKILL.md:3` (o `description` do front-matter, que é o que o agente lê ao carregar a skill), `SKILL.md:10` e `SKILL.md:103` ("— o processo") apontam para ele. `CHANGELOG.md:12` também.
- **Fix task**: escrever o arquivo (processo de geração de lote de sugestões, ligando `rules/`, `templates/`, `mappings/`, `schema/`, `validators/`), **ou** reapontar as 4 referências para os arquivos que existem.
- **Verify**: nenhum link de `SKILL.md` aponta para caminho inexistente.
- **Done when**: `SKILL.md` e `CHANGELOG.md` só citam arquivos presentes na árvore.

### Fix 3: Corrigir o caminho do changelog em `SKILL.md` — **Minor**

- **Root cause**: `design.md:22` moveu o `CHANGELOG.md` para a raiz da skill; `SKILL.md:14` e `SKILL.md:119` ainda linkam `changelog/CHANGELOG.md`.
- **Fix task**: trocar por `CHANGELOG.md` nos dois pontos.

### Fix 4: Decidir o destino de `faseChecklist` — **Minor**

- **Root cause**: T10 entregou função + 8 testes para um agrupamento "por fase" que nem o spec pede nem T14 construiu.
- **Fix task**: apagar `lib/derive.ts:120-166` e os testes de `lib/derive.test.ts:219-250`, **ou** adicionar a visão que os justifica. A primeira opção é a coerente com o spec.

### Fix 5: Progresso por pessoa para editor/visualizador — **Minor**

- **Root cause**: `components/tabs/Checklist.tsx:141` restringe o bloco a `souProprietario`; CHK-08 não faz esse recorte.
- **Fix task**: ou mostrar o progresso por pessoa calculado sobre os itens que quem pede enxerga (coerente com "calculados só sobre os itens visíveis para quem está pedindo"), ou emendar CHK-08 no spec registrando a restrição por papel como decisão de privacidade.

### Fix 6: Lint dos arquivos novos — **Minor**

- **Root cause**: 4 `any` novos e um `Date.now()` no render, em código escrito por esta feature.
- **Fix task**: tipar `roteiro`/`lugares`/`voos`/`cruzeiros` a partir dos schemas zod (o mesmo movimento que `design.md:258` prometeu para o checklist) e mover `Date.now()` de `Dicas` para fora do corpo do render.

### Fix 7 (bookkeeping): marcar T11 como concluída em `tasks.md:332`.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| CHK-01 | Implementing (T5) | ✅ Verified |
| CHK-02 | Implementing (T5) | ✅ Verified |
| CHK-03 | Implementing (T5) | ✅ Verified |
| CHK-04 | Implementing (T5) | ✅ Verified |
| CHK-05 | Implementing (T1, T13) | ✅ Verified |
| CHK-06 | Implementing (T1, T13) | ✅ Verified (desvio `dia` aprovado em design.md:269) |
| CHK-07 | Implementing (T14) | ✅ Verified |
| CHK-08 | Implementing (T14) | ⚠️ Verified parcialmente — por pessoa só para proprietário |
| CHK-09 | Implementing (T15) | ✅ Verified |
| CHK-10 | Implementing (omissão) | ✅ Verified |
| CHK-11 | Implementing (T2, T16) | ✅ Verified |
| CHK-12 | Implementing (T2) | ✅ Verified |
| CHK-13 | Implementing (T16) | ✅ Verified |
| CHK-14 | Implementing (T9, T16) | ✅ Verified |
| CHK-15 | Implementing (T17) | ✅ Verified |
| CHK-16 | Implementing (T17) | ✅ Verified |
| CHK-17 | Implementing (T17) | ✅ Verified |
| CHK-18 | Implementing (T9, T16) | ✅ Verified |
| CHK-19 | Implementing (T9, T16) | ✅ Verified |
| CHK-20 | Implementing (T17) | ✅ Verified |
| CHK-21 | Implementing (T18) | ✅ Verified |
| CHK-22 | Implementing (T19) | ✅ Verified |
| CHK-23 | Implementing (T20) | ✅ Verified |
| CHK-24 | Implementing (T21-T27) | ⚠️ Verified parcialmente — links quebrados, `reference/checklist-sugestoes.md` ausente |
| CHK-25 | Implementing (T21, T24) | ✅ Verified |

Nenhum AC reprovou. O que reprova a feature está fora da tabela: um edge case do spec (`VERSAO`) e um arquivo obrigatório do design (`reference/checklist-sugestoes.md`).

---

## Summary

**Overall**: ⚠️ Issues — não liberar sem o Fix 1.

**Spec-anchored check**: 23/25 ACs batem o outcome definido no spec · 2 parciais sinalizados · 0 sem evidência
**Sensor**: 4/4 mortos no código com teste; 1 sonda sobreviveu no limite de privacidade (sem cobertura automatizada, por decisão registrada)
**Gate**: build limpo · 186 passed / 0 failed / 0 skipped · +29 testes, nenhum removido ou enfraquecido

**O que funciona**: a privacidade do checklist decidida no SQL e não na tela — o vazamento que `design.md:10` identificou está fechado na leitura (`lib/db.ts:403`) e na escrita (`app/api/mutate/route.ts:147-158`), e o export herda o filtro de graça por derivar de `getSnapshot`. O pipeline de sugestões é puro, testado ramo a ramo, e nenhuma sugestão consegue virar item confirmado sem clique. As 4 visões, o progresso, o atrasado, a explicação de fonte, os painéis de dicas e clima estão implementados e degradam para "não renderiza" em vez de inventar dado. A skill está versionada e o validador funciona de verdade contra o zod real. E a correção do `$` faltando (`2aeddee`) desentala o `criar` de toda entidade do app, não só do checklist.

**Issues**: (1) `VERSAO` não subiu — crash real em cache quente; (2) o limite de privacidade não tem nenhum teste que o defenda (sonda M5 sobreviveu); (3) `reference/checklist-sugestoes.md` não existe e é referenciado 3× no `SKILL.md`; (4) `faseChecklist` é código morto; (5) progresso por pessoa mais restrito que o AC; (6) ~6 erros de lint novos; (7) T11 sem marca de conclusão.

**Next steps**: aplicar o Fix 1 (uma linha) e o Fix 2, depois re-verificar. Os Fixes 3-7 podem seguir junto ou virar um lote de limpeza. Depois de Fix 1+2, esta feature passa.
