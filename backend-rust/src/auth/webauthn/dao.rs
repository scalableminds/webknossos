//! WebAuthn DAOs: the webauthnCredentials, multiUsers and users queries behind
//! passkey registration and login.
//!
//! Callers own the connection and transaction; these functions only run SQL
//! and return rows. Mapping a missing row to an error is up to the caller.
use serde_json::Value as JsonValue;
use sqlx::{PgExecutor, PgPool};

use crate::{error::ApiResult, util::id::ObjectId};

/// Non-deleted credentials of an account (`findAllForUser`): id and serialized attested credential.
pub(crate) async fn find_all_for_multi_user<'e>(
    executor: impl PgExecutor<'e>,
    multi_user: &ObjectId,
) -> ApiResult<Vec<(String, Vec<u8>)>> {
    Ok(sqlx::query_as(
        "SELECT _id, serializedAttestedCredential FROM webknossos.webauthnCredentials_ WHERE _multiUser = $1 ORDER BY _id",
    )
    .bind(multi_user)
    .fetch_all(executor)
    .await?)
}

/// The account of a user: id, email and full name.
pub(crate) async fn find_multi_user_of_user(
    pool: &PgPool,
    user_id: &ObjectId,
) -> ApiResult<Option<(ObjectId, String, String)>> {
    Ok(sqlx::query_as(
        "SELECT m._id, m.email, m.firstName || ' ' || m.lastName FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON m._id = u._multiUser WHERE u._id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?)
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_credential(
    pool: &PgPool,
    multi_user: &ObjectId,
    credential_id: &[u8],
    name: &str,
    user_verified: bool,
    backup_eligible: bool,
    backup_state: bool,
    serialized_attestation_statement: JsonValue,
    serialized_attested_credential: Vec<u8>,
    serialized_extensions: JsonValue,
    signature_count: i32,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.webauthnCredentials (_id, _multiUser, credentialId, name, userVerified, backupEligible, backupState, serializedAttestationStatement, serializedAttestedCredential, serializedExtensions, signatureCount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(ObjectId::new())
    .bind(multi_user)
    .bind(credential_id)
    .bind(name)
    .bind(user_verified)
    .bind(backup_eligible)
    .bind(backup_state)
    .bind(serialized_attestation_statement)
    .bind(serialized_attested_credential)
    .bind(serialized_extensions)
    .bind(signature_count)
    .execute(pool)
    .await?;
    Ok(())
}

/// The account id and its last logged-in identity.
pub(crate) async fn find_one_multi_user(
    pool: &PgPool,
    multi_user_id: &ObjectId,
) -> ApiResult<Option<(ObjectId, Option<ObjectId>)>> {
    Ok(sqlx::query_as(
        "SELECT _id, _lastLoggedInIdentity FROM webknossos.multiUsers_ WHERE _id = $1",
    )
    .bind(multi_user_id)
    .fetch_optional(pool)
    .await?)
}

/// The credential of an account by its credential id: id, serialized attested
/// credential, backup-eligible flag and signature count.
pub(crate) async fn find_one_by_credential_id(
    pool: &PgPool,
    multi_user_id: &ObjectId,
    credential_id: &[u8],
) -> ApiResult<Option<(String, Vec<u8>, bool, i32)>> {
    Ok(sqlx::query_as(
        "SELECT _id, serializedAttestedCredential, backupEligible, signatureCount FROM webknossos.webauthnCredentials_ WHERE _multiUser = $1 AND credentialId = $2",
    )
    .bind(multi_user_id)
    .bind(credential_id)
    .fetch_optional(pool)
    .await?)
}

pub(crate) async fn update_signature_count(
    pool: &PgPool,
    id: &str,
    signature_count: i64,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.webauthnCredentials_ SET signatureCount = $2 WHERE _id = $1")
        .bind(id)
        .bind(signature_count)
        .execute(pool)
        .await?;
    Ok(())
}
