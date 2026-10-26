//! Queries of the validateUserAccess callbacks (WKRemoteDataStoreController /
//! WKRemoteTracingStoreController). The datastore and tracingstore callbacks
//! have their own `dao.rs` in `datastore` and `tracingstore`.
use sqlx::PgPool;

use crate::{auth::AuthUser, error::ApiResult, util::id::ObjectId};

/// Whether a live datastore has this name and key.
pub(crate) async fn data_store_key_is_valid(
    pool: &PgPool,
    name: String,
    key: &str,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.dataStores_ WHERE name=$1 AND key=$2)",
    )
    .bind(name)
    .bind(key)
    .fetch_one(pool)
    .await?)
}

/// The annotation a tracing id belongs to.
pub(crate) async fn find_annotation_id_for_tracing(
    pool: &PgPool,
    tracing_id: &str,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT a._id FROM webknossos.annotations_ a JOIN \
                    webknossos.annotation_layers layer ON layer._annotation=a._id WHERE \
                    layer.tracingId=$1 LIMIT 1",
    )
    .bind(tracing_id)
    .fetch_optional(pool)
    .await?)
}

pub(crate) async fn find_dataset_organization(
    pool: &PgPool,
    id: &ObjectId,
) -> ApiResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT _organization FROM webknossos.datasets_ WHERE _id=$1")
            .bind(id)
            .fetch_optional(pool)
            .await?,
    )
}

/// Whether the annotation has a private link with this token that has not expired.
pub(crate) async fn has_valid_private_link(
    pool: &PgPool,
    annotation_id: &ObjectId,
    token: Option<&str>,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM webknossos.annotation_privateLinks_ WHERE \
                _annotation=$1 AND accessToken=$2 AND (expirationDateTime IS NULL OR \
                expirationDateTime > statement_timestamp()))",
    )
    .bind(annotation_id)
    .bind(token)
    .fetch_one(pool)
    .await?)
}

/// Whether the user (if any) may read the job export: owner, superuser,
/// admin of the owner's organization, or team manager of the owner.
pub(crate) async fn can_read_job_export(
    pool: &PgPool,
    id: &ObjectId,
    user: Option<&AuthUser>,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM webknossos.jobs_ j WHERE j._id=$1 AND
      (j._owner=$2 OR $3 OR ($4 AND EXISTS (SELECT 1 FROM webknossos.users_ owner WHERE owner._id=j._owner AND owner._organization=$5))
      OR EXISTS(SELECT 1 FROM webknossos.user_team_roles requester JOIN webknossos.user_team_roles owner_role ON owner_role._team=requester._team
        JOIN webknossos.teams_ team ON team._id=requester._team AND team._organization=$5
        JOIN webknossos.users_ owner ON owner._id=owner_role._user AND owner._organization=$5
        WHERE requester._user=$2 AND requester.isTeamManager AND owner._id=j._owner)))"#,
    )
    .bind(id)
    .bind(user.map(|u| &u.id))
    .bind(user.is_some_and(|u| u.is_superuser))
    .bind(user.is_some_and(|u| u.is_admin))
    .bind(user.map(|u| u.organization_id.as_str()))
    .fetch_one(pool)
    .await?)
}
