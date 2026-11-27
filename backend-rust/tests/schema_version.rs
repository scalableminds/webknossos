//! Schema ownership guard: the Scala evolutions (`schema/evolutions`) stay authoritative, and this
//! backend refuses to start on any other `releaseInformation.schemaVersion` than
//! `db::SCHEMA_VERSION`. When an evolution lands, this test fails until the Rust backend has been
//! reviewed against it and `SCHEMA_VERSION` is bumped (see CUTOVER.md, "Schema ownership").
use std::path::Path;

use webknossos_backend::db::SCHEMA_VERSION;

fn repository_schema() -> &'static Path {
    Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../schema"))
}

#[test]
fn rust_schema_version_matches_schema_sql() {
    let schema = std::fs::read_to_string(repository_schema().join("schema.sql")).unwrap();
    let marker = "INSERT INTO webknossos.releaseInformation(schemaVersion) values(";
    let start = schema
        .find(marker)
        .expect("schema.sql sets releaseInformation")
        + marker.len();
    let version: i64 = schema[start..]
        .split(')')
        .next()
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert_eq!(
        version, SCHEMA_VERSION,
        "schema/schema.sql is at version {version}, the Rust backend supports {SCHEMA_VERSION}"
    );
}

#[test]
fn rust_schema_version_matches_latest_evolution() {
    let latest = std::fs::read_dir(repository_schema().join("evolutions"))
        .unwrap()
        .filter_map(|entry| {
            let name = entry.unwrap().file_name().into_string().ok()?;
            name.strip_suffix(".sql")?
                .split('-')
                .next()?
                .parse::<i64>()
                .ok()
        })
        .max()
        .unwrap();
    assert_eq!(
        latest, SCHEMA_VERSION,
        "schema/evolutions goes up to {latest}, the Rust backend supports {SCHEMA_VERSION}"
    );
}
