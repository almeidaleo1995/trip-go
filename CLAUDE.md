@AGENTS.md

# TripGo

Multi-user, offline-first trip planner. Next 16 (App Router) + React 19 + Neon Postgres + Tailwind v4, deployed on Vercel. Node 22+ required (native TS type stripping, `--env-file`).

**`README.md` is the real documentation** — data model, request lifecycles, offline engine, authorization, known limitations. Read the relevant section before changing anything structural; don't re-derive it.

## Objetivo

One family trip planned by many people, usable abroad with no signal: itinerary, flights, cruise, lodging, cities, checklist, documents, emergency contacts and budget. Concretely that means three non-negotiables — **opens in airplane mode and accepts edits**, **the `financeiro` tab is protected at the endpoint (403), not just hidden in the UI**, and **everything is editable from the screen** so no one needs a terminal mid-trip. Real data in production: the Europa 2027 trip, 5 participants. Still missing: guide module, activities/tickets, PDF-import review screen, PWA polish — README → Known limitations.

## Layout

```
app/(auth)/          login · register — anonymous only, proxy bounces logged-in users
app/(dashboard)/     private: dashboard · viagens · perfil
  viagens/[id]/      ← the trip app itself: Shell + TripProvider + 11 tabs
app/api/             9 route handlers, all Node runtime, all trip-scoped
components/          TripProvider (client state) · Shell (nav) · EditorSheet (all 15
                     entities, schema-driven) · ui.tsx (whole design system) · tabs/
lib/                 db (SQL, credential stops here) · auth (exigirUsuario/exigirViagem)
                     session · schema (zod contract) · importar · derive (pure calcs,
                     heaviest tests) · offline (IndexedDB) · api (error → HTTP pt-BR)
config/              site.ts (brand strings) · theme.ts (tokens) · navigation.ts (menu + papéis)
db/                  schema.sql (19 tables, idempotent) · europa-2027.json (v1, stale)
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
npm test             # 88 unit tests, node --test, no framework
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
- **Zod strips unknown keys** on import — a renamed field doesn't error, it silently imports as empty. Adding a field means touching `db/schema.sql` (create block **and** migrations section), `lib/schema.ts`, `/api/export`, and `lib/importar.ts` together, or backups quietly drop it.
- **Adding a whole entity is a 10-file checklist** with predictable failures per skipped step — README → Shipping a new update.
- **`db/schema.sql` is idempotent by design; there is no migration tool.** Applying the whole file *is* the migration.
- **`AGENTS.md` is regenerated by `next dev`.** Commit it with your work; reverting only recreates the diff.
- **Never create accounts or passwords for people.** Participants exist as name+email rows; each person registers at `/register` with that email and `vincularParticipantesPorEmail` links them automatically.
