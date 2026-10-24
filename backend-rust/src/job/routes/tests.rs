use super::*;

fn bbox(width: i32, height: i32, depth: i32) -> BoundingBox {
    BoundingBox::new(
        webknossos_common::geometry::Vec3Int::new(0, 0, 0),
        width,
        height,
        depth,
    )
}

#[test]
fn job_costs() {
    let features = crate::system::application_info::default_features();
    assert_eq!(
        job_cost_in_milli_credits(&features, "infer_neurons", &bbox(1000, 1000, 1000)),
        Ok(1000)
    );
    assert_eq!(
        job_cost_in_milli_credits(&features, "align_sections", &bbox(1, 1, 1)),
        Ok(1)
    );
    assert_eq!(
        job_cost_in_milli_credits(&features, "align_sections", &bbox(0, 1, 1)),
        Ok(0)
    );
    assert_eq!(
        job_cost_in_milli_credits(&features, "train_neuron_model", &bbox(1 << 20, 1 << 20, 1)),
        Ok(0)
    );
    assert_eq!(
        job_cost_in_milli_credits(&features, "export_tiff", &bbox(1, 1, 1)),
        Err("Unsupported job command export_tiff".into())
    );
}

#[test]
fn job_costs_of_huge_bounding_boxes_saturate_instead_of_overflowing() {
    let features = crate::system::application_info::default_features();
    assert_eq!(
        job_cost_in_milli_credits(
            &features,
            "infer_neurons",
            &bbox(i32::MAX, i32::MAX, i32::MAX)
        ),
        Ok(i32::MAX)
    );
    // 2^66 voxels: a wrapping i64 volume would be 0.
    assert_eq!(
        job_cost_in_milli_credits(&features, "infer_neurons", &bbox(1 << 22, 1 << 22, 1 << 22)),
        Ok(i32::MAX)
    );
}

#[test]
fn job_costs_of_empty_bounding_boxes_are_zero() {
    let features = crate::system::application_info::default_features();
    // Two negative extents would have a positive volume.
    assert_eq!(
        job_cost_in_milli_credits(&features, "infer_neurons", &bbox(-1000, -1000, 1000)),
        Ok(0)
    );
}

#[test]
fn result_links() {
    let args = json!({"dataset_name": "ds", "dataset_id": "0123456789abcdef01234567"});
    assert_eq!(
        result_link("convert_to_wkw", "SUCCESS", &args, None, "j", "org").as_deref(),
        Some("/datasets/ds-0123456789abcdef01234567/view")
    );
    assert_eq!(
        result_link("convert_to_wkw", "FAILURE", &args, None, "j", "org"),
        None
    );
    assert_eq!(
        result_link(
            "compute_mesh_file",
            "SUCCESS",
            &json!({"dataset_name": "ds"}),
            None,
            "j",
            "org"
        )
        .as_deref(),
        Some("/datasets/org/ds/view")
    );
    assert_eq!(
        result_link(
            "infer_nuclei",
            "SUCCESS",
            &json!({}),
            Some("name"),
            "j",
            "org"
        )
        .as_deref(),
        Some("/datasets/org/name/view")
    );
    assert_eq!(
        result_link(
            "infer_neurons",
            "SUCCESS",
            &json!({"do_evaluation": true}),
            Some("http://link"),
            "j",
            "org"
        )
        .as_deref(),
        Some("http://link")
    );
    assert_eq!(
        result_link("export_tiff", "SUCCESS", &json!({}), None, "j1", "org").as_deref(),
        Some("/api/jobs/j1/export")
    );
    assert_eq!(
        result_link(
            "find_largest_segment_id",
            "SUCCESS",
            &json!({}),
            Some("5"),
            "j",
            "org"
        ),
        None
    );
}
