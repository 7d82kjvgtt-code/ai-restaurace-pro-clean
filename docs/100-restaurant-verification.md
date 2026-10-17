# 100-restaurant isolation and concurrency verification

Date: 2026-10-17 UTC / 18 October Prague.
API source blob tested: 07899edaa0becb80800b5f849de148d2553d39f1.

## Passed

- Recreated all 18 production public tables, 42 functions, policies, constraints, indexes, grants and 20 triggers in isolated PGlite PostgreSQL. Auth identity helpers are local equivalents. No production data copied. Only synthetic users, restaurants and reservations are seeded.
- 100 restaurants, 100 owner identities and 100,000 synthetic reservations.
- 1,506 assertions: own vs adjacent foreign tenant reads across reservations, menu, tables, settings, opening hours, customer profiles and team; foreign writes/deletes/inserts; tenant reassignment; cross-tenant table assignment; anonymous private-data reads; denied whole-table maintenance privileges. Fixture data is seeded before installing triggers; triggers are active for assertions. No claim of an exhaustive audit of every RPC.
- Actual current API handler: 1,000 availability requests, 100 simultaneously, across 100 distinct restaurant slugs. Every downstream service query remained tenant-scoped. Malicious restaurant_id different from the slug did not change the target. Database transport is stubbed with synthetic responses and 10–14 ms delay; no real network writes or emails.
- Production after hardening: public restaurant metadata HTTP 200; availability HTTP 200 / 22 slots; unauthenticated dashboard HTTP 401; public menu RPC returns 12 dishes.

## Security correction applied

Migration restrict_client_table_maintenance revokes TRUNCATE, TRIGGER and REFERENCES from anon, authenticated and PUBLIC on public tables and in postgres-owned table defaults. TRUNCATE is not protected by row-level security. Browser CRUD permissions, RLS predicates, trusted service_role operations and existing foreign-key constraints are retained. Production verification returned zero client TRUNCATE/TRIGGER/REFERENCES grants after migration. No tables or data were deleted.

## Remaining security advisor notices

Post-change advisor review still reports four RLS-enabled server-only/no-policy tables, six anonymous public SECURITY DEFINER helper functions, twelve authenticated SECURITY DEFINER helpers and disabled leaked-password protection. The public helpers and role helpers require their privileged design and are intentionally callable; this test does not claim the advisor is warning-free or replace a complete security audit. Leaked-password protection was not changed as part of tenant/capacity verification. Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Limits

These results demonstrate tested tenant isolation and application-level concurrency. They do not certify 100 busy restaurants on the current hosted plan. PGlite 0.5.10 runs PostgreSQL 18.6 with one exclusive connection; production uses PostgreSQL 17. Database network latency, pool saturation, hosted CPU/RAM, real concurrent transactions, email quotas, real-world traffic and sustained load are not measured. Existing double-booking regression checks are separate; this test is not a hosted concurrent-booking test.

Before promising production capacity at that scale, run a sustained end-to-end benchmark on an isolated hosted staging environment with the intended compute plan, connection limits and email sandbox. Do not load-test production or create 100 real customer restaurants as a substitute.

## Reproduce safely

```bash
npm ci --prefix tests/capacity
node tests/capacity/isolation.mjs
node tests/capacity/concurrency.mjs
```

No secrets are required. isolation.mjs does not connect to production; concurrency.mjs replaces fetch and forbids writes. Results are written beside the tests as isolation-result.json and concurrency-result.json. Snapshot contains schema definitions only, no customer records. To refresh the snapshot, obtain metadata with a trusted administrator and review that no data or credentials are included.
