    use super::*;

    #[test]
    fn java_line_splitting() {
        assert_eq!(java_lines("a\nb\r\nc\rd\n"), vec!["a", "b", "c", "d"]);
        assert_eq!(java_lines("a\n\nb"), vec!["a", "", "b"]);
        assert!(java_lines("").is_empty());
    }
