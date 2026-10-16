use super::*;

#[test]
fn certificate_defaults_follow_play() {
    assert_eq!(check_certificate_values(None, None, 0), (true, 0));
    assert_eq!(
        check_certificate_values(Some("not a key"), Some("a.b.c"), 0),
        (false, 0)
    );
    assert!(feature_overrides(None, None).is_empty());
    assert_eq!(
        feature_overrides(Some("bad"), None),
        default_feature_overrides()
    );
}

#[test]
fn es256_certificates_are_verified() {
    use base64::Engine;
    use ring::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair, KeyPair};
    let rng = ring::rand::SystemRandom::new();
    let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &rng).unwrap();
    let pair =
        EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, pkcs8.as_ref(), &rng).unwrap();
    let mut spki = vec![
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08,
        0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    ];
    spki.extend_from_slice(pair.public_key().as_ref());
    let key = base64::engine::general_purpose::STANDARD.encode(&spki);
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let sign = |claims: Value| {
        let signed = format!(
            "{}.{}",
            engine.encode(br#"{"alg":"ES256","typ":"JWT"}"#),
            engine.encode(claims.to_string())
        );
        let signature = pair.sign(&rng, signed.as_bytes()).unwrap();
        format!("{signed}.{}", engine.encode(signature.as_ref()))
    };
    let token = sign(json!({"exp": 2000, "webknossos": {"openIdConnectEnabled": true}}));
    assert_eq!(
        check_certificate_values(Some(&key), Some(&token), 1000),
        (true, 2000)
    );
    assert_eq!(
        check_certificate_values(Some(&key), Some(&token), 3000),
        (false, 2000)
    );
    let tampered = format!("{}x", &token[..token.len() - 1]);
    assert!(!check_certificate_values(Some(&key), Some(&tampered), 1000).0);
    let overrides = feature_overrides(Some(&key), Some(&token));
    assert!(overrides["openIdConnectEnabled"]);
    assert!(!overrides["segmentAnythingEnabled"]);
    let mut features = default_features();
    features.insert("openIdConnectEnabled".into(), Value::Bool(true));
    apply_feature_overrides(&mut features, &overrides);
    assert_eq!(features["openIdConnectEnabled"], true);
    assert_eq!(features["editableMappingsEnabled"], false);
}
