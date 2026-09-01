# Assistente de IA Tasks

## Execution Protocol

A skill `tlc-spec-driven` **não está instalada** nesta máquina (verificado em 2026-09-01: não aparece nas skills disponíveis nem na busca). O `tasks.md` do `checklist-inteligente` manda parar quando ela falta — então este arquivo segue a mesma estrutura de tarefas, mas **sem** prometer o fluxo de execução dela (ciclo por tarefa, sub-agents, Verifier). Se a skill for instalada, ative-a por nome e siga o fluxo dela a partir daqui.

**Regras que valem com ou sem skill:**

- Uma tarefa = um commit. `npm test` e `npm run build` verdes antes de cada um.
- Nenhuma tarefa de IA começa antes de T1 estar mergeada e verde.
- Toda string de produto vai para `config/site.ts`. Toda cor, para `config/theme.ts`.
- Comentários e identificadores em pt-BR. Imports com `.ts`.
- Atalho deliberado ganha comentário `ponytail:` nomeando o teto e a saída.

**Design**: `.specs/features/assistente-ia/design.md`
**Spec**: `.specs/features/assistente-ia/spec.md`
**Status**: 0/24 — não iniciado

---

## Fase 0 — Fundação (sem IA, sem custo)

Nada aqui chama a Anthropic. Tudo é revisável antes de gerar um centavo.

### T1 — Extrair o caminho de escrita para `lib/escrita.ts`
**A tarefa mais perigosa da feature. Commit isolado, nada mais junto.**
Mover `TABELA`, `autorizar`, `aplicar`, `recorte`, `conferirPai`, `gravarDespesa` de `app/api/mutate/route.ts` para `lib/escrita.ts`, sem alterar **uma linha** de comportamento. `/api/mutate` passa a importar.
- **Feito quando**: `npm test` (290 testes) e `npm run build` verdes; `git diff` mostra só movimentação e imports; criar/editar/remover de cada entidade continua funcionando.
- **Por que primeiro**: toca a escrita do app inteiro. Isolada, o `git bisect` distingue "a extração quebrou" de "o assistente quebrou".
- _Requisitos_: IA-03

### T2 — `change_log` ganha `origem` e `lote`
`db/schema.sql`: colunas no bloco `create` **e** na seção de migrações (banco em uso não vê o `create` — armadilha documentada no CLAUDE.md). Índice em `(trip_id, lote)`. `registrarAlteracao` ganha os dois parâmetros no fim, opcionais, para as 7 chamadas existentes seguirem compilando.
- **Feito quando**: `npm run db:push` roda limpo duas vezes seguidas (idempotência); escrita normal pela tela grava `origem='pessoa'`.
- _Requisitos_: IA-05

### T3 — Tabela `ai_usage` e `config/precos.ts`
Tabela nova (`create table if not exists`), `trip_id` com `on delete set null` — apagar viagem não apaga histórico de gasto. Preços por modelo em `config/`, não no código.
- **Feito quando**: `db:push` idempotente; apagar uma viagem de teste preserva as linhas de `ai_usage`.
- _Requisitos_: IA-23

### T4 — `contextoDoSnapshot` em `lib/preparacao.ts`
Extrair a montagem de `Contexto` do `useMemo` de `tabs/Preparacao.tsx:102-185` para função pura. A aba passa a chamá-la.
- **Feito quando**: a aba Preparação mostra exatamente as mesmas pendências de antes; teste novo cobre a função.
- _Requisitos_: IA-18

### T5 — `VERSAO` do cache offline 6 → 7
O snapshot muda de forma nesta feature. Confirmar que a store `arquivos` e a `fila` sobrevivem ao bump — regra do CLAUDE.md.
- **Feito quando**: abrir o app com cache antigo não quebra a primeira pintura; cofre offline continua populado após o upgrade.

---

## Fase 1 — Motor puro (sem rede)

### T6 — `lib/assistente.ts`: ferramentas a partir do zod
`ferramentas(papel)` derivando JSON Schema de `POR_ENTIDADE` via `z.toJSONSchema()` (confirmado no `zod@4.4.3` do projeto). `strict: true`, `additionalProperties: false`. Exportar `esquemaDe(entidade)` de `lib/schema.ts`.
- **Feito quando**: os testes de T10 passam.
- _Requisitos_: IA-08

### T7 — `lib/assistente.ts`: digest da viagem
Snapshot → texto compacto para o modelo. **Omite estruturalmente** `travelers.passaporte`, telefone, e-mail e `documents.valor`: a IA sabe que o passaporte vence, não o número. Conteúdo de usuário entra delimitado e rotulado como dado.
- **Feito quando**: testes de T10 confirmam as omissões e a delimitação.
- _Requisitos_: IA-01, IA-11, IA-17

### T8 — `lib/assistente.ts`: receitas e modos
`RECEITAS` por modo (`criar_viagem`, `duvida`, `curiosidade`, `preparacao`) e por gatilho (resumo de lugar, planejar dia). Todo texto de prompt vive aqui — nenhum dentro de componente.
- _Requisitos_: IA-14, IA-20

### T9 — `lib/assistente.ts`: `tool_use` → proposta
Traduzir blocos do modelo em `{ref, entidade, op, campos, resumo}`. Rejeitar entidade fora da lista. `ref` é efêmero, nunca id de banco.
- _Requisitos_: IA-02, IA-04

### T10 — `lib/assistente.test.ts`
Sem framework, `node --test`, no padrão do repo. Cobre: `ferramentas('visualizador')` não traz `roteiro`/`voo`/`custo`; `ferramentas('editor')` bate com `POR_ENTIDADE` menos as proibidas; toda ferramenta é `strict`; digest não contém passaporte, telefone, e-mail nem `documents.valor`; digest de `visualizador` não traz total da viagem; tradutor rejeita entidade fora da lista.
- **Feito quando**: `npm test` sobe de 290 para ~305 testes, todos verdes.
- _Requisitos_: IA-01, IA-08, IA-17

### T11 — `lib/consumo.ts` + testes
Tokens → custo estimado com a tabela de `config/precos.ts`; agregação por pessoa, modo e período. Puro.
- _Requisitos_: IA-23

---

## Fase 2 — A conversa (primeira chamada real)

### T12 — `POST /api/assistente`
`runtime = 'nodejs'`. `exigirUsuario` + `exigirViagem`. Limite por conta (`assistente:${userId}`, 30/hora) reusando `registrarFalha`. Contexto **só** de `getSnapshot(tripId, papel, participanteId)`. Modelo `claude-opus-5`, `thinking: {type:'adaptive'}`, `effort` por modo, `max_tokens: 16000`, sem streaming. Cache: `cache_control` no fim do `system`; digest depois do breakpoint. Grava `ai_usage`. **Não importa `lib/escrita.ts`.**
- **Feito quando**: `curl` devolve texto + propostas; nenhuma linha gravada em nenhuma tabela de viagem; `ai_usage` ganhou uma linha; sem chave configurada responde erro em pt-BR e o resto do app segue de pé.
- **Medir aqui**: `messages.countTokens` no digest de uma viagem real de 5 pessoas. Se passar de alguns milhares de tokens por mensagem, o cache deixa de ser otimização e vira requisito.
- _Requisitos_: IA-01, IA-02, IA-09, IA-10, IA-23

### T13 — `POST /api/assistente/aplicar`
O único lugar do assistente com escrita. Cada proposta aceita passa por `autorizar` + `validarCampos` de `lib/escrita.ts` com o `Acesso` da sessão. Gera um `lote`, grava `origem='assistente'`. Envelope idêntico ao de `/api/mutate`.
- **Feito quando**: `visualizador` tentando aplicar proposta de `roteiro` recebe recusa sem linha gravada; `editor` aplica e a linha nasce com `lote` e `origem` no `change_log`.
- _Requisitos_: IA-03, IA-05, IA-07

### T14 — `POST /api/assistente/desfazer`
Replay reverso do `lote`: apaga o que foi criado, restaura valor anterior do que foi editado. Remoções não são desfeitas — não há como.
- **Feito quando**: aplicar 5 propostas e desfazer devolve o banco ao estado anterior.
- _Requisitos_: IA-06

### T15 — Teste de paridade de envelope
Comparar as chaves da resposta de `/api/assistente/aplicar` com as de `/api/mutate`. O README documenta que os dois já divergiram e "every write crashed the next render".
- _Requisitos_: IA-07

---

## Fase 3 — Superfícies

### T16 — `RevisaoPropostas.tsx`
Lista as propostas, permite desmarcar item, aceitar em bloco ou descartar tudo. **Remoções em destaque, com o aviso de que só elas não têm volta** — antes do aceite.
- _Requisitos_: IA-04, IA-06

### T17 — `Assistente.tsx` + botão flutuante + aba
Painel a partir de qualquer aba sem perder o estado da tela; aba dedicada monta o mesmo componente com o mesmo histórico. Envia a aba aberta como contexto. A aba entra no painel "Mais" do Shell; o acesso rápido no celular é o botão flutuante.
- _Requisitos_: IA-12, IA-22

### T18 — Modo `duvida` com contexto de tempo e lugar
Servidor manda agora-no-fuso-do-destino, compromisso atual e próximo âncora, derivados de `lib/hoje.ts` (não recalculados). É o que faz "estou aqui, tenho 40 minutos" ser respondível.
- **Feito quando**: às 15h do dia 3, com jantar às 16h, a resposta não propõe algo que colida com o âncora.
- _Requisitos_: IA-20

### T19 — `lib/voz.ts` e o botão de ditado
Web Speech API em pt-BR, sem dependência nova. Texto reconhecido vai para a caixa e **espera** uma ação — nunca envia sozinho. Sem suporte no navegador, o botão some e o texto continua funcionando.
- _Requisitos_: IA-13

---

## Fase 4 — O guia

### T20 — Gatilhos contextuais
"Quer um resumo?" ao criar `lugar`; "planejar este dia" em dia vazio do roteiro; curiosidades **dentro** do item de Roteiro e da Cidade (`tabs/Roteiro.tsx`, `tabs/Conteudo.tsx`) — sem aba nova. Avisar antes de substituir campo já preenchido.
- _Requisitos_: IA-15, IA-21

### T21 — Criar viagem com IA
Entrada na tela de viagens: destino, datas, estilo, nº de pessoas → viagem inteira proposta, revisada em **bloco** com desmarcar item. Só grava no aceite.
- **Feito quando**: uma viagem de 7 dias é gerada, revisada e aceita em uma ação, com `lote` único e desfazer funcionando.
- _Requisitos_: IA-19

### T22 — Web search com fonte
`web_search_20260209` (variante com filtragem dinâmica, suportada no Opus 5). Fonte apresentada junto da resposta. Dado da web gravado carrega a fonte na nota. Falha de busca responde com o que sabe do snapshot **dizendo** que não confirmou, em vez de afirmar sem fonte.
- **Feito quando**: inspecionar a consulta e confirmar que nenhum número de documento, telefone ou localizador aparece nela.
- _Requisitos_: IA-16, IA-17

### T23 — Sugestão proativa de preparação
Consome `montarPreparacao` via `contextoDoSnapshot` (T4). Cada pendência oferece a ação que a resolve. Nenhuma tabela nova.
- _Requisitos_: IA-18

---

## Fase 5 — Consumo

### T24 — Relatório de gasto
`GET /api/assistente/consumo` + `tabs/Consumo.tsx`, restrito a `proprietario`. Duas partes:
- **Sempre**: consumo do próprio app por período, pessoa e modo, com custo estimado de `lib/consumo.ts`.
- **Condicional**: consolidado da organização via `usage_report/messages` e `cost_report` (HTTP cru — não estão nos SDKs), com `ANTHROPIC_ADMIN_KEY` lida **só aqui**, cache de 1 hora, e a rota devolvendo agregados, nunca o corpo bruto (que traz ids de workspace e de chave).

> **Atenção antes de começar**: a documentação oficial diz que *"The Admin API is unavailable for individual accounts"*. Se a conta na Anthropic não for uma organização no Console, esta metade não funciona — e a tela precisa **explicar isso em pt-BR**, não mostrar erro. Confirmar o tipo de conta antes de investir na parte consolidada.

- **Feito quando**: `editor` recebe 403; três perguntas de contas diferentes aparecem separadas por pessoa e modo; sem `ANTHROPIC_ADMIN_KEY` a tela mostra a parte do app e explica a ausência da outra.
- _Requisitos_: IA-24, IA-25

---

## Fechamento

- [ ] `README.md`: seção do assistente, a chave nova, e o assistente na lista de "não funciona offline".
- [ ] `CLAUDE.md`: dependências de runtime 4 → 5; a regra de que `/api/assistente` não importa `lib/escrita.ts`.
- [ ] `.specs/STATE.md`: fechamento da feature, o que não foi construído e por quê.
- [ ] `AGENTS.md`: commitar junto se `next dev` o regenerar.
