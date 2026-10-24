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

#[test]
fn inference_result_links_follow_the_return_value() {
    const COMMANDS: [&str; 7] = [
        "infer_nuclei",
        "infer_neurons",
        "materialize_volume_annotation",
        "infer_with_model",
        "infer_mitochondria",
        "align_sections",
        "infer_instances",
    ];
    let link = |command: &str, args: &serde_json::Value, return_value: Option<&str>| {
        result_link(command, "SUCCESS", args, return_value, "j", "org")
    };
    for command in COMMANDS {
        let plain = json!({});
        // Annotation path or url: used unchanged.
        assert_eq!(
            link(command, &plain, Some("/annotations/abc")).as_deref(),
            Some("/annotations/abc")
        );
        assert_eq!(
            link(command, &plain, Some("https://wk.example/annotations/abc")).as_deref(),
            Some("https://wk.example/annotations/abc")
        );
        assert_eq!(
            link(command, &plain, Some("http://wk.example/annotations/abc")).as_deref(),
            Some("http://wk.example/annotations/abc")
        );
        // Legacy dataset id, directory name or name.
        assert_eq!(
            link(command, &plain, Some("0123456789ABCDEF01234567")).as_deref(),
            Some("/datasets/0123456789abcdef01234567/view")
        );
        assert_eq!(
            link(command, &plain, Some("my_dir")).as_deref(),
            Some("/datasets/org/my_dir/view")
        );
        assert_eq!(link(command, &plain, None), None);
        assert_eq!(
            result_link(
                command,
                "FAILURE",
                &plain,
                Some("/annotations/abc"),
                "j",
                "org"
            ),
            None
        );
    }
    // Evaluation flags no longer influence the link.
    for flag in ["do_evaluation", "do_split_merger_evaluation"] {
        let args = json!({ flag: true });
        assert_eq!(
            link("infer_neurons", &args, Some("/annotations/abc")).as_deref(),
            Some("/annotations/abc")
        );
        assert_eq!(
            link("infer_neurons", &args, Some("0123456789abcdef01234567")).as_deref(),
            Some("/datasets/0123456789abcdef01234567/view")
        );
        assert_eq!(
            link("infer_neurons", &args, Some("my_dir")).as_deref(),
            Some("/datasets/org/my_dir/view")
        );
    }
}
