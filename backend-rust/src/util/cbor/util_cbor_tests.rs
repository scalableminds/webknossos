use super::*;

fn hex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

#[test]
fn decodes_rfc8949_examples() {
    let cases: &[(&str, Value)] = &[
        ("00", Value::Integer(0)),
        ("17", Value::Integer(23)),
        ("1818", Value::Integer(24)),
        ("1903e8", Value::Integer(1000)),
        ("1bffffffffffffffff", Value::Integer(u64::MAX.into())),
        (
            "3bffffffffffffffff",
            Value::Integer(-1 - i128::from(u64::MAX)),
        ),
        ("20", Value::Integer(-1)),
        ("390100", Value::Integer(-257)),
        ("40", Value::Bytes(vec![])),
        ("4401020304", Value::Bytes(vec![1, 2, 3, 4])),
        ("6449455446", Value::Text("IETF".into())),
        ("62c3bc", Value::Text("\u{fc}".into())),
        ("f4", Value::Bool(false)),
        ("f5", Value::Bool(true)),
        ("f6", Value::Null),
        ("f7", Value::Undefined),
        (
            "8301820203820405",
            Value::Array(vec![
                Value::Integer(1),
                Value::Array(vec![Value::Integer(2), Value::Integer(3)]),
                Value::Array(vec![Value::Integer(4), Value::Integer(5)]),
            ]),
        ),
        (
            "a26161016162820203",
            Value::Map(vec![
                (Value::Text("a".into()), Value::Integer(1)),
                (
                    Value::Text("b".into()),
                    Value::Array(vec![Value::Integer(2), Value::Integer(3)]),
                ),
            ]),
        ),
        // Non-minimal heads are accepted (Jackson-compatible).
        ("1800", Value::Integer(0)),
    ];
    for (input, expected) in cases {
        assert_eq!(&decode(&hex(input)).unwrap(), expected, "{input}");
    }
}

#[test]
fn encode_roundtrips_minimal_encodings() {
    for input in [
        "00",
        "1818",
        "1903e8",
        "1bffffffffffffffff",
        "3bffffffffffffffff",
        "390100",
        "4401020304",
        "62c3bc",
        "8301820203820405",
        "a26161016162820203",
        "f4f5",
    ] {
        let bytes = hex(input);
        let (value, used) = decode_prefix(&bytes).unwrap();
        assert_eq!(encode(&value), bytes[..used], "{input}");
    }
}

#[test]
fn rejects_malformed_and_unsupported_input() {
    for (input, reason) in [
        ("", "unexpected end of input"),
        ("18", "unexpected end of input"),
        ("19ff", "unexpected end of input"),
        ("5f4101ff", "indefinite length"),
        ("9f01ff", "indefinite length"),
        ("bf6161 01ff", "indefinite length"),
        ("7f6161ff", "indefinite length"),
        ("c249010000000000000000", "tags are not supported"),
        ("f93c00", "floating point values are not supported"),
        (
            "fb3ff199999999999a",
            "floating point values are not supported",
        ),
        ("f0", "unsupported simple value"),
        ("f820", "unsupported simple value"),
        ("ff", "unexpected break"),
        ("1c", "reserved additional information"),
        ("5c", "reserved additional information"),
        ("4201", "length exceeds input"),
        ("62c3", "length exceeds input"),
        ("62c328", "invalid UTF-8 text"),
        ("5bffffffffffffffff", "length exceeds input"),
        ("9bffffffffffffffff", "length exceeds input"),
        ("bb00000000ffffffff", "length exceeds input"),
        ("a2616101616102", "duplicate map key"),
        ("82010203", "trailing bytes"),
        ("0000", "trailing bytes"),
    ] {
        let bytes = hex(&input.replace(' ', ""));
        assert_eq!(decode(&bytes), Err(CborError(reason)), "{input}");
    }
}

#[test]
fn bounds_nesting_depth() {
    let mut ok = vec![0x81; MAX_DEPTH];
    ok.push(0x00);
    assert!(decode(&ok).is_ok());
    let mut deep = vec![0x81; MAX_DEPTH + 1];
    deep.push(0x00);
    assert_eq!(decode(&deep), Err(CborError("nesting too deep")));
    // A long run of nested maps must fail fast, not overflow the stack.
    let bomb = vec![0xa1; 100_000];
    assert!(decode(&bomb).is_err());
}

/// Deterministic fuzz: random and mutated inputs never panic, and every
/// accepted value re-encodes to a decodable item.
#[test]
fn mutation_fuzz_never_panics() {
    let mut state: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    let seeds = [
        hex("a363666d74646e6f6e656761747453746d74a068617574684461746142aabb"),
        hex(
            "a5010203262001215820000000000000000000000000000000000000000000000000000000000000000022582000000000000000000000000000000000000000000000000000000000000000ff",
        ),
        hex("8301820203820405"),
    ];
    for round in 0..20_000 {
        let mut input = if round % 4 == 0 {
            (0..(next() % 64))
                .map(|_| next() as u8)
                .collect::<Vec<u8>>()
        } else {
            seeds[round % seeds.len()].clone()
        };
        if !input.is_empty() {
            for _ in 0..(1 + next() % 4) {
                let index = (next() as usize) % input.len();
                input[index] = next() as u8;
            }
            if next() % 3 == 0 {
                input.truncate((next() as usize) % input.len());
            }
        }
        if let Ok(value) = decode(&input) {
            assert_eq!(decode(&encode(&value)).unwrap(), value);
            let _ = value.to_json();
            let _ = CoseKey::from_value(&value);
        }
    }
}

fn ec2_key_bytes() -> (Vec<u8>, Vec<u8>) {
    (
        hex("6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
        hex("4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5"),
    )
}

#[test]
fn cose_keys_reencode_like_webauthn4j() {
    let (x, y) = ec2_key_bytes();
    // Authenticator order reversed, an unknown label and a kid: webauthn4j
    // 0.31.9 re-encodes as 1,2,3,-1,-2,-3 and drops the unknown label.
    let mut entries = vec![
        (Value::Integer(-3), Value::Bytes(y.clone())),
        (Value::Integer(-2), Value::Bytes(x.clone())),
        (Value::Integer(-1), Value::Integer(1)),
        (Value::Integer(-70), Value::Integer(5)),
        (Value::Integer(3), Value::Integer(-7)),
        (Value::Integer(2), Value::Bytes(vec![9, 9])),
    ];
    entries.push((Value::Integer(1), Value::Integer(2)));
    let key = CoseKey::from_value(&Value::Map(entries)).unwrap();
    assert_eq!(
        key.to_webauthn4j_cbor(),
        hex(
            "a6010202420909032620012158206b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2962258204fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5"
        )
    );
    let okp = CoseKey::Okp {
        kid: Some(vec![9]),
        x: vec![0x11; 32],
    };
    assert_eq!(
        okp.to_webauthn4j_cbor(),
        hex(
            "a50101024109032720062158201111111111111111111111111111111111111111111111111111111111111111"
        )
    );
    let mut n = vec![0; 256];
    n[0] = 0xc1;
    n[255] = 1;
    let rsa = CoseKey::Rsa {
        kid: Some(vec![9]),
        n: n.clone(),
        e: vec![1, 0, 1],
    };
    let mut expected = hex("a521430100010103205901 00".replace(' ', "").as_str());
    expected.extend(&n);
    expected.extend(hex("02410903390100"));
    assert_eq!(rsa.to_webauthn4j_cbor(), expected);
    for encoded in [
        okp.to_webauthn4j_cbor(),
        rsa.to_webauthn4j_cbor(),
        key.to_webauthn4j_cbor(),
    ] {
        let parsed = CoseKey::from_value(&decode(&encoded).unwrap()).unwrap();
        assert_eq!(parsed.to_webauthn4j_cbor(), encoded);
    }
}

#[test]
fn rejects_unsupported_cose_keys() {
    let (x, y) = ec2_key_bytes();
    let ec2 = |kty: i128, alg: i128, crv: i128, x: &[u8]| {
        Value::Map(vec![
            (Value::Integer(1), Value::Integer(kty)),
            (Value::Integer(3), Value::Integer(alg)),
            (Value::Integer(-1), Value::Integer(crv)),
            (Value::Integer(-2), Value::Bytes(x.to_vec())),
            (Value::Integer(-3), Value::Bytes(y.clone())),
        ])
    };
    assert!(CoseKey::from_value(&ec2(2, -7, 1, &x)).is_ok());
    assert!(CoseKey::from_value(&ec2(2, -35, 1, &x)).is_err());
    assert!(CoseKey::from_value(&ec2(2, -7, 2, &x)).is_err());
    assert!(CoseKey::from_value(&ec2(2, -7, 1, &x[..31])).is_err());
    assert!(CoseKey::from_value(&ec2(1, -7, 1, &x)).is_err());
    assert!(CoseKey::from_value(&Value::Integer(1)).is_err());
    let no_alg = Value::Map(vec![
        (Value::Integer(1), Value::Integer(1)),
        (Value::Integer(-1), Value::Integer(6)),
        (Value::Integer(-2), Value::Bytes(vec![0; 32])),
    ]);
    assert!(CoseKey::from_value(&no_alg).is_err());
}

#[test]
fn json_view_matches_jackson() {
    let value = decode(&hex("a263666f6f440102030463626172820161 78"
        .replace(' ', "")
        .as_str()))
    .unwrap();
    assert_eq!(
        value.to_json().unwrap(),
        serde_json::json!({"foo": "AQIDBA==", "bar": [1, "x"]})
    );
    assert!(decode(&hex("a10101")).unwrap().to_json().is_err());
}
