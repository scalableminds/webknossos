use std::{collections::HashMap, time::Duration};

use chrono::Utc;
use serde_json::{Map, Value, json};
use webknossos_common::{datasource::VoxelSize, enums::LengthUnit, geometry::Vec3Double};

use super::{
    AlignmentProjectsConfig,
    alignment_project_dao::AlignmentProjectRow,
    config_from_values,
    service::{AlignmentProject, SectionRange, cost_in_milli_credits, is_valid_voxel_size},
};
use crate::util::id::ObjectId;

fn features(align: i64, render_unaligned: i64) -> Map<String, Value> {
    match json!({
        "alignmentProjectAlignCostInMilliCreditsPerGB": align,
        "alignmentProjectRenderUnalignedCostInMilliCreditsPerGB": render_unaligned,
    }) {
        Value::Object(map) => map,
        _ => unreachable!(),
    }
}

const ALL: SectionRange = SectionRange {
    first: 10,
    last: 19,
};

#[test]
fn cost_is_prorated_by_sections_and_rounded_up() {
    let features = features(1000, 300);
    // 2.5 GB, all sections.
    assert_eq!(
        cost_in_milli_credits(&features, Some(2_500_000_000), ALL, ALL, false),
        2500
    );
    assert_eq!(
        cost_in_milli_credits(&features, Some(2_500_000_000), ALL, ALL, true),
        750
    );
    // Three of ten sections: 0.75 GB.
    let subset = SectionRange {
        first: 12,
        last: 14,
    };
    assert_eq!(
        cost_in_milli_credits(&features, Some(2_500_000_000), ALL, subset, false),
        750
    );
    // Rounded up.
    assert_eq!(
        cost_in_milli_credits(&features, Some(1), ALL, ALL, false),
        1
    );
    // Unknown size and the free default.
    assert_eq!(cost_in_milli_credits(&features, None, ALL, ALL, false), 0);
    assert_eq!(
        cost_in_milli_credits(&Map::new(), Some(i64::MAX), ALL, ALL, false),
        0
    );
    // Saturates like Scala's Double.toInt.
    assert_eq!(
        cost_in_milli_credits(&features, Some(i64::MAX), ALL, ALL, false),
        i32::MAX
    );
}

#[test]
fn voxel_size_components_must_be_positive_and_finite() {
    let size = |x, y, z| VoxelSize {
        factor: Vec3Double::new(x, y, z),
        unit: LengthUnit::Nanometer,
    };
    assert!(is_valid_voxel_size(&size(1.0, 2.5, 0.1)));
    assert!(!is_valid_voxel_size(&size(0.0, 1.0, 1.0)));
    assert!(!is_valid_voxel_size(&size(1.0, -1.0, 1.0)));
    assert!(!is_valid_voxel_size(&size(1.0, 1.0, f64::INFINITY)));
    assert!(!is_valid_voxel_size(&size(f64::NAN, 1.0, 1.0)));
}

fn row() -> AlignmentProjectRow {
    AlignmentProjectRow {
        id: ObjectId::new(),
        organization: "orga".into(),
        owner: ObjectId::new(),
        data_store: "localhost".into(),
        name: "project".into(),
        description: String::new(),
        status: "READY".into(),
        invalid_reason: None,
        voxel_size_factor: vec![1.0, 2.0, 3.0],
        voxel_size_unit: "micrometer".into(),
        csv_path: Some("tiles.csv".into()),
        file_count: Some(3),
        total_size_in_bytes: Some(100),
        first_section: Some(1),
        last_section: Some(4),
        is_input_data_deleted: false,
        csv_replaced: None,
        created: Utc::now(),
    }
}

#[test]
fn parse_reads_voxel_size_and_section_range() {
    let project = AlignmentProject::parse(row()).unwrap();
    assert_eq!(project.voxel_size.factor, Vec3Double::new(1.0, 2.0, 3.0));
    assert_eq!(project.voxel_size.unit, LengthUnit::Micrometer);
    assert_eq!(
        project.section_range,
        Some(SectionRange { first: 1, last: 4 })
    );
    let unfinished = AlignmentProject::parse(AlignmentProjectRow {
        last_section: None,
        ..row()
    })
    .unwrap();
    assert_eq!(unfinished.section_range, None);
    for invalid in [
        AlignmentProjectRow {
            voxel_size_factor: vec![1.0, 2.0],
            ..row()
        },
        AlignmentProjectRow {
            voxel_size_unit: "lightyear".into(),
            ..row()
        },
        AlignmentProjectRow {
            status: "DONE".into(),
            ..row()
        },
    ] {
        assert!(AlignmentProject::parse(invalid).is_err());
    }
}

#[test]
fn config_defaults_and_overrides() {
    let defaults = config_from_values(&HashMap::new()).unwrap();
    assert_eq!(defaults, AlignmentProjectsConfig::default());
    assert_eq!(
        defaults.input_data_retention,
        Duration::from_secs(90 * 86_400)
    );
    assert_eq!(
        defaults.input_data_cleanup.interval,
        Duration::from_secs(6 * 3_600)
    );
    assert!(defaults.input_data_cleanup.enabled);
    let values: HashMap<String, String> = [
        ("WK_ALIGNMENT_PROJECTS_INPUT_DATA_RETENTION_SECONDS", "3600"),
        (
            "WK_ALIGNMENT_PROJECTS_INPUT_DATA_CLEANUP_INTERVAL_SECONDS",
            "60",
        ),
        ("WK_ALIGNMENT_PROJECTS_INPUT_DATA_CLEANUP_ENABLED", "false"),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value.to_owned()))
    .collect();
    let config = config_from_values(&values).unwrap();
    assert_eq!(config.input_data_retention, Duration::from_secs(3600));
    assert_eq!(config.input_data_cleanup.interval, Duration::from_secs(60));
    assert!(!config.input_data_cleanup.enabled);
    let invalid: HashMap<String, String> = [(
        "WK_ALIGNMENT_PROJECTS_INPUT_DATA_RETENTION_SECONDS".to_owned(),
        "0".to_owned(),
    )]
    .into_iter()
    .collect();
    assert!(config_from_values(&invalid).is_err());
}
