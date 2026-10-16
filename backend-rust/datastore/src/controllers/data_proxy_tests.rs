    use super::*;

    #[test]
    fn raw_tail_keeps_encoding_and_nested_segments() {
        let uri: Uri = "/data/datasets/a/proxy/layers/l/mags/1-1-1/x%2Fy/0.0.0?token=t"
            .parse()
            .unwrap();
        assert_eq!(raw_tail(&uri, 8), "x%2Fy/0.0.0");
    }

    #[test]
    fn validates_paths_like_scala() {
        assert!(validate_path("0/0/0").is_ok());
        assert!(validate_path("a/../b").is_err());
        assert!(validate_path("%2e%2e/b").is_err());
        assert!(validate_path("%2fetc").is_err());
        // Scala only checks the lower-case escapes.
        assert!(validate_path("%2E%2E/b").is_ok());
    }
