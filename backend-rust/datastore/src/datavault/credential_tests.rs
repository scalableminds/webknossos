
use super::*;

#[test]
fn parses_wk_find_credential_format() {
    let value = json!({
        "_type": "com.scalableminds.webknossos.datastore.storage.S3AccessKeyCredential",
        "name": "s3://bucket", "user": "u", "organization": "o",
        "accessKeyId": "AK", "secretAccessKey": "SK"
    });
    let credential: DataVaultCredential = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(credential.s3_access_key(), Some(("AK", "SK")));
    assert_eq!(credential.to_json(), value);
    let debug = format!("{credential:?}");
    assert!(!debug.contains("SK"), "{debug}");

    let google: DataVaultCredential = serde_json::from_value(json!({
        "_type": "com.scalableminds.webknossos.datastore.storage.GoogleServiceAccountCredential",
        "name": "gs", "secretJson": {"type": "service_account"}
    }))
    .unwrap();
    assert!(
        matches!(google, DataVaultCredential::GoogleServiceAccount { ref secret_json, .. } if secret_json == r#"{"type":"service_account"}"#)
    );
    assert!(serde_json::from_value::<DataVaultCredential>(json!({"name": "x"})).is_err());
    let legacy = DataVaultCredential::legacy("user", None);
    assert_eq!(legacy.basic_auth(), Some(("user", "")));
    assert_eq!(legacy.s3_access_key(), Some(("user", "")));
}
