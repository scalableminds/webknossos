use super::*;

#[test]
fn unlocked_features_fold_skipped_tiers() {
    assert_eq!(
        unlocked_features(PricingPlan::Personal, PricingPlan::Power)
            .map(|(label, h)| (label, h.len())),
        Some(("Power", 7))
    );
    assert_eq!(
        unlocked_features(PricingPlan::Team, PricingPlan::Power_Trial)
            .map(|(label, h)| (label, h.len())),
        Some(("Power (Trial)", 2))
    );
    assert!(unlocked_features(PricingPlan::Personal, PricingPlan::Custom).is_none());
    assert!(unlocked_features(PricingPlan::Power, PricingPlan::Team).is_none());
    assert!(unlocked_features(PricingPlan::Team_Trial, PricingPlan::Team).is_none());
}

#[test]
fn byte_counts_and_instants_follow_scala_reads() {
    assert_eq!(parse_byte_count(&json!("50GB")), Some(50_000_000_000));
    assert_eq!(parse_byte_count(&json!("1 000_000")), Some(1_000_000));
    assert_eq!(parse_byte_count(&json!("12B")), Some(12));
    assert_eq!(parse_byte_count(&json!(12.7)), Some(12));
    assert_eq!(parse_byte_count(&json!("GB")), None);
    assert_eq!(parse_byte_count(&json!("1.5TB")), None);
    assert_eq!(parse_byte_count(&json!(true)), None);
    assert_eq!(
        parse_instant(&json!("2026-01-01T00:00:00Z")).map(|d| d.timestamp_millis()),
        Some(1_767_225_600_000)
    );
    assert_eq!(
        parse_instant(&json!("1000")).map(|d| d.timestamp_millis()),
        Some(1000)
    );
    assert_eq!(parse_instant(&json!(1.5)), None);
}

#[test]
fn plan_update_distinguishes_absent_and_null() {
    let update = parse_plan_update(&json!({
        "organizationId": "org",
        "pricingPlan": null,
        "aiPlan": null,
        "includedUsers": 5,
    }))
    .unwrap();
    assert_eq!(update.pricing_plan, None);
    assert_eq!(update.ai_plan, Change::Set(None));
    assert_eq!(update.included_users, Change::Set(Some(5)));
    assert_eq!(update.paid_until, Change::Unchanged);
    assert!(parse_plan_update(&json!({"pricingPlan": "Team"})).is_err());
    assert!(parse_plan_update(&json!({"organizationId": "o", "aiPlan": "x"})).is_err());
}

#[test]
fn upgrade_request_descriptions() {
    let request = UpgradeRequest {
        plan: Some(PricingPlan::Power),
        users: Some(1),
        storage_tb: Some(2),
        ai_addon: Some(true),
        credits: Some(3),
        extend_years: Some(1),
        note: None,
    };
    assert_eq!(
        request.describe(PricingPlan::Team_Trial),
        vec![
            "Upgrade from Team (Trial) to Power plan",
            "1 additional user",
            "2 TB additional storage",
            "AI Add-on (Power AI)",
            "3 WEBKNOSSOS credits",
            "Plan extension by 1 year",
        ]
    );
}
