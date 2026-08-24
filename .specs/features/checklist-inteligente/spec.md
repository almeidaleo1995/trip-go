# Checklist Inteligente Specification

## Problem Statement

O checklist do TripGo hoje é uma lista compartilhada plana: todo item é `global` ou `pessoal` só de nome, sem dono, sem prioridade, sem vínculo com roteiro/voo/hospedagem/destino, e sem nenhuma forma de a skill `viagem-para-json` alimentá-lo a partir dos documentos da viagem. Isso obriga cada participante a descobrir sozinho o que precisa fazer, levar e verificar, e obriga o admin a montar o checklist inteiro à mão. O objetivo é um checklist contextual — que sabe quem, quando, onde e por quê — capaz de nascer de sugestões da skill (com fonte e data) além da criação manual.

## Goals

- [ ] Um item de checklist pode ser atribuído a ninguém em particular (todos), a uma pessoa, ou a várias, e a visibilidade de itens pessoais é aplicada no servidor, nunca só escondida na UI.
- [ ] Um item pode se vincular a país/cidade/dia/passeio/hospedagem/voo/cruzeiro, e a tela oferece visões por categoria, por pessoa, por destino e "tudo".
- [ ] A skill `viagem-para-json` consegue emitir sugestões de checklist (fonte + data, nunca inventadas) que o admin revisa, edita, aprova ou rejeita antes de virarem itens reais.
- [ ] Zero dependência nova de LLM em produção — a inteligência roda na skill, fora do app.

## Out of Scope

Explicitamente excluído. Documentado para evitar scope creep.

| Feature | Reason |
| --- | --- |
| Motor de diff/merge campo-a-campo genérico (roteiro, voos, hospedagens, cruzeiro) ao reimportar uma viagem existente | Checklist é uma lista — sugestões só se somam, nunca sobrescrevem. Reconciliar valores escalares (horário, endereço) é um problema à parte, maior que checklist. Ver `context.md` → Deferred Ideas. |
| Entidade "grupo" nomeada e reutilizável de participantes | `assigned_to` como lista simples já cobre "todos / uma pessoa / várias / um grupo ad-hoc" pedido na seção 2 do brief original. Nomear e persistir o grupo é especulativo até o padrão se repetir. |
| Tombstone de sugestões rejeitadas | Rejeitar apaga a linha. Sem histórico de rejeição nesta versão. |
| Chamada de LLM/IA em produção (backend do app) | A skill roda fora do app, como `viagem-para-json` já faz hoje. Ver AD a ser registrada em `STATE.md`. |
| Módulo de atividades/ingressos, módulo de guia | Já listados como limitação conhecida no README; checklist vincula ao `itinerary_events` existente (que cobre passeio/hospedagem), não depende de um módulo de atividades novo. |
| PWA/offline polish geral | Fora desta feature; só a obrigação pontual de bump de `VERSAO` quando o snapshot mudar de forma está dentro. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Onde a skill roda | Fora do app (Claude Code/Desktop), sem API de LLM em produção | Decisão explícita do usuário — evita nova dependência/custo em produção | y |
| Modelo de atribuição | Lista simples `assigned_to: participante_id[]` no item | Decisão explícita do usuário — sem entidade "grupo" | y |
| Privacidade vs. atribuição | `escopo` controla visibilidade; `assigned_to` em item `global` é só destaque | Decisão explícita do usuário | y |
| Quem vê itens pessoais de terceiros | Só `proprietario` | Decisão explícita do usuário — mais restrito que o financeiro, adequado a dado pessoal (remédio) | y |
| Escopo do "não apagar dados" ao reimportar | Só sugestões de checklist (aditivo) | Decisão explícita do usuário — motor genérico fica pra depois | y |
| Sugestão rejeitada | Hard delete, sem tombstone | Decisão explícita do usuário; `ponytail:` no código de import marcando o ceiling | y |
| Fonte do clima | API ao vivo no backend do app | Decisão explícita do usuário, apesar de ser nova dependência de produção | y |
| Vínculo com país/cidade/hospedagem | Texto livre para país/cidade (segue `LugarSchema`/`Evento`), FK para `itinerary_events`/`flights`/`cruises` (hospedagem é um `itinerary_events` com `tipo`) | Resolvido lendo `lib/schema.ts`/`db/schema.sql` — não existe entidade normalizada de país/cidade nem tabela de hospedagem separada | y |
| Categoria livre | Reusa `categoria: TextoOpc` já existente | Já é texto livre hoje — "admin cria categoria adicional" não exige mudança de schema | y |
| Prioridade | Enum fixo `obrigatorio \| importante \| recomendado \| opcional` | Pedido direto e sem ambiguidade na seção 34 do brief | y |
| "Fase da viagem" | Calculada em `lib/derive.ts` a partir de `prazo_ideal`/`dia`/datas da viagem, não armazenada | Segue o padrão já existente de cálculos puros do app; evita coluna redundante | y |
| Dicas inteligentes | Reusa `Evento.dicas` já existente | Dado já existe no roteiro; painel é leitura direta, sem coluna nova | y |
| Provedor de clima específico | Design escolhe, preferindo provedor sem API key (ex.: Open-Meteo) | Mantém o espírito de "sem dependência para o que poucas linhas resolvem" mesmo com a decisão de API ao vivo | n — Design confirma |
| Algoritmo de dedup de título | Normalização (minúsculo, trim, sem acento) + comparação de string; Design detalha limiar se precisar de fuzzy match | Mecanismo, não decisão de produto | n — Design confirma |

**Open questions:** none — todas resolvidas ou registradas acima.

---

## User Stories

### P1: Checklist contextual — modelo e tela ⭐ MVP

**User Story**: Como participante da viagem, quero ver e organizar o checklist por pessoa, categoria e destino, com prioridade e prazos, e ter certeza de que meus itens pessoais não aparecem para quem não deveria vê-los.

**Why P1**: É a reformulação central pedida — sem isso não há "checklist inteligente", só o texto de sugestões da skill sem lugar pra pousar.

**Acceptance Criteria**:

1. WHEN um `proprietario` ou `editor` cria um item de checklist com `escopo=global` e `assigned_to` vazio THEN o sistema SHALL torná-lo visível para todos os participantes da viagem. <!-- event-driven -->
2. WHEN um item é criado com `escopo=pessoal` e `assigned_to` contendo um ou mais `participante_id` THEN o sistema SHALL retorná-lo, no snapshot e no export, apenas para os participantes listados em `assigned_to` e para o `proprietario` da viagem. <!-- event-driven -->
3. IF um participante com papel `editor` ou `visualizador` solicita o snapshot da viagem THEN o sistema SHALL excluir da resposta os itens `pessoal` cujo `assigned_to` não contenha o `participante_id` de quem pediu. <!-- unwanted-behavior / auth boundary -->
4. WHILE um item tem `escopo=global` e `assigned_to` preenchido, o sistema SHALL mantê-lo visível a todos os participantes, usando `assigned_to` só para destacar responsabilidade na UI. <!-- state-driven -->
5. WHEN um item de checklist é criado ou editado THEN o sistema SHALL aceitar `prioridade` como um de `obrigatorio`, `importante`, `recomendado`, `opcional`, com `importante` como padrão quando omitido. <!-- event-driven -->
6. WHEN um item de checklist é criado ou editado com qualquer combinação de `pais`, `cidade`, `dia`, `itinerary_event_id`, `flight_id`, `cruise_id` THEN o sistema SHALL persistir os vínculos informados sem exigir nenhum deles. <!-- event-driven -->
7. WHEN a tela de Checklist carrega THEN o sistema SHALL oferecer as visões "Por categoria", "Por pessoa", "Por destino" e "Tudo", cada uma agrupando os itens visíveis para quem está pedindo (respeitando os critérios 1–4). <!-- event-driven -->
8. WHEN a tela de Checklist carrega THEN o sistema SHALL mostrar o progresso geral (`concluídos / total`, percentual) e o progresso por pessoa, calculados só sobre os itens visíveis para quem está pedindo. <!-- event-driven -->
9. IF um item de checklist é atrasado (`prazo_maximo` no passado e ainda não `feito`) THEN o sistema SHALL exibi-lo com indicador "atrasado" em toda visão em que aparecer, nunca ocultá-lo. <!-- unwanted-behavior -->
10. The system SHALL manter o comportamento existente de `checklist_state` (uma marca de "feito" por `traveler_id` + `item_id`) sem alteração de contrato. <!-- ubiquitous -->

**Independent Test**: Criar 3 itens (um global sem atribuição, um pessoal atribuído a um participante, um global atribuído a dois participantes com prioridade `obrigatorio` e vínculo a uma cidade do roteiro); logar como um quarto participante e confirmar que só os itens visíveis aparecem, agrupados corretamente nas 4 visões, com o pessoal do outro participante ausente da resposta do servidor (não só escondido na tela).

---

### P2: Sugestões da skill com revisão no app

**User Story**: Como admin da viagem, quero que a skill `viagem-para-json` leia os documentos e o estado atual da viagem e me proponha itens de checklist com fonte e data, para eu revisar, editar e aprovar em vez de montar tudo à mão.

**Why P2**: É o que transforma o checklist de "lista que alguém preenche" em "sistema que entende a viagem" — mas depende do modelo do P1 já existir.

**Acceptance Criteria**:

1. WHEN a skill gera uma sugestão de checklist THEN a saída SHALL incluir `titulo`, `categoria`, `escopo`, `assigned_to` (por nome de participante, resolvido a `participante_id` na importação), `prioridade`, vínculos opcionais (`pais`/`cidade`/`dia`/evento/voo/cruzeiro), `prazo_ideal`/`prazo_maximo` quando aplicável, e `fonte_tipo` ∈ {`documento`, `pesquisa`, `sugestao`}. <!-- event-driven -->
2. IF `fonte_tipo=pesquisa` THEN a sugestão SHALL incluir `fonte_detalhe` (nome/URL da fonte) e `fonte_consultado_em` (data da consulta); a skill SHALL nunca gerar um item com `fonte_tipo=pesquisa` sem essas duas informações. <!-- unwanted-behavior -->
3. WHEN o admin importa um lote de sugestões THEN o sistema SHALL gravá-las como `checklist_items` com `pendente=true`, sem alterar ou remover nenhum item existente. <!-- event-driven -->
4. WHEN o sistema grava uma sugestão importada THEN ele SHALL normalizar o título (minúsculo, sem acento, sem espaço nas pontas) e descartar a sugestão se o resultado normalizado já corresponder a um item existente (`pendente` ou não) na mesma viagem. <!-- event-driven -->
5. WHEN o admin abre a revisão de sugestões pendentes THEN o sistema SHALL permitir, por item, aceitar como está, editar campos antes de aceitar, ou rejeitar. <!-- event-driven -->
6. WHEN o admin aceita uma sugestão (com ou sem edição) THEN o sistema SHALL definir `pendente=false` (o item passa a se comportar como qualquer item de checklist) mantendo `fonte_tipo`/`fonte_detalhe`/`fonte_consultado_em` gravados. <!-- event-driven -->
7. WHEN o admin rejeita uma sugestão THEN o sistema SHALL apagar a linha (hard delete). <!-- event-driven -->
8. IF `assigned_to` de uma sugestão referencia um nome de participante que não existe na viagem THEN o sistema SHALL rejeitar a importação dessa sugestão e listar o nome não resolvido para o admin. <!-- unwanted-behavior -->
9. IF `escopo=pessoal` e `assigned_to` vier vazio numa sugestão THEN o sistema SHALL rejeitar a importação dessa sugestão (item pessoal exige pelo menos um dono). <!-- unwanted-behavior -->
10. The system SHALL nunca marcar uma sugestão como `pendente=false` sem uma ação explícita do admin (aceitar) — nenhuma sugestão vira item confirmado automaticamente. <!-- ubiquitous -->

**Independent Test**: Rodar a skill sobre a viagem Europa 2027 com um PDF de exemplo, gerar um lote com pelo menos uma sugestão de cada `fonte_tipo`, importar, e verificar que todas aparecem como pendentes na tela de revisão, que aceitar uma a torna um item normal preservando a fonte, e que rejeitar outra a remove sem deixar rastro.

---

### P3: Contexto extra (dicas, clima, explicação, skill versionada)

**User Story**: Como viajante, quero entender por que uma sugestão apareceu e ver dicas e clima relevantes sem sair do checklist; como admin, quero que a skill evolua de forma controlada conforme o app muda.

**Why P3**: Agrega valor real mas nenhuma parte é bloqueante para usar o checklist reformulado (P1) ou revisar sugestões (P2).

**Acceptance Criteria**:

1. WHEN um item de checklist tem `fonte_tipo` e `fonte_detalhe` preenchidos THEN a UI SHALL oferecer "Por que estou vendo isso?" mostrando a fonte e, se houver, a data de consulta. <!-- event-driven -->
2. WHEN a tela de Checklist carrega e existem eventos do roteiro com `dicas` preenchido nos próximos dias da viagem THEN o painel de dicas SHALL listá-las, sem gerar nenhum texto novo. <!-- event-driven -->
3. WHEN o painel de clima carrega e há previsão disponível para uma cidade do roteiro nos próximos dias THEN o sistema SHALL mostrá-la; IF a previsão não estiver disponível (API fora do ar, cidade sem correspondência, ou fora do alcance de previsão do provedor) THEN o sistema SHALL ocultar o painel inteiro em vez de mostrar um placeholder ou dado inventado. <!-- unwanted-behavior -->
4. The system SHALL declarar `skillVersion` e `schemaVersion` no `SKILL.md` da skill `viagem-para-json`, e manter um `changelog/CHANGELOG.md` com uma entrada por mudança de schema/regra. <!-- ubiquitous -->
5. IF o schema do app mudar de um jeito que quebra o contrato de saída da skill THEN a skill SHALL propor uma nova versão em texto (o que mudou, por quê) para revisão manual, e SHALL NUNCA sobrescrever seu próprio `SKILL.md` de produção automaticamente. <!-- unwanted-behavior -->

**Independent Test**: Com dicas já presentes em eventos do roteiro Europa 2027, confirmar que o painel de dicas mostra exatamente esse texto; desligar a chave/URL do provedor de clima e confirmar que o painel some sem erro visível; conferir que `SKILL.md` expõe `skillVersion`/`schemaVersion` e que existe pelo menos uma entrada no changelog.

---

## Edge Cases

- IF um item pessoal é editado para remover o único `participante_id` de `assigned_to` THEN o sistema SHALL rejeitar a edição (item pessoal sem dono é um estado inválido).
- IF duas sugestões no mesmo lote normalizam para o mesmo título THEN o sistema SHALL importar só a primeira e descartar as demais do lote.
- WHEN `VERSAO` do snapshot muda por causa dos campos novos de checklist THEN o sistema SHALL bumped `VERSAO` em `lib/offline.ts` para que o cache antigo no IndexedDB não quebre o primeiro paint.
- IF a rota `/api/mutate` recebe uma edição de checklist item de quem não tem papel suficiente (`visualizador` tentando editar item de terceiro) THEN o sistema SHALL responder 403, replicando o padrão de `papelAlcanca` já usado nas outras rotas.
- WHEN um item vinculado a um `itinerary_event_id`/`flight_id`/`cruise_id` é removido do roteiro THEN o sistema SHALL manter o item de checklist, apenas com o vínculo apontando para um registro inexistente tratado como "sem vínculo" na UI (nunca apagar o item em cascata sem avisar).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CHK-01 | P1: item global sem atribuição visível a todos | Tasks | Implementing (T5) |
| CHK-02 | P1: item pessoal visível só a assigned_to + proprietario | Tasks | Implementing (T5) |
| CHK-03 | P1: exclusão server-side de itens pessoais de terceiros | Tasks | Implementing (T5) |
| CHK-04 | P1: assigned_to em item global é só destaque | Tasks | Implementing (T5) |
| CHK-05 | P1: prioridade com default | Tasks | Implementing (T1, T13) |
| CHK-06 | P1: vínculos opcionais com roteiro/voo/cruzeiro/destino | Tasks | Implementing (T1, T13) |
| CHK-07 | P1: visões por categoria/pessoa/destino/tudo | Tasks | Implementing (T14) |
| CHK-08 | P1: progresso geral e por pessoa | Tasks | Implementing (T14) |
| CHK-09 | P1: item atrasado sempre visível | Tasks | Implementing (T15) |
| CHK-10 | P1: checklist_state sem mudança de contrato | Tasks | Implementing (satisfeito por omissão — nenhuma tarefa de P1 tocou checklist_state) |
| CHK-11 | P2: forma da sugestão emitida pela skill | Tasks | Implementing (T2, T16) |
| CHK-12 | P2: pesquisa exige fonte + data | Tasks | Implementing (T2) |
| CHK-13 | P2: importação grava como pendente, aditiva | Tasks | Implementing (T16) |
| CHK-14 | P2: dedup por título normalizado | Tasks | Implementing (T9, T16) |
| CHK-15 | P2: revisão aceitar/editar/rejeitar | Tasks | Implementing (T17) |
| CHK-16 | P2: aceitar preserva fonte | Tasks | Implementing (T17) |
| CHK-17 | P2: rejeitar apaga | Tasks | Implementing (T17) |
| CHK-18 | P2: assigned_to não resolvido rejeita import | Tasks | Implementing (T9, T16) |
| CHK-19 | P2: pessoal sem assigned_to rejeita import | Tasks | Implementing (T9, T16) |
| CHK-20 | P2: nenhuma sugestão confirma sozinha | Tasks | Implementing (T17) |
| CHK-21 | P3: "por que estou vendo isso" | Tasks | Implementing (T18) |
| CHK-22 | P3: dicas reaproveitadas do roteiro | Tasks | In Tasks |
| CHK-23 | P3: clima ao vivo com fallback de ocultar | Tasks | In Tasks |
| CHK-24 | P3: skillVersion/schemaVersion + changelog | Tasks | In Tasks |
| CHK-25 | P3: proposta de versão nunca autoaplica | Tasks | In Tasks |

**Coverage:** 25 total, 0 mapped to tasks, 25 unmapped ⚠️ (esperado antes da fase Tasks)

---

## Success Criteria

- [ ] Um item pode ser atribuído a ninguém, uma pessoa ou várias, e a privacidade de itens `pessoal` é garantida pelo servidor (teste de integração cobrindo os 3 papéis).
- [ ] As 4 visões (categoria/pessoa/destino/tudo) refletem só os itens visíveis para quem pediu, com progresso calculado sobre o mesmo conjunto.
- [ ] Uma sugestão da skill nunca vira item confirmado sem ação explícita do admin, e nunca sobrescreve um item existente.
- [ ] O painel de clima nunca mostra dado inventado — só aparece quando o provedor responde com sucesso.
- [ ] `npm test` continua passando, com testes novos cobrindo: filtro de privacidade no snapshot, dedup de sugestões, e o cálculo de "fase da viagem" em `lib/derive.ts`.
- [ ] `npm run build` limpo (typecheck incluso).
