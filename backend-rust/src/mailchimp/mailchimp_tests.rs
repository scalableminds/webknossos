use super::*;

fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).into(), (*value).into()))
        .collect()
}

fn config() -> MailchimpConfig {
    MailchimpConfig {
        host: Some("https://us1.api.mailchimp.com/3.0".into()),
        list_id: "list123".into(),
        user: "anystring".into(),
        password: "secret-api-key".into(),
        ..MailchimpConfig::default()
    }
}

fn contact() -> MemberContact {
    MemberContact {
        email: "Ada@Example.org".into(),
        first_name: "Ada".into(),
        last_name: "Lovelace".into(),
    }
}

fn body_json(request: &reqwest::Request) -> Value {
    serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap()
}

fn basic_auth(request: &reqwest::Request) -> &str {
    request
        .headers()
        .get(reqwest::header::AUTHORIZATION)
        .unwrap()
        .to_str()
        .unwrap()
}

#[test]
fn tags_format_as_scala() {
    // MailchimpTag.format: camel case to snake case.
    let formatted: Vec<_> = MailchimpTag::ALL.iter().map(|tag| tag.as_str()).collect();
    assert_eq!(
        formatted,
        [
            "registered_as_user",
            "registered_as_admin",
            "has_annotated",
            "has_invited_team",
            "has_uploaded_own_dataset",
            "has_viewed_published_dataset",
            "was_active_in_weeks_two_or_three",
            "was_inactive_in_weeks_two_and_three",
        ]
    );
    for tag in MailchimpTag::ALL {
        assert_eq!(MailchimpTag::parse(tag.as_str()), Some(tag));
    }
    assert_eq!(MailchimpTag::parse("some_other_tag"), None);
}

#[test]
fn subscriber_hash_is_uppercase_md5_of_lowercased_email() {
    // md5("ada@example.org"), cross-checked with `printf ada@example.org | md5`.
    assert_eq!(
        subscriber_hash("Ada@Example.org"),
        "5BFCF2D8E394674550332640D72DB509".to_owned()
    );
    assert_eq!(
        subscriber_hash("ada@example.org"),
        subscriber_hash("ADA@EXAMPLE.ORG")
    );
}

#[test]
fn bodies_match_play() {
    assert_eq!(
        member_body(&contact()),
        json!({
            "email_address": "Ada@Example.org",
            "status": "subscribed",
            "merge_fields": {"FNAME": "Ada", "LNAME": "Lovelace"},
        })
    );
    assert_eq!(
        tag_body(MailchimpTag::HasAnnotated),
        json!({"tags": [{"name": "has_annotated", "status": "active"}]})
    );
}

#[test]
fn requests_use_member_urls_and_basic_auth() {
    let client = MailchimpClient::new(&config());
    let hash = subscriber_hash("ada@example.org");
    // base64("anystring:secret-api-key")
    let auth = "Basic YW55c3RyaW5nOnNlY3JldC1hcGkta2V5";

    let put = client
        .put_member_request(&contact())
        .unwrap()
        .build()
        .unwrap();
    assert_eq!(put.method(), reqwest::Method::PUT);
    assert_eq!(
        put.url().as_str(),
        format!("https://us1.api.mailchimp.com/3.0/lists/list123/members/{hash}")
    );
    assert_eq!(basic_auth(&put), auth);
    assert_eq!(body_json(&put), member_body(&contact()));

    let post = client
        .post_tag_request("Ada@Example.org", MailchimpTag::RegisteredAsUser)
        .unwrap()
        .build()
        .unwrap();
    assert_eq!(post.method(), reqwest::Method::POST);
    assert_eq!(
        post.url().as_str(),
        format!("https://us1.api.mailchimp.com/3.0/lists/list123/members/{hash}/tags")
    );
    assert_eq!(basic_auth(&post), auth);
    assert_eq!(body_json(&post), tag_body(MailchimpTag::RegisteredAsUser));

    let get = client
        .get_tags_request("ada@example.org")
        .unwrap()
        .build()
        .unwrap();
    assert_eq!(get.method(), reqwest::Method::GET);
    assert_eq!(get.url().as_str(), post.url().as_str());
    assert_eq!(basic_auth(&get), auth);
    assert!(get.body().is_none());
}

#[test]
fn disabled_without_host() {
    let client = MailchimpClient::new(&MailchimpConfig::default());
    assert!(!client.is_enabled());
    assert!(client.put_member_request(&contact()).is_none());
    assert!(
        client
            .post_tag_request("a@b.c", MailchimpTag::HasAnnotated)
            .is_none()
    );
    assert!(client.get_tags_request("a@b.c").is_none());
    assert!(
        client
            .register_user(&ObjectId::new(), contact(), MailchimpTag::RegisteredAsUser)
            .is_none()
    );
}

#[tokio::test]
async fn disabled_client_calls_are_no_ops() {
    let client = MailchimpClient::default();
    assert!(client.tags_for_email("a@b.c").await.unwrap().is_empty());
    client
        .tag_email("a@b.c", MailchimpTag::HasAnnotated)
        .await
        .unwrap();
    client.put_member(&contact()).await.unwrap();
}

#[test]
fn secrets_stay_out_of_debug() {
    let printed = format!("{:?} {:?}", config(), MailchimpClient::new(&config()));
    assert!(!printed.contains("secret-api-key"), "{printed}");
    assert!(printed.contains("password_configured: true"), "{printed}");
}

#[test]
fn config_defaults_and_overrides() {
    let config = config_from_values(&HashMap::new()).unwrap();
    assert_eq!(config, MailchimpConfig::default());
    assert_eq!(config.host, None);
    assert!(config.ticker.enabled);
    assert_eq!(config.ticker.interval, Duration::from_secs(3600));
    assert_eq!(config.ticker.initial_delay, Duration::from_secs(3600));

    let config = config_from_values(&values(&[
        ("WK_MAILCHIMP_HOST", " https://us1.api.mailchimp.com/3.0/ "),
        ("WK_MAILCHIMP_LIST_ID", "list123"),
        ("WK_MAILCHIMP_USER", "user"),
        ("WK_MAILCHIMP_PASSWORD", "pw"),
        ("WK_MAILCHIMP_TICKER_ENABLED", "false"),
        // Removed variables: Play hard-codes the timings, so they are ignored.
        ("WK_MAILCHIMP_TICKER_INTERVAL_SECONDS", "60"),
        ("WK_MAILCHIMP_TICKER_INITIAL_DELAY_SECONDS", "0"),
    ]))
    .unwrap();
    assert_eq!(
        config,
        MailchimpConfig {
            host: Some("https://us1.api.mailchimp.com/3.0".into()),
            list_id: "list123".into(),
            user: "user".into(),
            password: "pw".into(),
            ticker: JobSchedule {
                enabled: false,
                interval: DEFAULT_TICKER_INTERVAL,
                initial_delay: DEFAULT_TICKER_INTERVAL,
            },
        }
    );
    assert_eq!(
        config_from_values(&values(&[("WK_MAILCHIMP_HOST", "")]))
            .unwrap()
            .host,
        None
    );
}

#[test]
fn invalid_config_is_rejected() {
    for (key, value) in [
        ("WK_MAILCHIMP_HOST", "us1.api.mailchimp.com"),
        ("WK_MAILCHIMP_HOST", "ftp://example.org"),
        ("WK_MAILCHIMP_TICKER_ENABLED", "yes"),
        ("WK_MAILCHIMP_TICKER_ENABLED", "1"),
    ] {
        let error = config_from_values(&values(&[(key, value)])).unwrap_err();
        assert!(error.0.starts_with(key), "{key}={value}: {error}");
    }
}
