    use super::*;

    #[test]
    fn splits_upload_file_ids_like_java() {
        assert_eq!(extract_upload_id("abc/x/y"), "abc");
        assert_eq!(extract_upload_id(""), "");
        assert_eq!(java_split_slash("id/a/b/"), ["id", "a", "b"]);
        assert!(java_split_slash("///").is_empty());
    }

    #[test]
    fn rejects_paths_leaving_the_upload_dir() {
        assert!(stays_inside("a/b.zip"));
        assert!(stays_inside("a/../b"));
        assert!(!stays_inside("../b"));
        assert!(!stays_inside("a/../../b"));
    }
