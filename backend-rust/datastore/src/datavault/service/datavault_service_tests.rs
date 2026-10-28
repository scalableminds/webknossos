use super::*;

#[test]
fn zip_paths_are_keyed_by_their_zip_root() {
    let credential = Some(DataVaultCredential::legacy("u", None));
    let entry = CredentializedUPath::new(
        UPath::parse("s3://bucket/a.zip|zip:inner/file").unwrap(),
        credential.clone(),
    );
    let key = vault_cache_key_for(&entry);
    assert_eq!(key.upath.to_string(), "s3://bucket/a.zip|zip");
    assert_eq!(key.credential, credential);
    assert_eq!(
        key,
        vault_cache_key_for(&CredentializedUPath::new(
            UPath::parse("s3://bucket/a.zip|zip:other").unwrap(),
            credential.clone(),
        ))
    );
    let outer = CredentializedUPath::new(UPath::parse("s3://bucket/a.zip").unwrap(), credential);
    assert_eq!(vault_cache_key_for(&outer), outer);
    assert_ne!(vault_cache_key_for(&outer), key);
}
