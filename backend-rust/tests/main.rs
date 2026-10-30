//! All integration tests compile into this one test binary. Cargo would otherwise build every
//! `tests/*.rs` file as its own executable, each statically linking the whole crate and its
//! dependencies (~90 MB apiece). `autotests = false` in Cargo.toml disables that discovery, so a
//! new test file must be declared here; `every_test_file_is_declared` fails if one is missing.

mod ai_models;
mod analytics;
mod analytics_call_sites;
mod annotation_create;
mod annotation_download;
mod annotation_duplicate;
mod annotation_finish;
mod annotation_info;
mod annotation_lifecycle;
mod annotation_lists;
mod annotation_merge_reset;
mod annotation_metadata;
mod annotation_mutex;
mod annotation_private_links;
mod annotation_provider;
mod annotation_reopen;
mod annotation_reservations;
mod annotation_sandbox_transfer;
mod annotation_upload;
mod annotation_upload_service;
mod application_info;
mod auth_oidc;
mod auth_routes;
mod auth_webauthn;
mod authentication;
mod browser_auth;
mod browser_auth_account;
mod browser_auth_onboarding;
mod browser_auth_support;
mod common;
mod credentials;
mod credit_ticker;
mod credit_transactions;
mod data_stores;
mod dataset_compose;
mod dataset_configuration;
mod dataset_explore;
mod dataset_lifecycle;
mod dataset_remote;
mod dataset_sam;
mod dataset_update;
mod dataset_upload_paths;
mod dataset_versions;
mod datasets;
mod folders;
mod housekeeping;
mod http;
mod initial_data;
mod job_submission;
mod job_workers;
mod jobs;
mod mail;
mod maintenance_short_links;
mod notification_emails;
mod object_ids;
mod organization_pricing;
mod organizations;
mod process_lifecycle;
mod projects_task_types;
mod projects_transfer;
mod publications;
mod remote_datastore;
mod remote_datastore_attachment_upload;
mod remote_datastore_dataset_report;
mod remote_datastore_dataset_upload;
mod remote_datastore_lookup;
mod remote_datastore_mag_upload;
mod remote_tracingstore_reads;
mod remote_tracingstore_report;
mod remote_tracingstore_update;
mod reports;
mod schema_version;
mod server_boundary;
mod service_clients;
mod slack;
mod task_assignment;
mod task_creation;
mod task_creation_from_files;
mod task_request;
mod tasks;
mod teams_scripts;
mod thumbnails;
mod time_interaction_writer;
mod time_tracking;
mod tracing_stores;
mod tracingstore_client;
mod used_storage_scan;
mod user_access;
mod user_configuration;
mod users;
mod users_update;
mod voxelytics;
mod worker_liveness;

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
