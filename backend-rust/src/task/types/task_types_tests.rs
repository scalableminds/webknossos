use super::*;
fn parameters() -> TaskTypeParameters {
    serde_json::from_value(json!({"summary":"task","description":"","teamId":"000000000000000000000001","tracingType":"skeleton","settings":{"allowedModes":["orthogonal","flight"]}})).unwrap()
}
#[test]
fn summary_limits_match_scala_utf16_length() {
    let mut p = parameters();
    for summary in ["", "a", &"a".repeat(51)] {
        p.summary = summary.to_owned();
        assert!(validate(&p).is_err());
    }
    for summary in ["ab", &"a".repeat(50), "💡"] {
        p.summary = summary.to_owned();
        assert!(validate(&p).is_ok());
    }
}
#[test]
fn settings_defaults_and_enum_validation() {
    let p = parameters();
    assert!(
        p.settings.branch_points_allowed
            && p.settings.soma_clicking_allowed
            && p.settings.volume_interpolation_allowed
    );
    assert!(!p.settings.merger_mode);
    assert_eq!(p.settings.mag_restrictions, MagRestrictions::default());
    assert!(serde_json::from_value::<TracingType>(json!("invalid")).is_err());
    assert!(serde_json::from_value::<TracingMode>(json!("volume")).is_err());
}
#[test]
fn recommended_configuration_requires_object() {
    let mut p = parameters();
    p.recommended_configuration = Some(json!([]));
    assert!(validate(&p).is_err());
    p.recommended_configuration = Some(json!({"zoom":2}));
    assert!(validate(&p).is_ok());
}
