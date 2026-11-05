# Credit transactions and publications (batch M3)

Owner files: `src/credit_transactions.rs`, `src/publications.rs`, `tests/credit_transactions.rs`, `tests/publications.rs`.

## Status
- Status: done (6/6 routes implemented, wired, tested).
- Done: GET /maintenance/revokeExpiredCredits, POST /creditTransactions/addCredits,
  PATCH /creditTransactions/:transactionId, GET /creditTransactions, GET /publications, GET /publications/:id.
  Wired in src/lib.rs (`pub mod credit_transactions; pub mod publications;`,
  `.merge(credit_transactions::router())`, `.merge(publications::router(jobs_enabled))`).
  tests/credit_transactions.rs (3 DB tests), tests/publications.rs (1 DB test), 3 unit tests in
  src/credit_transactions.rs; full suite green; clippy -D warnings green for lib/bins/my tests.
- In-flight: none.
- Next step: coordinator regenerates MIGRATION_STATUS.md (`python3 tools/route_inventory.py`); not touched here.
- Note: crate-wide clippy currently fails in tests/organization_pricing.rs (another agent's file,
  `field_reassign_with_default`), unrelated to this batch.

## Contract notes
- Credits: all SecuredAction. Failures are Play `?~>` texts with 400: "Only super users can add credits to an
  organization" / "...manually refund credits" / "...manually revoke expired credits", Organization notFound,
  "moneySpent X is not a valid decimal", "moneySpent must be a positive number", "creditAmount must be a positive
  number", "Expiration date must be in the future", "Transaction is not for this organization", "Can only refund
  pending transactions.", "Only organization admins can list credit transactions.". Empty Fox -> 404
  "Could not find or access the requested resource." (unknown transaction, unparsable expiresAt, invisible paid job).
- Query params are bound before authentication (missing param -> 400 even unauthenticated, as with Play binding).
- addCredits: delta = creditAmount*1000, Complete/AddCredits; default comment uses java BigDecimal.toString of moneySpent.
- Mutations run in SERIALIZABLE transactions (as Scala); refund locks the row FOR UPDATE, inserts the +delta
  Refunding row (comment "Refund for failed job X." / "Refund for transaction X.") then marks the original
  Complete/Refunded. Balance-trigger (P0004) failures -> 400.
- revokeExpiredCredits: per organization one SERIALIZABLE transaction, grants DESC by created_at, same
  available-credits SUM as Scala (base table), Spent / Revoked / PartiallyRevoked + Revoking row
  "Revoked unused complimentary credits (YYYY-MM)" (grant month in server-local zone, like the JVM default).
- list: CreditTransactionDAO.listAccessQ (own org if admin/dataset manager, or team manager), compacted like
  compactFreeCreditsForDisplay (comment "<c>: <net/1000.0> used", Java Double formatting), zero deltas dropped.
  paidJob = JobCompactInfo (None fields omitted, tokens stripped from args, resultLink, costInMilliCredits).
- Publications: identity-independent (GlobalAccessContext, requesting user None) -> no auth extraction at all,
  so invalid tokens do not 401. Datasets via `datasets::full_json_on_connection(None)`, annotations as
  writesWithDataset {id,name,description,typ,tracingStore{name,url},dataset}. No tracing store -> 404 generic.
  Access-Control-Allow-Origin: * and Access-Control-Max-Age: 600 on all responses (allowRemoteOrigin).

## Gaps / deliberate deviations
- Error chains (Play "chain" message entry) are not emitted; only the outermost message.
- Missing/invalid query params: 400 "Invalid query parameters." (Play: its binder text).
- creditAmount whose *1000 overflows Int: 400 "creditAmount is too large" (Scala silently wraps).
- BigDecimal: no DECIMAL128 rounding for >34 significant digits.
- Revocation uses savepoints per grant so one failure does not abort the organization's transaction (Scala's
  asTry without savepoints would poison it); failures are logged via tracing, not sent to Slack.
- Serialization failures -> 409 (crate-wide mapping) instead of Play's 400.
- Deterministic ORDER BY where Scala has none (transactions/publications/datasets/annotations by created, _id;
  costInMilliCredits uses the earliest transaction of the job).
- Paid-job owner organization is read without the OrganizationDAO access check (owner must be readable via
  UserDAO.readAccessQ; otherwise 400 "User could not be found or accessed.").
