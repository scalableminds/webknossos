use crate::error::ApiError;
use serde::{Deserialize, Serialize};
use std::{
    fmt,
    str::FromStr,
    sync::OnceLock,
    sync::atomic::{AtomicU32, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

/// BSON-compatible 12-byte ObjectId: seconds, process randomness, atomic counter.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ObjectId(String);

/// Normalize IDs in existing DTOs whose fields are stored as strings.
pub(crate) fn deserialize_string<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<String, D::Error> {
    ObjectId::deserialize(deserializer).map(String::from)
}

pub(crate) fn deserialize_strings<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<String>, D::Error> {
    Vec::<ObjectId>::deserialize(deserializer)
        .map(|ids| ids.into_iter().map(String::from).collect())
}

impl ObjectId {
    pub fn new() -> Self {
        static SEED: OnceLock<[u8; 8]> = OnceLock::new();
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let seed = SEED.get_or_init(|| {
            let bytes = *uuid::Uuid::new_v4().as_bytes();
            // UUID bytes 8..16 have no fixed version bits.
            bytes[8..16].try_into().expect("eight-byte slice")
        });
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as u32;
        let counter_seed = u32::from_be_bytes([0, seed[5], seed[6], seed[7]]);
        let counter = COUNTER
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(counter_seed)
            & 0x00ff_ffff;
        Self(format!(
            "{seconds:08x}{:02x}{:02x}{:02x}{:02x}{:02x}{counter:06x}",
            seed[0], seed[1], seed[2], seed[3], seed[4]
        ))
    }
    pub fn parse(value: &str) -> Result<Self, ApiError> {
        if value.len() == 24 && value.bytes().all(|c| c.is_ascii_hexdigit()) {
            Ok(Self(value.to_ascii_lowercase()))
        } else {
            Err(ApiError::bad_request(
                "Invalid ObjectId: expected 24 hexadecimal characters.",
            ))
        }
    }
    /// Play's path binder permits a human-readable prefix. JSON and query
    /// inputs use `parse` and therefore still require exactly the identifier.
    pub fn parse_path(value: &str) -> Result<Self, ApiError> {
        Self::parse(value.rsplit('-').next().unwrap_or(value))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl Default for ObjectId {
    fn default() -> Self {
        Self::new()
    }
}
impl fmt::Display for ObjectId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl FromStr for ObjectId {
    type Err = ApiError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}
impl TryFrom<String> for ObjectId {
    type Error = ApiError;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        Self::parse(&s)
    }
}
impl From<ObjectId> for String {
    fn from(id: ObjectId) -> Self {
        id.0
    }
}

/// ObjectId with Play's URI path binding rules. Keep this distinct from
/// ObjectId so prefixes never become accepted in JSON bodies or query fields.
#[derive(Debug, Deserialize)]
#[serde(try_from = "String")]
pub struct PathObjectId(ObjectId);

impl TryFrom<String> for PathObjectId {
    type Error = ApiError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        ObjectId::parse_path(&value).map(Self)
    }
}

impl std::ops::Deref for PathObjectId {
    type Target = ObjectId;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl fmt::Display for PathObjectId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn object_ids_roundtrip_and_are_unique() {
        let ids: std::collections::HashSet<_> = (0..1000).map(|_| ObjectId::new()).collect();
        assert_eq!(ids.len(), 1000);
        for id in ids {
            assert_eq!(
                serde_json::from_str::<ObjectId>(&serde_json::to_string(&id).unwrap()).unwrap(),
                id
            );
        }
    }
    #[test]
    fn malformed_ids_are_rejected() {
        for value in [
            "",
            "prefix-abcdefabcdefabcdefabcdef",
            "00000000000000000000000g",
            "' OR true --",
        ] {
            assert!(ObjectId::parse(value).is_err());
        }
    }
    #[test]
    fn input_ids_normalize_case_and_only_paths_accept_prefixes() {
        let uppercase = "ABCDEF012345ABCDEF012345";
        let canonical = "abcdef012345abcdef012345";
        assert_eq!(ObjectId::parse(uppercase).unwrap().as_str(), canonical);
        for path in [uppercase.to_owned(), format!("readable-prefix-{uppercase}")] {
            assert_eq!(ObjectId::parse_path(&path).unwrap().as_str(), canonical);
        }
        assert!(ObjectId::parse_path(&format!("{canonical}-")).is_err());
        assert!(
            serde_json::from_value::<ObjectId>(serde_json::json!(format!("prefix-{canonical}")))
                .is_err()
        );
        assert_eq!(
            serde_json::to_value(ObjectId::parse(uppercase).unwrap()).unwrap(),
            canonical
        );
    }
}
