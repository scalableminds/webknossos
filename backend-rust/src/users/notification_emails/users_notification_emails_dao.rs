//! Queries behind the notification emails: the users, multiUsers, teams,
//! annotations, datasets, projects and tasks that the email texts are built from.
//!
//! Callers own the connection and transaction; these functions only run SQL
//! and return rows. They return `sqlx::Result` because the callers run in
//! background tasks that only log the error.
use sqlx::{FromRow, PgConnection, PgExecutor, PgPool};

use super::{Candidate, SharedResource};
use crate::{
    sql::{Arg, Requester, Sql},
    util::id::ObjectId,
};

/// A user's multi user: name and email.
#[derive(FromRow)]
pub(crate) struct Person {
    pub user_id: ObjectId,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
}

/// Team members who might gain access through a team share: the members of
/// the added teams (deactivated, unlisted and excluded users left out) with
/// the added teams they are a member of.
pub(crate) async fn find_all_share_candidates(
    connection: &mut PgConnection,
    added_team_ids: &[ObjectId],
    exclude: &[&ObjectId],
) -> sqlx::Result<Vec<Candidate>> {
    sqlx::query_as(
        "SELECT u._id AS user_id, array_agg(DISTINCT r._team ORDER BY r._team) AS team_ids
                 FROM webknossos.users_ u JOIN webknossos.user_team_roles r ON r._user = u._id
                 WHERE r._team = ANY($1) AND NOT u.isDeactivated AND NOT u.isUnlisted
                 AND NOT (u._id = ANY($2))
                 GROUP BY u._id ORDER BY u._id",
    )
    .bind(added_team_ids)
    .bind(exclude)
    .fetch_all(connection)
    .await
}

/// Those of the candidate users with access to the resource.
pub(crate) async fn find_all_user_ids_with_access<'e>(
    executor: impl PgExecutor<'e>,
    resource: &SharedResource,
    user_ids: &[&ObjectId],
) -> sqlx::Result<Vec<ObjectId>> {
    access_query(resource, user_ids)
        .build_query_scalar()
        .fetch_all(executor)
        .await
}

/// The requester-based access predicates are evaluated per candidate: the
/// requester becomes `candidate._id`, the organization scope the
/// candidate's organization.
pub(crate) fn access_query<'a>(
    resource: &'a SharedResource,
    user_ids: &'a [&'a ObjectId],
) -> Sql<'a> {
    let candidate = Requester {
        id: Arg::Sql("candidate._id"),
        organization: Arg::Sql("candidate._organization"),
        is_admin: false,
    };
    let mut q = Sql::new("SELECT candidate._id FROM webknossos.users_ candidate JOIN ");
    match resource {
        SharedResource::Annotation { .. } => q.push("webknossos.annotations_ a ON a._id = "),
        SharedResource::Dataset { .. } => q.push("webknossos.datasets_ d ON d._id = "),
    }
    .push_bind(resource.id())
    .push(" WHERE candidate._id = ANY(")
    .push_bind(user_ids)
    .push(") AND ");
    match resource {
        SharedResource::Annotation { .. } => {
            crate::annotation::lists::push_list_grant(&mut q, candidate, true);
        }
        SharedResource::Dataset { .. } => {
            crate::dataset::access::push_read_predicate(&mut q, candidate.id, None);
        }
    }
    q
}

/// The annotation's name and the name of its dataset.
pub(crate) async fn find_annotation_and_dataset_names(
    pool: &PgPool,
    annotation_id: &ObjectId,
) -> sqlx::Result<(String, String)> {
    sqlx::query_as(
        "SELECT a.name, d.name FROM webknossos.annotations_ a
                     JOIN webknossos.datasets_ d ON d._id = a._dataset WHERE a._id = $1",
    )
    .bind(annotation_id)
    .fetch_one(pool)
    .await
}

pub(crate) async fn find_dataset_name(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<String> {
    sqlx::query_scalar("SELECT name FROM webknossos.datasets_ WHERE _id = $1")
        .bind(dataset_id)
        .fetch_one(pool)
        .await
}

pub(crate) async fn is_user_deactivated(pool: &PgPool, user_id: &ObjectId) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT isDeactivated FROM webknossos.users_ WHERE _id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await
}

pub(crate) async fn find_organization_name_of_user(
    pool: &PgPool,
    user_id: &ObjectId,
) -> sqlx::Result<String> {
    sqlx::query_scalar(
        "SELECT o.name FROM webknossos.users_ u
                     JOIN webknossos.organizations_ o ON o._id = u._organization WHERE u._id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
}

/// The name of the task's project and the summary of its task type.
pub(crate) async fn find_project_name_and_task_type_summary(
    pool: &PgPool,
    task_id: &ObjectId,
) -> sqlx::Result<(String, String)> {
    sqlx::query_as(
        "SELECT p.name, tt.summary FROM webknossos.tasks_ t
                     JOIN webknossos.projects_ p ON p._id = t._project
                     JOIN webknossos.taskTypes_ tt ON tt._id = t._taskType
                     WHERE t._id = $1",
    )
    .bind(task_id)
    .fetch_one(pool)
    .await
}

/// TeamDAO.findAllByIds (global): ids and names of the live teams among `team_ids`.
pub(crate) async fn find_all_team_names_by_ids(
    pool: &PgPool,
    team_ids: &[ObjectId],
) -> sqlx::Result<Vec<(ObjectId, String)>> {
    sqlx::query_as::<_, (ObjectId, String)>(
        "SELECT _id, name FROM webknossos.teams_ WHERE _id = ANY($1)",
    )
    .bind(team_ids)
    .fetch_all(pool)
    .await
}

const PERSON: &str =
    "SELECT u._id AS user_id, m.email, m.firstName AS first_name, m.lastName AS last_name
    FROM webknossos.users u JOIN webknossos.multiUsers_ m ON m._id = u._multiUser";

/// The multi user (name and email) of a user.
pub(crate) async fn find_one_person(pool: &PgPool, user_id: &ObjectId) -> sqlx::Result<Person> {
    Sql::new(PERSON)
        .push(" WHERE u._id = ")
        .push_bind(user_id)
        .build_query_as()
        .fetch_one(pool)
        .await
}

pub(crate) async fn find_all_people(
    pool: &PgPool,
    user_ids: &[&ObjectId],
) -> sqlx::Result<Vec<Person>> {
    Sql::new(PERSON)
        .push(" WHERE u._id = ANY(")
        .push_bind(user_ids)
        .push(")")
        .build_query_as()
        .fetch_all(pool)
        .await
}
