# Checklist Inteligente Validation — Iteração 2 (re-verificação)

**Date**: 2026-08-24
**Spec**: `.specs/features/checklist-inteligente/spec.md`
**Diff range**: `main..HEAD` (`1a2c7c3..ac0859f`, 34 commits) · re-verificação incide sobre `c7235d4..ac0859f` (os 4 commits de correção)
**Verifier**: independent sub-agent (author ≠ verifier), read-only sobre a árvore real
**Iteração**: 2 de no máximo 3 · re-verifica as correções dos achados da iteração 1

## Validation: PASS ✅

A iteração 1 reprovou por dois motivos fora da tabela de ACs (1 blocker + 1 major) mais 5 achados menores. Os quatro commits seguintes endereçam todos os sete. **Verifiquei cada afirmação contra o código atual, não contra a mensagem do commit** — as sete se confirmam. O gate está verde (build limpo, 178/178), o lint voltou ao baseline documentado, e o mutante de controle continua sendo morto, então a limpeza não enfraqueceu o poder discriminante da suíte.

Restam 3 achados **cosméticos** novos (documentação desalinhada e uma nota de processo), nenhum deles bug, nenhum deles bloqueante. E permanece 1 **risco residual** conhecido e honestamente documentado: a camada `lib/db.ts` — onde vive o limite de privacidade — não tem teste automatizado, por um padrão que vale para o repositório inteiro, não para esta feature.

---

## Verificação das correções da iteração 1

| # | Achado da iteração 1 | Severidade | Commit | Verificação independente | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | `VERSAO` não subiu em `lib/offline.ts` — cache quente do IndexedDB crasha na primeira pintura | **Blocker** | `6b357a6` | `lib/offline.ts:23` - `const VERSAO = 4`. O bump veio acompanhado da linha de changelog no comentário do próprio arquivo (`:21-22`: "3 -> 4 cada item de checklist ganhou assigned_to, prioridade, pais/cidade, os três vínculos de roteiro, pendente e os três campos de fonte"), no formato que as entradas 1→2 e 2→3 já usavam | ✅ Corrigido |
| 2 | `reference/checklist-sugestoes.md` citado 3× no `SKILL.md` e inexistente | **Major** | `2acb256` | Arquivo existe, 109 linhas, conteúdo real (processo de 7 passos, não stub). Os 4 links relativos internos resolvem: `../templates/categorias-e-fases.md`, `../rules/dedup-e-prioridade.md`, `../mappings/campo-para-app.md`, `../schema/checklist-sugestoes.schema.json` — todos presentes na árvore. **Testei o lote de exemplo do arquivo** (`:57-87`) extraindo o bloco JSON e rodando `validators/validar-sugestoes.mjs` contra ele: `APROVADO`, contagem `sugestao 2 / pesquisa 1`, exit 0 | ✅ Corrigido |
| 3 | `SKILL.md` linkava `changelog/CHANGELOG.md` (inexistente) em 2 pontos | Minor | `2acb256` | `SKILL.md:14` e `:119` agora apontam para `CHANGELOG.md` na raiz da skill. Varri **todas** as 8 referências a `.md`/`.json` do `SKILL.md`: cada uma resolve para um arquivo presente | ✅ Corrigido |
| 4 | `faseChecklist` era código morto (função + 8 testes) | Minor | `9e6b566` | `grep -rn faseChecklist --include=*.ts --include=*.tsx` sobre o repo → **zero ocorrências**. `faseDaViagem` (função pré-existente, homônima parcial, usada em `lib/derive.ts:137`) permaneceu intacta — a remoção foi cirúrgica, não um `grep`-e-apaga | ✅ Corrigido |
| 5 | CHK-08 pedia progresso por pessoa sem recorte de papel; a implementação restringia a `proprietario` | Minor | `9e6b566` | `spec.md:69-70` agora traz CHK-08 (progresso geral, **todo participante**) e CHK-08a (por pessoa, **`proprietario`**), este com a justificativa de privacidade escrita no próprio AC e marcado `<!-- state-driven, achado no Verifier (validation.md), emendado 2026-08-24 -->`. Emenda de spec declarada, não silenciosa. Código re-conferido abaixo — bate com os dois | ✅ Corrigido |
| 6 | ~6 erros de lint novos nos arquivos desta feature | Minor | `9e6b566` | Total: **106 erros / 8 avisos** (iteração 1: 112/8) — de volta ao baseline de T11 registrado em `tasks.md:45`. `EditorSheet.tsx` voltou a 2 erros, exatamente o que `main` tinha. `Checklist.tsx` retém **1** erro (`:535`, `Date.now()` em render) — é o que a iteração 1 já atribuiu a código **movido** de `Interativas.tsx:183`, dívida realocada e não introduzida. Os 3 `Record<string, any>[]` viraram tipos estruturais locais (`EventoDica`, `LugarComCoordenada`, e 3 ramos de `useOpcoesDaFonte`), e o `Date.now()` de `Dicas` virou inicializador lazy de `useState` com comentário explicando a escolha | ✅ Corrigido |
| 7 | T11 sem marca de conclusão (bookkeeping) | Minor | `9e6b566` | `tasks.md:332` - `### T11: Extrair Checklist() para components/tabs/Checklist.tsx ✅` | ✅ Corrigido |

`ac0859f` não altera código — só versiona o relatório da iteração 1. Confirmado por `git show --stat`: 1 arquivo, `validation.md`, 229 inserções.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1-T27 | ✅ Done | Todas marcadas ✅ em `tasks.md`. T11 era a única pendente na iteração 1; fechada em `9e6b566` |

Desvios de "Done when" que sobrevivem da iteração 1:

- **T16** — "mutate em lote (não um `POST` por item)". Inalterado: `components/tabs/Checklist.tsx:428-430` ainda faz `for (…) await mutate(…)`, e `drenar()` (`components/TripProvider.tsx:123`) esvazia a fila a cada chamada → um POST por sugestão. Funcionalmente correto; não é o lote pedido. A iteração 1 não abriu fix task para isso e eu não escalo: é performance num fluxo de admin, não correção.
- **T11-T20** — "`npm run lint` limpo". Continua não literalmente limpo (106 erros), mas **o delta desta feature é zero** — é exatamente a dívida pré-existente que `tasks.md:45` isenta.

---

## Spec-Anchored Acceptance Criteria

Os 25 ACs passaram a checagem spec-anchored completa na iteração 1, com citação `file:line` para cada um. Esta iteração **re-derivou do zero os 2 que estavam parciais** (CHK-08/08a, CHK-24) e **re-conferiu uma amostra** dos demais, priorizando o caminho de privacidade (o de maior risco) e os ACs com asserção automatizada.

### Re-derivados integralmente (eram ⚠️ parcial na iteração 1)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + evidência | Result |
| --- | --- | --- | --- |
| **CHK-08** · progresso geral (`concluídos/total`, %) **para todo participante**, só sobre itens visíveis a quem pede (`spec.md:69`) | bloco de progresso renderizado independentemente do papel | `components/tabs/Checklist.tsx:76` - `progressoChecklist(itens as { id: string }[], meus)` sobre `itens` (já filtrado pelo servidor em `lib/db.ts:397-406`); renderizado em `:126-137` **fora** de qualquer guarda de papel — `{progresso.feitos}/{progresso.total} · {progresso.pct}%` | ✅ PASS (código) |
| **CHK-08a** · progresso por pessoa **enquanto** quem pede é `proprietario` (`spec.md:70`) | bloco por pessoa presente para `proprietario`, ausente para os outros papéis | `components/tabs/Checklist.tsx:70` - `const souProprietario = snapshot.eu.papel === 'proprietario'`; `:141` - `{souProprietario && (` fecha o bloco `:142-163`; cálculo em `:148-151` sobre `itens.filter((i) => i.escopo === 'global' \|\| i.assigned_to.includes(p.id))`. O comentário `:139-140` reproduz a razão que o AC agora declara | ✅ PASS (código) |
| **CHK-24** · `skillVersion`/`schemaVersion` declarados + changelog com uma entrada por mudança | versões batendo com o app; changelog existente e íntegro | `SKILL.md:4-5` - `skillVersion: 1.1.0`, `schemaVersion: 3`; bate com `lib/schema.ts:12` - `export const SCHEMA_VERSION = 3`. `CHANGELOG.md` na raiz da skill com entradas `1.1.0` e `1.0.0`, uma por versão aplicada, e a regra escrita de que proposta não-aplicada não entra. **Todas** as referências do `SKILL.md` resolvem agora — a razão do "parcial" desapareceu | ✅ PASS |

### Amostra re-conferida (eram ✅ na iteração 1)

| Criterion | Spec-defined outcome | `file:line` + asserção | Result |
| --- | --- | --- | --- |
| CHK-02/03 · item pessoal alheio excluído server-side | linha ausente da resposta, não escondida | `lib/db.ts:397-406` - `proprietario` cai no ramo `select *`; os demais em `where trip_id = ${tripId} and (escopo = 'global' or ${participanteId} = any(assigned_to))`. Intacto após os 4 commits | ✅ PASS (código) |
| CHK-05 · `prioridade` default `importante`, fora do enum rejeitado | `'importante'` quando omitido | `lib/schema.test.ts:229-236` - `assert.equal(r.sucesso && r.dados.checklist[0].prioridade, 'importante')`; `:238-242` - `assert.equal(r.sucesso, false)` + `assert.match(…, /prioridade/)` | ✅ PASS |
| CHK-14 · dedup por título normalizado descarta, não erra | `validas` vazio, `erros` vazio, `duplicadas` contado | `lib/checklist.test.ts:60-65` - `assert.equal(r.validas.length, 0)`, `assert.equal(r.erros.length, 0)`, `assert.equal(r.duplicadas, 1)`; intra-lote em `:67-74` - `validas.length === 1` | ✅ PASS |
| CHK-12 · `pesquisa` exige `fonte_detalhe` + `fonte_consultado_em` | rejeitado sem as duas | `lib/schema.ts:426-429` (`.refine`); `lib/schema.test.ts:263-265`. Re-confirmado ponta-a-ponta: o lote de exemplo do novo `reference/checklist-sugestoes.md` traz uma sugestão `fonte_tipo: "pesquisa"` **com** as duas e passa `APROVADO` no validador real | ✅ PASS |
| CHK-07 · 4 visões, nenhuma esconde item | as 4 existem | `components/tabs/Checklist.tsx:21-26` (`VISOES`). Re-conferido pós-remoção de `faseChecklist`: continuam 4, nenhuma dependia da função removida | ✅ PASS (código) |

**Status**: ✅ **25/25 ACs cobertos e batendo o outcome definido no spec** · 0 parciais · 0 sem evidência.

**Nota sobre "evidência de código" vs. asserção** (inalterada da iteração 1, repetida porque continua verdadeira): 13 dos 25 ACs vivem em camadas que a Test Coverage Matrix (`tasks.md:26-33`) marca explicitamente como `nenhum automatizado` — dado (`lib/db.ts`), rota (`app/api/mutate`) e UI (`components/**`). Para esses, a evidência é o código citado mais a verificação manual registrada no `Done when` de cada tarefa. É mais fraca que uma asserção, e a sonda M5 mede exatamente o quanto (ver abaixo).

---

## Discrimination Sensor

**Objetivo desta iteração**: confirmar que a limpeza de `9e6b566` (remoção de 46 linhas de `lib/derive.ts` + 34 de `lib/derive.test.ts`, retipagem de 3 casts, mudança de `Date.now()` para `useState`) não enfraqueceu o poder discriminante da suíte. Um mutante de controle basta para isso.

Scratch: `git worktree add` num diretório do scratchpad + junction para `node_modules`; mutação por script Python (com `assert` de contagem de ocorrência, para não mutar o alvo errado em silêncio); `npm test`; `git worktree remove --force`. **Nenhum `git stash` usado.**

| # | File:line | Mutação | Resultado |
| --- | --- | --- | --- |
| M1 (controle, re-run) | `lib/checklist.ts:19` | Removido `.replace(MARCAS_DIACRITICAS, '')` de `normalizarTitulo` — dedup deixa de ignorar acento | ✅ **Killed** — 178 tests, 177 pass, **1 fail**. `ERR_ASSERTION`, `actual: 'passaporte válido!'` vs `expected: 'passaporte valido!'` |

**Isolamento verificado**: `git status --porcelain` da árvore real **vazio antes** e **vazio depois**; `git worktree list` volta a listar só `C:/repos/travel-guide`. Nenhum arquivo real tocado pelo sensor.

**Sensor depth**: lightweight, 1 mutação de controle (as outras 3 de M1-M4 foram mortas na iteração 1; M4 mirava `faseChecklist`, que deixou de existir, então não é re-executável por definição).
**Result**: **1/1 killed** — poder discriminante preservado.

### Risco residual: sonda M5 (não corrigida, deliberadamente)

| # | File:line | Mutação | Resultado |
| --- | --- | --- | --- |
| M5 (sonda) | `lib/db.ts:403` | `and (escopo = 'global' or ${participanteId} = any(assigned_to))` → `and (true or …)` | ❌ **Survived** (iteração 1: 186/186 continuaram passando) |

Não re-executei M5: o resultado é estruturalmente determinado (a linha não tem cobertura automatizada) e a iteração 1 já o mediu. **Confirmei em vez disso que a lacuna é do repositório, não desta feature:**

- Não existe `lib/db.test.ts` — os únicos arquivos de teste são `lib/{checklist,derive,financeiro,schema,session}.test.ts`.
- `grep -rn "financeiroDaViagem\|getSnapshot\|checklistDaViagem" --include=*.test.ts` sobre o repo → **zero ocorrências**. Nenhuma função de `lib/db.ts` tem teste unitário, incluindo `financeiroDaViagem`, que carrega um limite de privacidade de rigor idêntico e é anterior a esta feature.
- `tasks.md:31` declara a camada como `nenhum automatizado`, com a razão (precisa de Neon real; `test:api` está quebrado por decisão anterior registrada em `CLAUDE.md`) e a mitigação (verificação manual no `Done when` de cada tarefa).
- `checklistDaViagem` foi construída **espelhando** `financeiroDaViagem` (o comentário em `lib/db.ts:390-392` diz isso explicitamente), então segue o precedente do repo em vez de abrir uma exceção.

**Veredito sobre M5**: limitação honesta, consistente e pré-existente — declarada na matriz de cobertura, no relatório da iteração 1 e aqui. **Não reprova a feature.** Mas o fato permanece e vale dito sem rodeio: *a linha mais sensível desta feature pode ser apagada inteira sem que um único teste reclame.* A defesa hoje é revisão de código e verificação manual, não a suíte.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ Resolvido nesta iteração — `faseChecklist` (46 linhas + 8 testes) removido em vez de ganhar uma visão fora de escopo para justificá-lo. Escolha correta: o spec nunca pediu a 5ª visão |
| Surgical changes | ✅ Os 4 commits somam 6 arquivos de código + 3 de spec/docs. `git show --stat` de cada um bate com o que a mensagem declara — nenhum arquivo a mais |
| No scope creep | ✅ Nenhuma correção passou do escopo do achado que endereçava. `2acb256` escreveu o arquivo faltante em vez de reapontar os links (a alternativa oferecida pela iteração 1) — mais trabalho, mas é o que o `description` do front-matter promete ao agente que carrega a skill |
| Matches patterns | ✅ pt-BR mantido em identificadores e comentários (`EventoDica`, `LugarComCoordenada`, `souProprietario`); nenhuma dependência nova; o comentário de changelog no `lib/offline.ts` segue o formato das entradas 1→2 e 2→3 |
| Spec-anchored outcome check | ✅ 25/25 — os 2 parciais fecharam |
| Per-layer Coverage Expectation met | ✅ domínio 1:1 com os ACs; ⚠️ rota/dado/UI sem cobertura — desvio pré-existente documentado em `tasks.md:26-35`, não introduzido aqui |
| Todo teste mapeia um requisito — sem teste órfão | ✅ Resolvido — os 8 testes órfãos de `faseChecklist` saíram junto com a função. Os 178 restantes mapeiam AC, edge case ou `Done when` |
| Guidelines seguidas | ✅ `CLAUDE.md` (incluindo o gotcha do `VERSAO`, que era exatamente a exceção da iteração 1 e foi fechada), `AGENTS.md`, `tasks.md` |

**Lint**: **106 erros / 8 avisos** (iteração 1: 112/8). Bate com o baseline de T11 registrado em `tasks.md:45`. Distribuição confirma que a dívida é pré-existente e alheia: `TripProvider.tsx` 22, `Roteiro.tsx` 18, `Financeiro.tsx` 15, `derive.ts` 9, `PdfBolso.tsx` 8. Arquivos desta feature: `EditorSheet.tsx` 2 (igual a `main`), `Checklist.tsx` 1 (dívida movida de `Interativas.tsx`). **Delta desta feature: zero.**

Descartado após verificação: o aviso `'useState' is defined but never used` em `Interativas.tsx:7` **não** foi criado pela extração do checklist — `git show main:components/tabs/Interativas.tsx | grep -c useState` devolve `1` (só o import), ou seja, já estava sem uso em `main`.

---

## Edge Cases

- [x] Item pessoal editado para ficar sem dono → rejeitado. `db/schema.sql:305` (`checklist_pessoal_tem_dono`) + espelho no formulário em `components/EditorSheet.tsx:566-573`
- [x] Duas sugestões do mesmo lote com título igual → só a primeira. `lib/checklist.ts:115` + `lib/checklist.test.ts:67-74`
- [x] **`VERSAO` do snapshot bumped** — `lib/offline.ts:23` é `4`. **Era o blocker da iteração 1; fechado.** O cache do IndexedDB gravado pela versão anterior é descartado no `onupgradeneeded`, então a primeira pintura nunca encontra um item de checklist sem `assigned_to` — que era a origem do `TypeError` em `Checklist.tsx:42` e `:148`
- [x] `visualizador` editando item de terceiro → 403. `app/api/mutate/route.ts:53` + `:147-158`
- [x] Vínculo removido do roteiro → item preservado. `db/schema.sql:296-299` (`on delete set null`)

---

## Gate Check

- **Gate command**: `npm run build && npm test` (nível Build, `tasks.md:43`)
- **Result**: build ✅ **exit 0**, typecheck incluso · testes ✅ **exit 0** — **178 passed, 0 failed, 0 skipped, 0 todo**
- **Test count iteração 1**: 186
- **Test count iteração 2**: 178
- **Delta**: **−8**, e **só −8**. Verificado, não presumido: `git diff c7235d4..HEAD -- '*.test.ts'` devolve **um único arquivo** (`lib/derive.test.ts`, 34 deleções, 0 inserções), e as 34 linhas são exatamente os 8 `test('faseChecklist …')` mais o import. Nenhum outro arquivo de teste tocado, nenhuma asserção enfraquecida, nenhuma perda silenciosa
- **Contagem por arquivo** (soma 178): `checklist.test.ts` 10 · `derive.test.ts` 73 · `financeiro.test.ts` 44 · `schema.test.ts` 35 · `session.test.ts` 16
- **Test Integrity**: ✅ a única remoção é justificada (código morto removido junto com seus testes — testes de uma função que não existe mais não são cobertura perdida)
- **Delta vs. antes da feature**: 157 → 178 = **+21 testes**
- **Skipped**: nenhum
- **`npm run lint`**: fora do gate por decisão registrada (`tasks.md:45`). Rodado assim mesmo: **106 erros / 8 avisos**, de volta ao baseline
- **`validators/validar-sugestoes.mjs`**: rodado contra o lote de exemplo do novo `reference/checklist-sugestoes.md` → `APROVADO`, `sugestao 2 / pesquisa 1`, **exit 0**

---

## Fix Plans

Nenhum bloqueante. Os três abaixo são cosméticos e podem entrar num lote de limpeza ou ser ignorados sem risco.

### Achado 1: `CHANGELOG.md` da skill ainda cita um diretório `changelog/` — **Cosmético**

- **Root cause**: a entrada `1.1.0` lista as pastas novas como "`schema/`, `rules/`, `templates/`, `mappings/`, `validators/`, `changelog/`". `design.md:22` decidiu pelo `CHANGELOG.md` na raiz, e `ls .claude/skills/viagem-para-json/changelog` → não existe. `2acb256` consertou as duas ocorrências no `SKILL.md` mas não esta, no próprio changelog.
- **Efeito**: nenhum em runtime — é prosa, não link. Mas o "Done when" do Fix 2 da iteração 1 dizia "`SKILL.md` **e `CHANGELOG.md`** só citam arquivos presentes na árvore", e essa metade não fechou.
- **Fix task**: apagar `changelog/` da enumeração.

### Achado 2: linha "Coverage" do `spec.md` está obsoleta — **Cosmético**

- **Root cause**: logo abaixo da tabela de rastreabilidade, `spec.md` ainda diz "**Coverage:** 25 total, 0 mapped to tasks, 25 unmapped ⚠️ (esperado antes da fase Tasks)". Sobrou da fase Specify — os 25 estão mapeados a tarefas e verificados.
- **Fix task**: atualizar para "25 total, 25 mapped to tasks, 0 unmapped ✅". Não editei: meu mandato nesta iteração é a coluna de status da tabela.

### Achado 3: `tasks.md` ainda pede "cálculo de fase" na matriz de cobertura — **Cosmético**

- **Root cause**: a linha "Domain / lógica pura" da Test Coverage Matrix (`tasks.md:28`) lista "1:1 com os ACs do spec (CHK-14, CHK-18, CHK-19, **cálculo de fase**)". `faseChecklist` foi removida em `9e6b566` e a matriz não acompanhou.
- **Fix task**: tirar "cálculo de fase" da enumeração.

### Nota de processo (não é fix task)

`9e6b566` virou **as 25 linhas** da tabela de rastreabilidade de `Implementing` para `Verified` — incluindo as duas que a iteração 1 tinha marcado como parciais — no mesmo commit em que o autor implementava as correções. O status `Verified` é veredito do Verifier, não do implementador; a ordem correta é o Verifier confirmar e então a tabela mudar. Registro porque o padrão importa mais que o caso: **aqui o estado final está certo** — re-derivei CHK-08/08a e CHK-24 do zero e re-conferi uma amostra dos demais, e todos se sustentam. Mas a marca precedeu a verificação que a justifica.

---

## Requirement Traceability Update

| Requirement | Previous Status (iteração 1) | New Status (iteração 2) |
| --- | --- | --- |
| CHK-01 … CHK-07 | ✅ Verified | ✅ Verified (sem mudança) |
| **CHK-08** | ⚠️ Verified parcialmente — por pessoa só para proprietário | ✅ **Verified** — AC emendado para "progresso geral, todo participante"; código bate |
| **CHK-08a** | *(não existia)* | ✅ **Verified** — novo AC (progresso por pessoa, `proprietario`), emendado em `9e6b566` com justificativa de privacidade; linha própria adicionada à tabela do `spec.md` |
| CHK-09 … CHK-23 | ✅ Verified | ✅ Verified (sem mudança) |
| **CHK-24** | ⚠️ Verified parcialmente — links quebrados, `reference/checklist-sugestoes.md` ausente | ✅ **Verified** — arquivo escrito e validado, links corrigidos, versões batendo |
| CHK-25 | ✅ Verified | ✅ Verified (sem mudança) |

**25 ACs + CHK-08a = 26 linhas, todas ✅ Verified.**

---

## Summary

**Overall**: ✅ **Ready**

**Spec-anchored check**: **25/25** ACs batem o outcome definido no spec (26 linhas de rastreabilidade contando CHK-08a) · 0 parciais · 0 sem evidência
**Sensor**: **1/1** mutante de controle morto — poder discriminante preservado após a limpeza · 1 sonda (M5) segue sobrevivendo, por lacuna de cobertura do repositório inteiro
**Gate**: build ✅ exit 0 · **178 passed / 0 failed / 0 skipped** · delta −8 verificado linha a linha como sendo só os testes do código morto removido
**Lint**: 106 erros — baseline documentado, delta desta feature = **zero**

**O que funciona**: as sete correções da iteração 1 se confirmam no código, não só nas mensagens de commit. O blocker real — `VERSAO` parada em 3 enquanto o snapshot ganhava 11 campos — está fechado com a linha de changelog que o arquivo pedia. O arquivo faltante da skill não virou stub para calar o link: são 109 linhas de processo com o lote de exemplo passando `APROVADO`/exit 0 no validador de verdade. O código morto foi removido em vez de ganhar uma visão inventada para justificá-lo, e a emenda de CHK-08/08a declara a restrição de privacidade no spec em vez de deixar código e spec divergindo em silêncio. A privacidade continua decidida no SQL (`lib/db.ts:397-406`), o export herda o filtro por derivar de `getSnapshot`, e nenhuma sugestão vira item sem clique de admin.

**Risco residual (1)**: o limite de privacidade em `lib/db.ts` não tem teste automatizado — a sonda M5 apaga a cláusula inteira e a suíte não reclama. Confirmei que isso vale para **toda** a `lib/db.ts` (nenhum `lib/db.test.ts`, nenhum teste referenciando `financeiroDaViagem`/`getSnapshot`/`checklistDaViagem`), que é o que `tasks.md:31` declara, e que `checklistDaViagem` espelha deliberadamente o precedente de `financeiroDaViagem`. Limitação honesta e consistente, não uma lacuna aberta por esta feature — mas continua sendo a linha mais sensível do trabalho, defendida hoje por revisão e verificação manual, não pela suíte. Fechar isso é um projeto de infraestrutura de teste (DB de teste ou convenção de mock para Postgres) para o repositório inteiro, não uma tarefa desta feature.

**Achados cosméticos (3)**: `changelog/` fantasma na prosa do `CHANGELOG.md` da skill; linha "Coverage" obsoleta no `spec.md`; "cálculo de fase" órfão na matriz de cobertura do `tasks.md`. Nenhum afeta runtime.

**Next steps**: feature liberada. Os 3 cosméticos podem entrar em qualquer commit de limpeza futuro. Se algum dia houver apetite para infraestrutura de teste de banco, `checklistDaViagem` e `financeiroDaViagem` são os dois primeiros alvos, nessa ordem.
