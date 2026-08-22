# Estado do Projeto — Planejador de Viagens em Grupo

## Decisions

### AD-001 — Next.js + Neon Postgres em vez de artifact de arquivo único
**Data:** 2026-08-21
**Contexto:** O pedido original era um React single-file offline, sem backend. O usuário depois trouxe uma conta Neon e pediu sincronização real entre 5 aparelhos.
**Decisão:** App Next.js (App Router) com Neon Postgres, deployado na Vercel.
**Razão:** A connection string do Neon não pode viver no navegador — exige uma API route no servidor. Sync real e proteção verdadeira do Financeiro só existem com backend.
**Consequência:** Deixa de ser um arquivo colável em artifact. Ganha sync, autorização de verdade e edição pela UI. Exige deploy.

### AD-002 — O banco é a fonte da verdade; o JSON de config é importador
**Data:** 2026-08-21
**Contexto:** A revisão 1 previa um objeto `TRIP_CONFIG` no topo do arquivo como fonte permanente.
**Decisão:** O conteúdo vive no Neon. O JSON padrão serve como carga inicial, enviado pela tela de admin.
**Razão:** O usuário quer editar durante a viagem (imprevistos). Na primeira edição pela UI, um arquivo versionado divergiria do banco e deixaria de ser fonte da verdade.
**Consequência:** Sem `npm run seed` e sem terminal. Conversão PDF → JSON continua sendo feita fora do app, sob demanda.

### AD-003 — Autenticação por nome + PIN com hash, autorização no servidor
**Data:** 2026-08-21
**Decisão:** Nome + PIN de 4 dígitos, bcrypt no banco, cookie httpOnly de 90 dias, rate limit de 10 tentativas/5min.
**Razão:** Sem email e sem senha para decorar, adequado a 5 pessoas conhecidas; 90 dias cobrem a viagem sem relogin no exterior.
**Consequência:** O Financeiro passa a ser protegido de verdade (403 no endpoint), não apenas escondido da interface.

### AD-004 — Offline-first por cache + fila, com last-write-wins
**Data:** 2026-08-21
**Decisão:** PWA com service worker, snapshot em IndexedDB, escritas otimistas numa fila que dá flush ao reconectar. Conflito resolvido por `updated_at` mais recente.
**Razão:** Entrega "abre em modo avião e funciona" sem introduzir CRDT.
**Consequência:** Simplificação deliberada com teto conhecido — duas edições simultâneas do mesmo campo perdem a mais antiga. Marcar com comentário `ponytail:` no código de merge.

### AD-005 — Credencial do Neon entregue pelo chat
**Data:** 2026-08-21
**Decisão:** O usuário cola a connection string na conversa; eu configuro tudo.
**Razão:** Escolha explícita do usuário, com o custo declarado.
**Consequência:** A senha fica no histórico da sessão. Mitigação combinada: rotacionar a senha no console do Neon depois do deploy.

### AD-006 - As referencias visuais do usuario sao a fonte da verdade do design
**Data:** 2026-08-21
**Contexto:** Numa pergunta anterior o usuario escolheu "painel denso" e pediu "cores vibrantes". Depois enviou duas imagens de referencia (mock mobile e desktop) que sao o oposto: espacosas, arejadas, monocromaticas em teal.
**Decisao:** As imagens ganham. Sistema visual calmo, teal `#0F766E`, muito branco, numeral gigante na contagem, mapa da rota como heroi.
**Razao:** Referencia visual concreta comunica intencao melhor que adjetivo abstrato. Confirmado com o usuario antes de codar.
**Consequencia:** Descartados a paleta vibrante de 8 cores categoricas e o par Fira Sans/Fira Code. Entram Inter e os badges de tipo pastel. Contraste de todo token foi medido, nao estimado: `#0D9488` e `#94A3B8` ficaram proibidos para texto por reprovarem AA.

### AD-007 - CRUD completo pela interface, incluindo viagem e viajantes
**Data:** 2026-08-21
**Contexto:** AD-002 definiu o banco como fonte da verdade com o JSON como importador. O usuario depois pediu CRUD para tudo, inclusive cadastrar a viagem pela tela.
**Decisao:** O admin cria, edita e remove tudo pela interface - viagem, viajantes, PINs e as 13 entidades de conteudo. A importacao de JSON continua existindo como atalho de carga em massa.
**Razao:** Pedido explicito. Sem isso o usuario depende de mim para cada mudanca de conteudo, o que anula o proposito de ter backend.
**Consequencia:** Nao substitui AD-002, estende. Entraram as historias P13 (gestao) e as tarefas de gestao da viagem e de viajantes. A folha de edicao e dirigida pelo schema zod, para nao escrever 13 formularios a mao.

### AD-008 - Cruzeiro e primeira classe no modelo, nao um caso de hospedagem
**Data:** 2026-08-21
**Contexto:** As referencias mostram uma aba Cruzeiro e a viagem real e um cruzeiro pelo Baltico.
**Decisao:** Tabelas `cruises` e `cruise_ports` proprias, e aba condicional que so aparece quando a viagem tem navio.
**Razao:** Embarque, cabine, portos e dias no mar nao cabem em `flights` nem em `stays` sem distorcer os dois modelos.
**Consequencia:** A navegacao passa a ser montada a partir dos dados, nao fixa no codigo - o que ja era necessario para o Financeiro por papel.

## Handoff

**Fase atual:** Todas as 6 fases executadas. 33 commits atômicos na branch `feat/planejador-viagem`.
**Gates:** 88 testes unitários + 26 de integração contra o Neon real + `next build` limpo.
**Estado do banco:** viagem Europa 2027 carregada (139 registros em 12 seções).
**Próximo passo:** deploy na Vercel e rotação da senha do Neon (AD-005).

**Bugs reais encontrados pelos testes durante a execução, não por revisão:**
1. `projetarRota` plotava cidade sem coordenada em (0,0) — `Number(null)` é 0.
2. `parseData` aceitava rollover: `2026-13-45` virava `2027-02-14`.
3. Refine do zod v4 roda após o regex falhar: data inválida dava 500 em vez de 400.
4. O catch do lote em `/api/mutate` engolia o 409 do último admin e devolvia 200.
5. Driver do Neon devolve `date` como `Date`: `String(d).slice(0,10)` virava "Mon Dec 3" e o backup não restaurava.
6. Um teste passava por acidente (procurava substring "pin" num corpo que era erro 500).

**Não construído, e por quê:**
- CRUD de escalas de voo e de portos do cruzeiro pela interface: as entidades existem no schema, na API e no `EditorSheet`, mas não há botão nas abas. Entram pela importação de JSON. Custo baixo de adicionar depois.
- Troca entre múltiplas viagens (ADM-07): o schema suporta, a UI não. Importar arquiva a anterior.
