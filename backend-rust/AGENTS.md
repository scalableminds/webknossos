# Rust backend

This directory is an incremental migration of the application backend. Keep additions inside this directory unless the task explicitly requires wiring elsewhere. The parent AGENTS.md also applies.

- Use the existing `../schema/schema.sql`, Scala controllers/DAOs, and `../conf/webknossos.latest.routes` as contract references. Do not claim parity for routes that are not implemented.
- Never run the destructive schema bootstrap against an existing database. Production startup only checks the schema version. Integration tests create a uniquely named database before applying the schema.
- Keep SQL values bound, authorization organization-scoped, multi-step mutations transactional, and sensitive fields out of responses and logs.
- Add a module exposing `router() -> Router<AppState>` and merge it in `src/lib.rs`. Preserve response fields, timestamp units, permissions, soft-delete behavior, and dependent-record handling.
- Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test --locked` from this directory.
- For database changes also run `WK_RUST_TEST_DATABASE_URL=<admin URL> cargo test --locked -- --include-ignored`. This role needs `CREATEDB`; tests must never bootstrap the URL's database itself.
- Update `MIGRATION_STATUS.md` with `python3 tools/route_inventory.py`; verify with `python3 tools/route_inventory.py --check`.

