# Assistente de IA Specification

## Problem Statement

O TripGo é completo no **antes** da viagem e quase vazio no **durante**. Preparação, documentação, cofre, checklist e financeiro planejado estão mais maduros que a maioria dos apps pagos, mas `Hoje` é a única tela feita para quem já está viajando — e ela só lê. Todo registro do app é *plano*: `itinerary_events.custo_centavos` é estimativa, `places.status` distingue `planejada`/`visitada` mas o roteiro não tem equivalente, e nada no sistema captura o que de fato aconteceu.

Ao mesmo tempo, alimentar o app custa formulário. Adicionar um passeio ao roteiro são sete campos; lançar uma despesa abre `FormDespesa` com divisão e parcelas. Ninguém faz isso de pé, na rua, com uma mão. O resultado prático é que a viagem é planejada com carinho antes de embarcar e para de ser atualizada no dia 2.

Esta feature ataca o custo de entrada e o vazio do "durante" com o mesmo mecanismo: um assistente de IA que entende a viagem, escreve nela por linguagem natural ou voz, e responde como um guia — dentro do app, no celular, com a chave da Anthropic do dono da viagem.

## Goals

- [ ] Falar ou escrever uma frase (`"jantar no Bairro Alto amanhã 20h, uns 40 euros divididos entre todos"`) cria os registros certos, nas tabelas certas, sem abrir formulário.
- [ ] O assistente responde qualquer pergunta sobre a viagem lendo **exatamente** o que quem perguntou já pode ver — nunca mais, nunca por uma query própria.
- [ ] Adicionar uma cidade oferece um resumo de guia preenchido pela IA, sem digitar nada.
- [ ] O assistente funciona como guia com informação atual da internet (horário, preço, o que está fechado), citando de onde tirou.
- [ ] O assistente aponta o que falta preparar, reusando as regras que `lib/preparacao.ts` já tem, em vez de reinventá-las.
- [ ] Toda escrita feita pela IA é rastreável e desfazível como lote.
- [ ] Nenhum papel ganha, através da IA, acesso que não tem pela tela.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Tela de confirmação antes de cada escrita | Decisão explícita do usuário: a IA escreve direto. O rastro no `change_log` e o desfazer em lote (P1) substituem a confirmação. |
| Streaming (SSE) da resposta | O app não tem streaming fora do download do cofre. Resposta inteira + estado "pensando" entrega a capacidade; streaming é percepção. Ver `context.md` → Deferred. |
| A IA lendo o conteúdo (bytes) de arquivos do cofre | `document_files` fora do snapshot é decisão de arquitetura (README → Known limitations). A IA vê metadado do documento, não o PDF. |
| Síntese de voz (a IA falando) | Entrada por voz está no v1; saída falada não foi pedida. |
| Chave da Anthropic por participante | Descartada na entrevista — uma chave no servidor. |
| Invocar a skill `roteiro-trip-go` em produção | Skill de Claude Code é um diretório lido pelo agente no desktop; não existe no runtime da Vercel. Portar as *regras* dela para uma receita de prompt está dentro (P3); invocar a skill não. |
| Memória entre conversas | Cada conversa parte do snapshot atual. |
| Registro do que aconteceu (foto, nota do dia, "fomos/não fomos") | Lacuna real e reconhecida, mas é feature de modelo de dados própria — colunas novas em `itinerary_events`. Não depende da IA e não deve entrar escondida nela. |
| Conversão de moeda / câmbio | Idem: lacuna real (`expenses.moeda` existe, conversão não existe em lugar nenhum), mas é feature do módulo financeiro, não do assistente. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Poder da IA | Escreve direto, sem confirmação | Decisão explícita do usuário | y |
| Caminho da escrita | O mesmo `autorizar`/`validarCampos` de `/api/mutate` | "Escreve direto" = sem tela de confirmação, não = sem autorização. Uma IA fora do `autorizar` seria rota para contornar o recorte do financeiro | y |
| Contexto que a IA lê | `getSnapshot(tripId, papel, participanteId)`, sem query própria | O recorte por papel já vive ali (`financeiroDaViagem`, `documentosDaViagem`). Reusar dá privacidade de graça | y |
| Chave | `ANTHROPIC_API_KEY` no servidor, todos usam | Decisão explícita do usuário | y |
| Superfícies | Botão flutuante + aba dedicada + voz + gatilhos contextuais | Decisão explícita do usuário (as quatro) | y |
| Guia com internet | Web search no v1, com citação de fonte | Decisão explícita do usuário ("seja guia baseada na internet") | y |
| Modelo | `claude-opus-5` | Padrão da referência da API; o usuário não nomeou outro | y |
| Ferramentas da IA | Derivadas de `POR_ENTIDADE` via `z.toJSONSchema()` | Evita um quinto lugar para atualizar quando um campo nasce | y |
| Entrada por voz | Web Speech API do navegador | Zero dependência nova; segue a regra "nada de biblioteca para o que poucas linhas resolvem" | y |
| Limite de uso por pessoa | Reusa `registrarFalha` de `lib/session.ts` com namespace próprio | Uma chave para 5 pessoas sem teto é uma conta aberta | n — Design define os números |
| Onde vive o histórico da conversa | Memória do cliente, não persistido | Nada no brief pediu histórico entre sessões; persistir é tabela nova | n — Design confirma |
| Efeito (`effort`) e `max_tokens` | Design escolhe por rota (conversa vs. resumo vs. proativo) | Mecanismo, não decisão de produto | n — Design confirma |

**Open questions:** as três marcadas `n` acima, todas de mecanismo — nenhuma bloqueia a escrita do design.

---

## User Stories

### P1: O motor — a IA escreve na viagem ⭐ MVP

**User Story**: Como participante da viagem, quero dizer o que aconteceu ou o que vou fazer em uma frase e ver aquilo virar registro no lugar certo, sem abrir formulário nenhum.

**Why P1**: É o núcleo. Sem escrita, o assistente é um chat bonito ao lado de um app que continua exigindo sete campos por passeio. Todas as outras histórias montam em cima deste motor.

**Acceptance Criteria**:

1. WHEN alguém envia uma mensagem ao assistente THEN o sistema SHALL montar o contexto da IA a partir de `getSnapshot(tripId, papel, participanteId)` para a pessoa que enviou, e SHALL NOT executar nenhuma consulta ao banco fora dessa função para compor o contexto. <!-- event-driven / auth boundary -->
2. WHEN a IA decide criar, editar ou remover um registro THEN o sistema SHALL aplicar a operação pelo mesmo `autorizar` + `validarCampos` que `/api/mutate` usa, com o `Acesso` de quem enviou a mensagem. <!-- event-driven / auth boundary -->
3. IF a IA propõe uma operação que `autorizar` recusa para o papel de quem pediu THEN o sistema SHALL descartar a operação, SHALL NOT aplicá-la, e SHALL informar na resposta que aquilo não foi feito e por quê. <!-- unwanted-behavior -->
4. IF a IA emite campos que `validarCampos` rejeita THEN o sistema SHALL descartar aquela operação e SHALL relatar o erro em pt-BR, sem abortar as demais operações válidas da mesma mensagem. <!-- unwanted-behavior -->
5. WHEN o sistema aplica uma operação originada da IA THEN ele SHALL registrar no `change_log` que a origem foi o assistente, além de quem pediu. <!-- event-driven -->
6. WHEN uma mensagem resulta em uma ou mais escritas THEN o sistema SHALL oferecer, na resposta, desfazer **o lote inteiro** daquela mensagem em uma ação. <!-- event-driven -->
7. WHEN a resposta do assistente chega ao cliente THEN ela SHALL trazer o mesmo envelope de `/api/mutate` (snapshot + `eu` com `papel`/`participanteId`), para a tela repintar sem uma segunda ida ao servidor. <!-- event-driven -->
8. The system SHALL expor à IA como ferramentas apenas entidades presentes em `POR_ENTIDADE`, com o JSON Schema derivado desses mesmos schemas. <!-- ubiquitous -->
9. IF o dispositivo está sem rede THEN a interface do assistente SHALL se apresentar indisponível com a razão dita na tela, e SHALL NOT enfileirar a mensagem para envio posterior. <!-- unwanted-behavior -->
10. IF `ANTHROPIC_API_KEY` não está configurada no servidor THEN as rotas do assistente SHALL responder com erro em pt-BR explicando a configuração ausente, e o resto do app SHALL continuar funcionando sem alteração. <!-- unwanted-behavior -->
11. WHEN uma pessoa excede o limite de uso do assistente na janela THEN o sistema SHALL recusar a chamada com mensagem em pt-BR dizendo quando ela volta, e SHALL NOT consumir a chave. <!-- event-driven -->
12. The system SHALL tratar todo conteudo da viagem (nota, descricao, titulo, dica) e todo resultado de busca na web como **dado, nunca como instrucao** — uma frase escrita dentro de um registro que peca para apagar, alterar permissao ou revelar dado de outra pessoa SHALL NOT ser obedecida. <!-- ubiquitous / prompt injection --> 
13. IF uma instrucao chega ao assistente por conteudo de registro ou por resultado da web, em vez de pela mensagem da pessoa THEN o sistema SHALL ignora-la e SHALL relatar a tentativa na resposta. <!-- unwanted-behavior / prompt injection -->

> **Por que 12 e 13 existem:** a AD-009 listou "superficie de prompt injection em producao" como uma das razoes para manter LLM fora do app. Com a IA escrevendo direto (decisao do usuario), o vetor deixa de ser teorico: qualquer participante — ou qualquer pagina que a busca da web trouxer — escreve texto que entra no contexto do modelo. A defesa real e a de P1-2: a IA so consegue fazer o que o papel de quem falou ja podia fazer, entao a injecao no pior caso vira vandalismo rastreado e desfazivel (P1-5, P1-6), nunca escalada de privilegio. Estes dois criterios fecham o resto.

**Independent Test**: Como `visualizador`, pedir ao assistente "qual o custo total da viagem?" e "apague o voo de volta". Confirmar que a primeira resposta não contém o total da viagem (o snapshot daquele papel não o traz) e que a segunda é recusada com explicação, sem linha removida no banco. Como `editor`, pedir "adiciona jantar no Bairro Alto amanhã às 20h" e confirmar uma linha nova em `itinerary_events`, uma entrada no `change_log` marcada como origem assistente, e o desfazer removendo-a.

---

### P2: As superfícies — onde se fala com ele

**User Story**: Como participante, quero chamar o assistente de qualquer tela do app, ou abrir uma aba dedicada quando a conversa for longa, e poder ditar em vez de digitar quando estiver na rua.

**Why P2**: O motor sem superfície não é usável, e a superfície define se ele serve na rua ou só no sofá. As quatro superfícies foram pedidas explicitamente.

**Acceptance Criteria**:

1. WHEN qualquer aba de uma viagem está aberta THEN o sistema SHALL exibir um acesso flutuante ao assistente que abre um painel sem trocar de aba e sem perder o estado da tela. <!-- event-driven -->
2. WHEN o assistente é aberto pelo painel flutuante ou pela aba dedicada THEN o sistema SHALL apresentar o mesmo histórico da conversa nas duas superfícies. <!-- event-driven -->
3. WHEN o assistente é aberto a partir de uma aba THEN o sistema SHALL informar à IA qual aba estava aberta, para que "adiciona isso aqui" resolva para a entidade daquela tela. <!-- event-driven -->
4. WHERE o navegador oferece reconhecimento de fala, the system SHALL oferecer ditado em pt-BR na caixa de mensagem, com estado visível de "ouvindo". <!-- optional-feature -->
5. IF o navegador não oferece reconhecimento de fala THEN o sistema SHALL ocultar o botão de voz e SHALL manter a entrada por texto plenamente funcional. <!-- unwanted-behavior -->
6. WHEN o ditado termina THEN o sistema SHALL colocar o texto reconhecido na caixa de mensagem para revisão, e SHALL NOT enviá-lo sem uma ação da pessoa. <!-- event-driven -->
7. The system SHALL manter toda a interface do assistente em pt-BR, incluindo estados de erro, seguindo `config/site.ts` para qualquer nome de produto. <!-- ubiquitous -->

**Independent Test**: Abrir o Roteiro, chamar o assistente pelo botão flutuante, ditar "adiciona um café aqui amanhã de manhã", revisar o texto reconhecido, enviar, e confirmar que o item nasceu no roteiro. Abrir a aba dedicada e ver a mesma conversa.

---

### P3: Gatilhos contextuais — o resumo que aparece sozinho

**User Story**: Como quem monta a viagem, quero que ao adicionar uma cidade nova o app me ofereça preencher o resumo dela, e que planejar um dia vazio seja uma ação de um toque, sem eu escrever prompt nenhum.

**Why P3**: É a diferença entre "tem uma IA no app" e "o app ficou inteligente". O usuário descreveu exatamente isto: adicionar algo e a IA subir com uma explicação.

**Acceptance Criteria**:

1. WHEN um `lugar` é criado THEN o sistema SHALL oferecer uma ação de gerar o resumo de guia daquele lugar, sem exigir que a pessoa escreva um prompt. <!-- event-driven -->
2. WHEN a pessoa aceita gerar o resumo THEN o sistema SHALL preencher os campos de texto do próprio `lugar` com o resultado, pelo caminho de escrita do P1. <!-- event-driven -->
3. WHEN um dia do roteiro está sem nenhum item THEN o sistema SHALL oferecer planejar aquele dia com o assistente, informando à IA a cidade e a data daquele dia. <!-- event-driven -->
4. The system SHALL manter as instruções desses gatilhos ("receitas") em um único módulo do servidor, e SHALL NOT espalhar texto de prompt dentro de componentes. <!-- ubiquitous -->
5. IF uma receita é acionada para um registro que já tem o campo preenchido THEN o sistema SHALL deixar claro que o conteúdo será substituído antes de escrever. <!-- unwanted-behavior -->

**Independent Test**: Adicionar a cidade "Praga" e aceitar o resumo oferecido; confirmar que as notas do lugar foram preenchidas com conteúdo pertinente e que a alteração aparece no `change_log` como origem assistente.

---

### P4: O guia — informação da internet, com fonte

**User Story**: Como viajante, quero perguntar coisas que o app não tem como saber — se o museu abre na segunda, quanto custa o bilhete hoje, o que fazer com chuva — e receber resposta atual, com a fonte, sem sair do app.

**Why P4**: É o "guia" do pedido original e a única parte que o snapshot não consegue responder sozinho. Sem internet o assistente vira um leitor do que já está na tela.

**Acceptance Criteria**:

1. WHEN uma pergunta depende de informação que não está no snapshot THEN o sistema SHALL permitir que a IA consulte a web para respondê-la. <!-- event-driven -->
2. WHEN a resposta usa informação vinda da web THEN o sistema SHALL apresentar a fonte junto da resposta. <!-- event-driven -->
3. The system SHALL NOT incluir na consulta à web dado pessoal de participante — número de documento, telefone, e-mail, localizador de reserva ou qualquer conteúdo de documento pessoal. <!-- ubiquitous / privacy boundary -->
4. IF a consulta à web falha ou não retorna nada THEN o sistema SHALL responder com o que sabe do snapshot e SHALL dizer que não conseguiu confirmar na internet, em vez de afirmar sem fonte. <!-- unwanted-behavior -->
5. WHEN a IA escreve na viagem um dado obtido da web THEN ela SHALL registrar a fonte no campo de nota do registro, e SHALL NOT gravar informação de internet como se fosse confirmada pelo usuário. <!-- event-driven -->

**Independent Test**: Perguntar "o museu de X abre na segunda?" e conferir que a resposta traz fonte. Inspecionar a requisição de busca e confirmar que nenhum número de documento ou localizador de participante aparece nela.

---

### P5: Sugestão proativa de preparação

**User Story**: Como organizador, quero que o assistente me diga o que está faltando na viagem sem eu perguntar, usando as regras que o app já tem, para eu não descobrir no aeroporto.

**Why P5**: `lib/preparacao.ts` já responde "o que falta?" com regras testadas. O ganho aqui é a IA transformar aquilo em conversa e agir sobre o resultado — não inventar um segundo motor de regras.

**Acceptance Criteria**:

1. WHEN o assistente avalia o estado de preparação THEN ele SHALL derivar as pendências de `lib/preparacao.ts`, e SHALL NOT recalcular por conta própria o que aquele módulo já decide. <!-- event-driven -->
2. WHEN o assistente apresenta uma pendência THEN ele SHALL oferecer a ação que a resolve, pelo caminho de escrita do P1, quando a pendência for resolvível por escrita. <!-- event-driven -->
3. The system SHALL apresentar a cada pessoa apenas as pendências visíveis no snapshot dela, mantendo o recorte por papel do P1. <!-- ubiquitous / auth boundary -->
4. The system SHALL NOT criar tabela nova para guardar pendências — elas continuam derivadas, pelo mesmo motivo que `lib/preparacao.ts` e `lib/hoje.ts` não guardam estado. <!-- ubiquitous -->

**Independent Test**: Numa viagem com passaporte faltando e um dia vazio no roteiro, pedir "o que falta?" e confirmar que as pendências batem exatamente com o que a aba Preparação mostra para o mesmo usuário, e que nenhuma tabela nova foi criada.

---

## Requirements Traceability

| ID | Requisito | História |
| --- | --- | --- |
| IA-01 | Contexto vem só de `getSnapshot` do papel de quem pediu | P1-1 |
| IA-02 | Escrita passa por `autorizar` + `validarCampos` | P1-2, P1-3, P1-4 |
| IA-03 | Origem "assistente" no `change_log` | P1-5 |
| IA-04 | Desfazer em lote por mensagem | P1-6 |
| IA-05 | Mesmo envelope de `/api/mutate` | P1-7 |
| IA-06 | Ferramentas derivadas de `POR_ENTIDADE` | P1-8 |
| IA-07 | Degradação sem rede e sem chave | P1-9, P1-10 |
| IA-08 | Limite de uso por pessoa | P1-11 |
| IA-08b | Conteudo e web sao dado, nunca instrucao | P1-12, P1-13 |
| IA-09 | Botão flutuante, aba, histórico compartilhado, contexto da aba | P2-1, P2-2, P2-3 |
| IA-10 | Voz opcional, revisável, com fallback | P2-4, P2-5, P2-6 |
| IA-11 | Receitas centralizadas no servidor | P3-4 |
| IA-12 | Resumo ao criar lugar; planejar dia vazio | P3-1, P3-2, P3-3, P3-5 |
| IA-13 | Web search com fonte | P4-1, P4-2, P4-5 |
| IA-14 | Dado pessoal nunca vai para a web | P4-3 |
| IA-15 | Preparação derivada, não recalculada, sem tabela nova | P5-1, P5-2, P5-3, P5-4 |
