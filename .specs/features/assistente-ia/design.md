# Assistente de IA Design

**Spec**: `.specs/features/assistente-ia/spec.md`
**Status**: Draft — aguardando aprovação

---

## Três achados que mudam o design

### 1. O `change_log` não consegue desfazer uma remoção — e a confirmação resolve

`registrarAlteracao` (`lib/db.ts:744`) grava `campo`, `de`, `para` como **texto**. No caminho de remoção (`app/api/mutate/route.ts`) a chamada é literalmente:

```ts
await registrarAlteracao(tripId, acesso.participanteId, op.entidade, op.id,
                         '(registro)', 'existia', 'removido')
```

O conteúdo da linha apagada não é guardado, e o `on delete cascade` leva os filhos junto (um `roteiro` leva suas `itinerary_options`; um `voo` leva suas `flight_stops`).

Na primeira rodada isto obrigou a **proibir** remoção pela IA: com escrita direta e sem confirmação, uma frase mal reconhecida pela voz — "apaga o jantar" saindo de "paga o jantar" — destruía dado sem volta.

A revisão de 2026-09-01 mudou a premissa. Com **proposta e confirmação**, remover pela IA passa a ser tão deliberado quanto o botão de apagar da tela, que já existe e já tem `ConfirmarDialogo`. **Remoção volta a ser permitida**, com duas condições que o design carrega:

- O desfazer em lote cobre **criações e edições**. Remoção não entra nele — não há como.
- A tela de revisão marca as remoções em destaque e diz que só elas não têm volta, antes do aceite (P1-10).

O `lote` continua valendo, e vale mais do que antes: aceitar uma viagem inteira gerada pela IA são dezenas de linhas de uma vez, e é exatamente aí que um desfazer de um toque importa.

### 2. O motor de preparação está preso dentro do componente

`montarPreparacao(c: Contexto)` é puro e testado, mas o `Contexto` que ele recebe é montado **dentro** de um `useMemo` em `components/tabs/Preparacao.tsx:102-185`. O servidor não tem como chamar aquilo.

O P5-1 exige que o assistente derive as pendências desse módulo em vez de recalcular. Então o design extrai a montagem para `lib/preparacao.ts`:

```ts
export function contextoDoSnapshot(s: Snapshot, eu: string, admin: boolean, hoje: Date): Contexto
```

A aba passa a chamar a mesma função. Ganho além do assistente: hoje existe **uma** montagem de `Contexto`, no cliente; se o servidor fizesse a sua, seriam duas listas de pendências divergindo em silêncio — o mesmo erro que o README documenta entre `/api/mutate` e `/api/snapshot` ("They drifted once and every write crashed the next render").

### 3. `getSnapshot` já é a história inteira de privacidade

`getSnapshot(tripId, papel, participanteId)` (`lib/db.ts:291`) já embute `financeiroDaViagem` (que devolve `{admin:false, obrigacoes}` para `visualizador`, com o SQL excluindo despesa alheia) e `documentosDaViagem` (que exclui documento `pessoal` de terceiro).

Portanto o IA-01 não é trabalho novo: é a **proibição** de escrever query própria para o assistente. O contexto do modelo é o snapshot daquela pessoa, e o recorte vem de graça. Uma query nova "só para a IA ver a viagem toda" reabriria todos os vazamentos que essas duas funções fecham.

---

## Arquitetura

```mermaid
flowchart TB
    subgraph CLIENTE["Navegador"]
        PAINEL["Assistente.tsx<br/>painel flutuante + aba"]
        VOZ["lib/voz.ts<br/>Web Speech API"]
        TP["TripProvider<br/>estado único"]
        VOZ --> PAINEL --> TP
    end

    subgraph SERVIDOR["Servidor (Node)"]
        ROTA["/api/assistente<br/>+ /api/assistente/desfazer"]
        MOTOR["lib/assistente.ts<br/>PURO: ferramentas, contexto,<br/>sanitização, receitas"]
        ESCRITA["lib/escrita.ts<br/>autorizar + aplicar<br/>EXTRAÍDO de /api/mutate"]
        PREP["lib/preparacao.ts<br/>contextoDoSnapshot (novo)"]
    end

    NEON[("Neon")]
    API(("API Anthropic<br/>claude-opus-5<br/>+ web_search"))

    PAINEL -->|"POST"| ROTA
    ROTA --> MOTOR
    ROTA -->|"getSnapshot(papel)"| NEON
    MOTOR -->|"tools + contexto"| API
    API -->|"tool_use"| ROTA
    ROTA --> ESCRITA --> NEON
    ROTA --> PREP
    ROTA -->|"envelope de /api/mutate"| TP
```

**A regra que rege o desenho:** a rota do assistente não sabe escrever. Ela traduz linguagem em `Operacao[]` e entrega para o mesmo código que `/api/mutate` usa. Se ela soubesse escrever sozinha, existiriam dois lugares decidindo quem pode o quê — e um deles ficaria para trás.

---

## Módulos

| Arquivo | Novo? | Responsabilidade |
| --- | --- | --- |
| `lib/assistente.ts` | novo | **Puro.** Ferramentas a partir do zod, digest da viagem, sanitização anti-vazamento, receitas de prompt, tradução `tool_use` → `Operacao`. Zero I/O, zero SDK. |
| `lib/assistente.test.ts` | novo | Testes do acima. Segue `node --test`, sem framework. |
| `lib/escrita.ts` | novo (extração) | `autorizar`, `aplicar`, `recorte`, `conferirPai`, `gravarDespesa`, `TABELA` — **movidos** de `app/api/mutate/route.ts`, sem mudança de comportamento. As duas rotas passam a importar daqui. |
| `lib/voz.ts` | novo | Casca do Web Speech API em pt-BR, com detecção de suporte. ~40 linhas. |
| `app/api/assistente/route.ts` | novo | Conversa. Sessão, limite, chamada ao modelo, telemetria. **Não importa `lib/escrita.ts`.** |
| `app/api/assistente/aplicar/route.ts` | novo | O aceite. O único lugar do assistente com escrita. |
| `app/api/assistente/desfazer/route.ts` | novo | Replay reverso de um `lote` do `change_log`. |
| `app/api/assistente/consumo/route.ts` | novo | Relatório. Único lugar que lê `ANTHROPIC_ADMIN_KEY`. |
| `lib/consumo.ts` | novo | **Puro.** Tokens → custo estimado, agregação por pessoa/modo/período. |
| `config/precos.ts` | novo | Tabela de preços por modelo. Muda sem tocar código. |
| `components/RevisaoPropostas.tsx` | novo | A tela de revisão: lista, desmarcar, aceitar em bloco, destaque de remoção. |
| `components/Assistente.tsx` | novo | Painel, histórico, cartões de resultado, botão de voz, desfazer. |
| `components/tabs/Assistente.tsx` | novo | Casca fina: a aba dedicada monta o mesmo componente. |
| `components/tabs/Consumo.tsx` | novo | Relatório de gasto (só `proprietario`). |
| `components/tabs/Roteiro.tsx` | alterado | Bloco de curiosidades no item aberto. |
| `components/tabs/Conteudo.tsx` | alterado | Bloco de curiosidades na cidade. |
| `app/(dashboard)/viagens/` | alterado | Entrada "criar viagem com IA". |
| `app/api/mutate/route.ts` | alterado | Passa a importar de `lib/escrita.ts`. Nenhuma regra muda. |
| `lib/preparacao.ts` | alterado | Ganha `contextoDoSnapshot`. |
| `components/tabs/Preparacao.tsx` | alterado | Passa a usar `contextoDoSnapshot` em vez do `useMemo` inline. |
| `components/Shell.tsx` | alterado | Aba `assistente` + botão flutuante. |
| `db/schema.sql` | alterado | `change_log` ganha `origem` e `lote` (bloco `create` **e** seção de migrações). |
| `config/site.ts` | alterado | Nome e frases do assistente. Nenhuma string de produto em componente. |
| `lib/offline.ts` | alterado | `VERSAO` 6 → 7. |

---

## O contrato da rota

A conversa e a gravação são **duas rotas**, e essa separação é o P1 inteiro:

```
POST /api/assistente            ← conversa. NUNCA escreve.
{ trip_id?, modo, mensagens[], aba?, alvo_id?, contexto_tempo? }
200 { texto, fontes[], propostas: [{ ref, entidade, op, campos, resumo }], uso }

POST /api/assistente/aplicar    ← grava. Só aqui existe SQL de escrita.
{ trip_id, propostas: [...aceitas] }
200 { lote, aplicadas, rejeitadas[], snapshot, eu }

POST /api/assistente/desfazer   { trip_id, lote }  → mesmo envelope
GET  /api/assistente/consumo    → relatório (só proprietario)
```

Por que separadas em vez de um `aplicar: true` na primeira: uma rota que às vezes escreve é uma rota onde alguém, um dia, esquece de checar a flag. `/api/assistente` não importa `lib/escrita.ts` — ela **não tem como** gravar, e isso é verificável por leitura de import, não por confiança.

`propostas[].ref` é um id efêmero do lote (não é id de banco): é o que a tela usa para desmarcar item antes de aceitar (P1-5, P6-2).

`snapshot` + `eu` em `/aplicar` são **o mesmo envelope de `/api/mutate`**. O README registra que os dois já divergiram uma vez e "every write crashed the next render"; a rota nova nasce com o envelope idêntico e um teste comparando as chaves.

## As ferramentas da IA

Derivadas de `POR_ENTIDADE` em `lib/schema.ts`, via `z.toJSONSchema()` do zod 4 (verificado nesta versão: `zod@4.4.3` expõe `toJSONSchema`). Uma ferramenta por entidade escrevível, com `strict: true` e `additionalProperties: false`.

```ts
// lib/assistente.ts
export function ferramentas(papel: Papel): Ferramenta[]
```

Duas propriedades que isso compra:

- **A lista de campos não é copiada.** Adicionar um campo hoje já exige tocar `db/schema.sql`, `lib/schema.ts`, `/api/export` e `lib/importar.ts` juntos (CLAUDE.md). Um quinto lugar com a lista à mão seria o que ninguém atualiza — e o sintoma seria a IA parar de preencher um campo novo, em silêncio.
- **O papel decide a lista.** `ferramentas('visualizador')` devolve só o que aquele papel escreve (`checklist_state`, `entrega`, documento próprio). O modelo não recebe sequer a descrição de uma ferramenta que ele não poderia usar — menos chance de tentar, menos recusa para explicar.

`autorizar` continua sendo a barreira real (P1-2/3): a lista por papel é ergonomia, não segurança.

### Configuração do modelo

| Parâmetro | Valor | Razão |
| --- | --- | --- |
| `model` | `claude-opus-5` | Padrão da referência da API. |
| `thinking` | `{type:'adaptive'}` | Traduzir "jantar amanhã 20h dividido entre todos" em despesa + divisão + item de roteiro é raciocínio, não extração. |
| `output_config.effort` | `high` na conversa, `medium` no resumo de lugar, `low` na sugestão proativa | A proativa lê uma lista pronta de `montarPreparacao`; não precisa pensar. |
| `max_tokens` | `16000` | Padrão para não-streaming, abaixo do timeout do SDK. |
| `tools` | entidades + `web_search_20260209` | A variante com filtragem dinâmica, suportada no Opus 5. |
| streaming | não | Ver spec → Out of Scope. |

### Cache de prompt

A ordem de renderização é `tools` → `system` → `messages`. O prompt do sistema e as ferramentas são **estáveis por papel**; o digest da viagem muda a cada mensagem. Então:

- `system` (regras, tom, data de hoje **não** incluída aqui) + `tools` → prefixo cacheável, com `cache_control` no fim do `system`.
- digest da viagem e conversa → primeira mensagem `user` em diante, **depois** do breakpoint.

Colocar o digest no `system` (o lugar intuitivo) invalidaria o cache a cada escrita, porque o snapshot muda. `usage.cache_read_input_tokens` zerado em requisições seguidas é o sintoma a vigiar.

---

## Os modos, e onde cada um mora

Um motor, quatro entradas. O `modo` viaja no corpo da requisição e escolhe a receita; nenhum modo tem código próprio de escrita.

| Modo | Onde mora | Contexto extra que recebe | Escreve o quê |
| --- | --- | --- | --- |
| `criar_viagem` | Tela de nova viagem (fora de uma viagem) | destino, datas, estilo, nº de pessoas | Viagem inteira, revisada em bloco |
| `duvida` | Painel flutuante + aba, dentro da viagem | aba aberta, agora no fuso do destino, compromisso atual (`lib/hoje.ts`), minutos disponíveis | Qualquer entidade, se aceito |
| `curiosidade` | Dentro do item de Roteiro e da Cidade | o registro aberto | Normalmente só o próprio registro (nota, dicas) |
| `preparacao` | Aba Preparação | saída de `montarPreparacao` | A pendência que resolve |

**"Estou aqui, tenho 40 minutos"** é o caso que dita o contexto do modo `duvida`. Para respondê-lo o servidor precisa de três coisas que o snapshot sozinho não dá mastigadas: que horas são **no destino** (`trips.fuso` + relógio, exatamente o que `lib/hoje.ts` já converte), qual o compromisso âncora seguinte, e onde a pessoa está segundo a programação. Tudo isso já é derivado por `lib/hoje.ts` — o design reusa, não recalcula, pelo mesmo motivo do achado 2.

O modo `curiosidade` **não vira aba**: ele monta dentro de `tabs/Roteiro.tsx` e `tabs/Conteudo.tsx` (Cidades), colado no registro aberto. Decisão explícita do usuário, e a que evita o Shell ir a 16 abas.

---

## Consumo e custo

Duas fontes, e elas respondem perguntas diferentes:

**1. O que este app gastou** — sempre disponível, é a base. Toda resposta da API traz `usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`). A rota grava uma linha por chamada:

```sql
create table if not exists ai_usage (
  id text primary key default gen_random_uuid()::text,
  trip_id text references trips(id) on delete set null,
  user_id text not null references users(id) on delete cascade,
  modo text not null,
  modelo text not null,
  entrada int not null default 0, saida int not null default 0,
  cache_leitura int not null default 0, cache_escrita int not null default 0,
  busca_web int not null default 0,
  criado_em timestamptz not null default now()
);
```

`trip_id` é `on delete set null`, não `cascade`: apagar uma viagem não pode apagar o histórico de gasto — é justamente o gasto que já aconteceu.

O custo em dólar é **calculado na leitura**, a partir de uma tabela de preços em `config/`. Gravar o preço junto do token congelaria um valor que muda; recalcular na leitura com o preço vigente é a conta certa e mantém a coluna honesta (token é fato, preço é tabela).

**2. O gasto real da organização** — opcional, e aqui está o achado:

> A documentação oficial diz, em destaque: **"The Admin API is unavailable for individual accounts."**

Se a conta do usuário for individual e não uma organização no Console, este painel **não tem como funcionar** — não é bug nosso. Por isso ele é um bloco condicional, não um requisito de tela (P7-5).

Quando existir, são dois endpoints, ambos **fora dos SDKs — só HTTP cru**:

```
GET https://api.anthropic.com/v1/organizations/usage_report/messages
    ?starting_at=…&ending_at=…&bucket_width=1d&group_by[]=model
GET https://api.anthropic.com/v1/organizations/cost_report
    ?starting_at=…&ending_at=…&group_by[]=description
headers: anthropic-version: 2023-06-01 · x-api-key: $ANTHROPIC_ADMIN_KEY
```

Detalhes que o design fixa por já estarem documentados: o `cost_report` só tem granularidade diária; os valores vêm como string decimal em **centavos** de USD; o dado leva ~5 min para aparecer; a recomendação oficial é no máximo uma consulta por minuto e cache para painel. O nosso cache é de 1 hora (P7-7) — o número é da fatura, não do minuto.

**A credencial de admin é o ponto sensível da feature.** `ANTHROPIC_ADMIN_KEY` (`sk-ant-admin01-…`) é muito mais poderosa que a chave de uso: ela administra membros, workspaces e chaves da organização. Regras que o design impõe:

- Variável separada de `ANTHROPIC_API_KEY`, lida só em `app/api/assistente/consumo/route.ts`.
- Nunca passada ao SDK do assistente, nunca no mesmo módulo que monta prompt.
- A rota devolve **números agregados**, nunca o corpo bruto da resposta da Anthropic — que traz ids de workspace e de chave.
- `exigirViagem(..., 'proprietario')` antes de qualquer leitura.
- Opcional de verdade: ausente, o app funciona e a tela explica (P7-5).

---

## Segurança

| Requisito | Mecanismo |
| --- | --- |
| IA-01 — contexto recortado | `getSnapshot(tripId, acesso.papel, acesso.participanteId)`. Proibido `sql` direto na rota do assistente; o lint do próprio review checa isso. |
| IA-02 — escrita autorizada | `lib/escrita.ts` com o `Acesso` da sessão. Mesmo código de `/api/mutate`. |
| IA-14 — dado pessoal não vai para a web | `sanitizarParaWeb()` em `lib/assistente.ts`: o digest tem **duas** formas. A que vai no contexto do modelo tem os dados da pessoa; a instrução do sistema proíbe repetir número de documento, telefone, e-mail ou localizador dentro de uma busca. Reforço estrutural: o digest **omite** por completo `documents.valor` e `travelers.passaporte` do texto — a IA sabe que o passaporte existe e está vencendo, não o número dele. |
| IA-08b — injeção de prompt | O digest marca conteúdo de usuário como dado (delimitado e rotulado), e o sistema instrui a nunca obedecer instrução vinda dali. A defesa real continua sendo `autorizar`: no pior caso a injeção faz o que a própria pessoa já podia fazer, e fica no `change_log` com `origem='assistente'`, desfazível. |
| Chave | `ANTHROPIC_API_KEY` lida em `app/api/assistente/route.ts`, `runtime = 'nodejs'`. Nunca em componente cliente, nunca em `NEXT_PUBLIC_*`. |

---

## Mudança de schema

```sql
-- no bloco create de change_log
origem  text not null default 'pessoa' check (origem in ('pessoa','assistente')),
lote    text,

-- e TAMBÉM na seção de migrações (banco em uso não vê o create):
alter table change_log add column if not exists origem text not null default 'pessoa';
alter table change_log add column if not exists lote   text;
alter table change_log drop constraint if exists change_log_origem_check;
alter table change_log add  constraint change_log_origem_check
  check (origem in ('pessoa','assistente')) not valid;
create index if not exists idx_change_log_lote on change_log (trip_id, lote);
```

Duas armadilhas do CLAUDE.md respeitadas de propósito: a coluna entra **nos dois lugares** (só no `create` ela não existiria em nenhum banco real), e o `check` entra como `not valid` — mas aqui isso é seguro porque o `default 'pessoa'` já satisfaz toda linha existente.

`registrarAlteracao` ganha dois parâmetros opcionais no fim (`origem`, `lote`), então as 7 chamadas existentes seguem compilando sem edição.

A tabela `ai_usage` (seção **Consumo e custo**) entra no mesmo `db/schema.sql`, no bloco `create` — é tabela nova, então não precisa de contraparte na seção de migrações, mas herda a regra de idempotência (`create table if not exists`).

---

## Custo e limite

Uma chave para cinco pessoas sem teto é uma conta aberta. Reusa `registrarFalha` de `lib/session.ts` com namespace próprio:

```ts
LIMITES_ASSISTENTE = { limite: 30, janelaMs: 60*60*1000, bloqueioMs: 15*60*1000 }
// chave: `assistente:${userId}` — por CONTA, não por IP: cinco pessoas na
// mesma rede do hotel dividiriam um balde só se fosse por IP.
```

Herda o teto conhecido do limitador (contador em memória, uma janela por instância) e o mesmo comentário `ponytail:`. Aqui o custo de furar é dinheiro, não segurança.

---

## Testing strategy

`lib/assistente.ts` é puro justamente para caber em `node --test` sem navegador nem rede:

| Teste | O que trava |
| --- | --- |
| `ferramentas('visualizador')` não contém `roteiro`, `voo`, `custo` | Regressão de papel na lista de ferramentas |
| `ferramentas('editor')` bate com as chaves de `POR_ENTIDADE` menos as proibidas | Entidade nova aparecendo sem querer |
| Toda ferramenta tem `strict:true` e `additionalProperties:false` | Contrato de tool use |
| `digest()` não contém passaporte, telefone, e-mail nem `documents.valor` | IA-14 |
| `digest()` de `visualizador` não contém total da viagem | IA-01 |
| `paraOperacoes()` rejeita entidade fora da lista e `op:'remover'` | Achado 1 |
| Chaves do envelope do assistente == chaves do envelope de `/api/mutate` | A divergência que o README já documenta |

Os limites de autorização de verdade (`autorizar` recusando por papel) continuam sem teste automatizado, como o resto do repo — mas agora a função é importável de `lib/escrita.ts` em vez de estar presa numa rota, o que é pré-requisito para testá-la depois.

---

## Risks & Concerns

| Risco | Avaliação |
| --- | --- |
| **A extração de `/api/mutate` para `lib/escrita.ts` é a mudança mais perigosa da feature** | Ela toca o caminho de escrita de todo o app. Deve ser um commit próprio, sem nenhuma alteração de comportamento, com `npm test` e `npm run build` verdes antes de qualquer linha de IA ser escrita. Se algo quebrar depois, o `git bisect` distingue "a extração quebrou" de "o assistente quebrou". |
| **O modelo inventar um `id`** | `autorizar`/`recorte` recortam por `trip_id`; um id inventado não encontra linha e a operação vira `rejeitada`. Falha alto, não em silêncio. |
| **Custo real desconhecido** | Nenhuma medição existe. O digest de uma viagem de 5 pessoas precisa ser medido com `messages.countTokens` antes do primeiro deploy — se passar de alguns milhares de tokens por mensagem, o cache vira obrigatório, não otimização. |
| **`web_search` roda nos servidores da Anthropic** | A consulta sai do nosso controle. Por isso o digest omite estruturalmente o dado sensível (IA-14) em vez de confiar só na instrução. |
| ~~`ocorre_em` volta do snapshot com `Z` e milissegundos~~ — **risco descartado** | O `design.md` do checklist registrou este bug como aberto (`parseData` devolvendo `null` em silêncio, afetando o app inteiro). Ele **já foi corrigido**: `lib/db.ts:327` seleciona `to_char(ocorre_em, 'YYYY-MM-DD"T"HH24:MI:SS')`, o mesmo tratamento de `itinerary_days.dia`. Verificado nesta leitura; o digest do assistente lê horário do roteiro sem risco. Vale corrigir o registro antigo. |
| **Aba nova numa barra que já está cheia** | O `Shell` já resolve onze abas com quatro fixas + painel "Mais". A aba `assistente` entra no "Mais"; o acesso rápido no celular é o botão flutuante, não a barra. |

---

## Ordem de implementação

1. **Extração** `lib/escrita.ts` — sem comportamento novo, testes verdes. *(commit isolado)*
2. **Schema** `change_log.origem`/`lote`, tabela `ai_usage`, `registrarAlteracao`, `VERSAO` 7.
3. **Motor puro** `lib/assistente.ts` + `lib/consumo.ts` + testes. Nada de rede ainda.
4. **Conversa** `/api/assistente` — propõe, não escreve. Telemetria já grava.
5. **Aceite** `/api/assistente/aplicar` + `/desfazer` + `RevisaoPropostas`. P1 fechado.
6. **Painel** flutuante + aba + modo `duvida` com contexto de tempo/lugar. P2 e parte do P6.
7. **Voz** `lib/voz.ts`. P2 completo.
8. **Receitas** resumo de lugar, planejar dia, curiosidades no Roteiro e nas Cidades. P3 e P6-5.
9. **Criar viagem com IA** + revisão em bloco. P6-1/2.
10. **Web search** + fontes. P4.
11. **Proativo** `contextoDoSnapshot` + sugestões. P5.
12. **Relatório de consumo** — app primeiro, consolidado da organização depois, como bloco opcional. P7.

Os passos 1 a 3 não dependem da chave da Anthropic e podem ser revisados antes de qualquer custo ser gerado.
