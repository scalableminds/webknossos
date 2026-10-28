use super::*;

#[test]
fn slices_and_parses_ranges() {
    let body = Bytes::from_static(b"0123456789");
    assert_eq!(
        &slice_complete(body.clone(), ByteRange::start_end_exclusive(2, 5))[..],
        b"234"
    );
    assert_eq!(
        &slice_complete(body.clone(), ByteRange::suffix(3))[..],
        b"789"
    );
    assert_eq!(
        &slice_complete(body, ByteRange::start_end_exclusive(8, 20))[..],
        b"89"
    );
    assert_eq!(total_from_content_range("bytes 0-9/100"), Some(100));
    assert_eq!(total_from_content_range("bytes */*"), None);
}

#[test]
fn rejects_invalid_service_account_without_leaking() {
    let error = ServiceAccountTokenSource::from_json(
            r#"{"client_email":"a@b","private_key":"-----BEGIN PRIVATE KEY-----\nU0VDUkVU\n-----END PRIVATE KEY-----"}"#,
            Client::new(),
        )
        .unwrap_err();
    assert_eq!(error, "Invalid PKCS#8 data.");
    assert!(ServiceAccountTokenSource::from_json("{}", Client::new()).is_err());
}
