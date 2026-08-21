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

**Fase atual:** Specify, Design e Tasks concluídas na revisão 3, todas com 0 erros nos gates — 89 requisitos, 14 histórias, 37 tarefas em 6 fases.
**Próximo passo:** Executar a Fase 1 (T1–T6): schema, db:push, cálculos puros, sessão, schemas zod, cliente do banco.
**Estado do ambiente:** Next.js 15 + Tailwind v4 scaffoldado, conexão com o Neon testada (PostgreSQL 18.6, base `neondb`), `.env.local` fora do git.
**Bloqueio:** Nenhum.
**Pendência de segurança:** rotacionar a senha do Neon no console depois do deploy (AD-005).
