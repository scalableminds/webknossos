    use super::*;

    #[test]
    fn redacts_key_and_token_parameters() {
        assert_eq!(
            redact_uri("/data/health?token=abc&x=1&key=secret"),
            "/data/health?token=xxx&x=1&key=xxx"
        );
        assert_eq!(redact_uri("/data/x?tokenish=1"), "/data/x?tokenish=1");
        assert_eq!(redact_uri("/data/x"), "/data/x");
    }

    #[test]
    fn health_problems_expire() {
        let problems = HealthProblems::default();
        assert_eq!(problems.recent_problem(Duration::from_secs(60)), None);
        problems.push("native failure");
        assert_eq!(
            problems.recent_problem(Duration::from_secs(60)).as_deref(),
            Some("native failure")
        );
        assert_eq!(problems.recent_problem(Duration::ZERO), None);
    }

    #[test]
    fn frontpage_escapes_like_twirl() {
        let page = render_frontpage("Datastore", "<ds&\"'>", "http://wk", "/data/health");
        assert!(page.contains("“&lt;ds&amp;&quot;&#x27;&gt;”"));
        assert!(page.contains(r#"<a href="http://wk" id="wkLink">"#));
    }
