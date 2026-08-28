@AGENTS.md

# TripGo

Multi-user, offline-first trip planner. Next 16 (App Router) + React 19 + Neon Postgres + Tailwind v4, deployed on Vercel. Node 22+ required (native TS type stripping, `--env-file`).

**`README.md` is the real documentation** — data model, request lifecycles, offline engine, authorization, known limitations. Read the relevant section before changing anything structural; don't re-derive it.

## Objetivo

One family trip planned by many people, usable abroad with no signal: itinerary, flights, cruise, lodging, cities, checklist, documents, emergency contacts and money. Concretely that means three non-negotiables — **opens in airplane mode and accepts edits**, **`financeiro` is scoped at the endpoint, not hidden in the UI** (a `visualizador` receives *their own obligations only*; the trip's totals never leave the server), and **everything is editable from the screen** so no one needs a terminal mid-trip. Real data in production: the Europa 2027 trip, 5 participants. Still missing: guide module, activities/tickets, PDF-import review screen, PWA polish — README → Known limitations.

## Layout

```
app/(auth)/          login · register — anonymous only, proxy bounces logged-in users
app/(dashboard)/     private: dashboard · viagens · perfil (+ dados de viagem: CPF,
                     passaporte, contato de emergência — da CONTA, não da viagem)
  viagens/[id]/      ← the trip app itself: Shell + TripProvider + 11 tabs
app/api/             10 route handlers, all Node runtime, all trip-scoped
components/          TripProvider (client state) · Shell (nav) · EditorSheet (schema-driven
                     editor for most entities) · FormDespesa (the money form — divisão
                     e parcelas) · CofreDocumento (vault: card, preview, modal, offline
                     hook) · ui.tsx (whole design system) · tabs/
lib/                 db (SQL, credential stops here) · auth (exigirUsuario/exigirViagem)
                     session · schema (zod contract) · importar · derive (pure calcs)
                     financeiro (money engine, heaviest tests) · offline (IndexedDB)
                     cofre (vault engine, pure) · cofreOffline (DocumentStorage seam)
                     documentacao (required-docs engine, pure) · api (error → HTTP pt-BR)
config/              site.ts (brand strings) · theme.ts (tokens) · navigation.ts (menu + papéis)
db/                  schema.sql (27 tables, idempotent) · europa-2027.json (v1, stale)
proxy.ts             Next 16 middleware — optimistic cookie check, never hits the DB
.specs/              spec, design, tasks, decision log
```

The shape to keep in mind: content has **no top-level routes**. Roteiro, voos, financeiro and the rest are tabs inside `/viagens/[id]`, not pages — `config/navigation.ts` only covers the three screens that live outside a trip. New trip content becomes a tab in `Shell.tsx`, never a new route.

## Regras

- **No brand string, brand color or institutional link outside `config/site.ts` and `config/theme.ts`.** Finding `"TripGo"` written into a component is a bug — the product must be rebrandable without touching components.
- **The database is the source of truth; JSON is an importer, not a config file.** Never reintroduce a versioned `TRIP_CONFIG`.
- **Add no dependency for what a few lines do.** 4 runtime deps on purpose: no PDF lib (`window.print()`), no auth lib, no ORM, no migration tool, no date lib (`Intl`).
- **Deliberate shortcuts get a `ponytail:` comment** naming the ceiling and the upgrade path (e.g. last-write-wins merge, in-process rate limit).
- **Contrast is measured, not guessed** — `#0D9488` and `#94A3B8` are banned for text (fail AA).
- **`.specs/STATE.md` is a decision log, not current state.** AD-002/AD-003 predate the multiuser migration (they describe PIN auth and "no seed script"). README wins on any conflict.

## Commands

```bash
npm run dev          # localhost:3000
npm run build        # includes typecheck
npm run lint
npm test             # 290 unit tests, node --test, no framework
npm run db:push      # applies db/schema.sql (idempotent) to DATABASE_URL
node --env-file=.env.local scripts/seed.mjs   # demo@tripgo.com / 123456
```

`npm run test:api` **fails wholesale** — the 26 integration tests target the removed PIN auth. Don't treat it as a regression you caused; see README → Testing.

## Conventions

- **Everything is pt-BR**: UI copy, comments, and identifiers (`viagem`, `roteiro`, `participante`, `papel`, `posso()`). Match it — don't introduce English names.
- **Imports carry the `.ts` extension**: `import { COOKIE } from '@/lib/session.ts'`. Omitting it fails to resolve.
- Prettier: no semicolons, single quotes, 100 cols.
- Routing middleware is **`proxy.ts`** (Next 16 renamed it from `middleware.ts`).

## Gotchas

- **`via` in `TABELA` (`app/api/mutate/route.ts`) is a security boundary**, not bookkeeping — it scopes a write by the session's trip instead of by id alone. A missing/wrong `via` makes records reachable across trips by guessing ids.
- **`/api/mutate` must return the same envelope as `/api/snapshot`**, including `eu` (`papel`/`participanteId`). They drifted once and every write crashed the next render.
- **Roles are checked twice**: `posso()` client-side, `papelAlcanca` server-side in every route. Never trust the client's papel alone.
- **`financeiro` is two different responses, not one payload with a filter.** `financeiroDaViagem` in `lib/db.ts` returns `{admin: true, …}` (all rows) for editor/proprietário and `{admin: false, obrigacoes, …}` for visualizador — where the SQL itself excludes expenses the person isn't in, and only *their* slice of each installment is serialized. Sending the admin shape and hiding fields in React would publish the trip's totals to every traveller.
- **A despesa is written transactionally, never field by field.** `gravarDespesa` in `/api/mutate` writes `expenses` + `expense_shares` + `installments` in one `sql.transaction`, and `POR_ENTIDADE.custo` is deliberately **not** `.partial()` — editing resends the whole record. Half a despesa is a wrong number on someone else's screen.
- **The client never computes money that gets stored.** The form sends intent (total, weights, how many installments); `resolverDivisao` / `gerarParcelas` run on the server. The same pure functions run in `TripProvider` for the optimistic paint, so offline shows exactly what will be saved.
- **`documents` is two things in one table, on purpose.** A row is either a short value (localizador, telefone, link) or a file (`tipo: 'arquivo'`), and the cofre shows both. Forcing an upload to store a policy number would be worse; `temArquivo()` in `lib/cofre.ts` is what tells them apart.
- **`documents.offline` is intent; the IndexedDB `arquivos` store is fact.** The column says the trip wants this document offline; only the store says *this device* has the bytes. Never derive the green light from the column alone — the same passport is green on the phone and yellow on the laptop, and the phone is the one that boards.
- **The `arquivos` store must survive every `VERSAO` bump.** The snapshot cache is thrown away on upgrade because one request regenerates it. The vault cannot be regenerated without a network — wiping it on an app update empties the cofre exactly when nobody can refill it. Same rule as `fila`.
- **A vault file moves in 4 MiB parts, in series, and comes back as a stream.** Vercel refuses a request *or response* body over 4.5 MB at the edge, so `enviarArquivo` (`lib/arquivo.ts`) slices the upload and `POST /api/documento` appends with `bytes || decode(...)` — but only `where octet_length(bytes) = deslocamento`, which is what makes a part that arrives twice (a retry) or out of order fail loudly instead of landing in the middle of the PDF. `documents.arquivo_bytes` holds the size the file was *supposed* to reach, and `GET` refuses to serve anything shorter: an upload that died halfway is a PDF that opens broken, and the owner blames their own file. Parallel parts would defeat the offset check — keep the loop serial.
- **Document bytes never enter the snapshot or the export.** They live in `document_files` (1:1 with `documents`) and move only through `/api/documento`. A `select *` that dragged PDFs into the snapshot would blow the IndexedDB quota and the first paint.
- **`/api/documento` re-checks visibility by itself.** `documentosDaViagem` scoping the snapshot is not enough: this route is reachable by typing a URL. The personal-document rule is enforced in three places — the read query, `autorizar` in `/api/mutate`, and this route — and all three must agree.
- **An editor cannot read another participant's `pessoal` document.** Planning the itinerary is not permission to open a passport. Only `proprietario` sees everything, matching `checklistDaViagem`.
- **`documents` and `document_requirements` are opposites, and both are needed.** `documents` stores what *exists*; `document_requirements` stores what is *demanded*. A requirement nobody has met has no file and no submission row — and that is the case the module exists for. `lib/documentacao.ts` is the whole engine, pure and tested.
- **Pending is the absence of a `document_submissions` row, never a stored value.** Creating a requirement must not write one row per participant, or every join/leave would need the list rewritten.
- **`document_submissions.status` is the *review*, not the traffic light.** `vencido`/`atrasado`/`proximo` are computed from the dates at read time by `estadoDe`. Storing the computed state leaves a passport `aprovado` after it expires, and nobody re-scans the table at midnight.
- **A submission has two owners and the 403 sits between them.** The *data* (`numero`, `validade`, `emitido_em`, `documento_id`) is the traveller's; the *verdict* (`status`, `comentario`) belongs to whoever reviews. `revisado_por`/`revisado_em` are stamped by the server — accepting them from the client would let any approval be signed by anybody.
- **A `visualizador` may write their own `pessoal` document, and only that.** It is the same escape hatch a personal checklist item has (`souDonoDoDocumento` in `autorizar`, mirrored in `POST /api/documento`). The person holding the passport cannot depend on the organiser to upload it. `podeEscrever`/`podeApagar` in `lib/cofre.ts` mirror the rule client-side; `lib/cofre.test.ts` asserts the two agree.
- **A `check` added as `not valid` breaks the paths that RE-INSERT old rows.** It tolerates what is stored and enforces the list on every INSERT — so duplicating a trip and export→import fail with 500 on a database in use and pass clean on a fresh one. `normalizarCategoria`/`tagsComCategoria` (`lib/cofre.ts`) are the fix: out-of-list becomes `outro` and the original word survives in `tags`.
- **Widening an enum in the `create table` half does nothing to a table that already exists.** `documents.tipo` listed `'arquivo'` up top while every real database still had the three-value constraint, so every upload died on `documents_tipo_check`. Always write the `alter table ... drop/add constraint` in the migrations half too.
- **Bump `VERSAO` in `lib/offline.ts` whenever the snapshot shape changes.** The first paint comes from the IndexedDB cache, so new code meets an old cached object and crashes on a field that no longer exists. `TripProvider.normalizar` is the seatbelt, not the fix.
- **Zod strips unknown keys** on import — a renamed field doesn't error, it silently imports as empty. Adding a field means touching `db/schema.sql` (create block **and** migrations section), `lib/schema.ts`, `/api/export`, and `lib/importar.ts` together, or backups quietly drop it.
- **Adding a whole entity is a 10-file checklist** with predictable failures per skipped step — README → Shipping a new update.
- **`db/schema.sql` is idempotent by design; there is no migration tool.** Applying the whole file *is* the migration.
- **`AGENTS.md` is regenerated by `next dev`.** Commit it with your work; reverting only recreates the diff.
- **Never create accounts or passwords for people.** Participants exist as name+email rows; each person registers at `/register` with that email and `vincularParticipantesPorEmail` links them automatically.
