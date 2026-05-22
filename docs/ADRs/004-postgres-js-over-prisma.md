# ADR-004: postgres.js over Prisma

**Status:** Accepted  
**Date:** 2026-05-15

## Context

We need a PostgreSQL client with:
- Full control over query structure (FOR UPDATE SKIP LOCKED, advisory locks, bulk inserts)
- Prepared statement support for performance
- Connection pooling
- TypeScript support

## Decision

Use **postgres.js** (raw SQL with tagged templates) validated by Zod for result shapes.

## Alternatives Considered

### Prisma

**Not selected.** Prisma is excellent for CRUD-heavy applications but has limitations for this use case:

- `FOR UPDATE SKIP LOCKED` requires raw SQL escape hatch
- Advisory lock calls (`pg_try_advisory_lock`) require raw SQL
- Bulk item inserts require raw SQL or N queries with the ORM
- The schema-first approach duplicates domain model definitions (one in Prisma schema, one in TypeScript)
- Generated client adds ~3MB to the bundle and a code generation step to the build

### TypeORM / Knex

**Not selected.** Knex is a query builder that requires learning its own API; the output SQL is less predictable. TypeORM has known N+1 issues and its ORM patterns don't align with the functional domain model used here.

## Consequences

**Positive:**
- Complete SQL control — any PostgreSQL feature works without workarounds
- `postgres.js` uses prepared statements automatically, preventing SQL injection at the driver level
- Pipelining support allows multiple queries to be sent in a single round trip
- No ORM abstraction layer — queries are exactly what they appear to be
- Bundle is smaller; no code generation step

**Negative:**
- More boilerplate for CRUD operations compared to Prisma
- No automatic migration generation — migrations are hand-written SQL files
- Developer must understand SQL (not necessarily a negative for a senior team)
- `postgres.js` v3 has a strict `JSONValue` type for `sql.json()` — raw serialisation to `::jsonb` cast is required for complex nested types (documented in repository implementations)
