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
| Escrita sem confirmação | Revertido em 2026-09-01: a IA nunca grava por conta própria. Ver Assumptions → "Poder da IA". |
| Aviso em tempo real para os outros participantes | O que a IA grava aparece para os demais no próximo sync, como qualquer edição. Sem push. |
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
| Poder da IA | **Propõe e confirma** — nada entra no banco sem um toque | Decisão revista em 2026-09-01: "ele não sai colocando as coisas, mas quando pedir eu quero que ele já insira". Substitui a escrita direta da primeira entrevista | y |
| Remoção pela IA | Permitida, com confirmação | Liberada *pela* revisão acima: era proibida só porque escrita direta + voz mal reconhecida destruía dado sem volta | y |
| Modos do guia | Criar viagem (tela própria) · Dúvida (dentro da viagem) · Curiosidades (dentro de Roteiro e Cidades) | Decisão explícita do usuário — não são três abas novas no menu | y |
| Relatório de custo | Consumo do próprio app **+** gasto consolidado da organização | Decisão explícita do usuário; o consolidado depende de conta de organização (P7-5) | y |
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
2. WHEN a IA conclui que algo deveria ser criado, editado ou removido THEN o sistema SHALL devolver aquilo como **proposta** junto da resposta em texto, e SHALL NOT gravar nada no banco. <!-- event-driven -->
3. WHEN a pessoa aceita uma proposta THEN o sistema SHALL aplicá-la pelo mesmo `autorizar` + `validarCampos` que `/api/mutate` usa, com o `Acesso` de quem enviou a mensagem. <!-- event-driven / auth boundary -->
4. WHILE uma proposta não foi aceita, o sistema SHALL manter o banco inalterado, e a proposta SHALL expirar com a conversa sem deixar registro. <!-- state-driven -->
5. WHEN o sistema apresenta propostas THEN ele SHALL permitir aceitar todas de uma vez, aceitar um subconjunto, ou descartar tudo. <!-- event-driven -->
6. IF uma proposta aceita é recusada por `autorizar` para o papel de quem pediu THEN o sistema SHALL descartá-la, SHALL NOT aplicá-la, e SHALL dizer na tela o que não foi feito e por quê. <!-- unwanted-behavior -->
7. IF os campos de uma proposta aceita falham em `validarCampos` THEN o sistema SHALL descartar aquela proposta e relatar o erro em pt-BR, sem impedir as demais propostas válidas do mesmo lote. <!-- unwanted-behavior -->
8. WHEN o sistema aplica uma operação originada do assistente THEN ele SHALL registrar no `change_log` que a origem foi o assistente, além de quem aceitou, e SHALL agrupar as operações do mesmo lote sob um identificador comum. <!-- event-driven -->
9. WHEN um lote foi aplicado THEN o sistema SHALL oferecer desfazer as **criações e edições** daquele lote em uma ação. <!-- event-driven -->
10. IF um lote aplicado contém remoções THEN o sistema SHALL avisar, antes de aplicar, que remoção não é desfazível, porque o `change_log` guarda que a linha existia e não o conteúdo dela. <!-- unwanted-behavior -->
11. WHEN a resposta do assistente chega ao cliente THEN ela SHALL trazer o mesmo envelope de `/api/mutate` (snapshot + `eu` com `papel`/`participanteId`), para a tela repintar sem uma segunda ida ao servidor. <!-- event-driven -->
12. The system SHALL expor à IA como ferramentas apenas entidades presentes em `POR_ENTIDADE`, com o JSON Schema derivado desses mesmos schemas. <!-- ubiquitous -->
13. IF o dispositivo está sem rede THEN a interface do assistente SHALL se apresentar indisponível com a razão dita na tela, e SHALL NOT enfileirar a mensagem para envio posterior. <!-- unwanted-behavior -->
14. IF `ANTHROPIC_API_KEY` não está configurada no servidor THEN as rotas do assistente SHALL responder com erro em pt-BR explicando a configuração ausente, e o resto do app SHALL continuar funcionando sem alteração. <!-- unwanted-behavior -->
15. WHEN uma pessoa excede o limite de uso do assistente na janela THEN o sistema SHALL recusar a chamada com mensagem em pt-BR dizendo quando ela volta, e SHALL NOT consumir a chave. <!-- event-driven -->
16. The system SHALL tratar todo conteúdo da viagem (nota, descrição, título, dica) e todo resultado de busca na web como **dado, nunca como instrução** — uma frase escrita dentro de um registro que peça para apagar, alterar permissão ou revelar dado de outra pessoa SHALL NOT ser obedecida. <!-- ubiquitous / prompt injection -->
17. IF uma instrução chega ao assistente por conteúdo de registro ou por resultado da web, em vez de pela mensagem da pessoa THEN o sistema SHALL ignorá-la e SHALL relatar a tentativa na resposta. <!-- unwanted-behavior / prompt injection -->

> **Por que 16 e 17 existem:** a AD-009 listou "superfície de prompt injection em produção" como razão para manter LLM fora do app. A confirmação humana (P1-2/3) já é a defesa mais forte — nada entra sem alguém ler e tocar. Estes dois critérios cobrem o resto, e `autorizar` (P1-3) garante que nem uma proposta aceita por engano consegue mais do que a própria pessoa já podia.

**Independent Test**: Como `visualizador`, pedir "qual o custo total da viagem?" e "apague o voo de volta". Confirmar que a primeira resposta não traz o total (o snapshot daquele papel não o contém) e que a segunda, mesmo se aceita, é recusada por `autorizar` sem remover linha. Como `editor`, pedir "adiciona jantar no Bairro Alto amanhã às 20h": confirmar que **nada** foi gravado antes do aceite, que o aceite cria a linha em `itinerary_events` com entrada no `change_log` marcada `origem='assistente'` e um `lote`, e que o desfazer a remove.

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

### P6: Os três modos do guia

**User Story**: Como viajante, quero três coisas diferentes do mesmo assistente — montar uma viagem do zero, resolver um aperto agora ("estou aqui, tenho 40 minutos, o que faço?"), e saber a curiosidade do lugar onde estou — sem que isso vire três telas para eu decorar.

**Why P6**: É o "guia" do pedido, e a forma como ele aparece decide se é usado. O usuário foi específico: criar viagem tem tela própria; dúvida vive dentro da viagem; curiosidade vive dentro do Roteiro e das Cidades, colada no conteúdo.

**Acceptance Criteria**:

1. WHEN alguém cria uma viagem THEN o sistema SHALL oferecer montá-la com o assistente a partir de destino, datas e estilo, e SHALL apresentar a viagem proposta **inteira** — dias, passeios, horários, custos estimados — numa revisão única antes de gravar qualquer linha. <!-- event-driven -->
2. WHEN a revisão da viagem proposta é apresentada THEN o sistema SHALL permitir desmarcar itens individuais antes de aceitar o restante em bloco. <!-- event-driven -->
3. WHEN o assistente é aberto de dentro de uma viagem THEN o sistema SHALL informar à IA a aba aberta, a data e hora locais do destino e, quando houver, o compromisso atual segundo `lib/hoje.ts`, para que "estou aqui, o que faço?" seja respondível sem a pessoa explicar onde está. <!-- event-driven -->
4. WHEN alguém pergunta o que fazer com um tempo limitado THEN o sistema SHALL responder considerando o tempo informado, a posição na programação do dia e o próximo compromisso marcado, e SHALL NOT propor algo que colida com um compromisso âncora. <!-- event-driven -->
5. WHEN um item do roteiro ou uma cidade é aberta THEN o sistema SHALL oferecer curiosidades e dicas daquele item ali mesmo, sem trocar de tela. <!-- event-driven -->
6. WHEN o assistente responde qualquer coisa THEN o sistema SHALL oferecer, na mesma resposta, gravar aquilo na viagem ou apenas encerrar — e ambos SHALL ser um toque. <!-- event-driven -->
7. The system SHALL NOT criar abas novas no menu para dúvida e curiosidades — elas vivem dentro da viagem e dentro do conteúdo. <!-- ubiquitous -->

**Independent Test**: Estando no dia 3 do roteiro às 15h, perguntar "tenho 40 minutos até o jantar, o que dá pra fazer aqui perto?" e confirmar que a resposta respeita o compromisso das 16h e oferece gravar no roteiro. Abrir uma cidade e ver curiosidades ali, sem sair da aba.

---

### P7: Relatório de consumo da IA

**User Story**: Como dono da viagem, quero ver quanto o assistente está me custando — quem usou, em quê, e quanto isso deu — para não descobrir pela fatura.

**Why P7**: Uma chave para cinco pessoas sem visibilidade é uma conta aberta. O usuário pediu explicitamente a tela.

**Acceptance Criteria**:

1. WHEN uma chamada ao modelo termina THEN o sistema SHALL registrar tokens de entrada, de saída, de leitura de cache e de criação de cache, o modelo, o modo do assistente, quem pediu e a viagem. <!-- event-driven -->
2. WHEN o relatório é aberto THEN o sistema SHALL mostrar o consumo do próprio app por período, por pessoa e por modo, com o custo estimado calculado a partir dos tokens registrados. <!-- event-driven -->
3. WHERE existe uma credencial de administrador configurada, the system SHALL mostrar também o gasto consolidado da organização na Anthropic, obtido dos relatórios oficiais de uso e custo. <!-- optional-feature -->
4. The system SHALL restringir o relatório ao papel `proprietario`. <!-- ubiquitous / auth boundary -->
5. IF a conta não é uma organização, ou a credencial de administrador não está configurada THEN o sistema SHALL exibir só o consumo do próprio app e SHALL explicar em pt-BR por que o consolidado não aparece, sem apresentar isso como erro. <!-- unwanted-behavior -->
6. The system SHALL manter a credencial de administrador exclusivamente no servidor, separada da chave de uso, e SHALL NOT expô-la a nenhuma resposta de API nem a nenhum componente de cliente. <!-- ubiquitous / security -->
7. WHEN o consolidado da organização é consultado THEN o sistema SHALL guardar o resultado em cache por um intervalo, e SHALL NOT consultar a cada abertura da tela. <!-- event-driven -->

**Independent Test**: Fazer três perguntas ao assistente com contas diferentes, abrir o relatório como `proprietario` e conferir que as três aparecem separadas por pessoa e por modo com custo estimado; abrir como `editor` e receber 403. Sem credencial de administrador, conferir que a tela explica a ausência do consolidado em vez de mostrar erro.

---

## Requirements Traceability

| ID | Requisito | História |
| --- | --- | --- |
| IA-01 | Contexto vem só de `getSnapshot` do papel de quem pediu | P1-1 |
| IA-02 | A IA propõe; nada é gravado sem aceite | P1-2, P1-4 |
| IA-03 | Aceite passa por `autorizar` + `validarCampos` | P1-3, P1-6, P1-7 |
| IA-04 | Aceitar tudo, parte, ou descartar | P1-5 |
| IA-05 | Origem "assistente" e `lote` no `change_log` | P1-8 |
| IA-06 | Desfazer criações e edições do lote; remoção avisada como irreversível | P1-9, P1-10 |
| IA-07 | Mesmo envelope de `/api/mutate` | P1-11 |
| IA-08 | Ferramentas derivadas de `POR_ENTIDADE` | P1-12 |
| IA-09 | Degradação sem rede e sem chave | P1-13, P1-14 |
| IA-10 | Limite de uso por pessoa | P1-15 |
| IA-11 | Conteúdo e web são dado, nunca instrução | P1-16, P1-17 |
| IA-12 | Botão flutuante, aba, histórico compartilhado, contexto da aba | P2-1, P2-2, P2-3 |
| IA-13 | Voz opcional, revisável, com fallback | P2-4, P2-5, P2-6 |
| IA-14 | Receitas centralizadas no servidor | P3-4 |
| IA-15 | Resumo ao criar lugar; planejar dia vazio | P3-1, P3-2, P3-3, P3-5 |
| IA-16 | Web search com fonte | P4-1, P4-2, P4-5 |
| IA-17 | Dado pessoal nunca vai para a web | P4-3 |
| IA-18 | Preparação derivada, não recalculada, sem tabela nova | P5-1, P5-2, P5-3, P5-4 |
| IA-19 | Criar viagem inteira com revisão em bloco | P6-1, P6-2 |
| IA-20 | "Estou aqui, tenho X minutos" com contexto de tempo e lugar | P6-3, P6-4 |
| IA-21 | Curiosidades dentro do Roteiro e das Cidades, sem aba nova | P6-5, P6-7 |
| IA-22 | Toda resposta oferece gravar ou encerrar | P6-6 |
| IA-23 | Telemetria de tokens por pessoa e por modo | P7-1, P7-2 |
| IA-24 | Consolidado da organização, opcional e degradável | P7-3, P7-5, P7-7 |
| IA-25 | Relatório só para `proprietario`; credencial de admin só no servidor | P7-4, P7-6 |
