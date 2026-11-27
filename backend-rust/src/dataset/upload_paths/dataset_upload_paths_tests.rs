use super::*;

#[test]
fn dataset_parents_use_prefix_organization_and_infix() {
    let config = UploadToPathsConfig {
        prefixes: vec!["/srv/a".into(), "s3://bucket/b".into()],
        ..Default::default()
    };
    assert_eq!(
        dataset_parent(&config, None, "org").unwrap(),
        "/srv/a/org/.virtual"
    );
    assert_eq!(
        dataset_parent(&config, Some("s3://bucket/b"), "org").unwrap(),
        "s3://bucket/b/org/.virtual"
    );
    assert!(dataset_parent(&config, Some("/elsewhere"), "org").is_err());
    let plain = UploadToPathsConfig {
        prefixes: vec![],
        insert_organization_directory: false,
        infix: None,
    };
    assert_eq!(dataset_parent(&plain, None, "org").unwrap(), "./binaryData");
    let layer = UPath::parse("/p/layer").unwrap();
    assert_eq!(
        attachment_path(
            "Mesh ä",
            LayerAttachmentDataformat::Hdf5,
            LayerAttachmentType::Mesh,
            &layer
        )
        .unwrap()
        .to_string(),
        "/p/layer/meshes/Mesh ae.hdf5"
    );
    let generated = attachment_path(
        "§",
        LayerAttachmentDataformat::Zarr3,
        LayerAttachmentType::Cumsum,
        &layer,
    )
    .unwrap()
    .to_string();
    assert!(generated.starts_with("/p/layer/agglomerates/cumsum__"));
}
