use super::*;

#[test]
fn bounding_box_literals_follow_the_java_pattern() {
    assert_eq!(
        parse_bounding_box("0,0,0,10,20,30"),
        Some([0, 0, 0, 10, 20, 30])
    );
    assert_eq!(
        parse_bounding_box(" -1, -2,-3 , 4, 5,6 "),
        Some([-1, -2, -3, 4, 5, 6])
    );
    assert_eq!(
        parse_bounding_box("007,0,0,1,1,1"),
        Some([7, 0, 0, 1, 1, 1])
    );
    for invalid in [
        "",
        "1,2,3,4,5",
        "1 ,2,3,4,5,6",
        "1,2,3,-4,5,6",
        "1,2,3,4,5,6,7",
        "+1,2,3,4,5,6",
        "1,2,3,4,5,99999999999",
        "a,2,3,4,5,6",
    ] {
        assert_eq!(parse_bounding_box(invalid), None, "{invalid}");
    }
}

#[test]
fn job_costs() {
    let features = crate::system::application_info::default_features();
    assert_eq!(
        job_cost_in_milli_credits(&features, "infer_neurons", 1_000_000_000),
        Ok(1000)
    );
    assert_eq!(
        job_cost_in_milli_credits(&features, "align_sections", 1),
        Ok(1)
    );
    assert_eq!(
        job_cost_in_milli_credits(&features, "align_sections", 0),
        Ok(0)
    );
    assert_eq!(
        job_cost_in_milli_credits(&features, "train_neuron_model", 1 << 40),
        Ok(0)
    );
    assert_eq!(
        job_cost_in_milli_credits(&features, "export_tiff", 1),
        Err("Unsupported job command export_tiff".into())
    );
    assert_eq!(
        job_cost_in_milli_credits(&features, "infer_neurons", i64::MAX),
        Ok(i32::MAX)
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
