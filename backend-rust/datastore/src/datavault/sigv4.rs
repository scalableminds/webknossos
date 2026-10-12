//! AWS Signature Version 4 (header-based) for S3 requests, implemented with `ring`.
//!
//! Replaces the AWS SDK signer used by Scala `S3DataVault`. Read and upload requests
//! use caller-supplied payload hashes and signed headers.

use std::{fmt, time::SystemTime};

use ring::{digest, hmac};

/// Hex SHA-256 of the empty payload.
pub const EMPTY_PAYLOAD_SHA256: &str =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const ALGORITHM: &str = "AWS4-HMAC-SHA256";

/// Static AWS credentials (Scala `S3AccessKeyCredential` / environment variables).
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct AwsCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    /// `AWS_SESSION_TOKEN` (sent as `x-amz-security-token`).
    pub session_token: Option<String>,
}

impl AwsCredentials {
    pub fn new(access_key_id: impl Into<String>, secret_access_key: impl Into<String>) -> Self {
        Self {
            access_key_id: access_key_id.into(),
            secret_access_key: secret_access_key.into(),
            session_token: None,
        }
    }

    /// Scala `EnvironmentVariableCredentialsProvider` (only consulted when no credential is set
    /// and `AWS_ACCESS_KEY_ID` or `AWS_ACCESS_KEY` exists). `Err` when the secret is missing.
    pub fn from_env_vars(get: impl Fn(&str) -> Option<String>) -> Option<Result<Self, String>> {
        let non_empty = |name: &str| get(name).filter(|v| !v.trim().is_empty());
        if get("AWS_ACCESS_KEY_ID").is_none() && get("AWS_ACCESS_KEY").is_none() {
            return None;
        }
        let Some(access_key_id) =
            non_empty("AWS_ACCESS_KEY_ID").or_else(|| non_empty("AWS_ACCESS_KEY"))
        else {
            return Some(Err(
                "Unable to load credentials from system settings. Access key must be specified either via environment variable (AWS_ACCESS_KEY_ID) or system property (aws.accessKeyId).".into(),
            ));
        };
        let Some(secret_access_key) =
            non_empty("AWS_SECRET_ACCESS_KEY").or_else(|| non_empty("AWS_SECRET_KEY"))
        else {
            return Some(Err(
                "Unable to load credentials from system settings. Secret key must be specified either via environment variable (AWS_SECRET_ACCESS_KEY) or system property (aws.secretAccessKey).".into(),
            ));
        };
        Some(Ok(Self {
            access_key_id: access_key_id.trim().to_owned(),
            secret_access_key: secret_access_key.trim().to_owned(),
            session_token: non_empty("AWS_SESSION_TOKEN").map(|t| t.trim().to_owned()),
        }))
    }
}

impl fmt::Debug for AwsCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AwsCredentials")
            .field("access_key_id", &self.access_key_id)
            .field("secret", &"[redacted]")
            .finish()
    }
}

/// A request to sign. `canonical_uri` is the already URI-encoded absolute path; `query` holds raw
/// (unencoded) pairs; `headers` must include `host` and `x-amz-date` and are all signed.
pub struct SigningRequest<'a> {
    pub method: &'a str,
    pub canonical_uri: &'a str,
    pub query: &'a [(String, String)],
    pub headers: &'a [(String, String)],
    pub payload_sha256: &'a str,
}

/// `Authorization` header value for `request`, signed at `amz_date` (`yyyyMMdd'T'HHmmss'Z'`).
pub fn authorization(
    credentials: &AwsCredentials,
    request: &SigningRequest<'_>,
    region: &str,
    service: &str,
    amz_date: &str,
) -> String {
    let (canonical_headers, signed_headers) = canonical_headers(request.headers);
    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        request.method,
        request.canonical_uri,
        canonical_query_string(request.query),
        canonical_headers,
        signed_headers,
        request.payload_sha256
    );
    let date = &amz_date[..8.min(amz_date.len())];
    let scope = format!("{date}/{region}/{service}/aws4_request");
    let string_to_sign = format!(
        "{ALGORITHM}\n{amz_date}\n{scope}\n{}",
        hex(digest::digest(&digest::SHA256, canonical_request.as_bytes()).as_ref())
    );
    let mut key = hmac_sha256(
        format!("AWS4{}", credentials.secret_access_key).as_bytes(),
        date.as_bytes(),
    );
    for part in [region, service, "aws4_request"] {
        key = hmac_sha256(&key, part.as_bytes());
    }
    let signature = hex(&hmac_sha256(&key, string_to_sign.as_bytes()));
    format!(
        "{ALGORITHM} Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
        credentials.access_key_id
    )
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, key), data)
        .as_ref()
        .to_vec()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `(canonical headers block, signed header list)`: lowercase names, trimmed values with inner
/// whitespace runs collapsed, sorted by name, repeated names joined with `,`.
fn canonical_headers(headers: &[(String, String)]) -> (String, String) {
    let mut normalized: Vec<(String, String)> = headers
        .iter()
        .map(|(name, value)| {
            (
                name.to_ascii_lowercase(),
                value.split_whitespace().collect::<Vec<_>>().join(" "),
            )
        })
        .collect();
    normalized.sort_by(|a, b| a.0.cmp(&b.0));
    let mut merged: Vec<(String, String)> = Vec::new();
    for (name, value) in normalized {
        match merged.last_mut() {
            Some((last, values)) if *last == name => {
                values.push(',');
                values.push_str(&value);
            }
            _ => merged.push((name, value)),
        }
    }
    let block = merged.iter().map(|(n, v)| format!("{n}:{v}\n")).collect();
    let signed = merged
        .iter()
        .map(|(n, _)| n.as_str())
        .collect::<Vec<_>>()
        .join(";");
    (block, signed)
}

/// Canonical query string (also used verbatim as the request query, so both always agree).
pub fn canonical_query_string(query: &[(String, String)]) -> String {
    let mut encoded: Vec<(String, String)> = query
        .iter()
        .map(|(k, v)| (uri_encode(k, true), uri_encode(v, true)))
        .collect();
    encoded.sort();
    encoded
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&")
}

/// AWS `UriEncode`: everything but `A-Za-z0-9-_.~` is `%XX` (uppercase); `/` too if `encode_slash`.
pub fn uri_encode(value: &str, encode_slash: bool) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b'/' if !encode_slash => out.push('/'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// `x-amz-date` format (`yyyyMMdd'T'HHmmss'Z'`, UTC).
pub fn amz_date(time: SystemTime) -> String {
    let secs = time
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}{month:02}{day:02}T{:02}{:02}{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant's `civil_from_days`.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_amz_date() {
        let t = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_440_938_160);
        assert_eq!(amz_date(t), "20150830T123600Z");
        assert_eq!(amz_date(SystemTime::UNIX_EPOCH), "19700101T000000Z");
    }

    #[test]
    fn encodes_like_aws() {
        assert_eq!(uri_encode("a b/c~*", false), "a%20b/c~%2A");
        assert_eq!(uri_encode("a/b", true), "a%2Fb");
        assert_eq!(uri_encode("ሴ", true), "%E1%88%B4");
    }

    #[test]
    fn env_credentials() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| {
                pairs
                    .iter()
                    .find(|(k, _)| *k == name)
                    .map(|(_, v)| v.to_string())
            }
        };
        assert!(AwsCredentials::from_env_vars(env(&[])).is_none());
        let creds = AwsCredentials::from_env_vars(env(&[
            ("AWS_ACCESS_KEY", "id"),
            ("AWS_SECRET_KEY", "S3CR3T"),
            ("AWS_SESSION_TOKEN", "tok"),
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(creds.access_key_id, "id");
        assert_eq!(creds.session_token.as_deref(), Some("tok"));
        assert!(!format!("{creds:?}").contains("S3CR3T"));
        assert!(
            AwsCredentials::from_env_vars(env(&[("AWS_ACCESS_KEY_ID", "id")]))
                .unwrap()
                .is_err()
        );
    }
}
