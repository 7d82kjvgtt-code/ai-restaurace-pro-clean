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

## Follow-up: bounded live hosted check

API source remained unchanged. Production configuration commit f8c534413509fdc71abf0c9055f7eeffb298b8da pins Functions to Dublin (`dub1`), beside the confirmed Supabase eu-west-1 database. Before the change the response route contained `cle1::iad1`; afterwards it contained `cle1::dub1`. Region configuration follows https://vercel.com/docs/functions/configuring-functions/region .

On explicit follow-up authorization, a bounded READ-ONLY check ran against the existing public demo tenant. No reservations, users, email, billing, schema changes or real restaurant fixtures were created by this live runner. Earlier local isolation test data stayed local. This is a deliberate small diagnostic on a pilot, not permission for unrestricted production stress tests.

Final run: **337 API reads, zero failures, peak 100 simultaneous requests**, then 150 reads over 30 seconds at 5 requests/second. All responses had the expected restaurant slug and valid no-store results. A separate 100-request static-CDN warmup preceded this run.

| Stage | Requests | HTTP p95 from runner | Instrumented server-data p95 |
| --- | ---: | ---: | ---: |
| preflight | 2 | 6.169 s | 0.194 s |
| concurrency-10 | 10 | 6.756 s | 0.204 s |
| concurrency-25 | 25 | 7.250 s | 0.144 s |
| concurrency-50 | 50 | 8.355 s | 0.087 s |
| concurrency-100 | 100 | 10.437 s | 0.111 s |
| steady-up-to-30-seconds-5rps | 150 | 6.162 s | 0.406 s |

The instrumented data segments at 50 concurrency were 1.385 s p95 in the original US-region sample and 0.082 s in the initial Dublin sample (0.087 s in the final Dublin run). This is a sample comparison, not a controlled benchmark or a promise of all-user latency.

**Important interpretation:** Server-Timing measures restaurant lookup plus availability-data fetch, not the entire request. Overall HTTP p95 was 10.437 s at 100 concurrency, despite 0.111 s for those server-data segments. The remaining time can include test-runner/proxy/network overhead, cold starts and invocation queues; without internal Vercel metrics its source cannot be conclusively attributed. This does not meet a two-second end-to-end UX target.

Earlier exploratory ramps stopped automatically at their original eight-second total-response threshold (50 requests), and a relative-baseline experiment stopped at 25. After examining the inconsistent total-response overhead, the final bounded diagnostic used explicit fixed safety ceilings: zero response errors, server-data p95 at most two seconds, total HTTP p95 at most twelve seconds and at most 50 outstanding steady-state reads. Passing these safety ceilings is not production performance certification. No further load escalation was attempted beyond the final envelope.

Vercel's project/log connector returned project-not-found for the known team; no hosting CPU, memory, pool or queue metrics were obtained. The Supabase performance advisor reported only 20 informational unused indexes; these were retained rather than deleting indexes intended for future traffic.

The live checker is excluded from normal test commands and requires explicit invocation:

```bash
node tests/capacity/live-readonly.mjs --run-authorized-live-check --warm-transport
```

Run it again only with authorization and a current traffic/cost assessment. For repeated or heavier tests use isolated hosted staging. No paid staging branch or hosting upgrade was created.

## Browser follow-up

A direct cloud-browser UI check after the Dublin deployment reached the restaurant's loaded heading in approximately 1,143 ms after navigation. This measures heading readiness, not complete loading of every menu image or the full page. Entering 2 guests and 20 October 2026 then produced 22 available times in approximately 470 ms (measured around the date input and waiting for the 18:00 option to attach). No booking was submitted. This is one normal-use UI sample, not a concurrent browser load benchmark and does not remove the hosted-load limitations above.

Vercel plugin installation is verified enabled, but the connected account does not expose the target project through the project API. The next step for internal queue/CPU investigation requires correcting the connector's account/team access; no permission was broadened automatically and no credentials were requested in chat.

## Limits

These results demonstrate tested tenant isolation and application-level concurrency. They do not certify 100 busy restaurants on the current hosted plan. PGlite 0.5.10 runs PostgreSQL 18.6 with one exclusive connection; production uses PostgreSQL 17. The follow-up section adds a bounded live read-only measurement; pool saturation, hosted CPU/RAM, real concurrent writes, email quotas, 100 real tenant workloads and long-running load are still not measured. Existing double-booking regression checks are separate; this test is not a hosted concurrent-booking test.

Before promising production capacity at that scale, run a sustained end-to-end benchmark on an isolated hosted staging environment with the intended compute plan, connection limits and email sandbox. Do not run unrestricted production load tests or create 100 real customer restaurants as a substitute. The narrowly authorized read-only diagnostic above does not replace hosted staging.

## Reproduce safely

```bash
npm ci --prefix tests/capacity
node tests/capacity/isolation.mjs
node tests/capacity/concurrency.mjs
```

No secrets are required. isolation.mjs does not connect to production; concurrency.mjs replaces fetch and forbids writes. Results are written beside the tests as isolation-result.json and concurrency-result.json. Snapshot contains schema definitions only, no customer records. To refresh the snapshot, obtain metadata with a trusted administrator and review that no data or credentials are included.
