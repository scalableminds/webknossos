//! Minimal, strict CBOR (RFC 8949) decoder/encoder and COSE_Key model for
//! WebAuthn attestation objects, authenticator data and credential storage.
//!
//! Accepted: definite-length unsigned/negative integers (64-bit), byte and
//! text strings, arrays, maps and the simple values false/true/null/undefined.
//! Rejected (stricter than Jackson-CBOR, which webauthn4j uses; CTAP2
//! canonical CBOR never contains them): indefinite lengths, tags, floats,
//! other simple values, reserved additional-information values, duplicate
//! map keys, invalid UTF-8 and nesting deeper than [`MAX_DEPTH`].
//! Non-minimal integer/length encodings are accepted like Jackson does.
use std::fmt;

use base64::{Engine, engine::general_purpose::STANDARD};
use ring::signature;
use serde_json::{Map, Value as Json};

/// Nesting limit; WebAuthn structures need at most four levels.
pub const MAX_DEPTH: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    /// Major types 0 and 1 (range -2^64..2^64-1).
    Integer(i128),
    Bytes(Vec<u8>),
    Text(String),
    Array(Vec<Value>),
    /// Entries in encoded order; keys are unique.
    Map(Vec<(Value, Value)>),
    Bool(bool),
    Null,
    Undefined,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CborError(pub &'static str);

impl fmt::Display for CborError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid CBOR: {}", self.0)
    }
}

impl std::error::Error for CborError {}

type Result<T> = std::result::Result<T, CborError>;

/// Decode exactly one data item; trailing bytes are an error.
pub fn decode(bytes: &[u8]) -> Result<Value> {
    let (value, used) = decode_prefix(bytes)?;
    if used != bytes.len() {
        return Err(CborError("trailing bytes"));
    }
    Ok(value)
}

/// Decode one data item from the start of `bytes`; returns it and the number
/// of bytes it occupied (authenticator data embeds the COSE key this way).
pub fn decode_prefix(bytes: &[u8]) -> Result<(Value, usize)> {
    let mut decoder = Decoder { bytes, pos: 0 };
    let value = decoder.item(0)?;
    Ok((value, decoder.pos))
}

struct Decoder<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl Decoder<'_> {
    fn take(&mut self, len: usize) -> Result<&[u8]> {
        let end = self
            .pos
            .checked_add(len)
            .filter(|end| *end <= self.bytes.len())
            .ok_or(CborError("unexpected end of input"))?;
        let slice = &self.bytes[self.pos..end];
        self.pos = end;
        Ok(slice)
    }

    fn argument(&mut self, info: u8) -> Result<u64> {
        Ok(match info {
            0..=23 => u64::from(info),
            24 => u64::from(self.take(1)?[0]),
            25 => u64::from(u16::from_be_bytes(self.take(2)?.try_into().expect("2"))),
            26 => u64::from(u32::from_be_bytes(self.take(4)?.try_into().expect("4"))),
            27 => u64::from_be_bytes(self.take(8)?.try_into().expect("8")),
            31 => return Err(CborError("indefinite length")),
            _ => return Err(CborError("reserved additional information")),
        })
    }

    fn length(&mut self, info: u8) -> Result<usize> {
        let len = self.argument(info)?;
        let remaining = self.bytes.len() - self.pos;
        // Every element occupies at least one byte: bounds allocations too.
        usize::try_from(len)
            .ok()
            .filter(|len| *len <= remaining)
            .ok_or(CborError("length exceeds input"))
    }

    fn item(&mut self, depth: usize) -> Result<Value> {
        if depth > MAX_DEPTH {
            return Err(CborError("nesting too deep"));
        }
        let initial = self.take(1)?[0];
        let (major, info) = (initial >> 5, initial & 0x1f);
        match major {
            0 => Ok(Value::Integer(i128::from(self.argument(info)?))),
            1 => Ok(Value::Integer(-1 - i128::from(self.argument(info)?))),
            2 => {
                let len = self.length(info)?;
                Ok(Value::Bytes(self.take(len)?.to_vec()))
            }
            3 => {
                let len = self.length(info)?;
                let text = std::str::from_utf8(self.take(len)?)
                    .map_err(|_| CborError("invalid UTF-8 text"))?;
                Ok(Value::Text(text.to_owned()))
            }
            4 => {
                let len = self.length(info)?;
                let mut items = Vec::with_capacity(len);
                for _ in 0..len {
                    items.push(self.item(depth + 1)?);
                }
                Ok(Value::Array(items))
            }
            5 => {
                let len = self.length(info)?;
                let mut entries: Vec<(Value, Value)> = Vec::with_capacity(len);
                for _ in 0..len {
                    let key = self.item(depth + 1)?;
                    if entries.iter().any(|(existing, _)| *existing == key) {
                        return Err(CborError("duplicate map key"));
                    }
                    let value = self.item(depth + 1)?;
                    entries.push((key, value));
                }
                Ok(Value::Map(entries))
            }
            6 => Err(CborError("tags are not supported")),
            _ => match info {
                20 => Ok(Value::Bool(false)),
                21 => Ok(Value::Bool(true)),
                22 => Ok(Value::Null),
                23 => Ok(Value::Undefined),
                25..=27 => Err(CborError("floating point values are not supported")),
                31 => Err(CborError("unexpected break")),
                _ => Err(CborError("unsupported simple value")),
            },
        }
    }
}

fn head(out: &mut Vec<u8>, major: u8, value: u64) {
    let major = major << 5;
    match value {
        0..=23 => out.push(major | value as u8),
        24..=0xff => out.extend([major | 24, value as u8]),
        0x100..=0xffff => {
            out.push(major | 25);
            out.extend((value as u16).to_be_bytes());
        }
        0x1_0000..=0xffff_ffff => {
            out.push(major | 26);
            out.extend((value as u32).to_be_bytes());
        }
        _ => {
            out.push(major | 27);
            out.extend(value.to_be_bytes());
        }
    }
}

/// Encode with definite lengths and minimal heads (as Jackson-CBOR writes).
/// Integers outside the CBOR range are clamped by construction: values only
/// come from [`decode`] or small constants.
pub fn encode(value: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    encode_into(&mut out, value);
    out
}

fn encode_into(out: &mut Vec<u8>, value: &Value) {
    match value {
        Value::Integer(n) if *n >= 0 => head(out, 0, u64::try_from(*n).unwrap_or(u64::MAX)),
        Value::Integer(n) => head(out, 1, u64::try_from(-1 - *n).unwrap_or(u64::MAX)),
        Value::Bytes(bytes) => {
            head(out, 2, bytes.len() as u64);
            out.extend(bytes);
        }
        Value::Text(text) => {
            head(out, 3, text.len() as u64);
            out.extend(text.as_bytes());
        }
        Value::Array(items) => {
            head(out, 4, items.len() as u64);
            for item in items {
                encode_into(out, item);
            }
        }
        Value::Map(entries) => {
            head(out, 5, entries.len() as u64);
            for (key, value) in entries {
                encode_into(out, key);
                encode_into(out, value);
            }
        }
        Value::Bool(false) => out.push(0xf4),
        Value::Bool(true) => out.push(0xf5),
        Value::Null => out.push(0xf6),
        Value::Undefined => out.push(0xf7),
    }
}

impl Value {
    pub fn as_map(&self) -> Option<&[(Value, Value)]> {
        match self {
            Value::Map(entries) => Some(entries),
            _ => None,
        }
    }

    pub fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            Value::Bytes(bytes) => Some(bytes),
            _ => None,
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        match self {
            Value::Text(text) => Some(text),
            _ => None,
        }
    }

    pub fn as_integer(&self) -> Option<i128> {
        match self {
            Value::Integer(n) => Some(*n),
            _ => None,
        }
    }

    /// Map lookup by integer label (COSE) or text key.
    pub fn get_int(&self, label: i128) -> Option<&Value> {
        self.as_map()?
            .iter()
            .find(|(key, _)| *key == Value::Integer(label))
            .map(|(_, value)| value)
    }

    pub fn get_text(&self, key: &str) -> Option<&Value> {
        self.as_map()?
            .iter()
            .find(|(k, _)| k.as_text() == Some(key))
            .map(|(_, value)| value)
    }

    /// Jackson's tree view of a CBOR value (byte strings become standard
    /// padded base64, as Jackson serializes `byte[]`). Only text map keys are
    /// representable; integers must fit i64/u64; `undefined` is rejected.
    pub fn to_json(&self) -> Result<Json> {
        Ok(match self {
            Value::Integer(n) => {
                if let Ok(n) = i64::try_from(*n) {
                    Json::from(n)
                } else {
                    Json::from(u64::try_from(*n).map_err(|_| CborError("integer out of range"))?)
                }
            }
            Value::Bytes(bytes) => Json::String(STANDARD.encode(bytes)),
            Value::Text(text) => Json::String(text.clone()),
            Value::Array(items) => {
                Json::Array(items.iter().map(Value::to_json).collect::<Result<_>>()?)
            }
            Value::Map(entries) => {
                let mut map = Map::new();
                for (key, value) in entries {
                    let key = key.as_text().ok_or(CborError("non-text map key"))?;
                    map.insert(key.to_owned(), value.to_json()?);
                }
                Json::Object(map)
            }
            Value::Bool(b) => Json::Bool(*b),
            Value::Null => Json::Null,
            Value::Undefined => return Err(CborError("undefined is not representable")),
        })
    }
}

// ---------------------------------------------------------------------------
// COSE_Key (RFC 9052/9053) restricted to the algorithms WEBKNOSSOS offers in
// pubKeyCredParams: EdDSA (-8, OKP Ed25519), ES256 (-7, EC2 P-256) and
// RS256 (-257, RSA).

pub const ALG_EDDSA: i64 = -8;
pub const ALG_ES256: i64 = -7;
pub const ALG_RS256: i64 = -257;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CoseKey {
    /// kty 1, crv 6 (Ed25519), alg -8.
    Okp { kid: Option<Vec<u8>>, x: Vec<u8> },
    /// kty 2, crv 1 (P-256), alg -7.
    Ec2 {
        kid: Option<Vec<u8>>,
        x: Vec<u8>,
        y: Vec<u8>,
    },
    /// kty 3, alg -257.
    Rsa {
        kid: Option<Vec<u8>>,
        n: Vec<u8>,
        e: Vec<u8>,
    },
}

impl CoseKey {
    /// Parse a COSE_Key map. Stricter than webauthn4j: alg is required and
    /// must match kty, the curve must be P-256/Ed25519 and coordinates must
    /// have their fixed size. Unknown labels are ignored (webauthn4j drops
    /// them as well).
    pub fn from_value(value: &Value) -> Result<Self> {
        value.as_map().ok_or(CborError("COSE key is not a map"))?;
        let int = |label| value.get_int(label).and_then(Value::as_integer);
        let bytes = |label| value.get_int(label).and_then(Value::as_bytes);
        let kid = match value.get_int(2) {
            None => None,
            Some(Value::Bytes(kid)) => Some(kid.clone()),
            Some(_) => return Err(CborError("COSE kid must be a byte string")),
        };
        let alg = int(3).ok_or(CborError("COSE alg missing"))?;
        match (int(1), alg) {
            (Some(1), a) if a == i128::from(ALG_EDDSA) => {
                let x = bytes(-2).filter(|x| x.len() == 32);
                match (int(-1), x) {
                    (Some(6), Some(x)) => Ok(CoseKey::Okp { kid, x: x.to_vec() }),
                    _ => Err(CborError("unsupported OKP key")),
                }
            }
            (Some(2), a) if a == i128::from(ALG_ES256) => {
                let coordinate = |label| bytes(label).filter(|c| c.len() == 32);
                match (int(-1), coordinate(-2), coordinate(-3)) {
                    (Some(1), Some(x), Some(y)) => Ok(CoseKey::Ec2 {
                        kid,
                        x: x.to_vec(),
                        y: y.to_vec(),
                    }),
                    _ => Err(CborError("unsupported EC2 key")),
                }
            }
            (Some(3), a) if a == i128::from(ALG_RS256) => {
                match (bytes(-1).filter(|n| !n.is_empty()), bytes(-2)) {
                    (Some(n), Some(e)) if !e.is_empty() => Ok(CoseKey::Rsa {
                        kid,
                        n: n.to_vec(),
                        e: e.to_vec(),
                    }),
                    _ => Err(CborError("unsupported RSA key")),
                }
            }
            _ => Err(CborError("unsupported COSE key type or algorithm")),
        }
    }

    pub fn algorithm(&self) -> i64 {
        match self {
            CoseKey::Okp { .. } => ALG_EDDSA,
            CoseKey::Ec2 { .. } => ALG_ES256,
            CoseKey::Rsa { .. } => ALG_RS256,
        }
    }

    /// The CBOR webauthn4j (Jackson) writes for this key; label order
    /// verified against webauthn4j 0.31.9: EC2 1,2,3,-1,-2,-3; OKP 1,2,3,-1,-2;
    /// RSA -2,1,-1,2,3.
    pub fn to_webauthn4j_cbor(&self) -> Vec<u8> {
        let int = |n: i64| Value::Integer(i128::from(n));
        let bytes = |b: &[u8]| Value::Bytes(b.to_vec());
        let kid_entry = |kid: &Option<Vec<u8>>| kid.as_ref().map(|kid| (int(2), bytes(kid)));
        let mut entries = Vec::new();
        match self {
            CoseKey::Okp { kid, x } => {
                entries.push((int(1), int(1)));
                entries.extend(kid_entry(kid));
                entries.push((int(3), int(ALG_EDDSA)));
                entries.push((int(-1), int(6)));
                entries.push((int(-2), bytes(x)));
            }
            CoseKey::Ec2 { kid, x, y } => {
                entries.push((int(1), int(2)));
                entries.extend(kid_entry(kid));
                entries.push((int(3), int(ALG_ES256)));
                entries.push((int(-1), int(1)));
                entries.push((int(-2), bytes(x)));
                entries.push((int(-3), bytes(y)));
            }
            CoseKey::Rsa { kid, n, e } => {
                entries.push((int(-2), bytes(e)));
                entries.push((int(1), int(3)));
                entries.push((int(-1), bytes(n)));
                entries.extend(kid_entry(kid));
                entries.push((int(3), int(ALG_RS256)));
            }
        }
        encode(&Value::Map(entries))
    }

    /// Verify a WebAuthn assertion signature (ES256 signatures are ASN.1 DER).
    pub fn verify(&self, message: &[u8], signature_bytes: &[u8]) -> bool {
        match self {
            CoseKey::Okp { x, .. } => signature::UnparsedPublicKey::new(&signature::ED25519, x)
                .verify(message, signature_bytes)
                .is_ok(),
            CoseKey::Ec2 { x, y, .. } => {
                let mut point = Vec::with_capacity(65);
                point.push(0x04);
                point.extend(x);
                point.extend(y);
                signature::UnparsedPublicKey::new(&signature::ECDSA_P256_SHA256_ASN1, point)
                    .verify(message, signature_bytes)
                    .is_ok()
            }
            CoseKey::Rsa { n, e, .. } => signature::RsaPublicKeyComponents { n, e }
                .verify(
                    &signature::RSA_PKCS1_2048_8192_SHA256,
                    message,
                    signature_bytes,
                )
                .is_ok(),
        }
    }
}

#[cfg(test)]
#[path = "cbor_tests.rs"]
mod tests;
