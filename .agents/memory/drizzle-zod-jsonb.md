---
name: drizzle-zod jsonb array typing
description: Why some Insert types are derived from $inferInsert instead of z.infer
---

# drizzle-zod jsonb-array insert typing

For pgTable jsonb columns typed with `.$type<Array<{...}>>()` (and objects containing nested arrays), `createInsertSchema(...)` + `z.infer` produces an array type that does NOT match what Drizzle's `db.insert().values()` expects. Symptom at compile time: `error TS2769: No overload matches this call ... pop() returns 'unknown' ... not assignable to {...}[]`.

**Fix used:** derive the Insert *type* from Drizzle's own `typeof table.$inferInsert` for those tables (e.g. onboardingData, marketEvents), while keeping the `createInsertSchema` zod schema for runtime request validation.

**Why:** the zod schema and the Drizzle insert type disagree only on jsonb-array shape; `$inferInsert` is exactly what `.values()` wants, so the storage layer type-checks cleanly.

**How to apply:** if you add a jsonb `$type<Array<...>>` column and hit the TS2769 `.values()` error, switch that table's `Insert<X>` export to `$inferInsert` rather than fighting the zod inference. Plain (non-array) jsonb and scalar columns are fine with `z.infer`.
