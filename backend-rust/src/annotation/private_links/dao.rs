//! AnnotationPrivateLinkDAO: the annotation_privateLinks queries and the
//! annotation source lookup.
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{Executor, PgConnection, PgPool, Postgres};

use super::PrivateLink;
use crate::{auth::AuthUser, error::ApiResult, sql::Sql, util::id::ObjectId};

/// Live private links of the user's live annotations; callers append further conditions.
fn select(user: &AuthUser) -> Sql<'_> {
    let mut q = Sql::new(
        "SELECT link._id AS id,link._annotation AS annotation,link.accessToken AS access_token,link.expirationDateTime AS expiration FROM webknossos.annotation_privateLinks link JOIN webknossos.annotations a ON a._id=link._annotation WHERE NOT link.isDeleted AND NOT a.isDeleted AND a._user=",
    );
    q.push_bind(&user.id);
    q
}

/// The user's live private link `id`; `lock` takes a row lock on it.
pub(crate) async fn find_one_owned<'e, E: Executor<'e, Database = Postgres>>(
    executor: E,
    user: &AuthUser,
    id: &ObjectId,
    lock: bool,
) -> ApiResult<Option<PrivateLink>> {
    let suffix = if lock { " FOR UPDATE OF link" } else { "" };
    let mut q = select(user);
    q.push(" AND link._id=").push_bind(id).push(suffix);
    Ok(q.build_query_as().fetch_optional(executor).await?)
}

pub(crate) async fn find_all_for_user(
    pool: &PgPool,
    user: &AuthUser,
) -> ApiResult<Vec<PrivateLink>> {
    Ok(select(user).build_query_as().fetch_all(pool).await?)
}

pub(crate) async fn find_all_for_annotation(
    pool: &PgPool,
    user: &AuthUser,
    annotation_id: &ObjectId,
) -> ApiResult<Vec<PrivateLink>> {
    let mut q = select(user);
    q.push(" AND link._annotation=").push_bind(annotation_id);
    Ok(q.build_query_as().fetch_all(pool).await?)
}

pub(crate) async fn insert_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    annotation_id: &ObjectId,
    access_token: String,
    expiration: Option<DateTime<Utc>>,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO \
            webknossos.annotation_privateLinks(_id,_annotation,accessToken,expirationDateTime) \
            VALUES($1,$2,$3,$4)",
    )
    .bind(id)
    .bind(annotation_id)
    .bind(access_token)
    .bind(expiration)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn update_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    annotation_id: &ObjectId,
    expiration: Option<DateTime<Utc>>,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE webknossos.annotation_privateLinks SET \
            _annotation=$2,expirationDateTime=$3 WHERE _id=$1 AND NOT isDeleted",
    )
    .bind(id)
    .bind(annotation_id)
    .bind(expiration)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn delete_one(connection: &mut PgConnection, id: &ObjectId) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.annotation_privateLinks SET isDeleted=true WHERE _id=$1")
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

/// The annotation behind the unexpired private link with this access token.
pub(crate) async fn find_annotation_id_by_access_token(
    pool: &PgPool,
    access_token: &str,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT link._annotation FROM webknossos.annotation_privateLinks_ link JOIN \
            webknossos.annotations_ a ON a._id=link._annotation WHERE link.accessToken=$1 AND \
            (link.expirationDateTime IS NULL OR link.expirationDateTime>statement_timestamp())",
    )
    .bind(access_token)
    .fetch_optional(pool)
    .await?)
}

/// The annotation's layers and its dataset, data store and tracing store URLs
/// as `/annotations/source` renders them.
pub(crate) async fn find_source_json(
    pool: &PgPool,
    annotation_id: &ObjectId,
    via_private_link: bool,
) -> ApiResult<Option<Value>> {
    Ok(sqlx::query_scalar(
        r#"SELECT jsonb_build_object('id',a._id,
        'annotationLayers',COALESCE((SELECT jsonb_agg(jsonb_build_object('tracingId',layer.tracingId,'typ',layer.typ,'name',layer.name,'stats',layer.statistics) ORDER BY layer.tracingId) FROM webknossos.annotation_layers layer WHERE layer._annotation=a._id),'[]'::jsonb),
        'datasetDirectoryName',d.directoryName,'datasetId',d._id,'organizationId',organization._id,
        'dataStoreUrl',store.publicUrl,'tracingStoreUrl',(SELECT publicUrl FROM webknossos.tracingStores_ LIMIT 1),
        'accessViaPrivateLink',$2)
        FROM webknossos.annotations_ a JOIN webknossos.datasets_ d ON d._id=a._dataset
        JOIN webknossos.organizations_ organization ON organization._id=d._organization
        JOIN webknossos.dataStores_ store ON store.name=trim(d._dataStore)
        WHERE a._id=$1"#,
    )
    .bind(annotation_id)
    .bind(via_private_link)
    .fetch_optional(pool)
    .await?)
}
