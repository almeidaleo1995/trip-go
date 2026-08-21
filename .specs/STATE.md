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

## Handoff

**Fase atual:** Specify concluída (revisão 2), validada com 0 erros — 70 requisitos, 11 histórias.
**Próximo passo:** Design (schema do Neon, contrato da API, camada de sync, árvore de componentes).
**Bloqueio:** Nenhum para o Design. A connection string do Neon é necessária antes de rodar migrations e deploy.
