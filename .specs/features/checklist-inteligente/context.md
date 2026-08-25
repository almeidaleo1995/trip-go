# Checklist Inteligente — Context

**Gathered:** 2026-08-24
**Spec:** `.specs/features/checklist-inteligente/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Reformular o módulo Checklist do TripGo de uma lista compartilhada plana (hoje: `checklist_items` + `checklist_state`, sem dono, sem prioridade, sem vínculo com roteiro) para um checklist contextual — por pessoa/grupo, por categoria, por destino/dia/voo/cruzeiro, com prioridade e prazos — e evoluir a skill `viagem-para-json` para também emitir sugestões de itens de checklist (com fonte e data) que o admin revisa e aprova dentro do app.

A skill continua rodando **fora** do app (Claude Code/Desktop), como hoje. O app não ganha nenhuma chamada de LLM em produção. O mecanismo de "atualizar viagem existente sem apagar dados" fica **restrito a sugestões de checklist** nesta spec — checklist é uma lista, então sugestões novas só se somam às existentes; um motor de diff campo-a-campo genérico para reconciliar roteiro/voos/hospedagens fica fora, para uma spec futura.

---

## Implementation Decisions

### Onde a inteligência roda

- A skill roda externamente (Claude Code/Desktop), do mesmo jeito que `viagem-para-json` hoje.
- Ela produz um JSON de sugestões de checklist (schema abaixo) que o admin importa e revisa dentro do app.
- Nenhuma dependência de LLM/API key entra em produção. O botão "✨ Gerar checklist inteligente" do mockup vira, na prática, "abrir revisão de sugestões pendentes" — as sugestões já existem porque alguém rodou a skill antes.

### Atribuição (assignedTo)

- Campo simples `assigned_to: participante_id[]` direto no item. Vazio = todos.
- "Grupos" (ex: "Casal Leonardo + Alana") são só uma seleção ad-hoc de participantes na hora de criar o item — não existe entidade "grupo" nomeada/reutilizável. Se um padrão de grupo se repetir muito na prática, essa entidade entra depois.

### Privacidade

- `escopo` (já existe: `global` | `pessoal`) controla visibilidade, não `assigned_to`.
  - `pessoal`: visível só para quem está em `assigned_to` + `proprietario`.
  - `global`: visível para todos os participantes da viagem, mesmo com `assigned_to` preenchido (nesse caso `assigned_to` é só destaque de responsabilidade, não um filtro).
- Só `proprietario` enxerga itens pessoais de terceiros. `editor` e `visualizador` só veem os próprios itens pessoais — mais restrito que o financeiro (que trata `editor` como admin), porque item pessoal de checklist é remédio/documento, não gasto.
- Aplicado no endpoint (mesmo padrão do financeiro), nunca só escondido na UI.

### Vínculo com roteiro (resolvido lendo o código, sem precisar perguntar)

Não existe entidade normalizada de país/cidade (tudo é texto livre em `LugarSchema`/`Evento`/`Dia`/`Voo`) nem tabela de hospedagem separada (hospedagem é uma linha de `itinerary_events` com `tipo`). O checklist segue a mesma convenção:

- `pais: text nullable`, `cidade: text nullable` — texto livre, igual ao resto do app.
- `dia: date nullable` — data solta, igual a `Evento.ocorre_em`/`Dia.dia`; não depende de existir uma linha em `itinerary_days` (que é opcional/esparsa).
- `itinerary_event_id`, `flight_id`, `cruise_id`: FKs nullable para o passeio/hospedagem (ambos são `itinerary_events`), voo e cruzeiro.
- "Fase da viagem" (seção 27 do pedido original) é **calculada**, não armazenada: deriva de `prazo_ideal`/`prazo_maximo`/`dia` vs. `viagem.data_partida`/`data_retorno`, em `lib/derive.ts` (mesmo padrão já usado para o resto dos cálculos puros do app). Nenhuma coluna nova para isso.

### Diff / merge ao reimportar

- Escopo desta spec: só sugestões de checklist. Item aceito vira um `checklist_item` normal (status `confirmado`); a skill nunca sobrescreve um item existente, só adiciona novos como `pendente`.
- Dedup: a skill normaliza título (minúsculas, trim, remove acentuação) antes de gerar e evita repetir contra os itens já existentes no snapshot que ela recebeu.
- Item rejeitado pelo admin é apagado (hard delete), sem tombstone. Ceiling conhecido: como a skill não tem memória entre execuções, ela pode sugerir de novo algo já rejeitado numa importação futura — aceito por ora (`ponytail:` no código de import), reconsiderar se incomodar na prática.
- Reconciliação campo-a-campo de roteiro/voos/hospedagens/etc. fica **fora de escopo** — feature separada.

### Clima

- Decisão: API de clima ao vivo dentro do app (fetch no backend Next.js), não nota estática da skill. Nova dependência de produção — mas o Design deve preferir um provedor sem API key (ex: Open-Meteo) para não violar "sem dependência para o que poucas linhas resolvem" nem exigir gestão de segredo. Mostrar o painel só quando houver dado disponível; nunca inventar previsão.

### Skill versionada

- A skill ganha `skillVersion`/`schemaVersion` e a estrutura de diretórios pedida (`schema/`, `rules/`, `templates/`, `mappings/`, `validators/`, `changelog/`) dentro de `.claude/skills/viagem-para-json/` — cada uma com conteúdo real (o JSON Schema da "TripGo Configuration", as regras de dedup/priorização, os defaults de categoria, o mapeamento nome→campo do app, o script de validação, o CHANGELOG), não pastas vazias. A skill nunca reescreve seu próprio `SKILL.md` de produção sozinha: no máximo propõe uma nova versão em texto, para revisão manual.

---

## Agent's Discretion

- Nome exato das colunas novas, tipos de FK, formato do enum de prioridade/fonte — Design decide, seguindo o estilo já usado em `db/schema.sql`.
- Provedor de clima específico e forma de cache/rate-limit — Design pesquisa e escolhe.
- Algoritmo de deduplicação de título (normalização + limiar de similaridade) — Design decide.
- Agrupamento em "fases" exato (quais faixas de dias contam como "7 dias antes" etc.) — Design decide um default razoável.

## Declined / Undiscussed Gray Areas → Assumptions

- **Categorias:** já são texto livre no schema atual (`categoria: TextoOpc`), então "admin pode criar categoria adicional" (seção 5) já funciona sem mudança — vira só uma lista de categorias sugeridas na UI, não um enum travado. Não discutido por já estar resolvido no código.
- **Prioridade:** enum fixo de 4 valores (`obrigatorio`, `importante`, `recomendado`, `opcional`) conforme pedido na seção 34 — sem ambiguidade, não precisou de discussão.
- **Dicas inteligentes (seção 38):** reaproveita o campo `dicas` que já existe em `Evento` — nenhuma coluna nova, painel só lê o que já está no roteiro. Não discutido por ser reuso direto de dado existente.
- **Modo demo (seção 41):** já existe como conceito no app (dados de exemplo antes de a viagem real ser carregada); "limpar dados de demonstração" fica coberto pelo fluxo de exclusão de itens que já existe — sem mecanismo novo dedicado.

## Specific References

- Mockup enviado pelo usuário (`ChatGPT Image 24 de ago. de 2026, 08_52_40.png`): cards por categoria, abas por pessoa, anel de progresso, painel de dicas, painel de clima, atalhos de "adicionar rápido" — é a referência visual para a tela de Checklist.

## Deferred Ideas

- Motor de diff/merge genérico para reconciliar roteiro/voos/hospedagens/cruzeiro a partir de reimportação da skill, com aprovação campo-a-campo (seções 19–20 do pedido original, fora do escopo de checklist). Feature separada.
- Entidade "grupo" nomeada e reutilizável de participantes, se o padrão de atribuição repetida aparecer na prática.
- Tombstone de sugestões rejeitadas, se a skill repetir sugestões já recusadas com frequência incômoda.
