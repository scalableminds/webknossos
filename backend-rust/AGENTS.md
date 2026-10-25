# Rust backend

This directory is an incremental migration of the application backend. Keep additions inside this directory unless the task explicitly requires wiring elsewhere. The parent AGENTS.md also applies.

- Use the existing `../schema/schema.sql`, Scala controllers/DAOs, and `../conf/webknossos.latest.routes` as contract references. Do not claim parity for routes that are not implemented.
- Never run the destructive schema bootstrap against an existing database. Production startup only checks the schema version. Integration tests create a uniquely named database before applying the schema.
- Keep SQL values bound, authorization organization-scoped, multi-step mutations transactional, and sensitive fields out of responses and logs.
- Compose dynamic SQL with `crate::sql::Sql` (sqlx `QueryBuilder`): `push` the text, `push_bind` the values. Reusable predicates (access checks) are `push_*` functions that bind their own values; never splice a fragment containing `$n` via `format!` (`tools/check_sql_placeholders.py`, part of `make check`, rejects it).
- Add a module under its domain (`src/annotation/`, `src/dataset/`, `src/auth/`, ...) exposing `router() -> Router<AppState>` and merge it in the domain's parent file (e.g. `src/annotation.rs`), which `src/routes.rs` merges. Unit tests live in a sibling `<module>/tests.rs`; integration tests in `tests/`. Preserve response fields, timestamp units, permissions, soft-delete behavior, and dependent-record handling.
- The app, `common/` and `datastore/` form one Cargo workspace (shared `Cargo.lock`, `target/`, lints and `[workspace.dependencies]`). Run `make check` and `make test` from this directory; they cover all three packages and CI runs them too.
- Build and test one package at a time (`-p <package>`): features unify across the packages of one cargo invocation, and the datastore's `serde_json/preserve_order` would change the app's JSON key order.
- `cargo fmt --check` passes over statements rustfmt could not fit and left as written; `tools/check_unformatted.py` (part of `make check`) catches them. Break long SQL/message literals with `\` continuations so rustfmt can format the statement.
- For database changes also run `WK_RUST_TEST_DATABASE_URL=<admin URL> make test-db`. This role needs `CREATEDB`; tests must never bootstrap the URL's database itself.
- Update `MIGRATION_STATUS.md` with `python3 tools/route_inventory.py`; verify with `python3 tools/route_inventory.py --check`.

