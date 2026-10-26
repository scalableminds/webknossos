//! CredentialDAO and the datastore access check of the credential RPC.
use sqlx::PgConnection;

use super::StoredCredential;
use crate::{auth::AuthUser, error::ApiResult, util::id::ObjectId};

/// Insert a credential owned by the live `user`. Returns the affected row
/// count (0 if the user is no longer live), taking share locks on the
/// multiUser, user and organization rows.
pub(crate) async fn insert_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    kind: &str,
    name: &str,
    identifier: Option<&str>,
    secret: String,
    user: &AuthUser,
) -> ApiResult<u64> {
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
    .bind(id).bind(kind).bind(name).bind(identifier).bind(secret)
    .bind(&user.id).bind(&user.organization_id)
    .execute(connection).await?;
    Ok(result.rows_affected())
}

/// DataStoreService.validateAccess: `onlyAllowedOrganization` of the live
/// datastore with this name and key (outer `None`: no such datastore).
pub(crate) async fn find_only_allowed_organization_for_share(
    connection: &mut PgConnection,
    name: &str,
    key: &str,
) -> ApiResult<Option<Option<String>>> {
    Ok(sqlx::query_scalar(
        "SELECT onlyAllowedOrganization FROM webknossos.dataStores WHERE name = $1 AND key = $2 AND NOT isDeleted FOR SHARE",
    ).bind(name).bind(key).fetch_optional(connection).await?)
}

pub(crate) async fn find_one(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> ApiResult<Option<StoredCredential>> {
    Ok(sqlx::query_as::<_, StoredCredential>(
        "SELECT type::text AS kind, name, identifier, secret, _user AS user_id, _organization AS organization FROM webknossos.credentials WHERE _id = $1 AND NOT isDeleted",
    ).bind(id).fetch_optional(connection).await?)
}
