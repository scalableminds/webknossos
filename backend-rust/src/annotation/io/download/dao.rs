//! Queries behind annotation downloads: layers, datasets, users and the
//! project, task and task type lookups of the compound downloads.
use sqlx::PgPool;

use super::{CompoundRow, DatasetRow, LayerRow};
use crate::{
    annotation::provider::{push_task_list, push_task_read, push_task_type_read},
    auth::AuthUser,
    error::ApiResult,
    sql::Sql,
    users,
    util::id::ObjectId,
};

pub(crate) async fn find_all_layers(
    pool: &PgPool,
    annotation_id: &ObjectId,
) -> ApiResult<Vec<LayerRow>> {
    Ok(sqlx::query_as(
        "SELECT tracingId AS tracing_id,typ::text AS typ,name FROM webknossos.annotation_layers
         WHERE _annotation=$1 ORDER BY tracingId",
    )
    .bind(annotation_id)
    .fetch_all(pool)
    .await?)
}

/// DatasetDAO.findOne under GlobalAccessContext (live datasets).
pub(crate) async fn find_dataset(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> ApiResult<Option<DatasetRow>> {
    Ok(sqlx::query_as(
        "SELECT _id AS id,name,_organization AS organization,
           CASE WHEN voxelSizeFactor IS NULL THEN NULL
             ELSE ARRAY[(voxelSizeFactor).x,(voxelSizeFactor).y,(voxelSizeFactor).z] END AS factor,
           voxelSizeUnit::text AS unit
         FROM webknossos.datasets_ WHERE _id=$1",
    )
    .bind(dataset_id)
    .fetch_optional(pool)
    .await?)
}

/// MultiUserDAO.findOne: (firstName, lastName). MultiUserDAO keeps the
/// default access predicates: global/authenticated TRUE, anonymous FALSE.
pub(crate) async fn find_multi_user_names(
    pool: &PgPool,
    multi_user_id: &ObjectId,
) -> ApiResult<Option<(String, String)>> {
    Ok(
        sqlx::query_as("SELECT firstName,lastName FROM webknossos.multiUsers_ WHERE _id=$1")
            .bind(multi_user_id)
            .fetch_optional(pool)
            .await?,
    )
}

/// TaskDAO.findOne: globally (`requester = None`) or under the requester's
/// read access (`Some(user_opt)`).
pub(crate) async fn task_exists(
    pool: &PgPool,
    task_id: &ObjectId,
    requester: Option<Option<&AuthUser>>,
) -> ApiResult<bool> {
    let mut q = Sql::new("SELECT EXISTS(SELECT 1 FROM webknossos.tasks_ t WHERE t._id=");
    q.push_bind(task_id);
    if let Some(user) = requester {
        q.push(" AND ");
        push_task_read(&mut q, user.into());
    }
    q.push(")");
    Ok(q.build_query_scalar().fetch_one(pool).await?)
}

const COMPOUND_COLUMNS: &str = "a._id AS id,a._dataset AS dataset_id,a._task AS task_id,\
     a._user AS owner_id,a.description";

/// ProjectDAO.findOne under the requester: (team, name).
pub(crate) async fn find_project(
    pool: &PgPool,
    user: &AuthUser,
    project_id: &ObjectId,
) -> ApiResult<Option<(ObjectId, String)>> {
    let mut q = Sql::new("SELECT p._team,p.name FROM webknossos.projects_ p WHERE p._id=");
    q.push_bind(project_id).push(" AND ");
    crate::projects::push_read_access(&mut q, user.into());
    Ok(q.build_query_as().fetch_optional(pool).await?)
}

/// TaskDAO.findOne under the requester: the task's project.
pub(crate) async fn find_task_project(
    pool: &PgPool,
    user: &AuthUser,
    task_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    let mut q = Sql::new("SELECT t._project FROM webknossos.tasks_ t WHERE t._id=");
    q.push_bind(task_id).push(" AND ");
    push_task_read(&mut q, user.into());
    Ok(q.build_query_scalar().fetch_optional(pool).await?)
}

/// TaskTypeDAO.findOne under the requester: (team, summary).
pub(crate) async fn find_task_type(
    pool: &PgPool,
    user: &AuthUser,
    task_type_id: &ObjectId,
) -> ApiResult<Option<(ObjectId, String)>> {
    let mut q = Sql::new("SELECT tt._team,tt.summary FROM webknossos.taskTypes_ tt WHERE tt._id=");
    q.push_bind(task_type_id).push(" AND ");
    push_task_type_read(&mut q, user.into());
    Ok(q.build_query_as().fetch_optional(pool).await?)
}

/// AnnotationDAO.findAllFinishedForProject (no annotation access predicate;
/// Scala has no ORDER BY, ordered by creation for determinism).
pub(crate) async fn finished_project_annotations(
    pool: &PgPool,
    project_id: &ObjectId,
) -> ApiResult<Vec<CompoundRow>> {
    let mut q = Sql::new("SELECT ");
    q.push(COMPOUND_COLUMNS)
        .push(
            " FROM webknossos.annotations_ a
         JOIN webknossos.tasks_ t ON a._task=t._id
         WHERE t._project=",
        )
        .push_bind(project_id)
        .push(" AND a.typ='Task' AND a.state='Finished' ORDER BY a.created,a._id");
    Ok(q.build_query_as().fetch_all(pool).await?)
}

/// TaskDAO.findAllByTaskType: list access, at most 1000 tasks.
pub(crate) async fn task_type_tasks(
    pool: &PgPool,
    user: &AuthUser,
    task_type_id: &ObjectId,
) -> ApiResult<Vec<ObjectId>> {
    let mut q = Sql::new("SELECT t._id FROM webknossos.tasks_ t WHERE t._taskType=");
    q.push_bind(task_type_id).push(" AND ");
    push_task_list(&mut q, user.into());
    q.push(" ORDER BY t._id LIMIT 1000");
    Ok(q.build_query_scalar().fetch_all(pool).await?)
}

/// `annotationService.annotationsFor(task)` (readable, non-cancelled Task
/// annotations) per task in order, filtered to Finished.
pub(crate) async fn finished_task_annotations(
    pool: &PgPool,
    user: &AuthUser,
    task_ids: &[ObjectId],
) -> ApiResult<Vec<CompoundRow>> {
    let mut q = Sql::new("SELECT ");
    q.push(COMPOUND_COLUMNS)
        .push(" FROM webknossos.annotations_ a JOIN unnest(")
        .push_bind(task_ids)
        .push(
            "::text[]) WITH ORDINALITY AS requested(task, position) ON requested.task=a._task
         WHERE a.typ='Task' AND a.state='Finished' AND ",
        );
    crate::annotation::access::push_read_predicate(&mut q, user.into());
    q.push(" ORDER BY requested.position,a.created,a._id");
    Ok(q.build_query_as().fetch_all(pool).await?)
}

/// DatasetDAO.findOne under the requester (AuthorizedAccessContext, no
/// sharing token).
pub(crate) async fn find_readable_dataset(
    pool: &PgPool,
    user: &AuthUser,
    dataset_id: &ObjectId,
) -> ApiResult<Option<DatasetRow>> {
    let mut q = Sql::new(
        "SELECT d._id AS id,d.name,d._organization AS organization,
           CASE WHEN d.voxelSizeFactor IS NULL THEN NULL
             ELSE ARRAY[(d.voxelSizeFactor).x,(d.voxelSizeFactor).y,(d.voxelSizeFactor).z] END AS factor,
           d.voxelSizeUnit::text AS unit
         FROM webknossos.datasets_ d WHERE d._id=",
    );
    q.push_bind(dataset_id).push(" AND ");
    crate::dataset::access::push_read_predicate(&mut q, (&user.id).into(), None);
    Ok(q.build_query_as().fetch_optional(pool).await?)
}

/// UserDAO.findOne under the requester's read access: the owner's MultiUser id.
pub(crate) async fn find_multi_user_id_readable(
    pool: &PgPool,
    requester: &AuthUser,
    user_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    let mut q = Sql::new("SELECT usr._multiUser FROM webknossos.users_ usr WHERE usr._id=");
    q.push_bind(user_id).push(" AND ");
    users::push_read_access(&mut q, (&requester.id).into());
    Ok(q.build_query_scalar().fetch_optional(pool).await?)
}

/// OrganizationDAO.findOrganizationIdForAnnotation (no access predicate).
pub(crate) async fn find_organization_id_for_annotation(
    pool: &PgPool,
    annotation_id: &ObjectId,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT o._id FROM webknossos.annotations_ a
         JOIN webknossos.datasets_ d ON a._dataset=d._id
         JOIN webknossos.organizations_ o ON d._organization=o._id
         WHERE a._id=$1",
    )
    .bind(annotation_id)
    .fetch_optional(pool)
    .await?)
}
