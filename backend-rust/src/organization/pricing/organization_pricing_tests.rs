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
    assert!(unlocked_features(PricingPlan::Power, PricingPlan::Team).is_none());
    assert!(unlocked_features(PricingPlan::Team_Trial, PricingPlan::Team).is_none());
}

const ALL_PLANS: [PricingPlan; 7] = [
    PricingPlan::Personal,
    PricingPlan::Team,
    PricingPlan::Power,
    PricingPlan::Team_Trial,
    PricingPlan::Power_Trial,
    PricingPlan::Open_Source,
    PricingPlan::Enterprise,
];

fn plans_with(is_allowed: impl Fn(PricingPlan) -> bool) -> Vec<PricingPlan> {
    ALL_PLANS
        .into_iter()
        .filter(|plan| is_allowed(*plan))
        .collect()
}

/// Follows the feature matrix of https://home.webknossos.org/pricing
/// (PricingPlanFeaturesTestSuite). Enterprise is Power with unlimited quotas.
#[test]
fn plans_follow_the_pricing_page() {
    use PricingPlan::*;
    for plan in ALL_PLANS {
        assert_eq!(PricingPlan::parse(plan.as_str()), Some(plan));
    }
    assert_eq!(PricingPlan::parse("Custom"), None);
    assert_eq!(
        plans_with(|plan| plan.tier_rank() >= Team.tier_rank()),
        [
            Team,
            Power,
            Team_Trial,
            Power_Trial,
            Open_Source,
            Enterprise
        ]
    );
    assert_eq!(
        plans_with(|plan| plan.tier_rank() >= Power.tier_rank()),
        [Power, Power_Trial, Enterprise]
    );
    assert_eq!(
        plans_with(PricingPlan::allows_jobs),
        [Personal, Team, Power, Team_Trial, Power_Trial, Enterprise]
    );
    assert_eq!(
        plans_with(PricingPlan::has_unlimited_quotas),
        [Open_Source, Enterprise]
    );
    assert_eq!(plans_with(|plan| !plan.is_paid()), [Personal, Open_Source]);
    assert_eq!(Open_Source.label(), "Open Source");
    assert_eq!(Enterprise.ai_addon_label(), "Power AI");
}

#[test]
fn unlocked_features_treat_open_source_like_team_and_enterprise_like_power() {
    use PricingPlan::*;
    assert_eq!(
        unlocked_features(Open_Source, Power),
        unlocked_features(Team, Power)
    );
    assert!(unlocked_features(Open_Source, Team).is_none());
    assert_eq!(
        unlocked_features(Personal, Enterprise).map(|(_, highlights)| highlights),
        unlocked_features(Personal, Power).map(|(_, highlights)| highlights)
    );
    assert_eq!(
        unlocked_features(Team, Enterprise).map(|(label, _)| label),
        Some("Enterprise")
    );
    assert!(unlocked_features(Personal, Open_Source).is_none());
    assert!(unlocked_features(Power, Enterprise).is_none());
}

fn plan_update(
    pricing_plan: Option<PricingPlan>,
    included_users: Change<i32>,
    included_storage: Change<i64>,
) -> PlanUpdate {
    PlanUpdate {
        organization_id: "sample_organization".into(),
        description: None,
        pricing_plan,
        ai_plan: Change::Unchanged,
        paid_until: Change::Unchanged,
        included_users,
        included_storage,
        created: DateTime::UNIX_EPOCH,
    }
}

fn quotas(update: &PlanUpdate) -> (&Change<i32>, &Change<i64>) {
    (&update.included_users, &update.included_storage)
}

/// OrganizationPlanUpdateTestSuite.
#[test]
fn plan_updates_apply_the_quotas_of_the_plan() {
    use PricingPlan::*;
    let limited = || plan_update(None, Change::Set(Some(5)), Change::Set(Some(1000)));
    let unlimited = (&Change::Set(None), &Change::Set(None));
    // Requested limits are overridden on Enterprise and Open Source.
    for plan in [Enterprise, Open_Source] {
        assert_eq!(quotas(&limited().with_quotas_of_plan(plan)), unlimited);
    }
    // Setting Enterprise or Open Source lifts the limits.
    let update = plan_update(Some(Enterprise), Change::Unchanged, Change::Unchanged)
        .with_quotas_of_plan(Team);
    assert_eq!(quotas(&update), unlimited);
    // Unchanged limits stay unchanged if the plan is not set.
    let update =
        plan_update(None, Change::Unchanged, Change::Unchanged).with_quotas_of_plan(Enterprise);
    assert_eq!(quotas(&update), (&Change::Unchanged, &Change::Unchanged));
    // Other plans keep the requested limits.
    let requested = (&Change::Set(Some(5)), &Change::Set(Some(1000)));
    for previous in [Power, Personal] {
        assert_eq!(quotas(&limited().with_quotas_of_plan(previous)), requested);
    }
    let update = plan_update(Some(Team), Change::Set(Some(5)), Change::Set(Some(1000)))
        .with_quotas_of_plan(Open_Source);
    assert_eq!(quotas(&update), requested);
    // Moving from Open Source to Team without requested limits sets Team's quotas.
    let update = plan_update(Some(Team), Change::Unchanged, Change::Unchanged)
        .with_quotas_of_plan(Open_Source);
    assert_eq!(
        quotas(&update),
        (&Change::Set(Some(5)), &Change::Set(Some(1_000_000_000_000)))
    );
    // Moving between limited plans leaves the limits unchanged.
    let update =
        plan_update(Some(Team), Change::Unchanged, Change::Unchanged).with_quotas_of_plan(Personal);
    assert_eq!(quotas(&update), (&Change::Unchanged, &Change::Unchanged));
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
