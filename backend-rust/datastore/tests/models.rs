//! DS1a model parity tests: `datasource-properties.json` reads (legacy and current forms), Play
//! writes, the `DataSourceToDiskWriter` output, validation errors and the canonical UPath.
//!
//! The `*.disk.json` goldens are derived by hand from the Scala sources (Play `Json.prettyPrint`
//! of `DataSourceToDiskWriter`'s JSON); they were not produced by a JVM run.

use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use serde_json::{Value, json};
use webknossos_datastore::models::{
    DataLayerAttachments, DataSource, LayerAttachment, LayerAttachmentDataformat,
    LayerAttachmentType, LengthUnit, UPath, UsableDataSource, Vec3Double, Vec3Int, VoxelSize,
    disk_writer::{self, DiskWriteError},
};

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/models")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn usable(json: &str) -> UsableDataSource {
    let value: Value = serde_json::from_str(json).unwrap();
    match DataSource::from_json(&value).unwrap() {
        DataSource::Usable(ds) => ds,
        DataSource::Unusable(ds) => panic!("unexpectedly unusable: {}", ds.status),
    }
}

#[test]
fn legacy_properties_are_upgraded_like_scala() {
    let ds = usable(&fixture("legacy_wkw.input.json"));
    assert_eq!(ds.scale.unit, LengthUnit::Nanometer);
    let color = ds.get_data_layer("color").unwrap();
    assert_eq!(
        color.resolutions(),
        vec![Vec3Int::full(1), Vec3Int::new(2, 2, 1)]
    );
    assert_eq!(
        color.default_view_configuration, None,
        "empty view config is dropped"
    );
    let segmentation = ds.get_data_layer("segmentation").unwrap();
    assert_eq!(segmentation.largest_segment_id(), Some(2_504_697));
    assert_eq!(
        segmentation.mappings().unwrap(),
        ["agglomerate_view_5", "agglomerate_view_10"]
    );
    assert_eq!(segmentation.coordinate_transformations, None);
    assert_eq!(
        ds.to_properties_file_content(),
        fixture("legacy_wkw.disk.json")
    );
    assert!(ds.validation_errors().is_empty());
}

#[test]
fn current_properties_round_trip_through_the_disk_writer_format() {
    let ds = usable(&fixture("zarr3_full.input.json"));
    let expected = fixture("zarr3_full.disk.json");
    assert_eq!(ds.to_properties_file_content(), expected);
    // Reading the written file again is a fixed point.
    assert_eq!(usable(&expected).to_properties_file_content(), expected);
    assert_eq!(ds.scale.unit, LengthUnit::Micrometer);
    let layer = &ds.data_layers[0];
    assert_eq!(layer.largest_segment_id(), Some(u64::MAX));
    assert_eq!(
        layer.mags[2].path.as_ref().unwrap(),
        &UPath::parse("./segmentation.zip|zip:4-4-2").unwrap()
    );
    assert!(ds.validation_errors().is_empty());
}

#[test]
fn play_writes_keep_resolutions_and_the_bigint_envelope() {
    let ds = usable(&fixture("zarr3_full.input.json"));
    let written = serde_json::to_value(DataSource::Usable(ds.clone())).unwrap();
    let layer = &written["dataLayers"][0];
    assert_eq!(
        layer["resolutions"],
        json!([[1, 1, 1], [2, 2, 2], [4, 4, 2]])
    );
    assert_eq!(layer["numChannels"], json!(1));
    assert_eq!(
        layer["largestSegmentId"],
        json!({"customJsonEncoding": "bigint", "value": "18446744073709551615"})
    );
    assert_eq!(
        layer["defaultViewConfiguration"],
        json!({"alpha": 50, "nested": {"resolutions": [1], "x": 1.5}})
    );
    // Play writes order: category first, resolutions + numChannels last.
    let text = serde_json::to_string(&ds.data_layers[0]).unwrap();
    assert!(text.starts_with(r#"{"category":"segmentation","name":"segmentation""#));
    assert!(text.ends_with(r#""resolutions":[[1,1,1],[2,2,2],[4,4,2]],"numChannels":1}"#));
    let small_id = usable(&fixture("legacy_wkw.input.json"));
    assert_eq!(
        serde_json::to_value(&small_id).unwrap()["dataLayers"][1]["largestSegmentId"],
        json!({"customJsonEncoding": "bigint", "value": "2504697"})
    );
}

#[test]
fn unusable_data_sources_are_read_first() {
    let value = json!({
        "id": {"name": "ds", "team": "org"},
        "status": "Not imported yet.",
        "dataLayers": [],
        "scale": [1, 1, 1],
        "existingDataSourceProperties": {"a": 1.0}
    });
    let DataSource::Unusable(ds) = DataSource::from_json(&value).unwrap() else {
        panic!("expected unusable");
    };
    assert_eq!(ds.status, "Not imported yet.");
    assert_eq!(
        serde_json::to_value(DataSource::Unusable(ds)).unwrap(),
        json!({
            "id": {"name": "ds", "team": "org"},
            "dataLayers": [],
            "status": "Not imported yet.",
            "scale": {"factor": [1, 1, 1], "unit": "nanometer"},
            "existingDataSourceProperties": {"a": 1}
        })
    );
}

#[test]
fn read_errors_follow_play() {
    // Derived format: accumulated errors with `obj.` paths.
    let error =
        UsableDataSource::from_json(&json!({"id": {"name": "x", "team": "y"}})).unwrap_err();
    assert_eq!(
        error.to_play_json(),
        json!({
            "obj.dataLayers": [{"msg": ["error.path.missing"], "args": []}],
            "obj.scale": [{"msg": ["error.path.missing"], "args": []}]
        })
    );
    // Hand-written layer reads short-circuit; missing mags and wkwResolutions.
    let layer = json!({"category": "color", "name": "c"});
    let error = DataSource::from_json(&json!({
        "id": {"name": "x", "team": "y"}, "dataLayers": [layer], "scale": [1, 1, 1]
    }))
    .unwrap_err();
    assert_eq!(
        error.to_play_json(),
        json!({"obj.dataLayers[0]": [{"msg": ["Either 'mags' or 'wkwResolutions' must be provided"], "args": []}]})
    );
    // An invalid mag path is swallowed by the `mags` → `wkwResolutions` fallback, like in Scala.
    let layer = |mags: Value, attachments: Value| {
        json!({
            "id": {"name": "x", "team": "y"},
            "dataLayers": [{"category": "color", "name": "c", "dataFormat": "zarr",
                "boundingBox": {"topLeft": [0, 0, 0], "width": 1, "height": 1, "depth": 1},
                "elementClass": "uint8", "mags": mags, "attachments": attachments}],
            "scale": [1, 1, 1]
        })
    };
    let error = DataSource::from_json(&layer(
        json!([{"mag": 1, "path": "a.zip|zip:b.zip|zip"}]),
        json!({}),
    ))
    .unwrap_err();
    assert!(
        error
            .to_play_json()
            .to_string()
            .contains("Either 'mags' or 'wkwResolutions' must be provided")
    );
    // An invalid attachment path carries the Scala `Failure` text.
    let error = DataSource::from_json(&layer(
        json!([{"mag": 1}]),
        json!({"meshes": [{"name": "m", "path": "a.zip|zip:b.zip|zip", "dataFormat": "hdf5"}]}),
    ))
    .unwrap_err();
    let rendered = error.to_play_json().to_string();
    assert!(
        rendered.contains("Invalid UPath: Failure(Invalid zip path “a.zip|zip:b.zip|zip”: Nested zip paths are not supported.,Full(java.lang.Exception: "),
        "{rendered}"
    );
}

#[test]
fn validation_errors_match_scala_messages() {
    let mut ds = usable(&fixture("legacy_wkw.input.json"));
    ds.scale.factor = Vec3Double::new(1.0, 0.0, 1.0);
    ds.data_layers[1].name = "color".to_owned();
    let duplicate = ds.data_layers[0].mags[0].clone();
    ds.data_layers[0].mags.push(duplicate);
    ds.data_layers[1].element_class = webknossos_datastore::models::ElementClass::Uint8;
    assert_eq!(
        ds.validation_errors(),
        vec![
            "Voxel size (scale) is negative in at least one dimension.",
            "There are duplicate mags in a layer.",
            "Largest segment id exceeds range (must be nonnegative and within the element class's value range).",
            "Layer names must be unique. At least two layers have the same name.",
        ]
    );
    let mut unsorted = usable(&fixture("legacy_wkw.input.json"));
    unsorted.data_layers[0].mags[1].mag = Vec3Int::new(4, 1, 1);
    let mut extra = unsorted.data_layers[0].mags[0].clone();
    extra.mag = Vec3Int::full(2);
    unsorted.data_layers[0].mags.push(extra);
    unsorted.data_layers[0].name = ".hidden/x".to_owned();
    assert_eq!(
        unsorted.validation_errors(),
        vec![
            "Mags do not monotonically increase in all dimensions.",
            "Layer names must not contain forward slash.",
            "Layer names must not start with dot.",
        ]
    );
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wk-ds-models-{name}-{}-{:?}",
        std::process::id(),
        std::time::SystemTime::now()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn disk_writer_relativizes_backs_up_and_validates() {
    let dir = temp_dir("writer");
    let mut ds = usable(&fixture("legacy_wkw.input.json"));
    let absolute_mag = UPath::from_local_path(&dir.join("color/2-2-1"));
    ds.data_layers[0].mags[1].path = Some(absolute_mag);
    let attachment = LayerAttachment {
        name: "m".to_owned(),
        path: UPath::from_local_path(&dir.join("segmentation/meshes/m.hdf5")),
        data_format: LayerAttachmentDataformat::Hdf5,
        credential_id: None,
    };
    ds.data_layers[1].attachments =
        Some(DataLayerAttachments::default().with_added(attachment, LayerAttachmentType::Mesh));
    std::fs::write(dir.join("datasource-properties.json"), "old\r\ncontent\n").unwrap();

    let now = UNIX_EPOCH + Duration::from_millis(1_700_000_000_120);
    disk_writer::update_data_source_on_disk_at(&dir, &ds, now).unwrap();

    let written: Value = serde_json::from_str(
        &std::fs::read_to_string(dir.join("datasource-properties.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        written["dataLayers"][0]["mags"][1]["path"],
        json!("./color/2-2-1")
    );
    assert_eq!(
        written["dataLayers"][1]["attachments"]["meshes"][0]["path"],
        json!("./segmentation/meshes/m.hdf5")
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("datasource-properties-backups.log")).unwrap(),
        "Contents of datasource-properties.json were changed by WEBKNOSSOS at 2023-11-14T22:13:20.120Z. Old content: \n\nold\ncontent\n\n"
    );

    ds.data_layers.clear();
    let error = disk_writer::update_data_source_on_disk_at(&dir, &ds, now).unwrap_err();
    assert_eq!(
        error,
        DiskWriteError::Invalid(json!([{"error": "No layers."}]))
    );
    assert_eq!(
        error.messages_body(),
        Some(json!({"messages": [{"error": "No layers."}]}))
    );

    let missing = dir.join("does-not-exist");
    let error = disk_writer::update_data_source_on_disk_at(
        &missing,
        &usable(&fixture("legacy_wkw.input.json")),
        now,
    )
    .unwrap_err();
    let DiskWriteError::Failure(failure) = error else {
        panic!("expected a failure");
    };
    assert_eq!(failure.message, disk_writer::UPDATE_FILE_FAILED);
    assert!(failure.chain[0].starts_with("Could not back up old contents: "));
    // Test-owned temporary directory.
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn additional_axes_helpers() {
    use webknossos_datastore::models::{AdditionalAxis, AdditionalCoordinate};
    let axis = |name: &str, lower: i32, upper: i32, index: i32| AdditionalAxis {
        name: name.to_owned(),
        bounds: vec![lower, upper],
        index,
    };
    let a = [axis("t", 0, 5, 0), axis("c", 0, 2, 1)];
    let b = [axis("t", 3, 9, 7)];
    let merged = AdditionalAxis::merge([Some(&a[..]), Some(&b[..]), None]).unwrap();
    assert_eq!(merged, vec![axis("t", 0, 9, 0), axis("c", 0, 2, 1)]);
    assert_eq!(
        AdditionalAxis::merge_and_assert_same([Some(&a[..]), Some(&b[..])]),
        Err("Additional coordinates differ in merged units.")
    );
    let space = AdditionalAxis::coordinate_space(Some(&[axis("t", 0, 2, 0), axis("c", 5, 7, 1)]));
    let names: Vec<Vec<(String, i32)>> = space
        .into_iter()
        .map(|c| c.into_iter().map(|c| (c.name, c.value)).collect())
        .collect();
    assert_eq!(names.len(), 4);
    assert_eq!(names[1], vec![("t".to_owned(), 0), ("c".to_owned(), 6)]);
    let coordinate = AdditionalCoordinate {
        name: "t".to_owned(),
        value: 3,
    };
    assert_eq!(
        axis("t", 0, 5, 0).intersect_with_additional_coordinates(&[coordinate]),
        axis("t", 3, 4, 0)
    );
    assert_eq!(
        axis("c", 2, 5, 1).intersect_with_additional_coordinates(&[]),
        axis("c", 2, 3, 1)
    );
}

#[test]
fn attachment_and_voxel_size_helpers() {
    let ds = usable(&fixture("zarr3_full.input.json"));
    let attachments = ds.data_layers[0].attachments.clone().unwrap();
    let id = &ds.id;
    let mesh = &attachments.meshes[0];
    assert_eq!(
        mesh.resolved_path(Path::new("/data"), id).to_string(),
        "/data/sample_organization/full/meshes/meshfile.hdf5"
    );
    let other = DataLayerAttachments {
        meshes: vec![mesh.clone()],
        ..Default::default()
    };
    let kept = attachments.drop_missing(&other).unwrap();
    assert_eq!(kept.all_attachments().len(), 1);
    assert!(
        attachments
            .drop_missing(&DataLayerAttachments::default())
            .is_none()
    );
    let renamed = attachments.rename_by_map(
        &[(
            (LayerAttachmentType::Cumsum, "cumsum".to_owned()),
            "c2".to_owned(),
        )]
        .into(),
    );
    assert_eq!(renamed.cumsum.unwrap().name, "c2");
    let base = UPath::parse("/data/org/ds").unwrap();
    assert_eq!(
        attachments.resolved_in(&base).meshes[0].path.to_string(),
        "/data/org/ds/meshes/meshfile.hdf5"
    );

    let a = VoxelSize::from_factor_and_unit_with_default(Vec3Double::new(1.0, 2.0, 4.0), None);
    let b = VoxelSize {
        factor: Vec3Double::new(1.0, 1.0, 1.0),
        unit: LengthUnit::Micrometer,
    };
    assert_eq!(a.ratio(&b), Vec3Double::new(0.001, 0.002, 0.004));
    assert_eq!(
        a.scaled(Vec3Double::new(2.0, 2.0, 2.0)).factor,
        Vec3Double::new(2.0, 4.0, 8.0)
    );
}
