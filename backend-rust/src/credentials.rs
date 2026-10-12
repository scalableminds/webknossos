//! Datastore credential RPC and the credential creation/storage prerequisite
//! used by remote dataset exploration. There are no public credential CRUD
//! routes in the Scala application's route table.
use std::fmt;

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};
use url::Url;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    id::ObjectId,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/datastores/{name}/findCredential", get(find_credential))
}

/// This deliberately has no derived Debug or Serialize implementation: secrets
/// may be serialized only by the authenticated datastore RPC below.
pub enum CredentialInput {
    HttpBasicAuth {
        name: String,
        username: String,
        password: String,
    },
    HttpToken {
        name: String,
        token_value: String,
    },
    S3AccessKey {
        name: String,
        access_key_id: String,
        secret_access_key: String,
    },
    GoogleServiceAccount {
        name: String,
        secret_json: Value,
    },
}

impl fmt::Debug for CredentialInput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match self {
            Self::HttpBasicAuth { .. } => "HttpBasicAuth",
            Self::HttpToken { .. } => "HttpToken",
            Self::S3AccessKey { .. } => "S3AccessKey",
            Self::GoogleServiceAccount { .. } => "GoogleServiceAccount",
        };
        f.debug_struct("CredentialInput")
            .field("type", &kind)
            .field("values", &"[redacted]")
            .finish()
    }
}

impl CredentialInput {
    /// Match CredentialService.createCredentialOpt for an already parsed URI.
    /// Remote exploration must normalize/validate its source URI before calling
    /// this function. Unsupported schemes and incomplete S3/GS inputs carry no
    /// credential, as in the Scala service.
    pub fn for_uri(uri: &Url, identifier: Option<&str>, secret: Option<&str>) -> Option<Self> {
        let name = uri.as_str().to_owned();
        match uri.scheme() {
            "http" | "https" => match identifier.filter(|value| !value.is_empty()) {
                Some(username) => Some(Self::HttpBasicAuth {
                    name,
                    username: username.to_owned(),
                    password: secret.unwrap_or("").to_owned(),
                }),
                None => secret.map(|token| Self::HttpToken {
                    name,
                    token_value: token.to_owned(),
                }),
            },
            "s3" => identifier
                .zip(secret)
                .map(|(key_id, key)| Self::S3AccessKey {
                    name,
                    access_key_id: key_id.to_owned(),
                    secret_access_key: key.to_owned(),
                }),
            "gs" => secret
                .and_then(|secret| serde_json::from_str(secret).ok())
                .map(|secret_json| Self::GoogleServiceAccount { name, secret_json }),
            _ => None,
        }
    }

    fn storage_fields(&self) -> (&'static str, &str, Option<&str>, String) {
        match self {
            Self::HttpBasicAuth {
                name,
                username,
                password,
            } => ("HttpBasicAuth", name, Some(username), password.clone()),
            Self::HttpToken { name, token_value } => ("HttpToken", name, None, token_value.clone()),
            Self::S3AccessKey {
                name,
                access_key_id,
                secret_access_key,
            } => (
                "S3AccessKey",
                name,
                Some(access_key_id),
                secret_access_key.clone(),
            ),
            Self::GoogleServiceAccount { name, secret_json } => {
                ("GoogleServiceAccount", name, None, secret_json.to_string())
            }
        }
    }
}

/// Insert inside the caller's transaction so remote-dataset metadata and its
/// stored credentials can commit or roll back together. Ownership is taken
/// from the authenticated user, never from credential payload fields.
pub async fn insert_credential(
    tx: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    credential: &CredentialInput,
) -> ApiResult<ObjectId> {
    let id = ObjectId::new();
    let (kind, name, identifier, secret) = credential.storage_fields();
    let result = sqlx::query(
        r#"INSERT INTO webknossos.credentials (_id, type, name, identifier, secret, _user, _organization)
          SELECT $1, $2::webknossos.CREDENTIAL_TYPE, $3, $4, $5, usr._id, usr._organization
          FROM webknossos.users AS usr
          JOIN webknossos.multiUsers AS multi ON multi._id = usr._multiUser
          JOIN webknossos.organizations AS org ON org._id = usr._organization
          WHERE usr._id = $6 AND usr._organization = $7
            AND NOT usr.isDeleted AND NOT usr.isDeactivated AND NOT multi.isDeleted AND NOT org.isDeleted
          FOR SHARE OF multi, usr, org"#,
    )
    .bind(id.as_str()).bind(kind).bind(name).bind(identifier).bind(secret)
    .bind(&user.id).bind(&user.organization_id)
    .execute(&mut **tx).await?;
    if result.rows_affected() != 1 {
        return Err(ApiError::unauthorized());
    }
    Ok(id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CredentialQuery {
    key: String,
    credential_id: ObjectId,
}

// Datastore keys are the service credential for this RPC. It is intentionally
// independent of bearer-user authentication, matching DataStoreService's global
// datastore validation: an authorized datastore can load credentials needed for
// datasets from any organization. Never log the key or raw query URI.
async fn find_credential(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(query): Query<CredentialQuery>,
) -> ApiResult<Response> {
    let mut tx = state.pool.begin().await?;
    let allowed: Option<String> = sqlx::query_scalar(
        "SELECT name FROM webknossos.dataStores WHERE name = $1 AND key = $2 AND NOT isDeleted FOR SHARE",
    ).bind(&name).bind(&query.key).fetch_optional(&mut *tx).await?;
    if allowed.is_none() {
        return Ok((
            StatusCode::FORBIDDEN,
            Json(json!({
                "granted": false,
                "msg": "Data store could not be found or accessed."
            })),
        )
            .into_response());
    }
    let row = sqlx::query_as::<_, StoredCredential>(
        "SELECT type::text AS kind, name, identifier, secret, _user AS user_id, _organization AS organization FROM webknossos.credentials WHERE _id = $1 AND NOT isDeleted",
    ).bind(query.credential_id.as_str()).fetch_optional(&mut *tx).await?;
    let credential = row.ok_or_else(|| ApiError::not_found("Credential not found."))?;
    let response = credential.datastore_json()?;
    tx.commit().await?;
    Ok(Json(response).into_response())
}

#[derive(sqlx::FromRow)]
struct StoredCredential {
    kind: String,
    name: String,
    identifier: Option<String>,
    secret: Option<String>,
    user_id: String,
    organization: String,
}

impl StoredCredential {
    fn datastore_json(self) -> ApiResult<Value> {
        let secret = self.secret.ok_or_else(ApiError::internal)?;
        let (class, fields) = match self.kind.as_str() {
            "HttpBasicAuth" => (
                "HttpBasicAuthCredential",
                json!({
                    "username": self.identifier.ok_or_else(ApiError::internal)?, "password": secret
                }),
            ),
            "HttpToken" => ("XAuthTokenCredential", json!({ "tokenValue": secret })),
            "S3AccessKey" => (
                "S3AccessKeyCredential",
                json!({
                    "accessKeyId": self.identifier.ok_or_else(ApiError::internal)?, "secretAccessKey": secret
                }),
            ),
            "GoogleServiceAccount" => (
                "GoogleServiceAccountCredential",
                json!({
                    "secretJson": serde_json::from_str::<Value>(&secret).map_err(|_| ApiError::internal())?
                }),
            ),
            _ => return Err(ApiError::internal()),
        };
        let mut response = json!({
            "_type": format!("com.scalableminds.webknossos.datastore.storage.{class}"),
            "name": self.name,
            "user": self.user_id,
            "organization": self.organization
        });
        response
            .as_object_mut()
            .ok_or_else(ApiError::internal)?
            .extend(fields.as_object().ok_or_else(ApiError::internal)?.clone());
        Ok(response)
    }
}

/// Convenient single-record storage for callers that have no other mutations.
pub async fn store_credential(
    pool: &PgPool,
    user: &AuthUser,
    credential: &CredentialInput,
) -> ApiResult<ObjectId> {
    let mut tx = pool.begin().await?;
    let id = insert_credential(&mut tx, user, credential).await?;
    tx.commit().await?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creation_matches_supported_schemes_and_optional_input_semantics() {
        let http = Url::parse("https://example.test/data").unwrap();
        assert!(
            matches!(CredentialInput::for_uri(&http, Some("alice"), None), Some(CredentialInput::HttpBasicAuth { password, .. }) if password.is_empty())
        );
        assert!(
            matches!(CredentialInput::for_uri(&http, Some(""), Some("secret")), Some(CredentialInput::HttpToken { token_value, .. }) if token_value == "secret")
        );
        assert!(CredentialInput::for_uri(&http, None, None).is_none());
        let s3 = Url::parse("s3://bucket/data").unwrap();
        assert!(CredentialInput::for_uri(&s3, Some("key"), None).is_none());
        assert!(CredentialInput::for_uri(&s3, None, Some("secret")).is_none());
        assert!(matches!(
            CredentialInput::for_uri(&s3, Some(""), Some("")),
            Some(CredentialInput::S3AccessKey { .. })
        ));
        let gs = Url::parse("gs://bucket/data").unwrap();
        assert!(CredentialInput::for_uri(&gs, None, Some("malformed json")).is_none());
        assert!(
            matches!(CredentialInput::for_uri(&gs, None, Some("null")), Some(CredentialInput::GoogleServiceAccount { secret_json, .. }) if secret_json.is_null())
        );
        assert!(
            CredentialInput::for_uri(
                &Url::parse("file:///data").unwrap(),
                Some("user"),
                Some("secret")
            )
            .is_none()
        );
    }

    #[test]
    fn debug_never_contains_credential_values() {
        let credential = CredentialInput::HttpBasicAuth {
            name: "https://secret-url.test".into(),
            username: "secret-user".into(),
            password: "secret-password".into(),
        };
        let debug = format!("{credential:?}");
        for secret in ["secret-url", "secret-user", "secret-password"] {
            assert!(!debug.contains(secret));
        }
    }
}
