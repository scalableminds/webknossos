use serde_json::{Value, json};

use super::*;
use crate::{dataset::lifecycle::real_path_scan_info_for, util::id::ObjectId};

fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).into(), (*value).into()))
        .collect()
}

fn record(store: &str, is_virtual: bool) -> DatasetRecord {
    DatasetRecord {
        id: ObjectId::new(),
        organization: "org".into(),
        store_url: Some(format!("http://{store}.invalid")),
        store_name: Some(store.into()),
        is_virtual,
        is_usable: true,
        status: String::new(),
        root_path: None,
        root_real_path: None,
    }
}

fn data_source(paths: &[&str], attachment_paths: &[&str]) -> Value {
    json!({
        "id": {"name": "ds", "team": "org"},
        "scale": {"factor": [1, 1, 1], "unit": "nanometer"},
        "dataLayers": [{
            "name": "color",
            "mags": paths.iter().map(|path| json!({"mag": [1, 1, 1], "path": path})).collect::<Vec<_>>(),
            "attachments": {
                "meshes": attachment_paths.iter().map(|path| json!({"name": "m", "path": path})).collect::<Vec<_>>(),
            },
        }],
    })
}

#[test]
fn defaults_match_scala() {
    let config = config_from_values(&HashMap::new()).unwrap();
    assert_eq!(config, VirtualDatasetsRealPathScanConfig::default());
    assert!(config.schedule.enabled);
    assert_eq!(config.schedule.interval, Duration::from_secs(3600));
    assert_eq!(config.schedule.initial_delay, Duration::from_secs(10));
}

#[test]
fn config_reads_env() {
    let config = config_from_values(&values(&[
        ("WK_VIRTUAL_DATASETS_REAL_PATH_SCAN_ENABLED", "false"),
        // Removed variables: Play hard-codes the timings, so they are ignored.
        ("WK_VIRTUAL_DATASETS_REAL_PATH_SCAN_INTERVAL_SECONDS", "120"),
        (
            "WK_VIRTUAL_DATASETS_REAL_PATH_SCAN_INITIAL_DELAY_SECONDS",
            "0",
        ),
    ]))
    .unwrap();
    assert_eq!(
        config.schedule,
        JobSchedule {
            enabled: false,
            interval: DEFAULT_INTERVAL,
            initial_delay: DEFAULT_INITIAL_DELAY,
        }
    );
    for (key, value) in [
        ("WK_VIRTUAL_DATASETS_REAL_PATH_SCAN_ENABLED", "maybe"),
        ("WK_VIRTUAL_DATASETS_REAL_PATH_SCAN_ENABLED", "1"),
    ] {
        let error = config_from_values(&values(&[(key, value)])).unwrap_err();
        assert!(error.0.starts_with(key), "{key}={value}: {error}");
    }
}

#[test]
fn advisory_lock_key_is_pinned_and_unique() {
    // Independently computed FNV-1a; a rename would silently change the lock identity.
    assert_eq!(advisory_lock_key(JOB_NAME), -3_001_348_398_396_176_784);
    let mut keys: Vec<i64> = crate::background::housekeeping::HousekeepingJob::ALL
        .iter()
        .map(|job| job.advisory_lock_key())
        .collect();
    keys.extend([
        advisory_lock_key(crate::background::credit_ticker::JOB_NAME),
        advisory_lock_key(crate::background::worker_liveness::JOB_NAME),
        advisory_lock_key(crate::background::pricing_plan_expiry_reminder::JOB_NAME),
        advisory_lock_key(crate::organization::storage::JOB_NAME),
    ]);
    assert!(!keys.contains(&advisory_lock_key(JOB_NAME)));
}

#[test]
fn groups_virtual_datasets_by_data_store() {
    let a1 = record("store-a", true);
    let b1 = record("store-b", true);
    let a2 = record("store-a", true);
    let non_virtual = record("store-c", false);
    let groups = group_by_data_store(vec![b1.clone(), a1.clone(), non_virtual, a2.clone()]);
    let summary: Vec<(&str, Vec<&ObjectId>)> = groups
        .iter()
        .map(|(store, records)| (store.as_str(), records.iter().map(|r| &r.id).collect()))
        .collect();
    assert_eq!(
        summary,
        vec![("store-a", vec![&a1.id, &a2.id]), ("store-b", vec![&b1.id])]
    );
    assert!(group_by_data_store(Vec::new()).is_empty());
}

#[test]
fn scan_info_requires_a_local_path() {
    for remote_only in [
        data_source(&["s3://bucket/mag"], &[]),
        data_source(&["https://host/mag"], &["gs://bucket/mesh"]),
        data_source(&[], &[]),
    ] {
        assert_eq!(
            real_path_scan_info_for(remote_only, Some("/root"), None),
            None
        );
    }
    for local in [
        data_source(&["s3://bucket/mag", "/srv/data/mag"], &[]),
        data_source(&["file:///srv/data/mag"], &[]),
        data_source(&["s3://bucket/mag"], &["relative/mesh.hdf5"]),
    ] {
        assert!(real_path_scan_info_for(local, None, None).is_some());
    }
}

#[test]
fn scan_info_is_data_source_with_root_path_info() {
    let source = data_source(&["/srv/data/mag"], &[]);
    assert_eq!(
        real_path_scan_info_for(source.clone(), None, None),
        Some(json!({"dataSource": source}))
    );
    assert_eq!(
        real_path_scan_info_for(source.clone(), Some("/srv/root"), Some("/real/root")),
        Some(json!({
            "dataSource": source,
            "rootPath": "/srv/root",
            "rootRealPath": "/real/root",
        }))
    );
}
