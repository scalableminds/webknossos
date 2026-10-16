use super::*;

#[test]
fn zoned_dates_match_java_iso_zoned_output() {
    let date = Utc.timestamp_millis_opt(1_791_504_000_123).unwrap();
    assert_eq!(format_zoned(date), "2026-10-09T00:00:00.123Z[UTC]");
    let date = Utc.timestamp_millis_opt(1_791_504_000_120).unwrap();
    assert_eq!(format_zoned(date), "2026-10-09T00:00:00.12Z[UTC]");
    let date = Utc.timestamp_millis_opt(1_791_504_000_000).unwrap();
    assert_eq!(format_zoned(date), "2026-10-09T00:00:00Z[UTC]");
    for value in [
        "2026-10-09T00:00:00.123Z[UTC]",
        "2026-10-09T00:00:00.123Z",
        "2026-10-09T02:00:00.123+02:00[Europe/Berlin]",
    ] {
        assert_eq!(
            parse_zoned(value).unwrap().timestamp_millis(),
            1_791_504_000_123
        );
    }
    assert!(parse_zoned("2026-10-09T00:00:00Z[UTC").is_none());
}

#[test]
fn email_constraint_matches_play_pattern() {
    for valid in ["a@b", "first.last+tag@example.co.uk", "x_y@a-b.c"] {
        assert!(is_valid_email(valid), "{valid}");
    }
    for invalid in [
        "", "a", "@b", "a@", "a@-b.c", "a@b-.c", "a@b..c", "a b@c", "a@b@c",
    ] {
        assert!(!is_valid_email(invalid), "{invalid}");
    }
}

#[test]
fn json_bodies_flatten_like_play_form_utils() {
    let mut data = HashMap::new();
    flatten_json(
        "",
        &serde_json::json!({"email":"a@b","password":{"password1":"x","password2":"y"},"n":3,"b":true,"z":null,"l":["q"]}),
        &mut data,
    );
    assert_eq!(data["password.password1"], "x");
    assert_eq!(data["n"], "3");
    assert_eq!(data["b"], "true");
    assert_eq!(data["l[0]"], "q");
    assert!(!data.contains_key("z"));
}

#[test]
fn configuration_defaults_follow_play_and_validate_input() {
    let url = url::Url::parse("https://wk.example/").unwrap();
    let idle = Duration::from_secs(60);
    let config = config_from_values(&HashMap::new(), &url, false, idle).unwrap();
    assert!(config.signer_secret.is_none());
    assert_eq!(config.public_uri, "https://wk.example");
    assert_eq!(config.cookie_name, "id");
    assert_eq!(config.same_site, CookieSameSite::Lax);
    assert!(config.use_fingerprinting && config.http_only_cookie && !config.secure_cookie);
    assert_eq!(
        config.authenticator_expiry,
        Duration::from_secs(30 * 86_400)
    );
    let values = HashMap::from([
        (
            "WK_COOKIE_SIGNER_SECRET".to_owned(),
            "a-sufficiently-long-key".to_owned(),
        ),
        (
            "WK_EMAIL_VERIFICATION_LINK_EXPIRY_SECONDS".to_owned(),
            "none".to_owned(),
        ),
        ("WK_COOKIE_SAME_SITE".to_owned(), "None".to_owned()),
    ]);
    let config = config_from_values(&values, &url, true, idle).unwrap();
    assert_eq!(config.same_site, CookieSameSite::None);
    assert!(config.email_verification_link_expiry.is_none());
    assert!(!format!("{config:?}").contains("sufficiently"));
    for (key, value) in [
        ("WK_COOKIE_SIGNER_SECRET", "short"),
        ("WK_COOKIE_SAME_SITE", "lax"),
        ("WK_COOKIE_NAME", "a;b"),
        ("WK_COOKIE_MAX_AGE_SECONDS", "0"),
        ("WK_IS_WKORG_INSTANCE", "yes"),
        ("WK_TERMS_OF_SERVICE_VERSION", "x"),
    ] {
        let values = HashMap::from([(key.to_owned(), value.to_owned())]);
        assert!(
            config_from_values(&values, &url, false, idle).is_err(),
            "{key}={value}"
        );
    }
    assert_eq!(duration_text(Duration::from_secs(30 * 86_400)), "30 days");
    assert_eq!(duration_text(Duration::from_secs(3_600)), "1 hour");
}

#[test]
fn signatures_reject_tampering_and_other_versions() {
    let signed = sign("secret", "data");
    assert_eq!(extract("secret", &signed).as_deref(), Some("data"));
    assert!(extract("other", &signed).is_none());
    assert!(extract("secret", &signed.replacen("1-", "2-", 1)).is_none());
    assert!(extract("secret", &format!("{signed}x")).is_none());
    assert!(extract("secret", "data").is_none());
}
