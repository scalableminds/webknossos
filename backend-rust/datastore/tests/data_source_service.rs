use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use webknossos_datastore::{
    AppState,
    config::DatastoreConfig,
    models::{DataSource, FILENAME_DATASOURCE_PROPERTIES_JSON, UPath, UsableDataSource},
    services::DataSourceService,
};
fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-datasource-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}
fn source() -> Value {
    json!({"id":{"name":"stored-name","team":"stored-org"},"scale":[1,2,3],"dataLayers":[{
        "name":"seg","category":"segmentation","elementClass":"uint32","dataFormat":"wkw",
        "boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},"mags":[
            {"mag":[1,1,1]},{"mag":[2,2,2]},
            {"mag":[4,4,4],"path":"../linked/4","credentialId":"cred"},
            {"mag":[8,8,8],"path":"s3://bucket/remote"}]}]})
}
fn write(path: &Path, source: &Value) {
    std::fs::write(
        path.join(FILENAME_DATASOURCE_PROPERTIES_JSON),
        serde_json::to_vec_pretty(source).unwrap(),
    )
    .unwrap();
}
fn service(path: &Path) -> DataSourceService {
    AppState::new(DatastoreConfig::defaults(path)).data_sources
}
fn usable(source: DataSource) -> UsableDataSource {
    match source {
        DataSource::Usable(s) => s,
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn loader_resolves_implicit_relative_remote_and_attachment_paths() {
    let p = temp();
    write(&p, &source());
    std::fs::create_dir_all(p.join("seg/1")).unwrap();
    // Existing scalar wins; missing scalar falls back to vector notation.
    std::fs::create_dir_all(p.join("seg/2-2-2")).unwrap();
    for (dir, name) in [
        ("meshes", "mesh.hdf5"),
        ("agglomerates", "agg.hdf5"),
        ("agglomerates", "counts.json"),
        ("segmentIndex", "index.hdf5"),
        ("connectomes", "connect.hdf5"),
        ("meshes", "wrong.HDF5"),
        ("meshes", ".hdf5"),
        ("segmentStatistics", "stats.hdf5"),
    ] {
        let dir = p.join("seg").join(dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), []).unwrap();
    }
    std::fs::create_dir_all(p.join("seg/meshes/not-a-file.hdf5")).unwrap();
    let s = service(&p);
    let resolved = usable(s.data_source_from_dir(&p, "org", true));
    assert_eq!(resolved.id.organization_id, "org");
    assert_eq!(
        resolved.id.directory_name,
        p.file_name().unwrap().to_str().unwrap()
    );
    let mags = &resolved.data_layers[0].mags;
    assert_eq!(
        mags[0].path.as_ref().unwrap(),
        &UPath::from_local_path(&p.join("seg/1"))
    );
    assert_eq!(
        mags[1].path.as_ref().unwrap(),
        &UPath::from_local_path(&p.join("seg/2-2-2"))
    );
    assert_eq!(
        mags[2].path.as_ref().unwrap(),
        &UPath::from_local_path(&p.join("../linked/4"))
    );
    assert_eq!(mags[2].credential_id.as_deref(), Some("cred"));
    assert_eq!(
        mags[3].path.as_ref().unwrap().to_string(),
        "s3://bucket/remote"
    );
    let a = resolved.data_layers[0].attachments.as_ref().unwrap();
    let mut mesh_names: Vec<_> = a.meshes.iter().map(|m| m.name.as_str()).collect();
    mesh_names.sort();
    assert_eq!(mesh_names, vec!["", "mesh"]);
    assert_eq!(a.agglomerates[0].name, "agg");
    assert_eq!(a.cumsum.as_ref().unwrap().name, "counts");
    assert_eq!(a.segment_index.as_ref().unwrap().name, "index");
    assert_eq!(a.connectomes[0].name, "connect");
    assert!(a.segment_statistics.is_none());
    assert!(a.all_attachments().iter().all(|a| a.path.is_absolute()));
    let unresolved = usable(s.data_source_from_dir(&p, "org", false));
    assert!(unresolved.data_layers[0].mags[0].path.is_none());
    assert_eq!(
        unresolved.data_layers[0]
            .attachments
            .as_ref()
            .unwrap()
            .agglomerates[0]
            .path
            .to_string(),
        "./seg/agglomerates/agg.hdf5"
    );
}

#[test]
fn explicit_metadata_wins_scans_and_new_remote_base_keeps_credentials() {
    let p = temp();
    let mut data = source();
    data["dataLayers"][0]["attachments"] = json!({"meshes":[{"name":"explicit","path":"custom/mesh.hdf5",
        "dataFormat":"hdf5","credentialId":"attachment-cred"}]});
    write(&p, &data);
    std::fs::create_dir_all(p.join("seg/meshes")).unwrap();
    std::fs::write(p.join("seg/meshes/scanned.hdf5"), []).unwrap();
    let source = usable(service(&p).data_source_from_dir(&p, "org", false));
    let attachments = source.data_layers[0].attachments.as_ref().unwrap();
    assert_eq!(attachments.meshes.len(), 1);
    assert_eq!(attachments.meshes[0].name, "explicit");
    let remote = DataSourceService::resolve_paths_in_new_base_path(
        &source,
        &UPath::parse("s3://bucket/new").unwrap(),
    );
    let layer = &remote.data_layers[0];
    assert_eq!(
        layer.mags[0].path.as_ref().unwrap().to_string(),
        "s3://bucket/new/seg/1"
    );
    assert_eq!(
        layer.mags[1].path.as_ref().unwrap().to_string(),
        "s3://bucket/new/seg/2"
    );
    assert_eq!(
        layer.mags[3].path.as_ref().unwrap().to_string(),
        "s3://bucket/remote"
    );
    let a = &layer.attachments.as_ref().unwrap().meshes[0];
    assert_eq!(a.path.to_string(), "s3://bucket/new/custom/mesh.hdf5");
    assert_eq!(a.credential_id.as_deref(), Some("attachment-cred"));
}

#[test]
fn missing_syntax_schema_and_validation_failures_keep_structured_unusable_sources() {
    let p = temp();
    let s = service(&p);
    let missing = s.data_source_from_dir(&p, "org", true);
    assert_eq!(missing.status_opt(), Some("Not imported yet."));
    std::fs::write(p.join(FILENAME_DATASOURCE_PROPERTIES_JSON), b"{broken").unwrap();
    let syntax = s.data_source_from_dir(&p, "org", true);
    assert!(syntax.status_opt().unwrap().contains("Invalid json format"));
    match syntax {
        DataSource::Unusable(s) => assert!(s.existing_data_source_properties.is_none()),
        _ => panic!(),
    }
    write(&p, &json!({"wrong":"shape"}));
    match s.data_source_from_dir(&p, "org", true) {
        DataSource::Unusable(s) => {
            assert!(s.status.contains("Validating Json Failed"));
            assert_eq!(
                s.existing_data_source_properties,
                Some(json!({"wrong":"shape"}))
            );
        }
        _ => panic!(),
    }
    let mut invalid = source();
    invalid["scale"] = json!([0, 2, 3]);
    write(&p, &invalid);
    match s.data_source_from_dir(&p, "org", true) {
        DataSource::Unusable(s) => {
            assert_eq!(
                s.status,
                "Error: Voxel size (scale) is negative in at least one dimension."
            );
            assert!(s.scale.is_some());
            assert!(s.existing_data_source_properties.is_some());
        }
        _ => panic!(),
    }
    // Source.getLines.mkString joins literal line separators, including inside a JSON string.
    let text = serde_json::to_string(&source())
        .unwrap()
        .replace("stored-name", "stored-\r\nname");
    std::fs::write(p.join(FILENAME_DATASOURCE_PROPERTIES_JSON), text).unwrap();
    assert!(s.data_source_from_dir(&p, "org", false).is_usable());
}

#[tokio::test]
async fn selective_vault_invalidation_removes_mag_and_attachment_handles() {
    let p = temp();
    let mut data = source();
    data["dataLayers"][0]["mags"] = json!([{"mag":[1,1,1],"path":p.join("seg/1")}]);
    data["dataLayers"][0]["attachments"] =
        json!({"meshes":[{"name":"mesh","path":p.join("mesh.hdf5"),"dataFormat":"hdf5"}]});
    let source: UsableDataSource = serde_json::from_value(data).unwrap();
    let state = AppState::new(DatastoreConfig::defaults(&p));
    let unrelated = UPath::from_local_path(&p.join("unrelated"));
    state.data_vaults.vault_path_for(&unrelated).await.unwrap();
    state
        .data_vaults
        .vault_path_for_mag(&source.data_layers[0].mags[0])
        .await
        .unwrap();
    state
        .data_vaults
        .vault_path_for_attachment(source.data_layers[0].all_attachments()[0])
        .await
        .unwrap();
    assert_eq!(state.data_vaults.cached_vault_count(), 3);
    let source = DataSource::Usable(source);
    assert_eq!(
        state
            .data_sources
            .invalidate_vault_cache(&source, Some("absent"))
            .await,
        Some(0)
    );
    assert_eq!(state.data_vaults.cached_vault_count(), 3);
    assert_eq!(
        state
            .data_sources
            .invalidate_vault_cache(&source, Some("seg"))
            .await,
        Some(1)
    );
    assert_eq!(state.data_vaults.cached_vault_count(), 1);
    assert_eq!(
        state
            .data_sources
            .invalidate_vault_cache(
                &DataSource::Unusable(webknossos_datastore::models::UnusableDataSource::new(
                    source.id().clone(),
                    "missing"
                )),
                None
            )
            .await,
        None
    );
}
