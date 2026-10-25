use super::*;

fn rp() -> RelyingParty {
    RelyingParty {
        origin: url::Url::parse("https://example.com").unwrap(),
        rp_id: "example.com".into(),
    }
}

/// The crate's origin rule with the options `RelyingParty::verifier` passes
/// (no subdomains, exact port). Unparsable origins fail clientDataJSON parsing.
#[test]
fn origins_compare_like_webauthn4j() {
    let rp = rp();
    let matches = |origin: &str| {
        WebauthnCore::origins_match(false, false, &url::Url::parse(origin).unwrap(), &rp.origin)
    };
    for ok in [
        "https://example.com",
        "https://example.com/",
        "https://example.com:443",
        "HTTPS://EXAMPLE.COM",
        "https://example.com/foo",
    ] {
        assert!(matches(ok), "{ok}");
    }
    for bad in [
        "http://example.com",
        "https://example.com:8443",
        "https://evil.com",
        "https://sub.example.com",
    ] {
        assert!(!matches(bad), "{bad}");
    }
}

#[test]
fn stored_counters_map_to_the_webauthn4j_rule() {
    assert_eq!(verifier_counter(0), 0);
    assert_eq!(verifier_counter(7), 7);
    // Stored after Scala's `toInt` wrap: webauthn4j accepts any new counter.
    assert_eq!(verifier_counter(-5), 0);
}

#[test]
fn token_binding_and_cross_origin_follow_webauthn4j() {
    let check = |binding: JsonValue| {
        let data = json!({"type": "webauthn.get", "origin": "https://example.com", "tokenBinding": binding});
        verify_client_data_bindings(data.to_string().as_bytes())
    };
    assert!(check(JsonValue::Null).is_ok());
    assert!(check(json!({"status": "supported"})).is_ok());
    assert!(check(json!({"status": "not-supported"})).is_ok());
    assert!(check(json!({"status": "present"})).is_ok());
    assert!(check(json!({"status": "present", "id": "AAAA"})).is_err());
    assert!(check(json!({"status": "bogus"})).is_err());
    assert!(check(json!({})).is_err());
    let cross_origin = |value: JsonValue| {
        verify_client_data_bindings(json!({"crossOrigin": value}).to_string().as_bytes())
    };
    assert!(cross_origin(json!(false)).is_ok());
    assert!(cross_origin(json!(true)).is_err());
    assert!(verify_client_data_bindings(b"not json").is_err());
}

/// A registration ceremony whose challenge is `challenge` (the crate draws
/// its own; its state is serde-serializable).
fn registration_state(challenge: &[u8]) -> RegistrationState {
    let (_, state) = registration_ceremony(&rp().verifier(), b"user", "user", "User").unwrap();
    let mut state = serde_json::to_value(state).unwrap();
    state["challenge"] = json!(URL_SAFE_NO_PAD.encode(challenge));
    serde_json::from_value(state).unwrap()
}

#[test]
fn challenge_store_pops_once_and_expires() {
    let store = ChallengeStore::default();
    store.insert("a".into(), vec![1], Duration::from_secs(60));
    store.insert("b".into(), vec![2], Duration::ZERO);
    assert_eq!(store.pop("a"), Some(vec![1]));
    assert_eq!(store.pop("a"), None);
    assert_eq!(store.pop("b"), None);
}

/// Oracle: webauthn4j 0.31.9 serialized this attested credential for an
/// authenticator that sent the COSE key in reverse label order.
#[test]
fn attested_credential_matches_webauthn4j_serialization() {
    let stored = "0000000000000000000000000000000000100102030405060708090a0b0c0d0e0f10a50102032620012158206b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2962258204fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";
    let bytes: Vec<u8> = (0..stored.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&stored[i..i + 2], 16).unwrap())
        .collect();
    let credential = AttestedCredential::from_webauthn4j_bytes(&bytes).unwrap();
    assert_eq!(credential.credential_id, (1..=16).collect::<Vec<u8>>());
    assert_eq!(credential.to_webauthn4j_bytes(), bytes);
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(AttestedCredential::from_webauthn4j_bytes(&trailing).is_err());
    assert!(AttestedCredential::from_webauthn4j_bytes(&bytes[..40]).is_err());
}

/// Registration responses captured from the webauthn4j 0.31.9 oracle
/// (challenge = 32 x 0x07, origin https://example.com): reversed COSE key
/// order, BE+BS flags and a credProtect extension. Expected values are what
/// Scala stored for them.
#[test]
fn replays_webauthn4j_registrations() {
    let rp = rp();
    let cdj = "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3YyIsIm9yaWdpbiI6Imh0dHBzOi8vZXhhbXBsZS5jb20iLCJjcm9zc09yaWdpbiI6ZmFsc2V9";
    let attested = "0000000000000000000000000000000000100102030405060708090a0b0c0d0e0f10a50102032620012158206b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2962258204fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";
    let cases = [
        (
            "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViUo3mm9u6vuaVeN4wRgDTidR5oL6ufLTCrE9ISVYbOGUdFAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAECAwQFBgcICQoLDA0ODxClIlggT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfUhWCBrF9Hy4SxCR_i85uVjpEDydwN9gS3rM6D0oTlF2JjCliABAyYBAg",
            (true, false, false),
            json!({}),
        ),
        (
            "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViUo3mm9u6vuaVeN4wRgDTidR5oL6ufLTCrE9ISVYbOGUddAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAECAwQFBgcICQoLDA0ODxClAQIDJiABIVggaxfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpYiWCBP40Li_hp_m47n60p8D54WK84zV2sxXs7LtkBoN79R9Q",
            (true, true, true),
            json!({}),
        ),
        (
            "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViio3mm9u6vuaVeN4wRgDTidR5oL6ufLTCrE9ISVYbOGUfFAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAECAwQFBgcICQoLDA0ODxClAQIDJiABIVggaxfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpYiWCBP40Li_hp_m47n60p8D54WK84zV2sxXs7LtkBoN79R9aFrY3JlZFByb3RlY3QC",
            (true, false, false),
            json!({"credProtect": 2}),
        ),
    ];
    for (attestation, (uv, be, bs), extensions) in cases {
        let id = URL_SAFE_NO_PAD.encode((1u8..=16).collect::<Vec<u8>>());
        let key = json!({
            "id": id,
            "rawId": id,
            "type": "public-key",
            "response": {"clientDataJSON": cdj, "attestationObject": attestation},
        });
        let registration = parse_registration(&key).unwrap();
        verify_registration(&registration, &registration_state(&[7; 32]), &rp).unwrap();
        let bytes = registration.credential.to_webauthn4j_bytes();
        let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, attested);
        let flags = registration.auth_data.flags;
        assert_eq!(
            (
                flags & FLAG_UV != 0,
                flags & FLAG_BE != 0,
                flags & FLAG_BS != 0
            ),
            (uv, be, bs)
        );
        assert_eq!(
            registration.auth_data.extensions_json().unwrap(),
            extensions
        );
        assert!(verify_registration(&registration, &registration_state(&[8; 32]), &rp).is_err());
    }
}

#[test]
fn authenticator_data_layout_rules() {
    const FLAG_UP: u8 = 0x01;
    let mut base = vec![0u8; 32];
    base.push(FLAG_UP | FLAG_ED);
    base.extend([0, 0, 0, 5]);
    // ED without bytes: accepted, no extensions (webauthn4j).
    let parsed = AuthenticatorData::parse(&base).unwrap();
    assert_eq!(parsed.sign_count, 5);
    assert!(parsed.extensions.is_none());
    let mut with_ext = base.clone();
    with_ext.extend([0xa1, 0x6b]);
    with_ext.extend(b"credProtect");
    with_ext.push(0x02);
    let parsed = AuthenticatorData::parse(&with_ext).unwrap();
    assert_eq!(parsed.extensions_json().unwrap(), json!({"credProtect": 2}));
    let last = with_ext.len() - 1;
    with_ext[last] = 0x09;
    assert!(
        AuthenticatorData::parse(&with_ext)
            .unwrap()
            .extensions_json()
            .is_err()
    );
    // Extensions without ED, or AT without data: rejected.
    let mut no_ed = with_ext.clone();
    no_ed[32] = FLAG_UP;
    assert!(AuthenticatorData::parse(&no_ed).is_err());
    let mut at = base.clone();
    at[32] = FLAG_UP | FLAG_AT;
    assert!(AuthenticatorData::parse(&at).is_err());
    assert!(AuthenticatorData::parse(&base[..36]).is_err());
}
