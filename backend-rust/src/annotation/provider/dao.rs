//! Queries behind the annotation provider: task, project and task type lookups
//! for the compound handlers and the task read/list access predicates.
use sqlx::PgPool;

use super::{AccessContext, TASK_ANNOTATION_COLUMNS, TaskAnnotation};
use crate::{
    sql::{PushArg, Requester, Sql},
    util::id::ObjectId,
};

/// TaskDAO.findAllByProjectAndTaskTypeAndIdsAndUser page size (first page only).
const TASK_TYPE_TASK_LIMIT: i64 = 1000;

/// The task bounding box components plus the task and annotation IDs.
pub(crate) type TaskBoundingBoxRow = (
    Option<f64>,
    Option<f64>,
    Option<f64>,
    Option<f64>,
    Option<f64>,
    Option<f64>,
    ObjectId,
    ObjectId,
);

/// The project of task `t` belongs to a team of the requester's organization
/// the requester has a role in (`managers_only`: manages), or the requester
/// administers that organization. The project/team subselects include
/// soft-deleted rows like Scala's.
fn push_task_project_grant<'a>(q: &mut Sql<'a>, requester: Requester<'a>, managers_only: bool) {
    q.push(
        "EXISTS(SELECT 1 FROM webknossos.projects access_project
    JOIN webknossos.teams access_team ON access_team._id=access_project._team
    WHERE access_project._id=t._project AND access_team._organization=",
    )
    .push_arg(requester.organization)
    .push(" AND (")
    .push_bind(requester.is_admin)
    .push(" OR EXISTS(SELECT 1 FROM webknossos.user_team_roles role WHERE role._user=")
    .push_arg(requester.id)
    .push(" AND role._team=access_project._team")
    .push(if managers_only {
        " AND role.isTeamManager"
    } else {
        ""
    })
    .push(")))");
}

/// TaskDAO.readAccessQ, alias `t`: the requester has a role in the project's
/// team, or administers the team's organization. Role grants are scoped to
/// the requester's organization.
pub(crate) fn push_task_read<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    push_task_project_grant(q, requester, false);
}

/// TaskDAO.listAccessQ (= deleteAccessQ): team manager of the project's team
/// or administrator of the team's organization.
pub(crate) fn push_task_list<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    push_task_project_grant(q, requester, true);
}

/// TaskTypeDAO.readAccessQ, alias `tt`.
pub(crate) fn push_task_type_read<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    q.push("(tt._organization=")
        .push_arg(requester.organization)
        .push(" AND (")
        .push_bind(requester.is_admin)
        .push(" OR EXISTS(SELECT 1 FROM webknossos.user_team_roles role WHERE role._user=")
        .push_arg(requester.id)
        .push(" AND role._team=tt._team)))");
}

/// AnnotationDAO.findAllFinishedForProject has no annotation read predicate:
/// authorization is the caller's team-manager assertion.
pub(crate) async fn find_all_finished_for_project(
    pool: &PgPool,
    project_id: &ObjectId,
) -> sqlx::Result<Vec<TaskAnnotation>> {
    let mut q = Sql::new("SELECT ");
    q.push(TASK_ANNOTATION_COLUMNS)
        .push(
            " FROM webknossos.annotations_ a
             JOIN webknossos.tasks_ t ON a._task=t._id
             WHERE t._project=",
        )
        .push_bind(project_id)
        .push(" AND a.typ='Task' AND a.state='Finished' ORDER BY a.created,a._id");
    q.build_query_as().fetch_all(pool).await
}

/// The IDs of the task type's tasks (first page of 1000), under the TaskDAO
/// list grant unless the context is global.
pub(crate) async fn find_all_task_ids_for_task_type(
    pool: &PgPool,
    context: AccessContext<'_>,
    task_type_id: &ObjectId,
) -> sqlx::Result<Vec<ObjectId>> {
    let mut q = Sql::new("SELECT t._id FROM webknossos.tasks_ t WHERE t._taskType=");
    q.push_bind(task_type_id);
    if !context.global {
        q.push(" AND ");
        push_task_list(&mut q, context.requester.into());
    }
    q.push(" ORDER BY t._id LIMIT ")
        .push_bind(TASK_TYPE_TASK_LIMIT);
    q.build_query_scalar().fetch_all(pool).await
}

/// TaskDAO.findOne under the access context: the task's project ID.
pub(crate) async fn find_task_project(
    pool: &PgPool,
    context: AccessContext<'_>,
    task_id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    let mut q = Sql::new("SELECT t._project FROM webknossos.tasks_ t WHERE t._id=");
    q.push_bind(task_id);
    if !context.global {
        q.push(" AND ");
        push_task_read(&mut q, context.requester.into());
    }
    q.build_query_scalar().fetch_optional(pool).await
}

/// ProjectDAO.findOne under the access context: the project's team.
pub(crate) async fn find_project_team(
    pool: &PgPool,
    context: AccessContext<'_>,
    project_id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    let mut q = Sql::new("SELECT p._team FROM webknossos.projects_ p WHERE p._id=");
    q.push_bind(project_id);
    if !context.global {
        q.push(" AND ");
        crate::projects::push_read_access(&mut q, context.requester.into());
    }
    q.build_query_scalar().fetch_optional(pool).await
}

/// TaskTypeDAO.findOne under the access context: the task type's team.
pub(crate) async fn find_task_type_team(
    pool: &PgPool,
    context: AccessContext<'_>,
    task_type_id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    let mut q = Sql::new("SELECT tt._team FROM webknossos.taskTypes_ tt WHERE tt._id=");
    q.push_bind(task_type_id);
    if !context.global {
        q.push(" AND ");
        push_task_type_read(&mut q, context.requester.into());
    }
    q.build_query_scalar().fetch_optional(pool).await
}

/// AnnotationDAO.findAllByTaskIdAndType(task, Task) for each task in order
/// (Fox.serialCombined): live, non-cancelled, readable.
pub(crate) async fn find_all_task_annotations(
    pool: &PgPool,
    context: AccessContext<'_>,
    task_ids: &[ObjectId],
) -> sqlx::Result<Vec<TaskAnnotation>> {
    let mut q = Sql::new("SELECT ");
    q.push(TASK_ANNOTATION_COLUMNS)
        .push(" FROM webknossos.annotations_ a JOIN unnest(")
        .push_bind(task_ids)
        .push(
            "::text[]) WITH ORDINALITY AS requested(task, position) ON requested.task=a._task
             WHERE a.typ='Task' AND a.state<>'Cancelled'",
        );
    if !context.global {
        q.push(" AND ");
        crate::annotation::access::push_read_predicate(&mut q, context.requester.into());
    }
    q.push(" ORDER BY requested.position,a.created,a._id");
    q.build_query_as().fetch_all(pool).await
}

/// The live dataset (global access): whether it is usable and has a voxel size.
pub(crate) async fn find_dataset_usability(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<Option<(bool, bool)>> {
    sqlx::query_as(
        "SELECT isUsable,voxelSizeFactor IS NOT NULL FROM webknossos.datasets_ WHERE _id=$1",
    )
    .bind(dataset_id)
    .fetch_optional(pool)
    .await
}

/// TaskDAO.findTaskBoundingBoxesByAnnotationIds (no access predicate).
pub(crate) async fn find_task_bounding_boxes_by_annotation_ids(
    pool: &PgPool,
    annotation_ids: &[ObjectId],
) -> sqlx::Result<Vec<TaskBoundingBoxRow>> {
    sqlx::query_as(
        "SELECT (t.boundingBox).x,(t.boundingBox).y,(t.boundingBox).z,
               (t.boundingBox).width,(t.boundingBox).height,(t.boundingBox).depth,t._id,a._id
             FROM webknossos.tasks_ t JOIN webknossos.annotations_ a ON a._task=t._id
             WHERE a._id=ANY($1) AND t.boundingBox IS NOT NULL ORDER BY t._id,a._id",
    )
    .bind(annotation_ids)
    .fetch_all(pool)
    .await
}

/// datasetDAO.findOne(datasetId) under the access context: whether the dataset is readable.
pub(crate) async fn is_dataset_readable(
    pool: &PgPool,
    context: AccessContext<'_>,
    dataset_id: &ObjectId,
) -> sqlx::Result<bool> {
    let mut q = Sql::new("SELECT EXISTS(SELECT 1 FROM webknossos.datasets_ d WHERE d._id=");
    q.push_bind(dataset_id);
    if !context.global {
        q.push(" AND ");
        crate::dataset::access::push_read_predicate(
            &mut q,
            context.requester.map(|user| &user.id).into(),
            None,
        );
    }
    q.push(")");
    q.build_query_scalar().fetch_one(pool).await
}
