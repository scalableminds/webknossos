.PHONY: check fmt-check test test-db run inventory

# Features unify across the packages of one cargo invocation (the datastore's
# `serde_json/preserve_order` would change the app's JSON key order), so tests run per package.
PACKAGES := webknossos-backend webknossos-common webknossos-datastore

check: fmt-check
	cargo clippy --locked --workspace --all-targets -- -D warnings
	python3 tools/route_inventory.py --check
	python3 tools/datastore_route_inventory.py --check

# `cargo fmt --check` passes over statements rustfmt could not fit into the line width and
# left untouched, so also reject the overlong code lines that indicate them.
fmt-check:
	cargo fmt --all --check
	python3 tools/check_unformatted.py

test:
	set -e; for package in $(PACKAGES); do cargo test --locked -p $$package; done

test-db:
	@test -n "$$WK_RUST_TEST_DATABASE_URL" || (echo 'Set WK_RUST_TEST_DATABASE_URL to a PostgreSQL administrative URL with CREATEDB'; exit 1)
	cargo test --locked -p webknossos-backend -- --include-ignored

run:
	cargo run --locked

inventory:
	python3 tools/route_inventory.py
