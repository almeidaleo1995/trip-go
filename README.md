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
- [The Hoje screen](#the-hoje-screen)
- [Installing and rate limits](#installing-and-rate-limits)
- [Project layout](#project-layout)
- [Getting started](#getting-started)
- [Deploying](#deploying)
- [Loading a trip](#loading-a-trip)
- [Building a trip from documents](#building-a-trip-from-documents)
- [Commands](#commands)
- [Testing](#testing)
- [Shipping a new update](#shipping-a-new-update)
- [The itinerary, day by day](#the-itinerary-day-by-day)
- [Known limitations](#known-limitations)
- [Security](#security)
- [Security checklist](#security-checklist)

---

## At a glance

|                     |                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Framework**       | Next.js 16.3.2, App Router, React 19.2, Node runtime                                                                                                                                                             |
| **Database**        | Neon serverless Postgres — 28 tables, one idempotent `schema.sql`                                                                                                                                                |
| **Auth**            | Email + password, scrypt hashes, HMAC-signed httpOnly cookie, 90 days                                                                                                                                            |
| **Runtime deps**    | 5 — `next`, `react` (+ `react-dom`), `@neondatabase/serverless`, `zod`, `lucide-react`                                                                                                                           |
| **Offline**         | IndexedDB snapshot cache + write queue, service worker for the shell                                                                                                                                             |
| **Conflict policy** | Last-write-wins on `updated_at`, every field change kept in `change_log`                                                                                                                                         |
| **Tests**           | 476 unit tests, `node --test`, zero test frameworks; plus `db/teste-recorte.sql` and `db/teste-limite.sql` against a real Postgres; CI runs tests, types, lint, `npm audit` and build     |
| **Styling**         | Tailwind v4 + CSS custom properties, contrast measured not guessed                                                                                                                                               |

Deliberately **not** installed: a PDF library (`window.print()` + `@media print`), a hashing library (`node:crypto` scrypt), an auth library (signed cookie), an IndexedDB wrapper, a date library (`Intl`), a PWA plugin, an ORM, a migration tool, an AI SDK.

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

    NEON[("Neon Postgres<br/>28 tables<br/>credential lives only here")]

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

| Postgres type       | Used for                                       | Why                                                                                                                                                    |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `timestamp` (no tz) | Flight departures, check-ins, itinerary events | **Local time at the destination**, exactly as printed on the ticket. Converting time zones in an app used offline in transit is how you miss a flight. |
| `timestamptz`       | `updated_at`, `criado_em`                      | Real server time. This is what last-write-wins compares.                                                                                               |

The **Hoje** tab is the one screen where "now" has to be compared against those
naive timestamps, and it converts exactly one side: `trips.fuso` (an IANA name,
nullable) turns the device clock into the destination's wall clock, and event
times are never touched. Travelling, the two agree anyway — the phone switches
zones on landing. Planning from home they don't, and without the conversion the
screen would call the wrong day "today". Null `fuso` means "trust the device",
which is correct in the case that matters most.

Money is **always** integer cents. Never float, never `numeric`.

### 6. Config-driven identity

Every brand string, colour and menu entry lives in `config/`. If you find `"TripGo"` written inside a component, that is a bug.

| File                   | Owns                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `config/site.ts`       | Name, tagline, manifesto, greetings, footer, demo account, social providers |
| `config/theme.ts`      | Palette, semantic states, per-event-type badges, font roles                 |
| `config/navigation.ts` | Menu, private/public route lists, the `Papel` type and `papelAlcanca()`     |

Rebranding this app touches three files and no components.

### 7. An expense is four facts, not one row

Who **paid** the vendor, who **owes** the money, **when** it leaves, and who **reimbursed** whom are four different things. Collapsing them (the old model was "value per person × number of people") cannot answer the question a group trip actually asks: _how much do I owe, to whom, and by when?_

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

All of it lives in `lib/financeiro.ts`: zero I/O, zero React, zero SQL. The server uses it to compute what each role may see; the screen uses it to draw; and the client uses the _same_ functions for the optimistic paint, so what appears offline is exactly what gets written.

### 8. Schema-driven forms

`lib/schema.ts` is the single contract: the import file format, the mutation format, and the account forms. `EditorSheet.tsx` builds its fields **from the zod schema**, so fifteen entities share one editor instead of fifteen hand-written forms. The server validates against the same schemas before writing.

### 9. The itinerary's day list is derived, not stored

A trip screen that shows "30 DEZ · 31 DEZ · 01 JAN …" looks like it needs a `days`
table. It does not. The list comes from `data_partida..data_retorno`, computed by
`montarDias()`; `itinerary_days` stores only the days somebody actually wrote
_about_ — a title, a summary, alerts, the two rituals.

The alternative — materialising every day at trip creation — buys nothing and costs
a reconciliation every time the dates change: shift the return date by two days and
you own the question of what happens to the rows past the end. Deriving makes that
question disappear, and a day annotated outside the range still renders (with no day
number) instead of silently taking its text with it.

---

## Data model

28 tables. Everything trip-scoped cascades from `trips`; everything person-scoped cascades from `users`.

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
may only reference a table defined _above_ it. `itinerary_events` (line ~106) used
to declare `reserva_id` and `documento_id` inline, pointing at `reservations` and
`documents` — both defined a couple hundred lines _below_. Existing databases never
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

| Capability                                                          | `visualizador` | `editor` | `proprietario` |
| ------------------------------------------------------------------- | :------------: | :------: | :------------: |
| See itinerary, flights, lodging, places, documents, emergency       |       ✅       |    ✅    |       ✅       |
| Tick **their own** checklist row                                    |       ✅       |    ✅    |       ✅       |
| See **their own** payments                                          |       ✅       |    ✅    |       ✅       |
| See the trip's **totals, budget, balances and everyone's expenses** |       ❌       |    ✅    |       ✅       |
| Create / edit / delete trip content, including expenses             |       ❌       |    ✅    |       ✅       |
| Manage participants and roles                                       |       ❌       |    ❌    |       ✅       |
| Import, export, delete the trip                                     |       ❌       |    ❌    |       ✅       |

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

For a `visualizador` the restriction is in the **SQL**, not in a `.filter()` afterwards: an expense they are not a participant of is never read from the database, and neither is anyone else's share row. The one thing that _is_ read and never sent is the full installment amount — it is needed to compute their slice, and `resumoPessoal()` returns only that slice. So the group's total does not exist anywhere in the response.

Measured against the real trip: the same request returns **11,459 bytes** of financial data to the owner and **92 bytes** to a common traveller, and none of the trip's expense values appear in the second.

Three invariants worth keeping when this code is touched:

- A traveller's per-installment share is `repartir(minha_divisao, [valores das parcelas])` — splitting _their_ total across the schedule. Splitting each installment among people instead gives a different number, and the sum of their installments would stop matching what they owe.
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
document _this session can actually see_. Listing all five names would let a
common traveller pick "Alana", get an empty screen, and read it as "Alana
uploaded nothing" when the truth is "her personal documents are not mine to
see". The panel says so in one line, and the owner — who does see everything —
gets the same control with no caveat.

The read scope alone is not enough, so it is closed twice more:

- `autorizar()` in `/api/mutate` refuses `editar`/`remover` on a `pessoal`
  document owned by somebody else — otherwise an editor who cannot _see_ a
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

| Piece              | ~Lines | Instead of  | Why                                                                                                                                                        |
| ------------------ | -----: | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/offline.ts`   |    160 | dexie       | Three object stores and nine operations.                                                                                                                   |
| `public/sw.js`     |     46 | next-pwa    | Caches the **shell only**. `/api/**` is never cached — an owner's cached snapshot would leak the budget to the next person opening the app on that device. |
| `TripProvider.tsx` |    284 | React Query | One object, one queue, one flush.                                                                                                                          |

### The document vault

The vault is the one place where offline means _files_, not JSON. Three stores now
live in IndexedDB — `snapshot`, `fila`, and `arquivos` — and the third one has a
rule the other two don't: **it survives every version bump.** The snapshot cache is
regenerable by one request, so an upgrade throws it away; the queue and the vault
are not, and wiping the vault on an app update would empty someone's documents
exactly when they can't download them again.

Two different facts are deliberately kept apart:

| Fact                          | Lives in  | Means                                                                     |
| ----------------------------- | --------- | ------------------------------------------------------------------------- |
| `documents.offline`           | Postgres  | The trip decided this document should travel offline. Shared by everyone. |
| a row in the `arquivos` store | IndexedDB | _This device_ has the bytes.                                              |

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

| Piece                                         | Holds                                                                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document_requirements`                       | what the trip demands: name, category, whether it's mandatory, who it applies to, whether it wants a number / an expiry / a file, an upload deadline, and the `pais` that demands it (null = the whole trip does) |
| `document_submissions`                        | one row per _(requirement, person)_ — the number, the expiry, the attached vault document, and the review verdict, in the same row                   |
| `users.cpf` / `passaporte_*` / `emergencia_*` | the person's documental data, on the **account**, so a CPF is not retyped for every trip                                                             |
| `lib/documentacao.ts`                         | the whole traffic light, pure and tested — no DOM, no network                                                                                        |

Four decisions that explain the rest:

**Pending is the absence of a row.** Creating a requirement does not write five
submissions. Otherwise every participant who joins or leaves would need the list
rewritten, and whoever forgot would have somebody travelling without a demanded
passport.

**The delivery and the review live in one row, on purpose.** They are two tables
in theory and one fact in practice — "Ana's passport" has _a_ state, not a
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

|                | requirements | submissions                                                                   | profiles                                        |
| -------------- | ------------ | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| `proprietario` | all          | all, with numbers                                                             | which fields are filled + passport expiry       |
| `editor`       | all          | everyone's **state** + expiry + review comment, no numbers, no file ids       | which fields are filled + passport expiry       |
| `visualizador` | all          | everyone's **state**, no numbers, no expiry, no review comment, no file ids   | which fields are filled, own expiry only        |

Everyone sees the requirements: knowing what the trip demands exposes nobody, and
a traveller who cannot see the demand has no way to meet it. An editor chases the
delivery, so they get the state — but the redaction is a `case` in SQL, not a
deleted field in React, because deleting it in JavaScript still ships the number
over the wire where the network tab prints it whole.

**The `visualizador` row was deliberately widened** when the country-requirements
note landed in the itinerary: it used to be "own submissions only". The note in a
day's header answers "who has already met what this country demands", and that
question cannot be answered from one's own row alone. What widened is the
**state**; every VALUE stayed shut, and one that an `editor` does see — the expiry
date and the reviewer's comment — is closed here, because a viewer does not
review. `db/teste-recorte.sql` block D pins both halves against a real Postgres:
the state comes through, the number, the expiry and the comment do not.

That redaction created one trap worth naming, twice. With the id hidden, "no id,
so no file" would have shown the entire trip as pending; `tem_arquivo` exists so
the privacy protection does not become a status bug. Hiding the expiry from a
viewer reopened exactly the same hole from the other side — "no date, so the
expiry is missing" — and `tem_validade` (plus `passaporte_validade_preenchida` on
the profile summary) closes it the same way. **Any column that leaves this query
needs its boolean to arrive**, or the semaphore lies about whoever already
complied.

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

## The Hoje screen

Every other tab answers "how is the trip shaping up". **Hoje** answers one
question only: _what am I doing now and how do I get there._ It is the screen for
someone standing on a street with one hand free and 12% of battery, so anything
that does not serve that is deliberately absent — including good things.

It becomes the default tab while `faseDaViagem` reports `durante`, and takes
Roteiro's slot in the mobile bar for the same window. Before and after the trip it
still opens (it explains itself: a countdown, or "viagem concluída") but it does
not earn one of the four thumb-reachable slots.

**It stores nothing.** `lib/hoje.ts` is pure, 47 tests, and derives every line
from what the other modules already hold — the same reason `lib/preparacao.ts` has
no table of its own. A stored "current activity" would go stale the moment nobody
came back to unmark it, and this is the screen that must never lie about now.

| Block                  | Derived from                               | The rule worth knowing                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Agora**              | `itinerary_events` + the clock             | An event that has ended is never "now" — it steps aside so the next one gets the screen. With no `fim_em` (the column is optional and rarely filled) an item runs until the next one starts, capped at 90 minutes. |
| **A seguir**           | the next event + `duracao_min`             | The gold **"Saia às"** panel is the loudest thing on the page, and the only computed time: `ocorre_em − duracao_min − margin`. Margins are per type (`voo` 30 min, `cruzeiro` 45, default 5) and overridable.      |
| **Depois disso (N)**   | the rest of the day                        | Collapsed. The whole day already has a tab.                                                                                                                                                                        |
| **Onde eu durmo hoje** | `reservations` where `tipo = 'hospedagem'` | **Never hidden by the end of the itinerary.** At 23:00 the timeline is over and this is the only thing left that matters. On check-out day the hotel stays, labelled with the check-out time.                      |
| **Rituais do dia**     | `checklist_items` + `checklist_state`      | Not a second checklist — the same rows, filtered to what is mine and due today. Ticking here ticks there, and syncs across the five devices.                                                                       |

The only write on the screen is that checkbox. Editing stays where editing lives.

**Ingresso / Voucher** reuse `documentosDe` from `lib/cofre.ts` — a reference to
the document already linked to the event or the reservation, opened through
`cofreOffline.abrir()`, which reads the device's copy before the network. That is
the museum-queue case: a QR code with no signal.

**Endereço** does not open a map. It opens a full-screen panel with the address in
`.t-endereco` and a copy button, because the actual task is _showing the phone to a
driver_, and a map needs a network the traveller may not have. The map link is
secondary and appears only with coordinates.

Weather (`lib/clima.ts`) and the map link are the only online-dependent pieces, and
both simply vanish without a network rather than showing a placeholder.

## Installing and rate limits

### The manifest is code, and it is not decoration

`app/manifest.ts` is a Metadata Route, not a static `public/manifest.json`, for the
project's own reason: **no brand string lives outside `config/site.ts`**, and the
manifest needs the name, the description and two colours. A static JSON would make
rebranding a two-file job, and the second file is the one everybody forgets.

Why it matters more than an icon: **without a manifest the app is not
installable**, and on iPhone that costs the offline data. Safari clears storage —
IndexedDB included, which is where the cached trip and the vault files live — for
any site not visited in 7 days. A site added to the Home Screen is exempt. Without
it, someone prepares the trip in November, boards in March, opens the app on the
plane and finds it empty: the exact scenario this app exists to prevent.

What ships:

|                                         |                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/manifest.webmanifest`                 | Generated from `siteConfig` + `theme`. `display: standalone`, `start_url: /viagens` — whoever installed it already chose.       |
| `public/icone-192.png`, `icone-512.png` | The `any` icons.                                                                                                                |
| `public/icone-maskable-512.png`         | Android crops icons to the system shape and eats up to 20% of each edge; this one has the artwork inside that safe zone.        |
| `app/apple-icon.png`                    | 180×180, square and opaque — iOS applies its own mask, so a pre-rounded icon would be a rounded square inside a rounded square. |

Next emits `mobile-web-app-capable` (the standardised name) rather than the
deprecated `apple-mobile-web-app-capable`. iOS 16.4+ honours the manifest's
`display: standalone` on its own.

**Still manual:** somebody has to actually tap "Add to Home Screen" on each phone.
Nothing in the app asks them to yet.

### Two limits, two different abuses

`lib/session.ts` has one counter and two policies, because signing in and signing
up are attacked differently:

|                               | Counts                              | Limit                           | Reset                     |
| ----------------------------- | ----------------------------------- | ------------------------------- | ------------------------- |
| **Sign-in** (`/api/sessao`)   | only _wrong_ attempts               | 10 / 5 min, then 15 min blocked | success clears the window |
| **Sign-up** (`/api/usuarios`) | **every** attempt, success included | 5 / hour, then 1 hour blocked   | never — that is the point |

The asymmetry is the whole design. What you block at sign-in is somebody _guessing
a password_, so only failures count and a correct password clears the slate. What
you block at sign-up is the account created **successfully** — a thousand rows from
one IP, each one also firing `vincularParticipantesPorEmail`. Counting only
failures there would stop nothing.

Keys are namespaced (`cadastro:<ip>`), so a botched login cannot eat the sign-up
quota of somebody on the same network. Both routes check the block **before**
scrypt: checking after would make the rate limit its own load vector.

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
│   │   │   └── [id]/            # ← the trip app: Shell + TripProvider + 12 tabs
│   │   └── perfil/              # account, password, preferences
│   ├── api/                     # 10 route handlers, all Node runtime
│   ├── layout.tsx               # fonts self-hosted at build, toast provider
│   └── globals.css              # design tokens as CSS custom properties
│
├── components/
│   ├── TripProvider.tsx         # client state: cache → network → optimistic → queue
│   ├── Shell.tsx                # sidebar on desktop, 4-slot tab bar + "More" on mobile
│   │                              # (the 4 change during the trip: Hoje replaces Roteiro)
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
│   ├── schema.sql               # 28 tables, idempotent, migrations included
│   └── europa-2027.json         # the real Europa 2027 trip, v3, import-ready
├── scripts/                     # db-push · seed · alias · test-api runner
├── tests/api.test.mjs           # integration suite (see Testing)
├── proxy.ts                     # Next 16 middleware — renamed from middleware.ts
└── .specs/                      # spec, design, tasks, decision log
```

### API surface

| Endpoint                | Methods                     | Minimum role    | Purpose                                                                                                                                                   |
| ----------------------- | --------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/usuarios`         | `POST`                      | —               | Create account, signs in immediately, links pending invites by email                                                                                      |
| `/api/sessao`           | `POST` `DELETE`             | —               | Sign in / sign out                                                                                                                                        |
| `/api/perfil`           | `GET` `PATCH` `PUT`         | signed in       | Read profile · update profile · change password                                                                                                           |
| `/api/viagens`          | `GET` `POST` `PUT` `DELETE` | mixed           | List · create · set active · delete _(owner)_                                                                                                             |
| `/api/viagens/duplicar` | `POST`                      | member          | Clone a whole trip with a day offset                                                                                                                      |
| `/api/snapshot`         | `GET`                       | member          | The entire trip in one response                                                                                                                           |
| `/api/mutate`           | `POST`                      | per entity      | Apply the write queue (expense + split + schedule land in one transaction)                                                                                |
| `/api/import`           | `POST`                      | signed in       | Create a trip from JSON — `dry_run` previews                                                                                                              |
| `/api/export`           | `GET`                       | member          | Download in the exact format import accepts                                                                                                               |
| `/api/documento`        | `GET` `POST`                | member · editor | Stream one vault file (chunked `ReadableStream`) · upload one in 4 MiB parts (multipart, 25 MB total). Re-checks personal-document visibility on its own. |

Trip duplication is worth a look: it runs **entirely in SQL**, never pulling rows into Node. `md5(old_id || new_id)` gives each copied record a deterministic new id, so children rediscover their copied parents without the server holding a mapping table in memory. Deliberately not copied: `checklist_state` (a new trip starts undone), `messages`, `change_log`, and other participants.

---

## Getting started

**Requirements:** Node 22+ (the repo relies on native TypeScript type stripping and `--env-file`), a Neon project.

```bash
npm install
cp .env.example .env.local          # then fill it in
npm run db:push                     # creates/updates all 28 tables — idempotent
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
        C["📑 From PDFs / vouchers<br/>roteiro-trip-go skill<br/>in Claude Code"]
    end
    C -->|"subir.mjs --nova"| D
    C -->|"subir.mjs --viagem"| D
    C -.->|"or hand the file over"| B
    B --> D[("Trip in Postgres")]
    A --> D
    D --> E["📤 Export<br/>same format, round-trip verified"]
    E -.->|"restore"| B
```

**From PDFs and vouchers.** Ask Claude Code in this repository — the `roteiro-trip-go` skill extracts the text, maps it to the app's format, validates against the real schema, and **reports contradictions between documents instead of silently picking one**. It can hand you the file, or put the trip in the app itself. See [Building a trip from documents](#building-a-trip-from-documents).

**Every path ends at the same two writers.** A new trip is always `importarViagem`; a row added to an existing trip is always `autorizar` + `aplicar`. Nothing writes trip data by any other route — a second writer would be a second copy of the authorization rules, and the second copy is the one that ages.

**Import never replaces.** It always creates a _new_ trip. With multiple trips per account, overwriting would be silent destruction — you end up with two and choose which to keep.

**Export is round-trip verified.** The output is assembled from the snapshot and validated against `TripImportSchema` before it is sent, so export → wipe → import reproduces the trip. Passwords are never included: the file travels by email and USB stick.

---

## Building a trip from documents

The app never reads a PDF. Turning a pile of vouchers, tickets and notes into a
trip happens **outside** the app, in Claude Code, through the `roteiro-trip-go`
skill in `.claude/skills/` — and the result goes straight into the database, so
the trip is on screen when you open it.

```bash
# which trips exist, and whose — this is what keeps uuids out of the conversation
node --env-file=.env.local .claude/skills/roteiro-trip-go/scripts/viagens.mjs

# what the app's contract accepts, read live from lib/schema.ts
node .claude/skills/roteiro-trip-go/scripts/campos.mjs [secao]

# validate a built file against TripImportSchema — the same one /api/import uses
node .claude/skills/roteiro-trip-go/scripts/validar.mjs viagem.json

# put it in the app: a new trip, or added to one that already exists
node --env-file=.env.local .claude/skills/roteiro-trip-go/scripts/subir.mjs \
  viagem.json --nova --conta voce@exemplo.com
node --env-file=.env.local .claude/skills/roteiro-trip-go/scripts/subir.mjs \
  viagem.json --viagem <tripId> --conta voce@exemplo.com --conferir

# undo the whole batch
node --env-file=.env.local .claude/skills/roteiro-trip-go/scripts/desfazer.mjs \
  <lote> --conta voce@exemplo.com
```

### The skill has no power of its own

`subir.mjs` never inserts into an app table. Every row goes through
`exigirViagem` → `autorizar` → `aplicar` from `lib/`, with the `Acesso` of the
account named in `--conta`. **The skill cannot do anything that person could not
already do from the screen**: a `visualizador` gets the same 403, an account that
is not on the trip gets the same 404, and a personal document still needs an
owner. `--nova` goes through `importarViagem` — the same function `/api/import`
calls, not a copy of it.

That is the whole security argument, and it is verifiable by reading imports
rather than trusting a description. `lib/skill.test.ts` fails the build if
`subir.mjs` stops calling `autorizar`/`aplicar`, or starts writing rows itself.

### On data it decides; on code it stops and specifies

Reading the files, choosing what goes in, building the itinerary and writing into
a live trip are all things the skill does without asking. What it never does is
change code — and a request that would need a new field, table or screen becomes
`.specs/propostas/<slug>.md` instead: the request in the person's own words, why
it is not possible today, what is possible with data alone, the minimal change in
the order of the ten-file checklist, and the security question (who may **read**
the new field). Writing the value into a free-text `nota` to make it work is
banned by the same rule — that is the data no screen reads, no filter finds and
no export carries.

The skill runs inside the repository with a `DATABASE_URL` and write permission —
so "it only updates data" has to be enforced, not promised. `lib/skill.test.ts`
fails if either database script gains a file write (`writeFileSync`, `mkdirSync`,
`createWriteStream`, …) or spawns a process (`exec`, `spawn`) — the second closes
the service door the first would otherwise leave open. It runs in `npm test` with
everything else.

### Two properties that make it safe on a live trip

**It does not duplicate.** Each section has a natural key — itinerary: time +
title; flight: airline + number + departure; expense: description + amount — and
anything already there is skipped, with the reason printed. Running the same file
twice does not double the itinerary. `--forcar` inserts anyway.

**It is reversible.** Each load gets a `lote` and writes `origem = 'skill'` into
`change_log`; `desfazer.mjs` replays it backwards, calling `autorizar` per row
(the `lote` is visible to every participant in the snapshot, so reverting without
that check would be privilege escalation) and filtering the column name through
`colunaValida` before it reaches a `set <campo> = $1`. Removals are listed and not
reverted: `change_log` records that a row existed, never its contents.

### What deliberately does not go up that way

| Not written | Why |
| ------------ | ----- |
| `participantes` | a participant's name is the key to money and to personal documents. `--com-participantes` only, after confirming spelling |
| irregular installment amounts, already-paid installments | the server computes installments from total + count (`gerarParcelas`), same as the screen. Mark payment in Financeiro |
| `pagamentos` | they point at an installment that only gets an id once written |
| document bytes | the vault takes the file through the screen or `POST /api/documento`; the JSON carries the record |

## Commands

| Command                                       | What it does                                   |
| --------------------------------------------- | ---------------------------------------------- |
| `npm run dev`                                 | Development server                             |
| `npm run build`                               | Production build, includes typecheck           |
| `npm run lint`                                | ESLint                                         |
| `npm run test`                                | **476 unit tests**, `node --test`, no framework |
| `npm run test:api`                            | Integration suite — see [Testing](#testing)    |
| `npm run db:push`                             | Applies `db/schema.sql` to `DATABASE_URL`      |
| `node --env-file=.env.local scripts/seed.mjs` | Demo account + sample trip                     |

---

## Testing

### Unit — 476 passing

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
lib/hoje.test.ts       47 tests  the Hoje screen's engine: which event is "now" and when a
                                 missing `fim_em` stops counting, the departure time and its
                                 per-type margin, tonight's lodging across check-out day,
                                 the checklist slice that is due today, the address the
                                 driver reads, and the destination clock in another zone
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
lib/skill.test.ts       6 tests  the roteiro-trip-go boundary, by reading its code:
                                 the database scripts write no file and spawn no
                                 process, every row goes through autorizar/aplicar,
                                 the undo filters the column name, and every
                                 `on conflict` matches a real unique in schema.sql
lib/arquitetura.test.ts         properties that hold by READING the code: no `select *`
                                 in the two snapshot queries, every `limitar()` awaited,
                                 no raw error object in a log, the submission owner read
                                 from the row and not from the request body
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

| Step               | If you skip it                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 3 — `TABELA` entry | Every write returns _"Entidade desconhecida"_                                                                                |
| 3 — `via` field    | The record is reachable across trips by guessing ids — **security bug**                                                      |
| 5 — `LISTA` entry  | Edits only appear after the round trip; no optimistic update                                                                 |
| 9 — export/import  | Backups silently lose the entity — including `resumirImportacao`, or the import screen reports "0" for something it did load |
| 10 — duplicate     | Cloned trips come back missing it                                                                                            |

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

There is no migration tool, on purpose: the schema is idempotent, so "apply the whole file" _is_ the correct operation. The migrations section already carries real examples worth copying — `ativo` → `arquivada`, the `admin`/`viajante` → three-role remap, `stays` → `reservations` with a data copy before the drop, and dropping `pin_hash`.

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

### What this country demands

The day's header carries a quiet note — flag, `Requisitos <country>`, `3 de 4` —
between the city line and the timeline. It is **not a module**: it is
`document_requirements` filtered by the day's country through `requisitosDoPais()`,
scored by the same `montarMatriz()` the Documentos tab uses. Nothing is stored for
it and nothing is marked from it; tapping it lists who has complied, and resolving
happens where it always did.

Three rules keep it from becoming noise. A requirement with **no `pais` applies
everywhere** — a passport belongs to the trip, not to Spain — which is why the
column could be born null without changing the meaning of a single existing row. A
day with **no country shows nothing**, because the country is never guessed from
the city name (same rule `locaisDoDia()` already follows), and answering "here is
everything" there would fill the header with demands from places nobody will set
foot in. And a country with **no applicable requirement shows nothing at all** —
a block that says "nothing to declare here" spends the one header line a phone has
on teaching people to ignore it.

The note is the whole surface, on purpose: no tab, no route, no `AbaId`. Content
has no top-level routes here, and this is content.

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

| On screen                                                          | Source                                                                | Stored?                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| The strip of days                                                  | `trips.data_partida..data_retorno`                                    | derived                                                    |
| Title, city, summary, alerts, the two rituals, day links, map link | `itinerary_days`                                                      | one row **per annotated day**                              |
| Timeline items, "how to get here", tips, links, estimated cost     | `itinerary_events`                                                    | yes                                                        |
| The transport options under "Como chegar"                          | `itinerary_options`                                                   | yes, child of an item                                      |
| "Saia às", the leg between two events, conflicts, the day's audit  | `trechosDoDia()` over the day's items + the night's lodging           | derived — see [Three views](#three-views-of-one-day-and-the-departure-time) |
| Day chips (locais · km · deslocamentos · refeições · tempo)        | `resumoDoDia()` over the day's items                                  | derived, never hardcoded                                   |
| Flights, hotel check-in/out, embarkation, port calls               | `flights` · `reservations` · `cruises`                                | **not copied** — rendered from the other tabs              |
| Checklist of the day                                               | `checklist_items` whose deadline falls on the day                     | the existing checklist, same `checklist_state`             |
| Money of the day                                                   | `financeiro` — the slice the server already decided this role may see | see [The money is scoped](#the-money-is-scoped-not-hidden) |

Two of those rows carry the design:

**Nothing is copied between modules.** A flight appears on its day as a _derived_
entry, marked "do cadastro de voos" and not editable from here. Writing the flight
into `itinerary_events` as well would create two records of one fact that then age
apart — which is exactly how a travel app starts lying about a departure time.

**The day's checklist is the trip's checklist.** Items whose `prazo_ideal` or
`prazo_maximo` lands on the open day, ticked through the same `checklist_state` the
Checklist tab writes. A second per-day task system would mean the same task ticked
in one place and open in the other.

### Three views of one day, and the departure time

`[ Agenda ] [ Mapa ] [ Deslocamentos ]` are not three modules — they are one day
read three ways, from the same `trechosDoDia()` call. There is no `Navegação` tab
and there will not be one: navigation is what the itinerary is _for_, and content
has no top-level routes here.

**Nothing new is stored for any of it.** The leg between two events was already in
the schema: `distancia_m`, `duracao_min`, `transporte` and `como_chegar` live on the
**destination** item — "to get to the Prado, 850 m on foot" — and the alternatives
live in `itinerary_options`. `lib/trechos.ts` reads those rows and adds the two
things the database cannot hold, because both go stale the moment they are written:
**when to leave** and **whether the plan fits**.

`sairAs` is not recomputed here. It calls the same `horaDeSair()` / `margemDe()`
that the Hoje screen calls, for the reason `checklist_state` is shared: two
implementations would give two departure times for one appointment, and the person
standing on the street has no way to tell which is right.

| What it answers          | Rule                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"When do I leave?"**   | `ocorre_em − duracao_min − margin`, margin per type (`cruzeiro` 45, `voo` 30, `trem` 20, `onibus` 15, default 5). **Without `duracao_min` there is no time shown** — a guessed departure is worse than none, because people trust it.                                                                                                                                                                        |
| **"Do I have time?"**    | `folgaMin` is a **ceiling** on the free time: measured from the previous item's `fim_em`, or from its _start_ when that column is empty. Assuming an item ends when it begins can only over-state the gap, so a conflict is never invented — and the case where not even the whole interval covers the leg is still caught.                                                                                    |
| **"How bad is it?"**     | Two levels, and the colour is the information: **conflict** (red) is impossible — the leg is longer than the gap; **tight** (amber) fits but eats the safety margin. Never hidden, on any view; the count rides on the `Deslocamentos` tab so it is visible from Agenda.                                                                                                                                       |
| **"Where do I start?"**  | The first leg of the day departs from the **hotel** (`reservations` where `tipo = 'hospedagem'`), and the last one returns to it. The return leg has no destination row to carry its numbers, so it is born **unverified** and the audit asks for it rather than estimating it.                                                                                                                              |
| **"Is this checked?"**   | `auditarNavegacao()` reports only what the stored rows prove: conflicts, legs with no duration, stops with neither address nor coordinate. Not "the airport looks far" — without coordinates on both ends that is a guess, and a guessed alarm teaches people to ignore the real ones.                                                                                                                        |

**The app never computes a route.** It has no routing engine, no distance API and no
straight-line estimate standing in for a walk — a fabricated "32 min on foot" crosses
rivers and railways, and it would be trusted exactly where it is wrong. Legs are
_prepared_ (by the skill, or by hand in the editor) and _displayed_, which is also
what keeps them working in airplane mode. `Abrir no mapa` hands off to the device's
map app for turn-by-turn; everything the traveller needs to decide — origin,
destination, duration, departure time, margin — is on screen without it.

`Hoje` consumes the same function and opens the same panel; **"Como chegar" there is
not a second implementation**, it is `components/ComoChegar.tsx` in a modal instead
of the desktop's right-hand column.

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

| Limitation                                                             | What it means in practice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Upgrade path                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A renamed section imports empty, with no error**                     | Zod **strips unknown keys**. `db/europa-2027.json` sat at v1 for months using `viajantes` and `hospedagens`; it passed the validator and imported a trip with **0 participants and 0 lodgings**. The file is now v3 and lands complete — but the next rename fails exactly the same silent way.                                                                                                                                                                                                                                                                                                  | Make `TripImportSchema` `.strict()` so an unknown key is an error. Until then, `scripts/campos.mjs` in the skill prints the live section list, which is what catches it by hand.                                                                                                                                                   |
| **Integration suite targets the removed PIN API**                      | `npm run test:api` fails wholesale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Rewrite the 26 tests against accounts. The list of behaviours to preserve is in [Testing](#testing).                                                                                                                                                                                                                               |
| **Rate limit is per instance**                                         | The counter lives in process memory. On serverless each instance keeps its own, so a distributed attacker gets more than the limit per window. Covers both sign-in (10 wrong attempts / 5 min) and sign-up (5 attempts / hour, counting the successful ones — see [Installing and rate limits](#installing-and-rate-limits)). Marked with a `ponytail:` comment at the source.                                                                                                                                                                                                                  | Move the counter into a Neon table. It is a local change in `lib/session.ts`.                                                                                                                                                                                                                                                      |
| **Last-write-wins**                                                    | Two people editing the **same record** inside one sync window: the older write is dropped and reported. Nothing vanishes untraceably — `change_log` keeps both.                                                                                                                                                                                                                                                                                                                                                                                                                                 | Per-field merge, or CRDTs if it ever justifies the cost.                                                                                                                                                                                                                                                                           |
| **Routes referenced but not built**                                    | `/esqueci-senha` is listed as public, `/configuracoes`, `/privacidade` and `/termos` are linked from `config/site.ts` and from participant notifications. All 404.                                                                                                                                                                                                                                                                                                                                                                                                                              | Build the pages, or remove the links. Password reset needs an email provider.                                                                                                                                                                                                                                                      |
| **Vault files cap at 25 MB**                                           | Not an edge limit any more — the upload is chunked. Vercel rejects any request body _or response body_ over 4.5 MB (`FUNCTION_PAYLOAD_TOO_LARGE`), so `lib/arquivo.ts` slices the file into 4 MiB parts and posts them in series, and `GET /api/documento` answers with a `ReadableStream` fed by `substring(bytes …)` — streamed responses have no size cap. 25 MB is the vault's own judgement: a document marked `offline` is pulled down in full to every phone's IndexedDB. Photos over one part are still shrunk to 2000px JPEG, because 8 MB of passport photo reads the same as 500 KB. | Direct-to-bucket upload with a signed URL, when files outgrow what belongs in Postgres and in an offline cache.                                                                                                                                                                                                                    |
| **Vault files live in Postgres `bytea`**                               | `document_files` keeps the bytes in the same database as everything else, which buys backup, transactions and authorization for free, and costs database size and egress as the vault grows.                                                                                                                                                                                                                                                                                                                                                                                                    | `lib/cofreOffline.ts` `baixar()` plus the two handlers in `/api/documento` are the whole seam — the screens never touch storage. Neon Object Storage, S3 or Vercel Blob replaces it without touching the UI.                                                                                                                       |
| **Offline vault is available, not encrypted**                          | Files marked "disponível offline" sit unencrypted in IndexedDB. Anyone holding the unlocked device can open them. The screen says exactly this, and the feature is deliberately never described as a bank-grade vault — it keeps documents _available_, not _secret_.                                                                                                                                                                                                                                                                                                                           | Encrypt blobs at rest with a key derived from the session; the store already goes through `lib/offline.ts`, so it is one layer, not a rewrite.                                                                                                                                                                                     |
| **Avatars are still URLs**                                             | `users.avatar_url` takes a link; nothing uploads an image. Document files no longer share this limitation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Point avatars at `/api/documento`'s upload path, or a bucket.                                                                                                                                                                                                                                                                      |
| **Vault links do not survive export/import**                           | `documents.itinerary_event_id` and `flight_id` are dropped on import — the itinerary is inserted _after_ documents (it points back at them), so the ids do not exist yet. `reserva`, `dono_nome` and `assigned_to_nomes` **do** round-trip, by name. The same compromise the checklist already makes.                                                                                                                                                                                                                                                                                           | A second pass that resolves event and flight links by name after the itinerary is inserted.                                                                                                                                                                                                                                        |
| **Routes are prepared, never live**                                    | The app computes no route. A leg only shows a duration, a distance or a "Saia às" if somebody stored `duracao_min`/`distancia_m` on the destination item — the skill, or the editor. Legs with nothing stored say "rota não conferida" and the day's audit lists them; the return to the hotel is always one of them, since no row carries it. Nothing is estimated from straight-line distance, and no leg is ever presented as live traffic. | A routing API called **server-side** (the key may not reach the browser, and the CSP `connect-src` in `lib/seguranca.ts` would need that host by name), writing the result plus a `checked_at` into the same columns. The screens would not change — they already read from those rows. |
| **Map has no coastline**                                               | The home map projects the route and pins onto an abstract gradient.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | A simplified GeoJSON, ~20–50 KB, from a reliable source.                                                                                                                                                                                                                                                                           |
| **Export omits credentials**                                           | A restored backup has no passwords. Intentional — the file circulates by email.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | None wanted.                                                                                                                                                                                                                                                                                                                       |
| **Old expenses import without a split**                                | A v2 backup records how _many_ people shared a cost, never _who_. The importer converts the amount to a total and leaves the split empty rather than inventing participants; the screen marks those expenses "a dividir".                                                                                                                                                                                                                                                                                                                                                                       | Open each one and choose who divides it.                                                                                                                                                                                                                                                                                           |
| **A reimbursement tied to an installment is re-linked by description** | Installment ids are recreated on import, so `payments.parcela_id` is restored by matching _expense description + installment number_. Two expenses with the same description put the payment on the first. Balances stay exact either way — only the "paid on this installment" label can move.                                                                                                                                                                                                                                                                                                 | Export the expense's `ordem` alongside it.                                                                                                                                                                                                                                                                                         |
| **Only `itinerary_days.dia` is read as text**                          | The Neon driver materialises a `date` column as a `Date` in server-local time, and JSON serialisation converts it to UTC — east of Greenwich that lands on the previous day. The itinerary's day key is converted with `to_char` in the query because the whole screen indexes on it. The other `date` columns (`prazo_ideal`, `ocorre_em` on an expense, `vence_em`) still travel as `Date`, which is correct for a UTC server and for any timezone west of Greenwich — both environments this runs in.                                                                                        | Same `to_char` on those queries. `expenses.ocorre_em` and `installments.vence_em` feed the money engine, so that one wants its tests re-run, not a blind edit.                                                                                                                                                                     |
| **The day list is derived, not stored**                                | `itinerary_days` holds only the days somebody wrote _about_. The list of days on screen comes from `data_partida..data_retorno`, so shortening a trip hides nothing — a day with notes outside the new range still renders, without a day number.                                                                                                                                                                                                                                                                                                                                               | None wanted. Storing every day would mean a write per trip creation and a reconciliation on every date change.                                                                                                                                                                                                                     |
| **"Antes de sair" / "antes de dormir" tick locally**                   | The two day rituals live in `localStorage`, per device. The _lists_ are stored on the day; only the checkmarks are local, so they do not sync between the five travellers and vanish with cleared site data. Marked with a `ponytail:` comment at the source.                                                                                                                                                                                                                                                                                                                                   | Move the marks into `checklist_state`, which already carries per-person state. The lists themselves would not move.                                                                                                                                                                                                                |
| **Reordering a day means changing times**                              | Every itinerary item has a mandatory `ocorre_em`, so the up/down buttons swap the _time_ of two neighbours rather than a parallel `ordem`. `ordem` only breaks a tie between two items marked at the same minute.                                                                                                                                                                                                                                                                                                                                                                               | None wanted — a timeline whose order disagrees with the clock it prints is worse.                                                                                                                                                                                                                                                  |
| **Trip duplication drops item → reservation links**                    | `reserva_id` and `documento_id` are set to NULL on clone: the copy's reservations are new rows, and keeping the old id would point an item at another trip.                                                                                                                                                                                                                                                                                                                                                                                                                                     | Copy reservations and documents with derived ids too, the way flights already are.                                                                                                                                                                                                                                                 |
| **Debt simplification is greedy**                                      | Largest debtor against largest creditor. At most n−1 transfers, which settles any group; not the proven minimum (that is NP-hard).                                                                                                                                                                                                                                                                                                                                                                                                                                                              | A partition solver, if a trip ever has enough participants for it to matter.                                                                                                                                                                                                                                                       |
| **The guide does not stream**                                          | Responses arrive whole, behind a "pensando…" state. Long answers feel slow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | SSE. The seam is one route and one component.                                                                                                                                                                                                                                                                                      |
| **Creating a trip from nothing still uses the normal screen**          | The guide fills an existing trip's itinerary in bulk; it does not create the `trips` row itself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A write path for trip creation, or reuse `/api/viagens` before the first proposal.                                                                                                                                                                                                                                                 |
| **`db:push` is not part of the build**                                 | Deploying does not migrate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Intentional. Automate only with a real migration tool.                                                                                                                                                                                                                                                                             |
| **Encryption stops at the account profile**                            | CPF, RG and passport number are encrypted in `users`. The same passport number typed into a _trip requirement_ lands plaintext in `document_submissions.numero`, and `change_log` records the **previous value** of every edit in plaintext too — so a dump still yields numbers, from a different table.                                                                                                                                                                                                                                                                                       | Encrypt `document_submissions.numero` in `aplicar()` and decrypt in `documentacaoDaViagem`, and stop logging the old value of an encrypted column (log that it changed, not to what). The change-log half is the larger piece: any undo replay writes `change_log.de` back into the column directly. |
| **The rate-limit counter is still in memory**                          | Item 11 above. The new write and upload limits share `lib/session.ts`'s in-process map, so they inherit the same per-instance ceiling.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | One Neon table, as already documented for sign-in.                                                                                                                                                                                                                                                                                 |
| **The honeypot only catches generic bots**                             | A script written against _this_ form just omits the field.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Nothing wanted alone — the same-origin check and the per-account limits are what bound a targeted script, and a CAPTCHA would tax five travellers to inconvenience one attacker.                                                                                                                                                   |
| **Social sign-in is inert**                                            | Google and Apple buttons render disabled with a reason, driven by `siteConfig.social`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Flip `ativo` once a provider is wired.                                                                                                                                                                                                                                                                                             |
| **The map draws straight lines, never real routes** | A leg between two cities is a straight segment, and an urban hop is not drawn at all. The map answers *where* and *in what order*, never *by which street*. A leg that no flight, train or transfer records is drawn faded and labelled **"Rota não verificada"** — the order is real, the path is not. | A routing service (OSRM, Valhalla) would give real geometry, and would be the itinerary's first network dependency. `lib/mapaViagem.ts` already separates a verified leg from a merely consecutive one, so only the drawing changes. |
| **A place with no coordinate falls back to the city centre** | Hotels, ports and stops without `lat`/`lon` are pinned at the centre of their city and marked **"Localização aproximada"** with a dashed ring — the pin is off by up to a few kilometres, and says so. A place with neither coordinate nor a known city does not appear at all; the map's audit counts it under **"fora do mapa"**. | Geocode on save — `lib/localizar.ts` already talks to Nominatim from the Localizar paradas screen — so a saved address becomes a coordinate right away. |
| **The macro leg guesses its transport mode from the item title** | `trajetoEntre` in `lib/mapaViagem.ts` confirms a Madri → Hamburgo train by looking for the origin city inside the item's title. It only ever CONFIRMS a leg the city order already established, so a miss downgrades that leg to "not verified" — it can never invent one. | An explicit `origem_cidade`/`destino_cidade` on the itinerary item, the way `flights` already has. That is a schema change, so it belongs in a proposal, not a patch. |
| **Map tiles need the network** | Offline, the pins, routes, addresses and "saia às" all still work from the snapshot cache — only the map imagery is blank, and the screen says so instead of pretending. | Caching tiles in the IndexedDB `arquivos` store, under the same never-wipe-on-upgrade rule the vault has. Worth it only if someone actually needs imagery on board. |

---

## Security

Twenty measures, in the order someone would ask about them. Each one says **where it lives** and **what it is not**, because a control whose limits are not written down is a control someone will over-trust.

### The perimeter

| #   | Measure                                    | Where                                    | The honest limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Keys never reach the browser**           | `lib/db.ts`, `lib/cripto.ts`             | `DATABASE_URL`, `SESSION_SECRET` and `DADOS_SECRET` are read only in server modules. `lib/arquitetura.test.ts` fails the build if any of them is ever prefixed `NEXT_PUBLIC_`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2   | **No secret in git history**               | `.gitignore`                             | `.env*` is ignored, `.env.example` carries names only. The history was scanned: no key, no connection string. **The one open action is below** — the development Neon password travelled through a chat conversation and must be rotated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3   | **The database is never public**           | `lib/db.ts`                              | The browser knows `/api/*` and nothing else. There is no anonymous key, no client-side SDK, no row reachable without a route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | **Least privilege in Postgres**            | `db/privilegios.sql`                     | Optional role `tripgo_app`: select/insert/update/delete, and no DDL. A bug cannot `drop table`. **RLS is deliberately not enabled** — see [What is not here](#what-is-not-here).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5   | **Encryption at rest for identity fields** | `lib/cripto.ts`                          | CPF, RG and passport number are AES-256-GCM in `users`, keyed by `DADOS_SECRET`. Protects a dump, a backup, a replica, an admin's screen — **not** someone running code on the server, who has the key. Blank key is a supported mode: everything works and the three fields stay plaintext.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 6   | **Authentication is server-side**          | `lib/auth.ts`                            | `exigirUsuario`/`exigirViagem` sit on the data, not on the route. `proxy.ts` is an _optimistic_ cookie check for redirects and never queries the database.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 7   | **Access is scoped, twice**                | `config/navigation.ts`, `lib/escrita.ts` | `posso()` on screen, `papelAlcanca` on the server, in every route. A trip you do not belong to answers **404, not 403** — a 403 would confirm the trip exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 8   | **Mass assignment is blocked**             | `lib/schema.ts`                          | Zod strips unknown keys, so an extra `papel` or `admin` in a request body never reaches a column. The dynamic `INSERT`/`UPDATE` builders interpolate **only column names derived from the schema** — `colunaValida` is the whitelist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 9   | **Cookies are hardened**                   | `lib/session.ts`                         | `httpOnly` + `SameSite=Lax` + `Secure` in production + `path=/`. The token carries the account id and an expiry, signed with HMAC-SHA256 and compared in constant time. Role is **not** in the cookie: a demotion would otherwise stay valid for 90 days.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 10  | **Passwords are hashed**                   | `lib/session.ts`                         | scrypt, N=16384, 16-byte salt per password, 64-byte key, `timingSafeEqual`. Sign-in returns the same message for unknown e-mail and wrong password, so the form is not an account-enumeration oracle. **Sign-up answers the same way for an e-mail that is already taken** — it used to reply `409 'Já existe uma conta com esse e-mail.'`, which handed back the enumerator that sign-in spends a comment avoiding. That matters more here than on the sign-in form: `vincularParticipantesPorEmail` makes a participant's e-mail a credential (row 21), so an enumerator learns exactly which trip e-mails are still unclaimed. The price is that someone who forgot they already have an account gets a generic message — the same price sign-in pays. |

### The traffic

| #   | Measure                                 | Where                                  | The honest limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11  | **Rate limits, four different reasons** | `lib/session.ts`                       | Sign-in counts _wrong_ attempts and success clears (blocking guessing). Sign-up counts **every** attempt and never clears (the abuse is the account created). Writes and uploads cap volume, per account. Password change reuses the sign-in limit so a stolen cookie is not a password oracle. **In-process counter** — on serverless each instance keeps its own, so a distributed attacker gets more than the limit per window. `ponytail:` at the source.. **Every call site is `await`ed**, and a test asserts it: `limitar` is async and signals by throwing, so an un-awaited call lets the 429 become a loose rejection that `rota()`'s try/catch never sees — the handler runs on and the request lands. `/api/documento` shipped that way and its upload bucket did nothing |
| 12  | **Bot protection**                      | `lib/seguranca.ts`, `/api/usuarios`    | Two layers: a hidden honeypot field on sign-up, and the same-origin check below, which refuses every state-changing request without browser headers — that is curl, script and bot. Neither stops someone who scripted _this_ app specifically; the rate limits are what bound that.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 13  | **Queries are parameterised**           | everywhere                             | The Neon tagged template binds every value. The only interpolated strings are table and column names from a static map and from the zod schema.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 14  | **Inputs are validated**                | `lib/schema.ts`                        | One zod contract for the import file, the mutation queue and the account forms — the server validates against the same schemas the editor sheet is generated from. Every route caps its body size.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 15  | **Content is scoped at the endpoint**   | `lib/db.ts`                            | `financeiro` is **two different responses**, not one payload with a filter: a `visualizador` gets their own obligations, and the trip's totals never leave the server. Personal documents are cut in the read query, in `autorizar` and in `/api/documento` — three places that must agree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 16  | **Uploads are restricted**              | `lib/arquivo.ts`, `/api/documento`     | Size cap, format list, **and the file's real signature** — the declared mime is what the client claimed, so the magic bytes are checked on the first chunk. HTML renamed to `.pdf` is refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 17  | **API responses are trimmed**           | `lib/db.ts`, `/api/export`             | `senha_hash` never leaves its two internal functions. Document bytes never enter the snapshot or the export — they live in `document_files` and move only through `/api/documento`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 18  | **Security headers**                    | `next.config.ts`, `proxy.ts`           | `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP, `X-Robots-Tag`, no `X-Powered-By` — in `next.config.ts`, so **API routes get them too**. CSP with a per-request nonce is in `proxy.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 19  | **HTTPS is forced**                     | `proxy.ts`, `next.config.ts`           | 308 (method-preserving) when the edge reports `http`, plus HSTS for a year with `includeSubDomains` and `preload`. Neither fires in development, and neither fires for `localhost` — checking a production build on your own machine used to 308 into a certificate error.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 20  | **Dependencies are scanned**            | `.github/workflows/ci.yml`             | `npm audit --omit=dev --audit-level=high` on every push and PR, plus weekly on a schedule — the code does not change but the advisory feed does. Dev-tool findings are logged, not blocking.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### The content security policy

It carries a nonce, generated per request in `proxy.ts`. The line that matters is `script-src 'self' 'nonce-…' 'strict-dynamic'`: the browser trusts only what the nonced script loads, so an injected `<script>` has no way in — the nonce changes every response.

Three deliberate loosenings, each with a reason:

- **`style-src` keeps `'unsafe-inline'`.** The app has ~170 `style={{…}}` attributes (map tile positions, derived trip colours), and a nonce does not apply to a style _attribute_ — only to a `<style>` element. Removing it without rewriting those 170 positions as classes would not make the page safer; it would make the map tileless.
- **`img-src` allows `https:` wholesale.** `users.avatar_url` and `trips.capa_url` accept any link, and the map loads tiles from OpenStreetMap. An image does not execute; what `img-src` narrows here is referer leakage, not XSS.
- **`object-src` allows `blob:`.** The vault previews a PDF in `<object data={blob:…}>`, and those bytes already came through our own authorized route.

`connect-src` is `'self'` plus `api.open-meteo.com` and `nominatim.openstreetmap.org` — the only third parties the _browser_ talks to. **No model service is on that list, and the app speaks to none**; `lib/seguranca.test.ts` asserts it. What builds a trip here is SQL, and SQL runs in the database, never in a browser.

One consequence worth knowing: nonces require dynamic rendering, so `app/layout.tsx` sets `dynamic = 'force-dynamic'`. A prerendered page has no request and therefore no nonce, and `'strict-dynamic'` makes the browser ignore `'self'` — `/login` and `/register` would open blank. Little is lost: every screen here depends on the session cookie anyway.

### Same-origin, and why `SameSite` was not enough

`rota()` in `lib/api.ts` refuses any POST/PUT/PATCH/DELETE that did not come from one of our own pages, reading `Sec-Fetch-Site` first (the browser writes it; no page script can forge it) and falling back to `Origin` versus `Host`.

The cookie is already `SameSite=Lax`, which blocks the cross-site POST — but the _browser_ is what enforces Lax, and the server has no way to know that it did. This is the same rule checked again on the side we control, exactly as `papelAlcanca` is re-checked on the server despite `posso()` on screen.

It lives in the route shell, not in each handler, so a new route is born protected. A list of routes-to-protect is a list somebody forgets to update.

### What is not here

**Row Level Security.** It is the standard recommendation and it is deliberately absent, because in this architecture it could not enforce anything:

1. There is one connection, from the server process, shared by all five travellers. The connected role does not say who is asking.
2. `lib/db.ts` uses Neon's HTTP driver, where **each query is an independent HTTP request**. `set local app.usuario_id` does not survive to the next query, so there is nowhere to write "who I am" before the `SELECT`.

A policy reading a variable that is never set either denies everything and stops the app, or is permissive and exists only so a report can say "RLS: enabled". The real cut lives in `exigirViagem`, in `financeiroDaViagem`/`documentosDaViagem` and in the `via` scoping of `lib/escrita.ts` — it is tested, and it is what a policy would have done. The upgrade path is written at the bottom of `db/privilegios.sql`: swap the HTTP driver for the WebSocket `Pool`, open a transaction per request, `set local` at its start.

### Still open

- [ ] **Rotate the Neon password.** The development connection string passed through a chat conversation and is in that history. Neon console → project → **Roles** → `neondb_owner` → **Reset password**, then update `.env.local` and the Vercel environment variable. Until that is done, assume anyone with access to that history has full database access.
- [ ] **Generate a unique `SESSION_SECRET` per environment.** It signs every session token; sharing one across environments means a token minted in staging is valid in production.
- [x] **`siteConfig.demo.mostrar` is already `false`** — verified in `config/site.ts`. It publishes working credentials on the login screen when true, so keep it false now that the trip holds real data.
- [ ] **Set `DADOS_SECRET`** and back it up somewhere durable. Losing it makes the encrypted fields unreadable — rotating it is not like rotating the session secret.
- [ ] **Set `siteConfig.demo.mostrar = false`** before real users arrive — it publishes working credentials on the login screen.
- [ ] **Point `TEST_DATABASE_URL` at a throwaway database.** The runner refuses to start otherwise, but verify it anyway.
- [ ] **Run `db/privilegios.sql`** and point `DATABASE_URL` at `tripgo_app`. Until then the app connects as the schema owner.

### The 20-item audit

A full pass over the app against the usual pre-launch list. Each row says where the rule lives, so the next person checks the file instead of re-deriving the answer.

| #   | Item                   | State                | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Hide API keys          | ✅                   | `DATABASE_URL`, `SESSION_SECRET` and `DADOS_SECRET` are read only in server modules. `lib/arquitetura.test.ts` fails the build if any of them becomes a `NEXT_PUBLIC_*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2   | Clean secrets from git | ✅                   | `.gitignore` blocks `.env*`; only `.env.example` is tracked, and it holds names, never values. History scanned for connection strings and `sk-ant-` — clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3   | Public key on the DB   | n/a                  | There is no browser-side database client and no anon key. The browser knows `/api/*` and nothing else; the connection string stops at `lib/db.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4   | Enable RLS             | n/a, by architecture | Postgres row-level security protects a database the client talks to directly. Here every read and write goes through `exigirViagem` plus the `via` cut in `TABELA` (`lib/escrita.ts`), which scopes a row by the session's trip instead of by id alone. That is the same guarantee, enforced one layer up — see [Authorization](#authorization)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5   | Encrypt data           | ⚠️ accepted          | Neon encrypts at rest and every connection is TLS. Passport, CPF and phone are stored in clear inside that. Column-level encryption would need a key that the server holds anyway, so it would stop a leaked backup and nothing else; the leak that matters here — one participant reading another's documents — is closed by the role cut instead. Revisit if the trip data ever leaves Neon                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 6   | Auth on the server     | ✅                   | `proxy.ts` is an optimistic cookie check that never touches the database; `exigirUsuario`/`exigirViagem` in `lib/auth.ts` are the real barrier, glued to the data source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 7   | Restrict access        | ✅                   | `posso()` on the client, `papelAlcanca` on the server, in every route. A trip the account does not belong to answers 404, not 403 — 403 would confirm the trip exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 8   | Block mass assignment  | ✅                   | zod strips unknown keys before anything reaches SQL, so `Object.keys` on the parsed object can only ever produce schema columns. `revisado_por`/`revisado_em` are deleted from the payload and stamped by the server — an approval can never be signed by the client                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 9   | Protect cookies        | ✅                   | `httpOnly`, `SameSite=Lax`, `Secure` in production, 90-day expiry, and the token carries only the account id — never the role, which would leave a demotion valid for 90 days. CSRF has a second lock: `rota()` in `lib/api.ts` rejects any non-GET whose `Origin` does not match the host                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 10  | Hash passwords         | ✅                   | scrypt N=16384, 16-byte salt per password, 64-byte key, `timingSafeEqual`. No password library — `node:crypto` does this better than a dependency would                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 11  | Rate limit             | ✅                   | Five buckets with deliberately different rules: sign-in counts only _wrong_ attempts and a success clears the window; sign-up counts **every** attempt and never clears; the assistant, uploads and imports are keyed by account, not IP. The counter now lives in Postgres (`registrar_tentativa`, under `for update`), not in process memory — on Vercel each serverless instance had its own, so ten instances meant ten times the limit. A network failure falls back to the in-memory bucket rather than either locking everyone out or removing the limit. **Every call site is `await`ed**, and a test asserts it: `limitar` is async and signals by throwing, so an un-awaited call lets the 429 become a loose rejection that `rota()`'s try/catch never sees — the handler runs on and the request lands. `/api/documento` shipped that way and its upload bucket did nothing                                                                                                                                                                                                                                                                |
| 12  | Bot protection         | ✅ opt-in            | Cloudflare Turnstile on sign-in and sign-up, verified server-side before scrypt runs. No new dependency — a `<script>` tag and a `fetch`. **Off until `TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are set**, because a misconfigured captcha refusing everyone at an airport is worse than no captcha. It closes what row 11 cannot: a thousand IPs trying five passwords each never approach a per-origin limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 13  | Parameterised queries  | ✅                   | Every value is a placeholder. The four places that interpolate an _identifier_ build it from a closed set: `TABELA` (a literal map), `Object.keys` of a zod-parsed object, `recorte()` (a literal `switch`), and `colunaValida()` in the undo path, which checks the column against the same schema that validates writes. `lib/escrita.test.ts` feeds it injection strings and asserts each is rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 14  | Validate inputs        | ✅                   | Every route body goes through a zod schema before anything else, with a byte cap chosen per route. The one place a stored value later becomes executable — a `href` — goes through `hrefSeguro` (`lib/seguranca.ts`), which drops `javascript:`, `data:` and anything else outside `http(s)`/`mailto:`/`tel:`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 15  | Leak content           | ✅                   | Cuts made in the SQL rather than in React: `financeiroDaViagem` returns two different shapes, `documentosDaViagem` never selects another participant's personal document, and `getSnapshot` withholds the trip budget below `editor` and other travellers' passport and phone below **`proprietario`**. Note the two different thresholds — money cuts at editor, documents cut at owner. See "What this audit fixed" below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 16  | Restrict uploads       | ✅                   | Extension is irrelevant, MIME allowlist is checked, size is capped at 25 MB, each part at 4 MiB, and the offset check makes an out-of-order or duplicated part fail loudly. On top of that `assinaturaConfere` reads the file's magic bytes: a `.html` announced as `application/pdf` is rejected at the door                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 17  | Trim API responses     | ✅                   | `usuarioPorId` lists its columns so the hash cannot escape; `hashDoUsuario` exists only so the hash leaves the database on the one path that needs it. The trip and traveller queries in `getSnapshot` now list columns too, for the same reason `select *` was wrong there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 18  | Security headers       | ✅                   | `next.config.ts` applies the list from `lib/seguranca.ts` to every route: HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and a CSP. `/api/documento` adds its own on the file response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 19  | Force HTTPS            | ✅                   | Vercel terminates TLS and redirects http at the edge, but that redirect happens _after_ the first request has already gone out in the clear — and the session cookie rides on every request. HSTS (2 years, `includeSubDomains`) is what makes the browser stop trying. `preload` is deliberately left off: it is a domain-level decision with a slow exit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 20  | Dependency scan        | ✅                   | 5 runtime dependencies on purpose, `npm audit` clean. The discipline that keeps this row green is the "add no dependency for what a few lines do" rule, not the audit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 21  | Invite path            | ✅                   | A participant's e-mail address used to be the credential for their seat: an owner adds someone as a `travelers` row with a name and an e-mail, and whoever registered at `/register` with that address was linked by `vincularParticipantesPorEmail` at the `papel` the row carried — no token, no confirmation, and reachable with no session at all, since registration is open. **`trips.codigo_convite` is now that proof**: a 10-hex code from `gen_random_uuid()`, shared out of band, required by the linking query. It is cut to `proprietario` in `getSnapshot` (an editor who saw it could invite strangers into a trip he does not own) and shown in the Dados tab, which is already owner-only. A wrong code is not an error — the account is created and joins nothing, because saying "invalid code" would make sign-up a code oracle, the same hole the 409 in row 10 was. Someone already registered, or invited to a second trip later, is linked the other way: the owner saves the participant with their e-mail (`lib/escrita.ts`), where the person doing the linking is authenticated and authorised and therefore needs no code |
| 22  | Copy scope             | ✅                   | **You may only copy what you can already read.** `POST /api/viagens/duplicar` hands the caller a trip they OWN, and the copy carries `orcamento_centavos`, every `expenses` row and every `installments` row. It ran at the default minimum, so a `visualizador` — who cannot read the budget (cut at `editor` in `getSnapshot`) and receives only their own obligations from `financeiroDaViagem` — duplicated the trip, opened the copy as owner, and got `{admin: true}` with the whole ledger. The entire role cut of the money module fell through one endpoint, and the UI offered the button to everyone. It is `editor` now, which is exactly what `/api/export` already grants, so duplicating gains nothing a person could not already download. The one thing an editor cannot read is another traveller's `pessoal` checklist item, so the copy filters `escopo = 'global'` — the same filter the documents copy already had. Personal documents, their bytes, and `travelers` rows were never copied                                                                                                                                      |

### What this audit fixed

Six changes, in rough order of how much they mattered.

**The snapshot was publishing other people's passports.** `getSnapshot` selected `p.passaporte` and `p.telefone` for every traveller and sent the lot to everyone on the trip, `visualizador` included. Only the `proprietario` can _write_ those fields (`participante` has minimum `proprietario` in `TABELA`) — but everyone could read them. That is the exact inversion the vault rule exists to prevent: _planning the itinerary is not permission to open a passport_. The two columns are now cut in the query and released for one's own row.

The first attempt at that fix landed **one role too low**, and the review caught it. It reused `administra` — `papelAlcanca(papel, 'editor')` — because that is the threshold `financeiroDaViagem` uses. But money and documents are different rules: `documentosDaViagem`, `documentacaoDaViagem` and `/api/documento`'s `documentoVisivel` all cut at `proprietario`, precisely so a co-planner cannot read a passport. An `editor` is the _common_ case, not the exotic one — it is what the role is for — so the near-miss would have handed every co-organiser the whole group's passport numbers through a field no screen displays. `getSnapshot` now carries two named thresholds, `administra` and `veDadoPessoal`, and `db/teste-recorte.sql` block B2 asserts the editor case against a real Postgres.

**The snapshot was publishing the trip's budget.** `select * from trips` carried `orcamento_centavos` — the trip total — to every participant. The screen hid it (`if (!fin.admin) return null` in `Financeiro.tsx`), which is precisely the pattern the finance rule warns about: sending the admin shape and hiding fields in React publishes the number to anyone who opens the network tab. The query now lists its columns and nulls the budget below `editor`.

**An upload was trusted on its own word.** `arquivo.type` is whatever the client declares. An HTML file announced as `application/pdf` passed the MIME allowlist, was stored, and came back from `GET` as `application/pdf` served from the app's own origin to the other travellers. Now the first part's magic bytes must match the declared type, and the response carries `nosniff` — one closes the entrance, the other the exit, and a vault that serves other people's files needs both.

**A stored value could become a script.** `doc.valor` on a `link` document went straight into `href`. Written by one participant, clicked by another, `javascript:` there runs inside a page holding the whole snapshot. It now goes through `hrefSeguro`, the same guard `lerLinks` already used for the itinerary's links — one rule, in one place, for the two fields that turn stored text into a link.

**The app shipped no security headers at all.** `next.config.ts` was the empty scaffold. It now carries HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and a CSP whose most valuable line is `connect-src 'self'`: injected script cannot ship the trip snapshot — passports included — to an outside server.

**Two authenticated routes had no rate limit.** `/api/documento` and `/api/import` were reachable in a loop by any valid account: 25 MB per file, and a whole trip created per import call. Both now have buckets sized to their actual cost.

**The rate limit only counted on one machine.** The counter lived in a `Map` in process memory. On Vercel every serverless instance holds its own, so ten warm instances meant ten times the limit — and password guessing does not need more than that. It moved to Postgres, where `registrar_tentativa` reads, decides and writes under `for update` in one round trip. Doing it in three separate queries would have reopened the same race between instances that the table exists to close. `db/teste-limite.sql` proves the sliding window, the block ceiling, and that the buckets stay independent.

**Nothing stopped a distributed bot.** Turnstile now guards sign-in and sign-up, verified server-side before scrypt runs and before the attempt is counted — a refused captcha is not a created account, so it should not consume the quota of everyone on the hotel's wifi. It stays off until both keys are configured.

**A security header that depended on the build.** The first version of the Turnstile CSP was conditional: allow `challenges.cloudflare.com` only when the captcha is on. Testing it against the running build showed why that was a trap — Next serialises `headers()` into `routes-manifest.json` at **build** time, so the policy depended on the variable existing during the build, not during the request. Enable Turnstile in the Vercel dashboard, redeploy with build cache, and the server demands a token while the browser is blocked from loading the widget that produces one: nobody logs in, and the only clue is a CSP violation in a console nobody has open. It is unconditional now, and the rule that came out of it is written next to the constant: **a security header must never depend on a build-time environment variable — either it always applies, or it is a configuration that fails silently.**

**Not fixed, on purpose.** `script-src` keeps `'unsafe-inline'`, so the CSP is not a second line of defence against XSS — React's escaping and `hrefSeguro` are. Removing it means a per-request nonce generated in `proxy.ts`, which turns off static optimisation for every page; the trade is not worth it while there is no `dangerouslySetInnerHTML` anywhere in the tree. Bot protection (row 12) and column-level encryption (row 5) are the two items still genuinely open, and both are written down above rather than quietly dropped.

---

<div align="center">

**Built with intent.** Every dependency not installed here was a decision, and every one of those decisions is written down — in `.specs/`, in the comments, and above.

</div>
