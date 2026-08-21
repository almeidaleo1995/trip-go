# Planejador de Viagens em Grupo — Especificação

> **Revisão 2** — a arquitetura mudou de artifact offline sem backend para app Next.js + Neon Postgres.
> A revisão 1 (arquivo único, sem sync) está superada; ver Assumptions para o registro do que mudou e por quê.

## Problem Statement

Um grupo de 5 pessoas viaja junto pela Europa e as informações da viagem (roteiro, voos, hospedagem, documentos, custos) estão espalhadas em PDFs, prints e conversas de WhatsApp. Em viagem, no celular, a internet é cara e intermitente — consultar essas informações precisa funcionar offline. Planos mudam no meio do caminho (voo remarcado, hotel cancelado) e hoje não existe um lugar onde a versão atual da verdade fique visível para todos ao mesmo tempo. Além disso, o dono da viagem controla os custos e a divisão financeira não pode aparecer na tela dos outros viajantes.

## Goals

- [ ] Um app deployado (URL) onde os 5 aparelhos veem sempre o mesmo conteúdo, com sincronização real via Neon Postgres.
- [ ] Offline-first de verdade: aberto uma vez, funciona em modo avião com os últimos dados sincronizados, e as escritas feitas offline sobem sozinhas quando a rede volta.
- [ ] O admin corrige imprevistos pelo celular em segundos e o grupo vê o que mudou, quem mudou e quando.
- [ ] O Financeiro é protegido no servidor: a API nunca devolve dados financeiros para uma sessão de viajante.
- [ ] Trocar de viagem não exige programar: o admin sobe um arquivo JSON no formato padrão pela própria tela de administração.

## Out of Scope

Explicitamente excluído. Documentado para evitar scope creep.

| Feature | Reason |
| ------- | ------ |
| Parsing automático de PDF pelo app | Frágil. A conversão PDF → JSON padrão é feita fora do app (por mim, sob demanda) e entra pela tela de importação. |
| Acerto de contas / quem-deve-a-quem / Pix | Financeiro é registro de custos e totais, não split ledger. Pedido foi tabela de custos, não fechamento de contas. |
| Mapas, clima, câmbio ao vivo, tradução | Dependem de rede em tempo de uso e de chaves de API de terceiros; nenhum foi pedido. |
| Múltiplas viagens simultâneas no mesmo app | Uma viagem ativa por vez. O schema tem `trip_id` para não travar isso no futuro, mas a UI de troca de viagem não é construída agora. |
| Push notification de alteração | Exige service worker com push + permissão + VAPID. O aviso de alterações aparece dentro do app ao sincronizar. |
| Resolução de conflito por merge (CRDT) | Com 5 pessoas e escrita quase sempre de um admin só, last-write-wins por campo com carimbo de tempo basta. Registrado como simplificação deliberada. |
| Tema escuro | Pedido explícito de tema claro de alto contraste, otimizado para leitura sob sol. |
| Upload de imagens/anexos | Exigiria object storage (S3/R2) e cota. Documentos são texto, link ou telefone. |

---

## Assumptions & Open Questions

Toda ambiguidade está resolvida ou registrada aqui.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Stack | Next.js (App Router) + Neon Postgres, deployado na Vercel | Escolha do usuário. A API route é o que permite guardar a credencial do Neon fora do navegador | y |
| Onde vive a credencial do Neon | Variável de ambiente no servidor; nunca chega ao bundle do cliente | Connection string no navegador daria acesso total ao banco a qualquer pessoa com DevTools | y |
| Como a credencial chega até mim | Usuário cola a connection string nesta conversa | Escolha explícita do usuário, com o custo declarado. Mitigação recomendada: rotacionar a senha no Neon depois do deploy | y |
| Fonte da verdade do conteúdo | O banco Neon. O arquivo JSON de config é um importador de carga inicial, não a fonte permanente | O usuário quer editar pela UI durante a viagem; um arquivo versionado divergiria do banco na primeira edição | y |
| Autenticação | Nome + PIN de 4 dígitos, PIN com hash (bcrypt) no banco, sessão em cookie httpOnly de 90 dias | Sem email e sem senha para decorar; funciona para 5 pessoas conhecidas. 90 dias cobre a viagem inteira sem relogin no exterior | y |
| Como o Financeiro é protegido | Autorização no servidor: o endpoint de financeiro checa o papel da sessão e retorna 403 para viajante | Esconder na UI não é proteção. Com backend dá para proteger de verdade, então protege | y |
| Estratégia offline | PWA com service worker; cache local do último snapshot em IndexedDB; escritas otimistas numa fila que dá flush ao reconectar | É o mínimo que entrega "abre em modo avião e funciona" sem introduzir CRDT | y |
| Resolução de conflito | Last-write-wins por campo, usando `updated_at` do servidor | Simplificação deliberada com teto conhecido: duas edições simultâneas do mesmo campo perdem a mais antiga. Marcada com comentário `ponytail:` no código | y |
| Fuso horário | Horários gravados como hora local do destino (`timestamp without time zone` + campo de cidade), sem conversão | Converter fuso num app usado offline em trânsito gera erro de horário de voo. A string literal é o que está no bilhete | y |
| PDF de bolso | Gerado por `window.print()` sobre uma folha de estilo de impressão dedicada, sem biblioteca de PDF | Entrega salvar-como-PDF e imprimir com zero dependência e zero peso no bundle | y |
| Identidade visual | Painel denso de alto contraste, uma cor de destaque configurável, alvos de toque de 44px | Escolha do usuário ("painel denso"), com o piso de acessibilidade preservado para uso sob sol e em movimento | y |
| Idioma | Toda a interface em português do Brasil; datas e valores via `Intl` com locale `pt-BR` | Requisito explícito | y |

**Open questions:** none — tudo resolvido ou registrado acima.

---

## User Stories

### P1: Autenticação por nome e PIN com papéis validados no servidor ⭐ MVP

**User Story**: Como viajante, quero tocar no meu nome e digitar 4 dígitos para entrar, e como dono da viagem quero que só eu enxergue o Financeiro — de verdade, não só na tela.

**Why P1**: Toda leitura e escrita do app depende de existir uma sessão com papel. É também a única barreira real que separa o Financeiro do resto.

**Acceptance Criteria**:

1. WHEN o app é aberto sem cookie de sessão válido THEN the system SHALL exibir a tela de seleção com um botão por viajante cadastrado, sem expor o PIN nem o hash de ninguém.
2. WHEN o usuário seleciona um nome e envia o PIN correto THEN the system SHALL validar o hash no servidor, criar um cookie de sessão httpOnly com validade de 90 dias e redirecionar para o Início.
3. IF o PIN enviado está incorreto THEN the system SHALL responder com erro genérico "Nome ou PIN incorreto", sem indicar qual dos dois falhou, e sem criar sessão.
4. IF a mesma origem envia mais de 10 tentativas de PIN incorretas em 5 minutos THEN the system SHALL recusar novas tentativas por 15 minutos.
5. WHILE a sessão ativa tem papel `viajante` the system SHALL responder com HTTP 403 a qualquer requisição aos endpoints de financeiro, independentemente do que a interface exibir.
6. WHILE a sessão ativa tem papel `viajante` the system SHALL omitir a aba Financeiro da navegação.
7. The system SHALL armazenar PINs exclusivamente como hash bcrypt, nunca em texto puro, nem em log, nem em resposta de API.
8. WHEN o usuário aciona "Sair" THEN the system SHALL invalidar o cookie de sessão e limpar o cache local de dados financeiros do aparelho.

**Independent Test**: Entrar como viajante e chamar `/api/financeiro` direto pelo navegador — recebe 403 mesmo com sessão válida.

---

### P2: Modelo de dados e importação do JSON padrão

**User Story**: Como dono da viagem, quero mandar meus PDFs, receber um JSON no formato do app e subir esse arquivo pela tela de admin para carregar a viagem inteira de uma vez.

**Why P2**: É como a viagem entra no sistema sem eu digitar 40 registros no celular, e é o que torna o app reutilizável em viagens futuras.

**Acceptance Criteria**:

1. The system SHALL persistir viagem, viajantes, roteiro, voos, hospedagens, lugares, checklist, documentos, contatos de emergência e custos em tabelas do Neon, todas vinculadas a um `trip_id`.
2. WHEN o admin envia um arquivo JSON válido na tela de importação THEN the system SHALL exibir um resumo do que será criado por seção antes de gravar qualquer coisa.
3. WHEN o admin confirma a importação THEN the system SHALL gravar todos os registros numa única transação, de modo que uma falha parcial não deixe a viagem meio carregada.
4. IF o arquivo enviado não é JSON válido, excede 2 MB ou falha na validação de schema THEN the system SHALL rejeitá-lo indicando o campo problemático e manter o banco inalterado.
5. WHERE o JSON importado traz `pins` para os viajantes the system SHALL gravar apenas o hash de cada PIN e descartar o valor em texto puro da memória após o hash.
6. The system SHALL aceitar campos opcionais ausentes em qualquer seção sem falhar, gravando NULL em vez de exigir preenchimento.

**Independent Test**: Subir o JSON de demonstração numa base vazia e conferir que as 9 seções aparecem populadas.

---

### P3: Sincronização offline-first entre os aparelhos

**User Story**: Como viajante no metrô sem sinal, quero abrir o app e ver tudo, marcar meus itens, e que isso suba sozinho quando eu voltar a ter rede.

**Why P3**: É a razão de existir o banco, e é o requisito mais difícil — precisa estar no MVP ou o resto é construído em cima de premissa errada.

**Acceptance Criteria**:

1. WHEN o app carrega com rede disponível THEN the system SHALL buscar o snapshot da viagem e gravá-lo no cache local do aparelho.
2. WHILE o aparelho está sem conexão the system SHALL renderizar todas as abas a partir do cache local e exibir um indicador de "offline" com o horário do último snapshot.
3. WHEN o usuário faz uma alteração sem conexão THEN the system SHALL aplicá-la imediatamente na tela e enfileirá-la localmente para envio posterior.
4. WHEN a conexão é restabelecida THEN the system SHALL enviar a fila de alterações pendentes em ordem e atualizar o cache com a resposta do servidor.
5. IF o envio de uma alteração da fila falhar por erro do servidor THEN the system SHALL mantê-la na fila, exibir quantas alterações estão pendentes e tentar de novo no próximo reconnect, sem perder a alteração.
6. IF duas alterações concorrentes atingem o mesmo campo THEN the system SHALL manter a de `updated_at` mais recente e descartar a mais antiga.
7. The system SHALL funcionar em modo avião após o primeiro carregamento, sem tela de erro e sem bloqueio de navegação entre abas.

**Independent Test**: Marcar itens em modo avião, reativar a rede e conferir no segundo aparelho que as marcações chegaram.

---

### P4: Início — painel denso

**User Story**: Como viajante, quero abrir o app e ver numa tela só quanto falta, o que vem agora, o dia inteiro e o que mudou.

**Why P4**: É a tela de maior uso, e o formato denso foi a escolha explícita do usuário.

**Acceptance Criteria**:

1. WHILE a data atual é anterior à partida the system SHALL exibir a contagem regressiva em dias inteiros até a partida.
2. WHILE a data atual está entre partida e retorno the system SHALL exibir o dia atual e o total de dias da viagem.
3. WHILE a data atual é posterior ao retorno the system SHALL exibir "Viagem concluída" no lugar da contagem.
4. WHEN existe evento de roteiro com data e hora futuras THEN the system SHALL destacar o mais próximo como "próximo compromisso", com data, hora e local.
5. IF não existe nenhum evento futuro THEN the system SHALL exibir "Sem compromissos futuros" em vez do card.
6. The system SHALL exibir na mesma tela a barra de resumo com dias, cidades distintas e países distintos, a linha do tempo compacta do dia corrente e o progresso do checklist do usuário.
7. WHERE existem alterações registradas nas últimas 48 horas the system SHALL exibi-las como avisos no topo, com o que mudou, quem alterou e há quanto tempo.

**Independent Test**: Alterar o horário de um voo num aparelho e ver o aviso surgir no Início do outro após sincronizar.

---

### P5: Conteúdo da viagem — Roteiro, Voos, Hospedagem, Cidades, Documentos

**User Story**: Como viajante, quero consultar roteiro, voos, hospedagens, lugares e números importantes, offline, em telas densas e legíveis.

**Why P5**: É o conteúdo que substitui os PDFs — a função básica do app.

**Acceptance Criteria**:

1. The system SHALL exibir o roteiro como linha do tempo ordenada por data e hora, agrupada por dia, com hora, local e descrição de cada evento.
2. WHERE um evento tem `ancora: true` the system SHALL destacá-lo com a cor de destaque e um rótulo do tipo do evento.
3. The system SHALL exibir cada voo com companhia, número, origem, destino, horários de partida e chegada, duração e escalas.
4. IF um voo não tem escalas cadastradas THEN the system SHALL exibir "Direto" em vez de lista vazia.
5. WHERE um voo tem localizador preenchido the system SHALL exibi-lo com um controle que copia o código para a área de transferência.
6. The system SHALL exibir cada hospedagem com nome, check-in, check-out, número de noites calculado a partir das datas, endereço e link quando houver.
7. The system SHALL exibir cada lugar com cidade, país, quantidade de dias e as notas cadastradas.
8. The system SHALL exibir documentos como lista de rótulo e valor, renderizando `tipo: "link"` como link e `tipo: "telefone"` como discagem `tel:`.
9. WHEN uma seção não tem nenhum registro THEN the system SHALL exibir um estado vazio com o texto da seção e, para admin, um atalho para adicionar o primeiro item.

**Independent Test**: Percorrer as cinco abas com o JSON de demonstração e conferir cada campo renderizado.

---

### P6: Edição pelo admin e registro de alterações

**User Story**: Como dono da viagem, quero corrigir um voo remarcado pelo celular em 10 segundos, sem formulário rígido, e quero que o grupo saiba o que mudou.

**Why P6**: É a resposta ao requisito de imprevistos — o que diferencia isto de um PDF.

**Acceptance Criteria**:

1. WHILE a sessão ativa tem papel `admin` the system SHALL permitir criar, editar e remover registros de roteiro, voos, hospedagens, lugares, documentos, contatos de emergência, checklist e custos.
2. WHEN o admin grava qualquer alteração THEN the system SHALL registrar na tabela de histórico o que mudou, o valor anterior, o novo valor, quem alterou e o horário.
3. The system SHALL exigir apenas os campos mínimos de cada registro, aceitando o restante em branco, para que um item possa ser criado com informação incompleta.
4. The system SHALL oferecer um campo de anotação livre em cada registro de roteiro, voo, hospedagem e lugar.
5. WHEN o admin remove um registro THEN the system SHALL pedir confirmação exibindo o que será removido antes de apagar.
6. IF um usuário com papel `viajante` envia qualquer requisição de escrita fora do próprio checklist THEN the system SHALL responder 403 e não alterar nada.

**Independent Test**: Editar o horário de um voo como admin, conferir o registro no histórico e a recusa 403 na mesma edição feita como viajante.

---

### P7: Checklist com sincronização real

**User Story**: Como viajante, quero marcar minhas pendências e que isso valha em qualquer aparelho meu, e quero ver o andamento do grupo nos itens coletivos.

**Why P7**: É a interação de escrita do viajante comum e a prova de que o sync funciona para todo mundo, não só para o admin.

**Acceptance Criteria**:

1. The system SHALL exibir duas listas: itens globais da viagem e itens pessoais do usuário logado.
2. WHEN o usuário marca ou desmarca um item THEN the system SHALL persistir o estado associado ao par (usuário, item) e refletir a mudança na tela imediatamente.
3. WHILE o item é global the system SHALL exibir quantos dos viajantes já o concluíram.
4. The system SHALL exibir uma barra de progresso com a porcentagem de itens concluídos do usuário atual, arredondada para inteiro.
5. IF não existe nenhum item de checklist THEN the system SHALL exibir estado vazio e progresso de 0% sem divisão por zero.
6. WHEN o estado salvo referencia um item que não existe mais THEN the system SHALL ignorá-lo no cálculo de progresso sem lançar erro.

**Independent Test**: Marcar um item global num aparelho e ver o contador do grupo subir no outro.

---

### P8: Financeiro do admin

**User Story**: Como dono da viagem, quero registrar custos por categoria e ver o custo por pessoa e o total do grupo, editando direto no app.

**Why P8**: É a razão de existir a divisão de papéis.

**Acceptance Criteria**:

1. WHILE a sessão ativa tem papel `admin` the system SHALL exibir a aba Financeiro com os custos agrupados por categoria.
2. The system SHALL exibir, para cada custo, a descrição, o valor por pessoa e o valor total do grupo, além do subtotal por categoria e do total geral da viagem.
3. WHEN o admin cria, edita ou remove um custo THEN the system SHALL recalcular os totais imediatamente e persistir a alteração.
4. IF um valor informado não é numérico ou é negativo THEN the system SHALL rejeitar a gravação e preservar o valor anterior.
5. The system SHALL armazenar valores monetários em centavos como inteiro, nunca em ponto flutuante.
6. The system SHALL formatar valores na moeda da viagem via `Intl.NumberFormat` com locale `pt-BR`.

**Independent Test**: Cadastrar um custo de 100 por pessoa com 4 viajantes e conferir total 400 e o subtotal da categoria.

---

### P9: Emergência

**User Story**: Como viajante em apuros, quero uma tela com os telefones e números que importam, em texto grande, funcionando offline e com um toque para ligar.

**Why P9**: É a tela que justifica o app existir no pior dia da viagem, e ela é barata: são dados de leitura.

**Acceptance Criteria**:

1. The system SHALL exibir a aba Emergência com telefones locais, consulado, número da apólice de seguro e contato de cada viajante.
2. The system SHALL renderizar cada telefone como link `tel:` acionável com um toque.
3. The system SHALL exibir a aba Emergência a partir do cache local mesmo sem conexão.
4. The system SHALL exibir os dados da Emergência com tamanho de fonte maior que o das demais abas.

**Independent Test**: Em modo avião, abrir Emergência e tocar num telefone — o discador abre com o número certo.

---

### P10: PDF de bolso, exportar e importar

**User Story**: Como dono da viagem, quero imprimir uma folha com o essencial antes de sair, e quero um backup do banco em arquivo.

**Why P10**: É o plano B para celular sem bateria e o seguro contra perder o banco.

**Acceptance Criteria**:

1. WHEN o usuário aciona "PDF de bolso" THEN the system SHALL abrir o diálogo de impressão com um layout de uma página contendo voos, endereços de hospedagem, contatos de emergência e número da apólice.
2. The system SHALL ocultar navegação, botões e elementos interativos do layout de impressão.
3. WHEN o admin aciona "Exportar dados" THEN the system SHALL baixar um JSON com `schemaVersion` e todo o conteúdo da viagem, no mesmo formato aceito pela importação.
4. IF um usuário com papel `viajante` aciona a exportação THEN the system SHALL produzir um arquivo sem nenhum dado financeiro.
5. The system SHALL garantir que o arquivo exportado, reimportado numa base vazia, reproduz a mesma viagem.

**Independent Test**: Exportar, apagar as tabelas, importar o arquivo e conferir que todas as seções voltam idênticas.

---

### P11: Navegação densa e responsiva em pt-BR

**User Story**: Como viajante andando na rua com uma mão, quero trocar de aba com o polegar e ler tudo no sol.

**Why P11**: Define a usabilidade de todas as outras telas.

**Acceptance Criteria**:

1. WHILE a viewport tem largura inferior a 768px the system SHALL exibir a navegação como barra de abas fixa na base, com alvos de toque de no mínimo 44px de altura.
2. WHILE a viewport tem largura igual ou superior a 768px the system SHALL exibir a navegação como barra lateral fixa à esquerda.
3. The system SHALL manter contraste mínimo de 4.5:1 entre texto e fundo em todos os elementos de conteúdo.
4. The system SHALL formatar datas e horários via `Intl.DateTimeFormat` com locale `pt-BR`.
5. The system SHALL exibir toda a interface, incluindo erros e estados vazios, em português do Brasil.
6. WHEN o usuário troca de aba THEN the system SHALL preservar a aba escolhida ao recarregar o app.

**Independent Test**: Abrir em 375px e em 1280px e conferir tab bar inferior vs. barra lateral.

---

## Edge Cases

- IF o banco não tem nenhuma viagem cadastrada THEN the system SHALL exibir a tela de importação em vez de um app vazio.
- IF a data de partida é posterior à de retorno THEN the system SHALL exibir a duração como 0 dias em vez de número negativo.
- IF um evento de roteiro tem data inválida THEN the system SHALL ignorá-lo no cálculo de próximo compromisso e exibi-lo ao fim da linha do tempo.
- WHEN duas cidades têm o mesmo nome em países diferentes THEN the system SHALL contá-las como cidades distintas.
- IF o Neon está indisponível e existe cache local THEN the system SHALL servir o cache e sinalizar que os dados podem estar desatualizados.
- IF o Neon está indisponível e não existe cache local THEN the system SHALL exibir uma tela explicando que é preciso abrir o app uma vez com internet.
- IF o IndexedDB estiver bloqueado pelo navegador THEN the system SHALL operar somente online e avisar que o modo offline está indisponível.
- WHEN a sessão expira durante o uso THEN the system SHALL preservar as alterações pendentes na fila e pedir novo login antes de enviá-las.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| AUTH-01 | P1: Autenticação | Design | Pending |
| AUTH-02 | P1: Autenticação | Design | Pending |
| AUTH-03 | P1: Autenticação | Design | Pending |
| AUTH-04 | P1: Autenticação | Design | Pending |
| AUTH-05 | P1: Autenticação | Design | Pending |
| AUTH-06 | P1: Autenticação | Design | Pending |
| AUTH-07 | P1: Autenticação | Design | Pending |
| AUTH-08 | P1: Autenticação | Design | Pending |
| DATA-01 | P2: Dados e importação | Design | Pending |
| DATA-02 | P2: Dados e importação | Design | Pending |
| DATA-03 | P2: Dados e importação | Design | Pending |
| DATA-04 | P2: Dados e importação | Design | Pending |
| DATA-05 | P2: Dados e importação | Design | Pending |
| DATA-06 | P2: Dados e importação | Design | Pending |
| SYNC-01 | P3: Sincronização offline | Design | Pending |
| SYNC-02 | P3: Sincronização offline | Design | Pending |
| SYNC-03 | P3: Sincronização offline | Design | Pending |
| SYNC-04 | P3: Sincronização offline | Design | Pending |
| SYNC-05 | P3: Sincronização offline | Design | Pending |
| SYNC-06 | P3: Sincronização offline | Design | Pending |
| SYNC-07 | P3: Sincronização offline | Design | Pending |
| HOME-01 | P4: Início | Design | Pending |
| HOME-02 | P4: Início | Design | Pending |
| HOME-03 | P4: Início | Design | Pending |
| HOME-04 | P4: Início | Design | Pending |
| HOME-05 | P4: Início | Design | Pending |
| HOME-06 | P4: Início | Design | Pending |
| HOME-07 | P4: Início | Design | Pending |
| CONT-01 | P5: Conteúdo da viagem | Design | Pending |
| CONT-02 | P5: Conteúdo da viagem | Design | Pending |
| CONT-03 | P5: Conteúdo da viagem | Design | Pending |
| CONT-04 | P5: Conteúdo da viagem | Design | Pending |
| CONT-05 | P5: Conteúdo da viagem | Design | Pending |
| CONT-06 | P5: Conteúdo da viagem | Design | Pending |
| CONT-07 | P5: Conteúdo da viagem | Design | Pending |
| CONT-08 | P5: Conteúdo da viagem | Design | Pending |
| CONT-09 | P5: Conteúdo da viagem | Design | Pending |
| EDIT-01 | P6: Edição e histórico | Design | Pending |
| EDIT-02 | P6: Edição e histórico | Design | Pending |
| EDIT-03 | P6: Edição e histórico | Design | Pending |
| EDIT-04 | P6: Edição e histórico | Design | Pending |
| EDIT-05 | P6: Edição e histórico | Design | Pending |
| EDIT-06 | P6: Edição e histórico | Design | Pending |
| CHK-01 | P7: Checklist | Design | Pending |
| CHK-02 | P7: Checklist | Design | Pending |
| CHK-03 | P7: Checklist | Design | Pending |
| CHK-04 | P7: Checklist | Design | Pending |
| CHK-05 | P7: Checklist | Design | Pending |
| CHK-06 | P7: Checklist | Design | Pending |
| FIN-01 | P8: Financeiro | Design | Pending |
| FIN-02 | P8: Financeiro | Design | Pending |
| FIN-03 | P8: Financeiro | Design | Pending |
| FIN-04 | P8: Financeiro | Design | Pending |
| FIN-05 | P8: Financeiro | Design | Pending |
| FIN-06 | P8: Financeiro | Design | Pending |
| EMG-01 | P9: Emergência | Design | Pending |
| EMG-02 | P9: Emergência | Design | Pending |
| EMG-03 | P9: Emergência | Design | Pending |
| EMG-04 | P9: Emergência | Design | Pending |
| BKP-01 | P10: PDF, export e import | Design | Pending |
| BKP-02 | P10: PDF, export e import | Design | Pending |
| BKP-03 | P10: PDF, export e import | Design | Pending |
| BKP-04 | P10: PDF, export e import | Design | Pending |
| BKP-05 | P10: PDF, export e import | Design | Pending |
| UI-01 | P11: Navegação e pt-BR | Design | Pending |
| UI-02 | P11: Navegação e pt-BR | Design | Pending |
| UI-03 | P11: Navegação e pt-BR | Design | Pending |
| UI-04 | P11: Navegação e pt-BR | Design | Pending |
| UI-05 | P11: Navegação e pt-BR | Design | Pending |
| UI-06 | P11: Navegação e pt-BR | Design | Pending |

**ID format:** `[AREA]-NN`, na ordem dos critérios de aceite de cada história.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 70 total, 0 mapeados para tasks, 70 não mapeados (fase Tasks ainda não executada).

---

## Success Criteria

- [ ] Modo avião ativado: todas as abas funcionam e as marcações feitas offline sobem sozinhas ao reconectar.
- [ ] Um viajante autenticado recebe 403 ao chamar o endpoint de financeiro direto, sem passar pela interface.
- [ ] Alterar o horário de um voo num aparelho aparece como aviso no Início dos outros quatro após sincronizar.
- [ ] Subir o JSON de demonstração numa base vazia popula as nove seções numa transação só.
- [ ] Exportar, zerar o banco e reimportar reproduz a viagem idêntica.
- [ ] Nenhuma seção quebra sem dados: todas exibem estado vazio.
