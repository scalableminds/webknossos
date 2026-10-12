//! Scala `storage/DataVaultCredentials.scala`.
//!
//! Wire format (Play-JSON sealed family, as returned by WK `findCredential`):
//! `{"_type":"com.scalableminds.webknossos.datastore.storage.S3AccessKeyCredential","name":..,
//! "accessKeyId":..,"secretAccessKey":..,"user":..,"organization":..}`. The legacy inline
//! credential of a mag locator (`{"user":..,"password":..}`) has no `_type`; build it with
//! [`DataVaultCredential::legacy`].

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value, json};

use crate::config;

const CLASS_PREFIX: &str = "com.scalableminds.webknossos.datastore.storage.";

#[derive(Clone, PartialEq, Eq, Hash)]
pub enum DataVaultCredential {
    HttpBasicAuth {
        name: String,
        username: String,
        password: String,
        user: Option<String>,
        organization: Option<String>,
    },
    XAuthToken {
        name: String,
        token_value: String,
        user: Option<String>,
        organization: Option<String>,
    },
    S3AccessKey {
        name: String,
        access_key_id: String,
        secret_access_key: String,
        user: Option<String>,
        organization: Option<String>,
    },
    GoogleServiceAccount {
        name: String,
        /// The service-account JSON document, serialized (kept as text so the credential can be a
        /// cache key).
        secret_json: String,
        user: Option<String>,
        organization: Option<String>,
    },
    /// Scala `LegacyDataVaultCredential(user, password)`.
    Legacy {
        user: String,
        password: Option<String>,
    },
}

impl DataVaultCredential {
    pub fn legacy(user: impl Into<String>, password: Option<String>) -> Self {
        Self::Legacy {
            user: user.into(),
            password,
        }
    }

    /// Scala `name` (`""` for legacy credentials).
    pub fn name(&self) -> &str {
        match self {
            Self::HttpBasicAuth { name, .. }
            | Self::XAuthToken { name, .. }
            | Self::S3AccessKey { name, .. }
            | Self::GoogleServiceAccount { name, .. } => name,
            Self::Legacy { .. } => "",
        }
    }

    /// Scala `HttpsDataVault.getBasicAuthCredential`: `(username, password)`.
    pub fn basic_auth(&self) -> Option<(&str, &str)> {
        match self {
            Self::HttpBasicAuth {
                username, password, ..
            } => Some((username, password)),
            Self::Legacy { user, password } => Some((user, password.as_deref().unwrap_or(""))),
            _ => None,
        }
    }

    /// Scala `S3DataVault.s3CredentialFrom`: `(accessKeyId, secretAccessKey)`.
    pub fn s3_access_key(&self) -> Option<(&str, &str)> {
        match self {
            Self::S3AccessKey {
                access_key_id,
                secret_access_key,
                ..
            } => Some((access_key_id, secret_access_key)),
            Self::Legacy { user, password } => Some((user, password.as_deref().unwrap_or(""))),
            _ => None,
        }
    }

    fn class_name(&self) -> &'static str {
        match self {
            Self::HttpBasicAuth { .. } => "HttpBasicAuthCredential",
            Self::XAuthToken { .. } => "XAuthTokenCredential",
            Self::S3AccessKey { .. } => "S3AccessKeyCredential",
            Self::GoogleServiceAccount { .. } => "GoogleServiceAccountCredential",
            Self::Legacy { .. } => "LegacyDataVaultCredential",
        }
    }

    /// Parse the Play-JSON sealed-family format.
    pub fn from_json(value: &Value) -> Result<Self, String> {
        let object = value
            .as_object()
            .ok_or_else(|| "credential must be a JSON object".to_owned())?;
        let type_name = object
            .get("_type")
            .and_then(Value::as_str)
            .ok_or_else(|| "credential is missing _type".to_owned())?;
        let class = type_name.strip_prefix(CLASS_PREFIX).unwrap_or(type_name);
        let string = |key: &str| -> Result<String, String> {
            object
                .get(key)
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| format!("credential field {key} missing or not a string"))
        };
        let optional = |key: &str| -> Result<Option<String>, String> {
            match object.get(key) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(s)) => Ok(Some(s.clone())),
                Some(_) => Err(format!("credential field {key} is not a string")),
            }
        };
        Ok(match class {
            "HttpBasicAuthCredential" => Self::HttpBasicAuth {
                name: string("name")?,
                username: string("username")?,
                password: string("password")?,
                user: optional("user")?,
                organization: optional("organization")?,
            },
            "XAuthTokenCredential" => Self::XAuthToken {
                name: string("name")?,
                token_value: string("tokenValue")?,
                user: optional("user")?,
                organization: optional("organization")?,
            },
            "S3AccessKeyCredential" => Self::S3AccessKey {
                name: string("name")?,
                access_key_id: string("accessKeyId")?,
                secret_access_key: string("secretAccessKey")?,
                user: optional("user")?,
                organization: optional("organization")?,
            },
            "GoogleServiceAccountCredential" => Self::GoogleServiceAccount {
                name: string("name")?,
                secret_json: object
                    .get("secretJson")
                    .ok_or_else(|| "credential field secretJson missing".to_owned())?
                    .to_string(),
                user: optional("user")?,
                organization: optional("organization")?,
            },
            "LegacyDataVaultCredential" => Self::Legacy {
                user: string("user")?,
                password: optional("password")?,
            },
            other => return Err(format!("unknown credential type {other}")),
        })
    }

    /// Serialize in the Play-JSON sealed-family format (includes secrets: wire use only).
    pub fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert(
            "_type".into(),
            Value::String(format!("{CLASS_PREFIX}{}", self.class_name())),
        );
        let fields = match self {
            Self::HttpBasicAuth {
                name,
                username,
                password,
                user,
                organization,
            } => {
                json!({"name": name, "username": username, "password": password, "user": user, "organization": organization})
            }
            Self::XAuthToken {
                name,
                token_value,
                user,
                organization,
            } => {
                json!({"name": name, "tokenValue": token_value, "user": user, "organization": organization})
            }
            Self::S3AccessKey {
                name,
                access_key_id,
                secret_access_key,
                user,
                organization,
            } => {
                json!({"name": name, "accessKeyId": access_key_id, "secretAccessKey": secret_access_key, "user": user, "organization": organization})
            }
            Self::GoogleServiceAccount {
                name,
                secret_json,
                user,
                organization,
            } => json!({
                "name": name,
                "secretJson": serde_json::from_str::<Value>(secret_json).unwrap_or(Value::Null),
                "user": user,
                "organization": organization
            }),
            Self::Legacy { user, password } => json!({"user": user, "password": password}),
        };
        if let Value::Object(fields) = fields {
            for (key, value) in fields {
                // Play omits `None` options.
                if !value.is_null() {
                    object.insert(key, value);
                }
            }
        }
        Value::Object(object)
    }
}

impl From<&config::DataVaultCredential> for DataVaultCredential {
    /// Scala `CredentialConfigReader.getCredential` (global credentials are not user-scoped).
    fn from(value: &config::DataVaultCredential) -> Self {
        match value {
            config::DataVaultCredential::S3AccessKey {
                name,
                key_id,
                secret,
            } => Self::S3AccessKey {
                name: name.clone(),
                access_key_id: key_id.clone(),
                secret_access_key: secret.expose().to_owned(),
                user: None,
                organization: None,
            },
            config::DataVaultCredential::HttpBasicAuth {
                name,
                username,
                password,
            } => Self::HttpBasicAuth {
                name: name.clone(),
                username: username.clone(),
                password: password.expose().to_owned(),
                user: None,
                organization: None,
            },
            config::DataVaultCredential::GoogleServiceAccount { name, secret_json } => {
                Self::GoogleServiceAccount {
                    name: name.clone(),
                    secret_json: serde_json::from_str::<Value>(secret_json.expose())
                        .map(|v| v.to_string())
                        .unwrap_or_else(|_| secret_json.expose().to_owned()),
                    user: None,
                    organization: None,
                }
            }
            config::DataVaultCredential::HttpToken { name, token } => Self::XAuthToken {
                name: name.clone(),
                token_value: token.expose().to_owned(),
                user: None,
                organization: None,
            },
        }
    }
}

impl fmt::Debug for DataVaultCredential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut s = f.debug_struct(self.class_name());
        match self {
            Self::S3AccessKey { access_key_id, .. } => {
                s.field("name", &self.name())
                    .field("access_key_id", access_key_id);
            }
            Self::HttpBasicAuth { username, .. } => {
                s.field("name", &self.name()).field("username", username);
            }
            Self::Legacy { user, .. } => {
                s.field("user", user);
            }
            _ => {
                s.field("name", &self.name());
            }
        }
        s.field("secret", &"[redacted]").finish()
    }
}

impl Serialize for DataVaultCredential {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for DataVaultCredential {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        Self::from_json(&value).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
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
}
