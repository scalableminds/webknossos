//! DataStoreDAO and TracingStoreDAO: the dataStores and tracingStores queries.
use serde_json::Value;
use sqlx::{Executor, PgConnection, PgPool, Postgres};

use crate::{error::ApiResult, util::id::ObjectId};

/// Names of the data stores visible to an organization, in a share lock.
pub(crate) async fn find_all_names_for_organization(
    connection: &mut PgConnection,
    organization_id: &str,
) -> ApiResult<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT name FROM webknossos.dataStores WHERE NOT isDeleted AND (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization = $1) ORDER BY name FOR SHARE",
    ).bind(organization_id).fetch_all(connection).await?)
}

pub(crate) async fn name_is_taken(
    connection: &mut PgConnection,
    name: &str,
    organization_id: &str,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.dataStores WHERE name = $1 AND NOT isDeleted AND (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization = $2))",
    ).bind(name).bind(organization_id).fetch_one(connection).await?)
}

pub(crate) async fn insert_one(
    connection: &mut PgConnection,
    name: &str,
    url: &str,
    public_url: &str,
    key: &str,
    allows_upload: bool,
    allows_upload_to_paths: bool,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.dataStores (name, url, publicUrl, key, \
                allowsUpload, allowsUploadToPaths, reportUsedStorageEnabled) VALUES ($1, $2, \
                $3, $4, $5, $6, FALSE)",
    )
    .bind(name)
    .bind(url)
    .bind(public_url)
    .bind(key)
    .bind(allows_upload)
    .bind(allows_upload_to_paths)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn delete_one(connection: &mut PgConnection, name: String) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.dataStores SET isDeleted = TRUE WHERE name = $1")
        .bind(name)
        .execute(connection)
        .await?;
    Ok(())
}

/// The id of the user if it is still a live superuser of the organization;
/// takes share locks on the multiUser, user and organization rows.
pub(crate) async fn lock_live_superuser(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    organization_id: &str,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        r#"SELECT usr._id FROM webknossos.users AS usr
          JOIN webknossos.multiUsers AS multi ON multi._id = usr._multiUser
          JOIN webknossos.organizations AS org ON org._id = usr._organization
          WHERE usr._id = $1 AND usr._organization = $2 AND multi.isSuperUser
            AND NOT usr.isDeleted AND NOT usr.isDeactivated AND NOT multi.isDeleted AND NOT org.isDeleted
          FOR SHARE OF multi, usr, org"#,
    ).bind(user_id).bind(organization_id).fetch_optional(connection).await?)
}

/// The public JSON (name and publicUrl) of the first tracing store.
pub(crate) async fn find_first_public_json(pool: &PgPool) -> ApiResult<Option<Value>> {
    Ok(sqlx::query_scalar(
        "SELECT jsonb_build_object('name', name, 'url', publicUrl) FROM \
            webknossos.tracingStores_ LIMIT 1",
    )
    .fetch_optional(pool)
    .await?)
}

pub(crate) async fn tracing_store_exists(pool: &PgPool, name: &str) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.tracingStores_ WHERE name = $1)",
    )
    .bind(name)
    .fetch_one(pool)
    .await?)
}

pub(crate) async fn update_tracing_store(
    pool: &PgPool,
    name: String,
    url: String,
    public_url: String,
) -> ApiResult<Option<Value>> {
    Ok(sqlx::query_scalar("UPDATE webknossos.tracingStores SET url=$2, publicUrl=$3 WHERE name=$1 AND NOT isDeleted RETURNING jsonb_build_object('name',name,'url',publicUrl)")
        .bind(name).bind(url).bind(public_url).fetch_optional(pool).await?)
}

pub(crate) async fn find_first_tracing_store_url<'e, E: Executor<'e, Database = Postgres>>(
    executor: E,
) -> ApiResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT url FROM webknossos.tracingStores_ ORDER BY name LIMIT 1")
            .fetch_optional(executor)
            .await?,
    )
}
