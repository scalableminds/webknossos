.PHONY: check test test-db run inventory

check:
	cargo fmt --check
	cargo clippy --locked --all-targets -- -D warnings
	python3 tools/route_inventory.py --check

test:
	cargo test --locked

test-db:
	@test -n "$$WK_RUST_TEST_DATABASE_URL" || (echo 'Set WK_RUST_TEST_DATABASE_URL to a PostgreSQL administrative URL with CREATEDB'; exit 1)
	cargo test --locked -- --include-ignored

run:
	cargo run --locked

inventory:
	python3 tools/route_inventory.py

