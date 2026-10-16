    use super::*;

    fn p(s: &str) -> UPath {
        UPath::parse(s).unwrap()
    }

    fn round(s: &str) -> String {
        p(s).to_string()
    }

    #[test]
    fn canonical_strings() {
        assert_eq!(round("color/1"), "./color/1");
        assert_eq!(round("./color/1/"), "./color/1");
        assert_eq!(round("a//b/./c/../d"), "./a/b/d");
        assert_eq!(round("../x"), "./../x");
        assert_eq!(round("/../x"), "/x");
        assert_eq!(round(""), "./");
        assert_eq!(round("."), "./");
        assert_eq!(round("/abs/path"), "/abs/path");
        assert_eq!(round("file:///abs/x/"), "/abs/x");
        assert!(UPath::parse("file://relative").is_err());
        assert_eq!(round("s3://bucket/a/./b/../c/"), "s3://bucket/a/c/");
        assert_eq!(round("https://host:8080/../../x"), "https://host:8080/x");
        assert_eq!(round("/data/a.zip|zip:/inner/x"), "/data/a.zip|zip:inner/x");
        assert_eq!(round("data/a.zip|zip"), "./data/a.zip|zip");
        // `"://".split("://")` is empty in Java: no scheme, a local path named `:`.
        assert_eq!(round("://"), "./:");
        assert_eq!(round("://host/x"), "://host/x");
        assert!(UPath::parse("|zip").is_err());
        assert!(UPath::parse("a.zip|zip:b.zip|zip").is_err());
        assert!(UPath::parse("a.zip|zip://x").is_err());
        assert!(UPath::parse("a\0b").is_err());
    }

    #[test]
    fn remote_paths_keep_scala_segment_semantics() {
        assert_eq!(round("s3://bucket/a/b"), "s3://bucket/a/b");
        assert_eq!(round("https://host/a/b/"), "https://host/a/b/");
        assert_eq!(round("https://host/a//b"), "https://host/a//b");
        assert_eq!(round("https://host/a/./b/../c"), "https://host/a/c");
        assert_eq!(round("gs://bucket"), "gs://bucket");
        assert_eq!(p("s3://bucket/a/").join("b").to_string(), "s3://bucket/a/b");
        assert_eq!(
            p("s3://bucket/a").join("b/c/").to_string(),
            "s3://bucket/a/b/c/"
        );
        assert_eq!(p("s3://bucket").join("/x").to_string(), "s3://bucket//x");
        assert_eq!(
            p("s3://bucket/a/b").join("../c").to_string(),
            "s3://bucket/a/c"
        );
        assert_eq!(p("s3://bucket/a/b/").basename(), "b");
        assert_eq!(p("s3://bucket/a/b").parent().to_string(), "s3://bucket/a");
        assert_eq!(p("s3://bucket").parent().to_string(), "s3://bucket");
        assert_eq!(p("s3://bucket").scheme(), Some("s3"));
        assert!(p("s3://bucket").is_remote() && p("s3://bucket").is_absolute());
        assert!(p("s3://bucket/a/b").starts_with(&p("s3://bucket/a/")));
        assert!(p("s3://bucket/a/b").starts_with(&p("s3://bucket/a")));
        assert!(!p("s3://bucket/ab").starts_with(&p("s3://bucket/a/")));
        assert!(!p("gs://bucket/a").starts_with(&p("s3://bucket")));
        assert_eq!(
            p("s3://b/k").relativized_in(&p("s3://b")).to_string(),
            "s3://b/k"
        );
    }

    #[test]
    fn local_paths_normalize_like_java_nio() {
        assert_eq!(round("/a/./b//c/../d/"), "/a/b/d");
        assert_eq!(round("a/../.."), "./..");
        assert_eq!(round("/.."), "/");
        assert_eq!(round("myfile:///data/x"), "/data/x");
        assert_eq!(
            UPath::parse("file://data/x").unwrap_err().message,
            "Trying to construct relative UPath data/x. Must either be absolute or have no scheme."
        );
        assert!(p("/a").is_absolute() && p("/a").is_local() && p("/a").scheme().is_none());
        assert!(p("a").is_relative());
        assert_eq!(p("/a/b").join("c/../d").to_string(), "/a/b/d");
        assert_eq!(p("/a/b").join("/x").to_string(), "/x");
        assert_eq!(p("").join("x").to_string(), "./x");
        assert_eq!(p("/a/b").basename(), "b");
        assert_eq!(p("/").basename(), "");
        assert_eq!(p("/a").parent().to_string(), "/");
        assert_eq!(p("/").parent().to_string(), "/");
        assert_eq!(p("a").parent().to_string(), "./a");
        assert!(p("/a/b").starts_with(&p("/a")));
        assert!(!p("/ab").starts_with(&p("/a")));
        assert!(p("rel").to_absolute().is_absolute());
        assert_eq!(p("/a").to_local_path().unwrap(), PathBuf::from("/a"));
        assert_eq!(
            p("s3://b/k").to_local_path().unwrap_err().message,
            "Accessed toLocalPath on RemotePath s3://b/k"
        );
        assert_eq!(
            p("/a").to_zip_entry().unwrap_err().message,
            "Called toZipEntryUPath on LocalUPath /a"
        );
    }

    #[test]
    fn resolve_and_relativize() {
        let base = p("/data/org/ds");
        let relative = p("color/1");
        let resolved = relative.resolved_in(&base);
        assert_eq!(resolved.to_string(), "/data/org/ds/color/1");
        let root = LocalPath::parse("/");
        assert_eq!(
            resolved.relativized_in_cwd(&base, &root).to_string(),
            "./color/1"
        );
        assert_eq!(base.relativized_in_cwd(&base, &root).to_string(), "./");
        assert_eq!(
            p("/a/b/c").relativized_in_cwd(&p("/"), &root).to_string(),
            "./a/b/c"
        );
        // Relative paths are made absolute against the working directory.
        let cwd = LocalPath::parse("/data");
        assert_eq!(
            p("org/ds/color")
                .relativized_in_cwd(&base, &cwd)
                .to_string(),
            "./color"
        );
        assert_eq!(
            p("/other/x").relativized_in_cwd(&base, &root).to_string(),
            "/other/x"
        );
        assert_eq!(
            p("/data/org/dsx")
                .relativized_in_cwd(&base, &root)
                .to_string(),
            "/data/org/dsx"
        );
        assert_eq!(
            relative.resolved_in(&p("s3://bucket/ds/")).to_string(),
            "s3://bucket/ds/color/1"
        );
        let zip = p("a.zip|zip:inner");
        let resolved_zip = zip.resolved_in(&base);
        assert_eq!(resolved_zip.to_string(), "/data/org/ds/a.zip|zip:inner");
        assert_eq!(
            resolved_zip.relativized_in_cwd(&base, &root).to_string(),
            "./a.zip|zip:inner"
        );
        assert_eq!(
            p("s3://bucket/x").resolved_in(&base).to_string(),
            "s3://bucket/x"
        );
        assert_eq!(p("/b").resolved_in(&p("/a")).to_string(), "/b");
    }

    #[test]
    fn zip_entry_paths() {
        let zip = p("s3://bucket/data.zip|zip:inner/file.json");
        assert_eq!(zip.to_string(), "s3://bucket/data.zip|zip:inner/file.json");
        assert_eq!(zip.basename(), "file.json");
        assert_eq!(zip.parent().to_string(), "s3://bucket/data.zip|zip:inner");
        assert_eq!(zip.scheme(), Some("s3"));
        let (outer, inner) = zip.to_zip_entry().unwrap();
        assert_eq!(
            (outer.to_string().as_str(), inner),
            ("s3://bucket/data.zip", "inner/file.json")
        );
        assert_eq!(round("/x/a.zip|zip"), "/x/a.zip|zip");
        assert_eq!(round("/x/a.zip|zip:/b"), "/x/a.zip|zip:b");
        assert_eq!(
            p("/x/a.zip|zip").join("b//c").to_string(),
            "/x/a.zip|zip:b/c"
        );
        assert!(zip.starts_with(&p("s3://bucket/data.zip|zip")));
        assert!(zip.starts_with(&p("s3://bucket/data.zip|zip:inner")));
        assert!(!zip.starts_with(&p("s3://bucket/data.zip|zip:inn")));
        assert!(zip.starts_with(&p("s3://bucket")));
        assert!(zip.is_remote());
        assert_eq!(
            p("s3://bucket/ds")
                .join_upath(&p("rel.zip|zip:a"))
                .to_string(),
            "s3://bucket/ds/rel.zip|zip:a"
        );
        assert_eq!(
            UPath::parse("/a.zip|zip:b.zip|zip").unwrap_err().message,
            "Invalid zip path “/a.zip|zip:b.zip|zip”: Nested zip paths are not supported."
        );
        assert_eq!(
            UPath::parse("|zip:a").unwrap_err().message,
            "Invalid zip path “|zip:a”: Outer path must not be empty."
        );
        assert!(p("/a.zip|zip:b").to_local_path().is_err());
    }

    #[test]
    fn json_format_is_a_string() {
        let parsed: UPath = serde_json::from_str("\"s3://bucket/a\"").unwrap();
        assert_eq!(serde_json::to_string(&parsed).unwrap(), "\"s3://bucket/a\"");
        assert_eq!(
            UPath::from_json(&Value::from("|zip")).unwrap_err(),
            JsError::new(
                "Invalid UPath: Failure(Invalid zip path “|zip”: Outer path must not be empty.,\
                 Full(java.lang.Exception: Invalid zip path “|zip”: Outer path must not be empty.),Empty)"
            )
        );
        assert_eq!(
            UPath::from_json(&Value::from(5)).unwrap_err(),
            JsError::new("error.expected.jsstring")
        );
        assert!(serde_json::from_str::<UPath>("5").is_err());
    }
