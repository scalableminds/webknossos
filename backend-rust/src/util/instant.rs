//! Scala Instant's millisecond number/string and ISO timestamp input contract.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer};
use serde_json::Value;

/// Instant.now (millisecond precision).
pub(crate) fn now_millis() -> DateTime<Utc> {
    DateTime::from_timestamp_millis(Utc::now().timestamp_millis()).unwrap_or_else(Utc::now)
}

pub(crate) fn optional<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<DateTime<Utc>>, D::Error> {
    let value = Option::<Value>::deserialize(deserializer)?;
    let Some(value) = value else {
        return Ok(None);
    };
    let millis = match value {
        Value::Number(number) => number.as_i64(),
        Value::String(value) => value.parse::<i64>().ok().or_else(|| {
            DateTime::parse_from_rfc3339(&value)
                .ok()
                .map(|date| date.timestamp_millis())
        }),
        _ => None,
    }
    .ok_or_else(|| serde::de::Error::custom(crate::msg::request::INVALID_TIMESTAMP))?;
    DateTime::from_timestamp_millis(millis)
        .map(Some)
        .ok_or_else(|| serde::de::Error::custom(crate::msg::request::INVALID_TIMESTAMP))
}
