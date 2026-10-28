use super::*;

fn model(path: Option<&str>, organization: Option<&str>, shared: &[&str]) -> AiModel {
    AiModel {
        id: ObjectId::parse("576500000000000000000001").unwrap(),
        organization: organization.map(str::to_owned),
        data_store: "store".into(),
        user_id: None,
        training_job: None,
        path: path.map(str::to_owned),
        upload_to_path_is_pending: false,
        name: "model".into(),
        comment: None,
        category: None,
        created: Utc::now(),
        is_super_user_only: false,
        is_pretrained: false,
        shared_organizations: shared.iter().map(|s| (*s).to_owned()).collect(),
    }
}

#[test]
fn best_matching_mag_compares_x_on_a_log_scale_and_keeps_the_first_minimum() {
    let mags = [[1, 1, 1], [2, 2, 1], [4, 4, 2], [4, 4, 1], [8, 8, 4]];
    assert_eq!(
        find_best_matching_mag([4000.0, 1.0, 1.0], [1000.0, 9.0, 9.0], &mags),
        Some([4, 4, 2])
    );
    // 11 nm is closer to 8 than to 16 on a log scale (ratio 1.375 vs 1.45).
    assert_eq!(
        find_best_matching_mag([11.0, 0.0, 0.0], [4.0, 4.0, 4.0], &mags),
        Some([2, 2, 1])
    );
    assert_eq!(
        find_best_matching_mag([7.96, 7.96, 31.2], [1000.0, 1000.0, 1000.0], &mags),
        Some([1, 1, 1])
    );
    assert_eq!(find_best_matching_mag([1.0; 3], [1.0; 3], &[]), None);
}

#[test]
fn parse_normalizes_path_and_appends_owner() {
    let parsed = model(Some("s3://bucket/a/../models"), Some("org"), &["a"])
        .parse()
        .unwrap();
    assert_eq!(parsed.path.as_deref(), Some("s3://bucket/models"));
    assert_eq!(parsed.shared_organizations, ["a", "org"]);
    let parsed = model(None, Some("org"), &["org", "z"]).parse().unwrap();
    assert_eq!(parsed.shared_organizations, ["org", "z"]);
    let parsed = model(None, None, &[]).parse().unwrap();
    assert!(parsed.shared_organizations.is_empty());
    assert!(model(Some("a|zip|zip"), None, &[]).parse().is_err());
}
