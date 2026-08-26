# TripGo

**A multi-user, offline-first trip planner.** Itinerary, flights, cruises, lodging, cities, checklists, documents, emergency contacts and shared costs — for one traveller or a group of twenty. It opens in airplane mode, accepts edits with no network, and syncs when connectivity returns.

Built on Next.js 16 (App Router) + Neon Postgres, deployed on Vercel.

> **Language note.** The product, the UI copy and the identifiers in the source are all **pt-BR** (`viagem`, `roteiro`, `participante`). This document is in English; the code it describes is not. Names in tables below are the real identifiers.

---

## Table of contents

- [At a glance](#at-a-glance)
- [Architecture](#architecture)
- [Design decisions — and why](#design-decisions--and-why)
- [Data model](#data-model)
- [Request lifecycles](#request-lifecycles)
- [Authorization](#authorization)
- [Offline engine](#offline-engine)
- [Required documentation](#required-documentation)
- [Project layout](#project-layout)
- [Getting started](#getting-started)
- [Deploying](#deploying)
- [Loading a trip](#loading-a-trip)
- [Commands](#commands)
- [Testing](#testing)
- [Shipping a new update](#shipping-a-new-update)
- [The itinerary, day by day](#the-itinerary-day-by-day)
- [Known limitations](#known-limitations)
- [Security checklist](#security-checklist)

---

## At a glance

| | |
| --- | --- |
| **Framework** | Next.js 16.3.2, App Router, React 19.2, Node runtime |
| **Database** | Neon serverless Postgres — 27 tables, one idempotent `schema.sql` |
| **Auth** | Email + password, scrypt hashes, HMAC-signed httpOnly cookie, 90 days |
| **Runtime deps** | 4 — `next`, `react`, `@neondatabase/serverless`, `zod`, `lucide-react` |
| **Offline** | IndexedDB snapshot cache + write queue, service worker for the shell |
| **Conflict policy** | Last-write-wins on `updated_at`, every field change kept in `change_log` |
| **Tests** | 284 unit tests, `node --test`, zero test frameworks |
| **Styling** | Tailwind v4 + CSS custom properties, contrast measured not guessed |

Deliberately **not** installed: a PDF library (`window.print()` + `@media print`), a hashing library (`node:crypto` scrypt), an auth library (signed cookie), an IndexedDB wrapper, a date library (`Intl`), a PWA plugin, an ORM, a migration tool.

---

## Architecture

Three tiers, one rule: **the browser never speaks to Postgres.** The connection string exists only in the server process; the client knows nothing but `/api/*`.

```mermaid
flowchart TB
    subgraph BROWSER["🖥️ Browser"]
        direction TB
        UI["React UI<br/>5 pages + 12 trip tabs"]
        TP["TripProvider<br/>single source of client state"]
        IDB[("IndexedDB<br/>snapshot cache<br/>+ write queue")]
        SW["Service Worker<br/>app shell only — never /api/**"]
        UI <--> TP
        TP <--> IDB
    end

    subgraph EDGE["⚡ Next.js"]
        direction TB
        PROXY["proxy.ts<br/>optimistic cookie check<br/>redirect only"]
        RSC["Pages<br/>App Router"]
        API["Route Handlers<br/>10 endpoints, Node runtime"]
    end

    subgraph SERVER["🔒 Server-only modules"]
        direction TB
        AUTH["lib/auth.ts<br/>the real access barrier"]
        SCHEMA["lib/schema.ts<br/>zod contract"]
        DB["lib/db.ts<br/>SQL + snapshot assembly"]
    end

    NEON[("Neon Postgres<br/>27 tables<br/>credential lives only here")]

    TP -->|"fetch"| API
    SW -.->|"cache miss"| RSC
    PROXY --> RSC
    API --> AUTH --> DB --> NEON
    API --> SCHEMA
```

**Why this shape.** Any design that puts credentials in the browser cannot keep one traveller from reading the whole trip's finances, and any design without a server cannot sync five devices. Once a server exists, the only question left is how thin it can stay — and the answer was: nine route handlers, three server modules, no ORM.

---

## Design decisions — and why

Each of these was a fork in the road. The rationale matters more than the outcome, because the rationale is what tells you when to reverse it.

### 1. One snapshot per trip, not one endpoint per resource

`GET /api/snapshot?trip=<id>` returns **the whole trip** in a single response: trip, participants, itinerary, flights with nested stops, cruises with nested ports, reservations, places, checklist and its per-person state, documents, emergency contacts, messages, change history, and the slice of the trip's finances this person may see, plus the account's trip list and notifications.

A full trip is a few dozen KB. In exchange for that payload:

- **N+1 disappears.** Fifteen queries fire in one `Promise.all`; children are nested in a single JS pass, not one query per parent.
- **Offline caching becomes trivial.** One object in, one object out. There is no per-endpoint cache invalidation problem because there are no per-endpoint caches.
- **No client state library.** No React Query, no Redux, no SWR. `TripProvider` holds one object.

The ceiling is real and known: a trip large enough that a few dozen KB becomes a few MB would need pagination. No trip is.

### 2. Optimistic writes through a durable queue

The screen changes **before** the network is consulted. The operation is appended to an IndexedDB queue and flushed when possible. Offline and online run **the same code path** — offline is only the queue taking longer to drain.

This is what makes "works in airplane mode" a property of the architecture rather than a feature that needs testing separately.

### 3. Last-write-wins, with receipts

Every mutable row carries `updated_at timestamptz`. A write carries the client's `client_ts` and only lands if `updated_at < client_ts`. Older writes are dropped and reported back as `rejeitadas`.

CRDTs were the alternative. For a group editing different fields of a shared trip, they buy correctness nobody will observe at a complexity cost everybody pays. The mitigation is `change_log`: **both** versions of every changed field are recorded, so a dropped write is visible, not lost.

### 4. Role lives on the membership, never in the token

The session cookie carries **one thing**: the user id. Role is a property of the `(user, trip)` pair, resolved by query on every request.

The same person is `proprietario` of their own trip and `visualizador` of a friend's. Baking a role into a 90-day token would also mean a promotion or a removal takes 90 days to take effect.

### 5. Two clock conventions, on purpose

| Postgres type | Used for | Why |
| --- | --- | --- |
| `timestamp` (no tz) | Flight departures, check-ins, itinerary events | **Local time at the destination**, exactly as printed on the ticket. Converting time zones in an app used offline in transit is how you miss a flight. |
| `timestamptz` | `updated_at`, `criado_em` | Real server time. This is what last-write-wins compares. |

Money is **always** integer cents. Never float, never `numeric`.

### 6. Config-driven identity

Every brand string, colour and menu entry lives in `config/`. If you find `"TripGo"` written inside a component, that is a bug.

| File | Owns |
| --- | --- |
| `config/site.ts` | Name, tagline, manifesto, greetings, footer, demo account, social providers |
| `config/theme.ts` | Palette, semantic states, per-event-type badges, font roles |
| `config/navigation.ts` | Menu, private/public route lists, the `Papel` type and `papelAlcanca()` |

Rebranding this app touches three files and no components.

### 7. An expense is four facts, not one row

Who **paid** the vendor, who **owes** the money, **when** it leaves, and who **reimbursed** whom are four different things. Collapsing them (the old model was "value per person × number of people") cannot answer the question a group trip actually asks: *how much do I owe, to whom, and by when?*

```mermaid
flowchart LR
    E["expenses<br/>total + who paid"] --> S["expense_shares<br/>who owes, and how much"]
    E --> I["installments<br/>when it leaves"]
    S --> B(("saldo"))
    I --> B
    P["payments<br/>who reimbursed whom"] --> B
    B --> AC["acerto:<br/>quem paga quanto a quem"]
    style B fill:#CCFBF1,stroke:#0F766E,color:#0F766E
```

Balances and settlements are **derived, never stored** — there is no field anyone can edit into disagreeing with the expenses.

`peso` on a share is how many parts a person assumes. That one integer expresses a couple paying for two, a child at half, or someone joining a single leg — without a `couples` table.

All of it lives in `lib/financeiro.ts`: zero I/O, zero React, zero SQL. The server uses it to compute what each role may see; the screen uses it to draw; and the client uses the *same* functions for the optimistic paint, so what appears offline is exactly what gets written.

### 8. Schema-driven forms

`lib/schema.ts` is the single contract: the import file format, the mutation format, and the account forms. `EditorSheet.tsx` builds its fields **from the zod schema**, so fifteen entities share one editor instead of fifteen hand-written forms. The server validates against the same schemas before writing.

### 9. The itinerary's day list is derived, not stored

A trip screen that shows "30 DEZ · 31 DEZ · 01 JAN …" looks like it needs a `days`
table. It does not. The list comes from `data_partida..data_retorno`, computed by
`montarDias()`; `itinerary_days` stores only the days somebody actually wrote
*about* — a title, a summary, alerts, the two rituals.

The alternative — materialising every day at trip creation — buys nothing and costs
a reconciliation every time the dates change: shift the return date by two days and
you own the question of what happens to the rows past the end. Deriving makes that
question disappear, and a day annotated outside the range still renders (with no day
number) instead of silently taking its text with it.

---

## Data model

27 tables. Everything trip-scoped cascades from `trips`; everything person-scoped cascades from `users`.

```mermaid
erDiagram
    users ||--o{ trips : owns
    users ||--o{ travelers : "is"
    users ||--o{ notifications : receives
    trips ||--o{ travelers : has
    trips ||--o{ itinerary_events : has
    trips ||--o{ itinerary_days : "annotates"
    itinerary_events ||--o{ itinerary_options : "how to get there"
    trips ||--o{ flights : has
    trips ||--o{ reservations : has
    trips ||--o{ places : has
    trips ||--o{ cruises : has
    trips ||--o{ checklist_items : has
    trips ||--o{ documents : has
    documents ||--o| document_files : "bytes of"
    trips ||--o{ document_requirements : "requires"
    document_requirements ||--o{ document_submissions : "fulfilled by"
    travelers ||--o{ document_submissions : "delivers"
    documents ||--o| document_submissions : "attached to"
    trips ||--o{ emergency_contacts : has
    trips ||--o{ expense_categories : has
    trips ||--o{ expenses : has
    trips ||--o{ payments : settles
    expenses ||--o{ expense_shares : "split among"
    expenses ||--o{ installments : "paid over"
    travelers ||--o{ expense_shares : owes
    travelers ||--o{ payments : reimburses
    trips ||--o{ messages : has
    trips ||--o{ change_log : records
    flights ||--o{ flight_stops : "layovers"
    cruises ||--o{ cruise_ports : "calls at"
    expense_categories ||--o{ expenses : groups
    travelers ||--o{ checklist_state : ticks
    checklist_items ||--o{ checklist_state : "ticked by"
    travelers ||--o{ documents : "belongs to"
    travelers ||--o{ change_log : signs

    users {
        text id PK
        text email UK "lowercased, unique"
        text senha_hash "scrypt$N$salt$hash"
        text moeda_preferida
    }
    trips {
        text id PK
        text owner_id FK
        date data_partida
        date data_retorno
        boolean arquivada
    }
    travelers {
        text id PK
        text trip_id FK
        text user_id FK "null = name-only guest"
        text papel "proprietario / editor / visualizador"
    }
    expenses {
        text id PK
        integer valor_centavos "TOTAL in cents, never float"
        text traveler_id FK "who PAID the vendor"
        text divisao "igual / peso / personalizado"
    }
    expense_shares {
        text expense_id FK
        text traveler_id FK "who OWES"
        integer peso "parts assumed - a couple is 2"
        integer valor_centavos "resolved share"
    }
    installments {
        text expense_id FK
        integer numero
        date vence_em
        integer pago_centavos "paid to the vendor"
    }
    payments {
        text de_id FK "who reimbursed"
        text para_id FK "who received"
        text parcela_id FK "nullable — null = loose settlement"
    }
```

### The two joins that carry the model

**`travelers` is a membership, not a person.** A row with `user_id` is an account that can sign in and see the trip. A row without one is just a name on the list — a child, or someone who does not want an account. Without this dual nature, "add a participant" would require creating an account for everyone.

**`reservations` is one table for everything you book.** Hotels, restaurants, tours, tickets, cars. Lodging is a reservation that happens to have a check-out; keeping two tables with the same eight columns would duplicate the form, the screen and the query. `tipo` makes the distinction and the UI groups by it.

### Full column reference

`db/schema.sql` is the reference and it is heavily commented. It is **idempotent** — running it twice is a no-op — and split into two halves that must stay in sync:

```mermaid
flowchart LR
    A["CREATE TABLE IF NOT EXISTS<br/>final definition"] --> C{{"same end state"}}
    B["ALTER TABLE ... IF EXISTS<br/>migrations section"] --> C
    C --> D["npm run db:push"]
    style C fill:#CCFBF1,stroke:#0F766E,color:#0F766E
```

A fresh database is born correct from the first half. An old database catches up through the second. **Never edit only the first.**

One consequence that bit once: the create half runs **top to bottom**, so a table
may only reference a table defined *above* it. `itinerary_events` (line ~106) used
to declare `reserva_id` and `documento_id` inline, pointing at `reservations` and
`documents` — both defined a couple hundred lines *below*. Existing databases never
noticed (`if not exists` skipped the block), but `db:push` against an empty one
failed on a forward reference. Both columns now live only in the migrations
section, which runs after every table exists. When adding a foreign key, check
where the target is created.

---

## Request lifecycles

### Reading — first paint from cache, network confirms

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant TP as TripProvider
    participant IDB as IndexedDB
    participant API as /api/snapshot
    participant PG as Neon

    U->>TP: opens /viagens/:id
    TP->>IDB: lerSnapshot(tripId)
    IDB-->>TP: cached trip (or null)
    Note over TP: screen paints here — no network yet
    TP->>API: GET ?trip=:id
    API->>API: exigirUsuario → exigirViagem
    alt role = visualizador
        Note over API,PG: financial queries are scoped to<br/>this person's own obligations
    end
    API->>PG: 15 parallel queries
    PG-->>API: rows
    API-->>TP: snapshot + viagens + notificacoes + eu
    TP->>IDB: gravarSnapshot(tripId, …)
    TP-->>U: reconciled screen
```

The cache key is the **trip id**, not the user. Switching trips offline can never surface another trip's data — including its budget — through leftover cache.

### Writing — optimistic, queued, reconciled

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant TP as TripProvider
    participant IDB as IndexedDB
    participant API as /api/mutate
    participant PG as Neon

    U->>TP: edits a field
    TP->>TP: aplicarLocal() — UI updates now
    TP->>IDB: enfileirar(op)
    TP->>API: POST { trip_id, ops[] }

    alt offline / request fails
        API--xTP: no response
        Note over IDB: queue preserved, retried on 'online'
    else online
        API->>API: zod parse → exigirViagem → autorizar
        loop each op
            API->>PG: UPDATE … WHERE updated_at < client_ts
            alt server row is newer
                PG-->>API: 0 rows → rejeitadas[]
            else applied
                API->>PG: INSERT INTO change_log (de, para)
            end
        end
        API->>PG: rebuild snapshot
        API-->>TP: { aplicadas, rejeitadas, snapshot }
        TP->>IDB: limparFila() + gravarSnapshot()
    end
```

A deliberate refusal — 403 from authorization, 409 from integrity — **aborts the whole batch**. Swallowing it into a list would let the client see `200` and believe the write landed. Only a data error on a single operation becomes an entry in `rejeitadas`.

### Signing in

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant API as /api/sessao
    participant RL as rate limiter
    participant PG as Neon

    U->>API: POST { email, senha }
    API->>RL: estaBloqueado(ip)?
    alt blocked
        RL-->>U: 429 — before any CPU is spent
    end
    API->>PG: usuarioPorEmail
    API->>API: scrypt verify, timing-safe
    alt wrong password OR unknown email
        API->>RL: registrarFalha(ip)
        API-->>U: 401 "E-mail ou senha incorretos."
        Note over API: identical message for both —<br/>otherwise login is an email enumerator
    else correct
        API->>API: criarToken = userId.exp.HMAC
        API-->>U: Set-Cookie httpOnly, SameSite=Lax, 90d
    end
```

Rate limit: 10 failures per 5-minute window, then a 15-minute block.

---

## Authorization

Two layers that must not be confused.

```mermaid
flowchart TB
    REQ["Incoming request"] --> P{"proxy.ts<br/>cookie signature valid?"}
    P -->|"no, private route"| L["302 → /login?proximo=…"]
    P -->|"yes"| H["Page or Route Handler"]
    H --> A["exigirUsuario<br/>cookie → real user row"]
    A --> V["exigirViagem userId, tripId, minimum"]
    V --> Q[("SELECT papel FROM travelers<br/>WHERE trip_id AND user_id")]
    Q -->|"no row"| NF["404 — not 403"]
    Q -->|"role too low"| FB["403 with a specific message"]
    Q -->|"ok"| OK["Acesso { userId, tripId, papel, participanteId }"]

    style P fill:#FEF3C7,stroke:#A1590A,color:#A1590A
    style V fill:#CCFBF1,stroke:#0F766E,color:#0F766E
    style NF fill:#FFE4E6,stroke:#BE123C,color:#BE123C
```

`proxy.ts` is **optimistic and cosmetic**: it verifies the cookie's HMAC and nothing else, never touching the database. It runs on every route including prefetches, so a query there would turn into load per hovered link. The real barrier is `exigirViagem`, welded to the data source.

**404, not 403, for a trip you do not belong to.** Answering "you lack permission" would confirm the trip exists to anyone guessing ids.

### The three roles

| Capability | `visualizador` | `editor` | `proprietario` |
| --- | :---: | :---: | :---: |
| See itinerary, flights, lodging, places, documents, emergency | ✅ | ✅ | ✅ |
| Tick **their own** checklist row | ✅ | ✅ | ✅ |
| See **their own** payments | ✅ | ✅ | ✅ |
| See the trip's **totals, budget, balances and everyone's expenses** | ❌ | ✅ | ✅ |
| Create / edit / delete trip content, including expenses | ❌ | ✅ | ✅ |
| Manage participants and roles | ❌ | ❌ | ✅ |
| Import, export, delete the trip | ❌ | ❌ | ✅ |

### The money is scoped, not hidden

`financeiro` is **two different responses**, chosen by `financeiroDaViagem()` in `lib/db.ts` — not one payload the UI filters.

```mermaid
flowchart TB
    Q{"papelAlcanca(papel, editor)?"}
    Q -->|"yes"| A["admin: true<br/>categorias · despesas · divisoes<br/>parcelas · pagamentos<br/><br/>every row of the trip"]
    Q -->|"no"| B["admin: false<br/>obrigacoes · historico<br/>devendo · pago · atrasadas<br/><br/>only what this person owes"]
    A --> UI1["Painel completo"]
    B --> UI2["Meus pagamentos"]

    style A fill:#CCFBF1,stroke:#0F766E,color:#0F766E
    style B fill:#FEF3C7,stroke:#A1590A,color:#A1590A
```

For a `visualizador` the restriction is in the **SQL**, not in a `.filter()` afterwards: an expense they are not a participant of is never read from the database, and neither is anyone else's share row. The one thing that *is* read and never sent is the full installment amount — it is needed to compute their slice, and `resumoPessoal()` returns only that slice. So the group's total does not exist anywhere in the response.

Measured against the real trip: the same request returns **11,459 bytes** of financial data to the owner and **92 bytes** to a common traveller, and none of the trip's expense values appear in the second.

Three invariants worth keeping when this code is touched:

- A traveller's per-installment share is `repartir(minha_divisao, [valores das parcelas])` — splitting *their* total across the schedule. Splitting each installment among people instead gives a different number, and the sum of their installments would stop matching what they owe.
- Nobody owes themselves: an expense whose payer is the viewer produces no obligation.
- An expense with **no payer** is the normal state of a trip still being planned. It counts in the trip total and in nobody's balance.

### Personal documents are scoped the same way

The vault repeats the pattern, not the code: `documentosDaViagem()` in `lib/db.ts`
decides in the **query** what this session may see.

- `proprietario` reads every row.
- Everyone else reads `escopo = 'global'`, plus the `pessoal` rows they own
  (`traveler_id`) or were shared into (`assigned_to`).

An **editor is not entitled to read someone's passport** — planning the itinerary
is not the same permission as opening a personal document. That mirrors
`checklistDaViagem`, where a personal checklist item is owner-or-owner-of-the-trip
too.

The **person filter** in the vault is built from `pessoasComDocumentos()`, not
from the trip's participant list: it offers only people who own or share a
document *this session can actually see*. Listing all five names would let a
common traveller pick "Alana", get an empty screen, and read it as "Alana
uploaded nothing" when the truth is "her personal documents are not mine to
see". The panel says so in one line, and the owner — who does see everything —
gets the same control with no caveat.

The read scope alone is not enough, so it is closed twice more:

- `autorizar()` in `/api/mutate` refuses `editar`/`remover` on a `pessoal`
  document owned by somebody else — otherwise an editor who cannot *see* a
  passport could still overwrite it by guessing the id.
- `/api/documento` re-runs the same check before streaming bytes. It does not go
  through the snapshot, and a URL can be typed by hand.

There is one **deliberate exception**, and it runs the other way. A
`visualizador` may create, replace and delete **their own `pessoal` document** —
in `autorizar()` (`souDonoDoDocumento`, the same escape hatch a personal
checklist item already had) and in `POST /api/documento`. Without it the one
person who actually holds the passport would depend on the trip's organiser to
upload it, which is the opposite of what a vault is for. Everything else stays
`editor`: the group's voucher, somebody else's row, a document with no owner.

`podeEscrever()` / `podeApagar()` in `lib/cofre.ts` mirror those rules on the
client so the UI does not offer a button that turns into a 403 — and
`lib/cofre.test.ts` asserts the two halves agree, because a mirror that drifts is
worse than no mirror.

Two invariants enforced server-side regardless of role:

- A `visualizador` writing `checklist_state` for someone else's `traveler_id` → **403**.
- Removing or demoting the **last** `proprietario` → **409**. A trip cannot become unmanageable.
- Reading or writing another participant's `pessoal` document → **403**, on all three paths above.

---

## Offline engine

```mermaid
stateDiagram-v2
    [*] --> ColdStart
    ColdStart --> PaintedFromCache: IndexedDB hit
    ColdStart --> Loading: no cache
    Loading --> Synced: network responds
    PaintedFromCache --> Synced: revalidated
    PaintedFromCache --> Stale: no network

    Synced --> Pending: user edits
    Stale --> Pending: user edits
    Pending --> Synced: queue drained
    Pending --> Stale: still offline

    Stale --> Synced: 'online' event → recarregar + drenar

    note right of Stale
        UI shows offline badge
        + pending write count
    end note
```

Three cooperating pieces, each written by hand for a reason:

| Piece | ~Lines | Instead of | Why |
| --- | ---: | --- | --- |
| `lib/offline.ts` | 160 | dexie | Three object stores and nine operations. |
| `public/sw.js` | 46 | next-pwa | Caches the **shell only**. `/api/**` is never cached — an owner's cached snapshot would leak the budget to the next person opening the app on that device. |
| `TripProvider.tsx` | 284 | React Query | One object, one queue, one flush. |

### The document vault

The vault is the one place where offline means *files*, not JSON. Three stores now
live in IndexedDB — `snapshot`, `fila`, and `arquivos` — and the third one has a
rule the other two don't: **it survives every version bump.** The snapshot cache is
regenerable by one request, so an upgrade throws it away; the queue and the vault
are not, and wiping the vault on an app update would empty someone's documents
exactly when they can't download them again.

Two different facts are deliberately kept apart:

| Fact | Lives in | Means |
| --- | --- | --- |
| `documents.offline` | Postgres | The trip decided this document should travel offline. Shared by everyone. |
| a row in the `arquivos` store | IndexedDB | *This device* has the bytes. |

The same passport can be green on the phone and yellow on the laptop, and the
phone is the one that boards. `lib/cofreOffline.ts` is the seam (`abrir`,
`salvarOffline`, `sincronizar`): it looks in IndexedDB **first** and only then hits
the network, which is what makes a document marked offline independent of any
request. Swapping Postgres for a bucket later rewrites `baixar()` and nothing else.

The bytes themselves never ride in the snapshot. They live in `document_files`
(a separate table, keyed 1:1 to `documents`) and are served one at a time by
`/api/documento`, which re-checks visibility on its own — `documentosDaViagem`
scoping the snapshot is not enough when a URL can be typed by hand.

`lib/offline.ts` has one absolute rule: **nothing throws to the caller.** A private window, blocked site data, or an exhausted quota means no offline mode — the app still works online. An exception there would be a white screen.

---

## Required documentation

The vault stores what **exists**. This stores what is **missing** — and a
requirement nobody has met yet is exactly the interesting case: no file, no
delivery row, and still it has to show up in red in front of somebody before the
trip. A folder of PDFs cannot represent that, which is why it is a module and not
a checklist item.

Three tables and one pure engine:

| Piece | Holds |
| --- | --- |
| `document_requirements` | what the trip demands: name, category, whether it's mandatory, who it applies to, whether it wants a number / an expiry / a file, an upload deadline |
| `document_submissions` | one row per *(requirement, person)* — the number, the expiry, the attached vault document, and the review verdict, in the same row |
| `users.cpf` / `passaporte_*` / `emergencia_*` | the person's documental data, on the **account**, so a CPF is not retyped for every trip |
| `lib/documentacao.ts` | the whole traffic light, pure and tested — no DOM, no network |

Four decisions that explain the rest:

**Pending is the absence of a row.** Creating a requirement does not write five
submissions. Otherwise every participant who joins or leaves would need the list
rewritten, and whoever forgot would have somebody travelling without a demanded
passport.

**The delivery and the review live in one row, on purpose.** They are two tables
in theory and one fact in practice — "Ana's passport" has *a* state, not a
history somebody consults. The history already exists: every write goes through
`/api/mutate` and lands in `change_log`.

**The status column is the review, never the traffic light.** `estadoDe()`
computes `vencido`, `atrasado` and `proximo` from the dates at read time. Storing
the computed light would leave a passport `aprovado` in the database after it
expired, and nobody re-scans the table at midnight. Expiry beats review in the
precedence for the same reason: an approved passport expiring in 30 days is not a
closed matter, it is the most urgent thing there is.

**The percentage counts only the mandatory ones.** A "city guide PDF" marked as a
recommendation cannot push someone to 80% and make them look blocked when the
documentation that matters is complete.

### Who sees what

`documentacaoDaViagem()` in `lib/db.ts` returns three lists with three different
rules, cut **in the query**:

| | requirements | submissions | profiles |
| --- | --- | --- | --- |
| `proprietario` | all | all, with numbers | which fields are filled |
| `editor` | all | everyone's **state**, no passport numbers, no file ids | which fields are filled |
| `visualizador` | all | own only | own only |

Everyone sees the requirements: knowing what the trip demands exposes nobody, and
a traveller who cannot see the demand has no way to meet it. An editor chases the
delivery, so they get the state — but the redaction is a `case` in SQL, not a
deleted field in React, because deleting it in JavaScript still ships the number
over the wire where the network tab prints it whole.

That redaction created one trap worth naming: with the id hidden, "no id, so no
file" would have shown the entire trip as pending. `tem_arquivo` exists so the
privacy protection does not become a status bug.

### The two owners of one row

A submission has two halves and the 403 lives exactly between them:

- the **data** (`numero`, `validade`, `emitido_em`, `documento_id`) belongs to the traveller
- the **verdict** (review `status`, `comentario`) belongs to whoever reviews

Without that split, the same endpoint that lets Ana register her passport would
let Ana approve it, and would let an editor rewrite a passport number they cannot
even read. `revisado_por` / `revisado_em` are stamped by the **server** — a
`revisado_por` accepted from the browser would let any approval be signed by
anybody, and that signature is the only record of who checked.

Re-sending after a rejection clears the previous verdict: leaving "illegible
photo" next to the new photo tells the person they got it wrong again before
anyone has looked.

### Where it shows up

The engine feeds four screens without duplicating a single row:

- **`components/tabs/Documentacao.tsx`** — the traveller's own list, and the
  organiser's panel. One matrix, read by row or by column; two files would drift
  on the first new traffic-light rule.
- **Checklist** — `checklistDaDocumentacao()` returns **virtual** items with ids
  derived from the requirement. Nothing is written to `checklist_items`: ticking
  "register passport" by hand and then actually registering it would leave two
  truths about one fact, and the wrong one would be the hand-ticked one.
- **Itinerary** — the day view lists what the trip demands of you. "Of the day" is
  wider than a matching date: whoever boards today needs the passport, which has
  no date attached to it.
- **Home and the vault** — `AvisoDocumentacao` answers "what do I need to do now?"
  where the person already is, instead of waiting for them to open the right tab.

---

## Project layout

```
travel-guide/
├── app/
│   ├── (auth)/                  # public — proxy redirects logged-in users away
│   │   ├── login/               # email + password
│   │   └── register/            # signup, lands signed in
│   ├── (dashboard)/             # private — proxy redirects anonymous users to /login
│   │   ├── dashboard/           # greeting + the trip in focus
│   │   ├── viagens/             # trip list: create, duplicate, delete
│   │   │   └── [id]/            # ← the trip app: Shell + TripProvider + 11 tabs
│   │   └── perfil/              # account, password, preferences
│   ├── api/                     # 10 route handlers, all Node runtime
│   ├── layout.tsx               # fonts self-hosted at build, toast provider
│   └── globals.css              # design tokens as CSS custom properties
│
├── components/
│   ├── TripProvider.tsx         # client state: cache → network → optimistic → queue
│   ├── Shell.tsx                # sidebar on desktop, 4-slot tab bar + "More" on mobile
│   ├── EditorSheet.tsx          # ONE schema-driven editor for most entities
│   ├── FormDespesa.tsx          # the money form: pagador, divisão, parcelas
│   ├── CofreDocumento.tsx       # vault pieces: card, preview, small modal, offline hook
│   ├── MapaRota.tsx             # hand-projected SVG route map
│   ├── PdfBolso.tsx             # print-only pocket sheet — window.print(), no PDF lib
│   ├── ui.tsx                   # the whole design system
│   └── tabs/                    # Inicio · Roteiro · Conteudo · Interativas ·
│                                #   Financeiro · Dados
│
├── lib/
│   ├── db.ts                    # SQL + snapshot assembly. Credential stops here.
│   ├── auth.ts                  # exigirUsuario / exigirViagem — the access barrier
│   ├── session.ts               # scrypt, HMAC token, rate limit, cookies
│   ├── schema.ts                # zod contract: import format + mutations + forms
│   ├── importar.ts              # one transactional importer, shared by API and seed
│   ├── derive.ts                # pure calculations: dates, money formatting
│   ├── financeiro.ts            # the money engine — splits, schedules, balances,
│   │                            #   settlements, and the per-role privacy cut
│   ├── offline.ts               # IndexedDB
│   └── api.ts                   # route wrapper: exception → HTTP + pt-BR body
│
├── config/                      # site.ts · theme.ts · navigation.ts
├── db/
│   ├── schema.sql               # 27 tables, idempotent, migrations included
│   └── europa-2027.json         # a real trip in import format (see Limitations)
├── scripts/                     # db-push · seed · test-api runner
├── tests/api.test.mjs           # integration suite (see Testing)
├── proxy.ts                     # Next 16 middleware — renamed from middleware.ts
└── .specs/                      # spec, design, tasks, decision log
```

### API surface

| Endpoint | Methods | Minimum role | Purpose |
| --- | --- | --- | --- |
| `/api/usuarios` | `POST` | — | Create account, signs in immediately, links pending invites by email |
| `/api/sessao` | `POST` `DELETE` | — | Sign in / sign out |
| `/api/perfil` | `GET` `PATCH` `PUT` | signed in | Read profile · update profile · change password |
| `/api/viagens` | `GET` `POST` `PUT` `DELETE` | mixed | List · create · set active · delete *(owner)* |
| `/api/viagens/duplicar` | `POST` | member | Clone a whole trip with a day offset |
| `/api/snapshot` | `GET` | member | The entire trip in one response |
| `/api/mutate` | `POST` | per entity | Apply the write queue (expense + split + schedule land in one transaction) |
| `/api/import` | `POST` | signed in | Create a trip from JSON — `dry_run` previews |
| `/api/export` | `GET` | member | Download in the exact format import accepts |
| `/api/documento` | `GET` `POST` | member · editor | Stream one vault file · upload one (multipart, 4 MB). Re-checks personal-document visibility on its own. |

Trip duplication is worth a look: it runs **entirely in SQL**, never pulling rows into Node. `md5(old_id || new_id)` gives each copied record a deterministic new id, so children rediscover their copied parents without the server holding a mapping table in memory. Deliberately not copied: `checklist_state` (a new trip starts undone), `messages`, `change_log`, and other participants.

---

## Getting started

**Requirements:** Node 22+ (the repo relies on native TypeScript type stripping and `--env-file`), a Neon project.

```bash
npm install
cp .env.example .env.local          # then fill it in
npm run db:push                     # creates/updates all 27 tables — idempotent
npm run dev                         # http://localhost:3000
```

`.env.local`:

```ini
DATABASE_URL="postgresql://user:pass@host.neon.tech/neondb?sslmode=require"

# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET="<64 hex characters>"

# A SEPARATE database — the integration suite truncates tables
TEST_DATABASE_URL="postgresql://user:pass@host.neon.tech/travelguide_test?sslmode=require"
```

`.env.local` is gitignored and must never be committed.

**Optional demo data** — creates `demo@tripgo.com` / `123456` plus a sample trip:

```bash
node --env-file=.env.local scripts/seed.mjs
```

That account is advertised on the login screen by `siteConfig.demo.mostrar`. Set it to `false` before anything resembling production.

---

## Deploying

```mermaid
flowchart LR
    A["git push"] --> B["Vercel build<br/>next build + typecheck"]
    B --> C["Set DATABASE_URL<br/>+ SESSION_SECRET"]
    C --> D["npm run db:push<br/>run manually, pointed at prod"]
    D --> E["Live"]
    style D fill:#FEF3C7,stroke:#A1590A,color:#A1590A
```

1. `vercel`, or import the repository at vercel.com.
2. **Settings → Environment Variables**: add `DATABASE_URL` and `SESSION_SECRET`.
3. Deploy. `db:push` **does not run during the build** — apply the schema yourself against the same database. This is on purpose: a schema change should be a decision, not a side effect of a push.

Neon's free tier suspends an idle database, so the first request after a quiet period takes a few seconds. The local cache covers it — the app paints before the network answers.

---

## Loading a trip

```mermaid
flowchart TB
    subgraph PATHS["Three ways in"]
        direction TB
        A["✍️ By hand<br/>Trips → New trip, then<br/>the + button on each tab"]
        B["📄 From JSON<br/>Data tab → Import<br/>dry_run preview first"]
        C["📑 From PDFs / vouchers<br/>viagem-para-json skill"]
    end
    C --> B
    B --> D[("Trip in Postgres")]
    A --> D
    D --> E["📤 Export<br/>same format, round-trip verified"]
    E -.->|"restore"| B
```

**From PDFs.** Ask Claude Code in this repository — the `viagem-para-json` skill extracts the text, maps it to the app's format, validates against the real schema, and **reports contradictions between documents instead of silently picking one**.

```bash
node .claude/skills/viagem-para-json/scripts/validar.mjs db/europa-2027.json
```

**Import never replaces.** It always creates a *new* trip. With multiple trips per account, overwriting would be silent destruction — you end up with two and choose which to keep.

**Export is round-trip verified.** The output is assembled from the snapshot and validated against `TripImportSchema` before it is sent, so export → wipe → import reproduces the trip. Passwords are never included: the file travels by email and USB stick.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build, includes typecheck |
| `npm run lint` | ESLint |
| `npm run test` | **88 unit tests**, `node --test`, no framework |
| `npm run test:api` | Integration suite — see [Testing](#testing) |
| `npm run db:push` | Applies `db/schema.sql` to `DATABASE_URL` |
| `node --env-file=.env.local scripts/seed.mjs` | Demo account + sample trip |

---

## Testing

### Unit — 290 passing

```
lib/derive.test.ts     73 tests  pure calculations: dates, phases, countdowns,
                                 checklist progress, pt-BR money parsing, map projection,
                                 the day model of the itinerary (grouping, day summary,
                                 which day to open, distances, link parsing)
lib/cofre.test.ts      48 tests  the vault: grouping by destination, search, filters,
                                 the offline traffic light, expiry windows — plus the two
                                 rules that mirror the server, who may write a document
                                 and who may delete it, and the legacy-category normaliser
lib/financeiro.test.ts 44 tests  the money engine: exact splits, weights, custom
                                 amounts, installment schedules, overdue/partial/paid,
                                 balances, debt simplification, and the privacy cut —
                                 what a common traveller is allowed to receive
lib/documentacao.test.ts 38      required documentation: the whole traffic light, the
                                 precedence between expiry and review, what counts as
                                 delivered, the matrix and its two reports
lib/schema.test.ts     38 tests  the zod contract: field-precise error messages,
                                 calendar rollover, currency, roles, per-entity fields
lib/session.test.ts    16 tests  scrypt round-trip, tampered/expired tokens,
                                 timing-safe comparison, rate-limit windows
lib/checklist.test.ts  10 tests  suggestion resolution, title normalisation, dedup
lib/kml.test.ts         9 tests  KML parsing for the route map
lib/mapa.test.ts        9 tests  map projection and bounds
lib/localizar.test.ts   5 tests  place lookup
```

`lib/financeiro.ts` carries the heaviest coverage for the same reason `derive.ts` does:
a bug here is invisible until someone is asked to pay the wrong amount. Every split
and every schedule is asserted to sum **exactly** to the total, in integer cents.

`lib/derive.ts` is where a bug stays invisible until someone misses a flight, which is why it carries the heaviest coverage. One example of what is covered: `new Date("2026-12-30")` is parsed as **UTC** by the JS spec, which lands on the previous day anywhere west of Greenwich — Brazil included. `parseData()` builds the date component by component and rejects silent rollover, so `"2026-13-05"` is an error instead of becoming January 2027 in the flights tab.

### Integration — currently stale ⚠️

`tests/api.test.mjs` holds 26 end-to-end tests written against the **previous** authentication model: name + 4-digit PIN, `admin`/`viajante` roles, and a `/api/viajantes` endpoint that no longer exists. **`npm run test:api` fails wholesale until it is rewritten** for accounts, email/password and the three-role scale.

What the suite covered, and what a rewrite must preserve:

- A `visualizador` receives only their own obligations in `financeiro` — no trip total, no budget, no other person's share, no full installment amount. Verified at the wire, not in the UI
- 403 on editing content, 403 on ticking someone else's checklist
- Last-write-wins: a stale timestamp is rejected, the newer write survives
- `change_log` records both the previous and the new value
- Removing the last owner is refused
- Export → import round-trip reproduces the trip
- Export never carries credentials

The runner (`scripts/test-api.mjs`) is worth keeping as is. The suite runs `truncate trips cascade`, and it once wiped a real trip — so the runner now **refuses to start** if `TEST_DATABASE_URL` is missing or equal to `DATABASE_URL`. It boots its own server on port 3100 against the test database and tears it down afterwards.

---

## Shipping a new update

### Adding a field to an existing entity

1. `db/schema.sql` — add the column to the `create table` block **and** an `alter table … add column if not exists` in the migrations section.
2. `lib/schema.ts` — add it to that entity's zod schema. The editor sheet picks it up automatically.
3. `app/api/export/route.ts` + `lib/importar.ts` — include it, or backups quietly drop it.
4. `npm run db:push` locally, then against production.

### Adding a whole entity

Ten files, in this order. Skipping one produces a specific, predictable failure — noted in the last column.

```mermaid
flowchart TB
    S1["1 · db/schema.sql<br/>table + migration + index"] --> S2["2 · lib/schema.ts<br/>zod + ENTIDADES + TripImportSchema"]
    S2 --> S3["3 · api/mutate TABELA<br/>table name · via · minimum role"]
    S3 --> S4["4 · lib/db.ts<br/>Snapshot type + query"]
    S4 --> S5["5 · TripProvider<br/>type + LISTA optimistic entry"]
    S5 --> S6["6 · components/tabs/<br/>the screen"]
    S6 --> S7["7 · Shell.tsx<br/>AbaId + ABAS"]
    S7 --> S8["8 · viagens/:id/page.tsx<br/>render the tab"]
    S8 --> S9["9 · export + importar.ts<br/>round-trip"]
    S9 --> S10["10 · duplicar/route.ts<br/>copy on clone"]
    style S3 fill:#CCFBF1,stroke:#0F766E,color:#0F766E
    style S9 fill:#FEF3C7,stroke:#A1590A,color:#A1590A
```

| Step | If you skip it |
| --- | --- |
| 3 — `TABELA` entry | Every write returns *"Entidade desconhecida"* |
| 3 — `via` field | The record is reachable across trips by guessing ids — **security bug** |
| 5 — `LISTA` entry | Edits only appear after the round trip; no optimistic update |
| 9 — export/import | Backups silently lose the entity — including `resumirImportacao`, or the import screen reports "0" for something it did load |
| 10 — duplicate | Cloned trips come back missing it |

Two traps that only fire on a database **already in use**, and never on a fresh
one — which is why both shipped green and broke in production:

- A `check` constraint added as `not valid` tolerates the rows already stored and
  enforces the list on every INSERT from then on. Duplicating a trip and
  export→import are exactly the two paths that **re-insert old rows**, so a value
  written before the constraint existed makes them fail with a 500. See
  `normalizarCategoria()` in `lib/cofre.ts`.
- Widening an enum in the `create table` half does nothing for a table that
  already exists. `documents.tipo` listed `'arquivo'` up top while every existing
  database still carried the three-value constraint, so every upload died on
  `documents_tipo_check`. The migrations half is not optional.

The `via` field is the one to read twice. It is what scopes every operation by the session's `trip_id` rather than by id alone. `'trip'` for direct children, `'flight'` / `'cruise'` for grandchildren, `'self'` only for the trip row itself.

### Changing the shape of the snapshot

If a change alters what `/api/snapshot` returns, **bump `VERSAO` in `lib/offline.ts`**. The first paint of every screen comes from the IndexedDB cache, so without the bump the new code meets an object written by the previous version and crashes on a field that no longer exists — on the devices of people who already use the app, and only there. The upgrade drops the cached snapshot (regenerable in one request) and keeps the write queue (real work that has not synced).

### Changing the import format

`SCHEMA_VERSION` in `lib/schema.ts` is the file format version. Files declaring a **newer** version are refused with a clear message; older ones are accepted. Bump it whenever a key is renamed or removed, and keep the ability to read the previous shape — old exports live on people's hard drives.

### Evolving the database safely

```mermaid
flowchart LR
    NEW["Fresh database"] --> A["CREATE TABLE IF NOT EXISTS"]
    OLD["Existing database"] --> B["ALTER TABLE IF EXISTS<br/>+ DO $$ … $$ guards"]
    A --> SAME{{"identical end state"}}
    B --> SAME
    style SAME fill:#CCFBF1,stroke:#0F766E,color:#0F766E
```

There is no migration tool, on purpose: the schema is idempotent, so "apply the whole file" *is* the correct operation. The migrations section already carries real examples worth copying — `ativo` → `arquivada`, the `admin`/`viajante` → three-role remap, `stays` → `reservations` with a data copy before the drop, and dropping `pin_hash`.

The day a genuinely destructive change arrives — renaming a column in place, changing a type — that is the moment to bring in `drizzle-kit` or similar. Not before.

### Release flow

```bash
git switch -c feat/<thing>
npm run test && npm run build       # both must be green
npm run db:push                     # local database first
# review, commit in atomic pieces, open a PR
npm run db:push                     # production database, DATABASE_URL pointed at it
vercel --prod
```

### A note on `AGENTS.md`

`next dev` regenerates the `AGENTS.md` block on every run. It states that this version of Next.js differs from what a model was trained on and that `node_modules/next/dist/docs/` is the authority. Commit it with your work rather than reverting it — reverting only recreates the diff.

---

## The itinerary, day by day

The Roteiro is the one screen meant to be used **with one hand, on a phone, in a
foreign city**. It answers, in this order: where do I need to be now, what comes
next, how do I get there, how long does it take, do I need a document, do I have a
booking, what does it cost, and is there anything I should know first.

### Three levels

```
VIAGEM  ──►  DIA  ──►  ITEM
             │          │
             │          └─ nível 1  horário · o quê · onde · próximo deslocamento
             │             nível 2  como chegar · distância · transporte · duração
             │             nível 3  dicas · links · reserva · documentos · custos
             │
             └─ cabeçalho · resumo · alertas · checklist · antes de sair/dormir
```

Levels 2 and 3 are collapsed behind a **Detalhes** toggle. That is the whole reason
the screen can carry this much without reading as a spreadsheet: the first layer is
four facts per item, and everything else is one tap away.

### What comes from where

| On screen | Source | Stored? |
| --- | --- | --- |
| The strip of days | `trips.data_partida..data_retorno` | derived |
| Title, city, summary, alerts, the two rituals, day links, map link | `itinerary_days` | one row **per annotated day** |
| Timeline items, "how to get here", tips, links, estimated cost | `itinerary_events` | yes |
| The transport options under "Como chegar" | `itinerary_options` | yes, child of an item |
| Day chips (locais · km · deslocamentos · refeições · tempo) | `resumoDoDia()` over the day's items | derived, never hardcoded |
| Flights, hotel check-in/out, embarkation, port calls | `flights` · `reservations` · `cruises` | **not copied** — rendered from the other tabs |
| Checklist of the day | `checklist_items` whose deadline falls on the day | the existing checklist, same `checklist_state` |
| Money of the day | `financeiro` — the slice the server already decided this role may see | see [The money is scoped](#the-money-is-scoped-not-hidden) |

Two of those rows carry the design:

**Nothing is copied between modules.** A flight appears on its day as a *derived*
entry, marked "do cadastro de voos" and not editable from here. Writing the flight
into `itinerary_events` as well would create two records of one fact that then age
apart — which is exactly how a travel app starts lying about a departure time.

**The day's checklist is the trip's checklist.** Items whose `prazo_ideal` or
`prazo_maximo` lands on the open day, ticked through the same `checklist_state` the
Checklist tab writes. A second per-day task system would mean the same task ticked
in one place and open in the other.

### Reordering

Every item has a mandatory `ocorre_em`, so "move up" can only mean "happen earlier".
The ↑/↓ buttons **swap the times** of two neighbours; `ordem` exists only to break a
tie between two items marked at the same minute. There is no drag-and-drop: HTML5
drag is poor on touch, and a library for it would be the fifth runtime dependency.

### Text fields that are lists

`dicas`, `alertas`, `antes_sair` and `antes_dormir` are **one item per line** in a
single `text` column; `links` is `Rótulo|https://…` per line. Four child tables to
store sentences would have meant four entities, four editors and four round-trips
through the import format. `linhas()` and `lerLinks()` in `derive.ts` parse them —
and `lerLinks()` drops any scheme that is not `http`, `https`, `mailto` or `tel`,
because one person writes the itinerary and everybody else's browser renders it.

---

## Known limitations

Nothing here is a hidden surprise. Each is a deliberate choice with a known ceiling and a known upgrade path.

| Limitation | What it means in practice | Upgrade path |
| --- | --- | --- |
| **`db/europa-2027.json` is a v1 file** | It still uses `viajantes` and `hospedagens`. The current schema expects `participantes` and `reservas`, and zod **strips unknown keys** — so importing it today yields a trip with **0 participants and 0 reservations**, silently. | Rename the two keys, map `papel: admin → proprietario`, drop `pin`, set `schemaVersion: 2`. Better still, make `TripImportSchema` `.strict()` so drift becomes an error. |
| **Integration suite targets the removed PIN API** | `npm run test:api` fails wholesale. | Rewrite the 26 tests against accounts. The list of behaviours to preserve is in [Testing](#testing). |
| **Rate limit is per instance** | The counter lives in process memory. On serverless each instance keeps its own, so a distributed attacker gets more than 10 attempts per window. Marked with a `ponytail:` comment at the source. | Move the counter into a Neon table. It is a local change in `lib/session.ts`. |
| **Last-write-wins** | Two people editing the **same record** inside one sync window: the older write is dropped and reported. Nothing vanishes untraceably — `change_log` keeps both. | Per-field merge, or CRDTs if it ever justifies the cost. |
| **Routes referenced but not built** | `/esqueci-senha` is listed as public, `/configuracoes`, `/privacidade` and `/termos` are linked from `config/site.ts` and from participant notifications. All 404. | Build the pages, or remove the links. Password reset needs an email provider. |
| **Vault files cap at 4 MB** | `/api/documento` refuses anything larger, and the real ceiling is the serverless request body (4.5 MB on Vercel), not Postgres. A photographed passport and a hotel voucher fit comfortably; a scanned 40-page contract does not. Marked with a `ponytail:` comment at the source. | Direct-to-bucket upload with a signed URL. Raising the number alone would fail at the edge, before the handler runs. |
| **Vault files live in Postgres `bytea`** | `document_files` keeps the bytes in the same database as everything else, which buys backup, transactions and authorization for free, and costs database size and egress as the vault grows. | `lib/cofreOffline.ts` `baixar()` plus the two handlers in `/api/documento` are the whole seam — the screens never touch storage. Neon Object Storage, S3 or Vercel Blob replaces it without touching the UI. |
| **Offline vault is available, not encrypted** | Files marked "disponível offline" sit unencrypted in IndexedDB. Anyone holding the unlocked device can open them. The screen says exactly this, and the feature is deliberately never described as a bank-grade vault — it keeps documents *available*, not *secret*. | Encrypt blobs at rest with a key derived from the session; the store already goes through `lib/offline.ts`, so it is one layer, not a rewrite. |
| **Avatars are still URLs** | `users.avatar_url` takes a link; nothing uploads an image. Document files no longer share this limitation. | Point avatars at `/api/documento`'s upload path, or a bucket. |
| **Vault links do not survive export/import** | `documents.itinerary_event_id` and `flight_id` are dropped on import — the itinerary is inserted *after* documents (it points back at them), so the ids do not exist yet. `reserva`, `dono_nome` and `assigned_to_nomes` **do** round-trip, by name. The same compromise the checklist already makes. | A second pass that resolves event and flight links by name after the itinerary is inserted. |
| **Map has no coastline** | The home map projects the route and pins onto an abstract gradient. | A simplified GeoJSON, ~20–50 KB, from a reliable source. |
| **Export omits credentials** | A restored backup has no passwords. Intentional — the file circulates by email. | None wanted. |
| **Old expenses import without a split** | A v2 backup records how *many* people shared a cost, never *who*. The importer converts the amount to a total and leaves the split empty rather than inventing participants; the screen marks those expenses "a dividir". | Open each one and choose who divides it. |
| **A reimbursement tied to an installment is re-linked by description** | Installment ids are recreated on import, so `payments.parcela_id` is restored by matching *expense description + installment number*. Two expenses with the same description put the payment on the first. Balances stay exact either way — only the "paid on this installment" label can move. | Export the expense's `ordem` alongside it. |
| **Only `itinerary_days.dia` is read as text** | The Neon driver materialises a `date` column as a `Date` in server-local time, and JSON serialisation converts it to UTC — east of Greenwich that lands on the previous day. The itinerary's day key is converted with `to_char` in the query because the whole screen indexes on it. The other `date` columns (`prazo_ideal`, `ocorre_em` on an expense, `vence_em`) still travel as `Date`, which is correct for a UTC server and for any timezone west of Greenwich — both environments this runs in. | Same `to_char` on those queries. `expenses.ocorre_em` and `installments.vence_em` feed the money engine, so that one wants its tests re-run, not a blind edit. |
| **The day list is derived, not stored** | `itinerary_days` holds only the days somebody wrote *about*. The list of days on screen comes from `data_partida..data_retorno`, so shortening a trip hides nothing — a day with notes outside the new range still renders, without a day number. | None wanted. Storing every day would mean a write per trip creation and a reconciliation on every date change. |
| **"Antes de sair" / "antes de dormir" tick locally** | The two day rituals live in `localStorage`, per device. The *lists* are stored on the day; only the checkmarks are local, so they do not sync between the five travellers and vanish with cleared site data. Marked with a `ponytail:` comment at the source. | Move the marks into `checklist_state`, which already carries per-person state. The lists themselves would not move. |
| **Reordering a day means changing times** | Every itinerary item has a mandatory `ocorre_em`, so the up/down buttons swap the *time* of two neighbours rather than a parallel `ordem`. `ordem` only breaks a tie between two items marked at the same minute. | None wanted — a timeline whose order disagrees with the clock it prints is worse. |
| **Trip duplication drops item → reservation links** | `reserva_id` and `documento_id` are set to NULL on clone: the copy's reservations are new rows, and keeping the old id would point an item at another trip. | Copy reservations and documents with derived ids too, the way flights already are. |
| **Debt simplification is greedy** | Largest debtor against largest creditor. At most n−1 transfers, which settles any group; not the proven minimum (that is NP-hard). | A partition solver, if a trip ever has enough participants for it to matter. |
| **`db:push` is not part of the build** | Deploying does not migrate. | Intentional. Automate only with a real migration tool. |
| **Social sign-in is inert** | Google and Apple buttons render disabled with a reason, driven by `siteConfig.social`. | Flip `ativo` once a provider is wired. |

---

## Security checklist

- [ ] **Rotate the Neon password.** The development connection string passed through a chat conversation and is in that history. Neon console → project → **Roles** → `neondb_owner` → **Reset password**, then update `.env.local` and the Vercel environment variable. Until that is done, assume anyone with access to that history has full database access.
- [ ] **Generate a unique `SESSION_SECRET` per environment.** It signs every session token; sharing one across environments means a token minted in staging is valid in production.
- [ ] **Set `siteConfig.demo.mostrar = false`** before real users arrive — it publishes working credentials on the login screen.
- [ ] **Point `TEST_DATABASE_URL` at a throwaway database.** The runner refuses to start otherwise, but verify it anyway.

What is already handled: scrypt with a per-password salt, timing-safe comparison everywhere, identical failure messages for unknown-email and wrong-password, httpOnly + `SameSite=Lax` + `Secure`-in-production cookies, request body size caps per route, SQL parameterised throughout — including the dynamic `INSERT`/`UPDATE` builders in `/api/mutate`, where only column names derived from validated zod schemas are ever interpolated.

---

<div align="center">

**Built with intent.** Every dependency not installed here was a decision, and every one of those decisions is written down — in `.specs/`, in the comments, and above.

</div>
