use super::*;

#[test]
fn comma_separated_lists_follow_scala_split() {
    assert!(split_comma_separated(None).is_empty());
    assert!(split_comma_separated(Some("")).is_empty());
    assert_eq!(split_comma_separated(Some("a,b,")), vec!["a", "b"]);
    assert_eq!(split_comma_separated(Some("a,,b")), vec!["a", "", "b"]);
    assert!(parse_enum_list("Task,Foo", &ANNOTATION_TYPES, "x").is_err());
    assert_eq!(
        parse_object_ids(Some("ABCDEFABCDEFABCDEFABCDEF"), None).unwrap(),
        vec!["abcdefabcdefabcdefabcdef"]
    );
    assert!(parse_object_ids(Some("xyz"), Some("Invalid team ids.")).is_err());
}
