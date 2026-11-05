//! All integration tests compile into this one test binary. Cargo would otherwise build every
//! `tests/*.rs` file as its own executable, each statically linking the whole crate and its
//! dependencies (~90 MB apiece). `autotests = false` in Cargo.toml disables that discovery, so a
//! new test file must be declared here; `every_test_file_is_declared` fails if one is missing.

mod access;
mod agglomerate_routes;
mod binary_data;
mod binary_data_routes;
mod binding_errors;
mod common;
mod compression;
mod compresso;
mod compresso_routes;
mod connectome;
mod connectome_routes;
mod data_proxy_routes;
mod data_source_routes;
mod data_source_service;
mod datareaders_n5;
mod datareaders_precomputed;
mod datareaders_wkw;
mod datareaders_zarr;
mod datareaders_zarr3;
mod dataset_cache;
mod datavault;
mod explore_routes;
mod fake_redis;
mod find_data_routes;
mod full_mesh_routes;
mod hdf5_agglomerates;
mod hdf5_segment_index;
mod health;
mod maintenance_routes;
mod managed_s3;
mod mapping_routes;
mod mesh_files;
mod mesh_geometry;
mod mesh_routes;
mod mock_s3;
mod mock_wk;
mod models;
mod reader_support;
mod routing;
mod s3_uri_rewrite;
mod segment_index_routes;
mod segment_statistics_routes;
mod slack;
mod source_scan;
mod thumbnail_routes;
mod upload_finish_routes;
mod upload_metadata_store;
mod upload_routes;
mod wk_client;
mod zarr_private_link_routes;
mod zarr_streaming_routes;
mod zip_data_routes;
mod zip_vault;

#[test]
fn every_test_file_is_declared() {
    let main = include_str!("main.rs");
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let module = match name.strip_suffix(".rs") {
            Some("main") => continue,
            Some(module) => module,
            None if path.join("mod.rs").exists() => name,
            None => continue,
        };
        assert!(
            main.lines().any(|line| line == format!("mod {module};")),
            "tests/{name} is not declared in tests/main.rs and would never run"
        );
    }
}
