use super::*;

#[test]
fn body_preview_truncates_like_scala() {
    assert_eq!(preview_body(b"{}"), "{}");
    let long = vec![b'a'; 130];
    assert_eq!(
        preview_body(&long),
        format!("{}... <omitted 30 bytes>", "a".repeat(100))
    );
}

#[test]
fn object_id_answers_are_validated() {
    let ok: ObjectIdString = serde_json::from_str("\"5f0c4e8a2b00002b00b4a1c3\"").unwrap();
    assert_eq!(ok.0, "5f0c4e8a2b00002b00b4a1c3");
    assert!(serde_json::from_str::<ObjectIdString>("\"nope\"").is_err());
}

#[test]
fn report_dataset_upload_reads_the_conversion_job_id_leniently() {
    assert_eq!(
        conversion_job_id(br#"{"conversionJobId":"ABCDEF0123456789abcdef01"}"#).as_deref(),
        Some("abcdef0123456789abcdef01")
    );
    // Older WEBKNOSSOS versions reply with an empty body; no job is `{}`.
    for reply in [
        &b""[..],
        b"{}",
        br#"{"conversionJobId":null}"#,
        br#"{"conversionJobId":"x"}"#,
    ] {
        assert_eq!(conversion_job_id(reply), None);
    }
}
