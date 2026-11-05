//! TeamDAO: the teams and team-reference queries.
use sqlx::{PgConnection, PgPool};

use super::Team;
use crate::{auth::AuthUser, sql::Sql, util::id::ObjectId};

/// The teams of the user's organization; unless the user is an admin, only
/// teams they belong to (or, with `is_editable`, manage).
pub(crate) async fn find_all_for_user(
    pool: &PgPool,
    user: &AuthUser,
    is_editable: bool,
) -> sqlx::Result<Vec<Team>> {
    sqlx::query_as::<_, Team>(
        "SELECT t._id AS id, t.name, t._organization AS organization,
                t.isOrganizationTeam AS is_organization_team
         FROM webknossos.teams_ t
         WHERE t._organization = $1 AND ($2 OR EXISTS (
           SELECT 1 FROM webknossos.user_team_roles r
           WHERE r._team = t._id AND r._user = $3
             AND (NOT $4 OR r.isTeamManager)
         )) ORDER BY t._id",
    )
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(&user.id)
    .bind(is_editable)
    .fetch_all(pool)
    .await
}

/// Inserts the team; the raw sqlx error is returned so the caller can map a unique violation.
pub(crate) async fn insert_one(
    pool: &PgPool,
    id: &ObjectId,
    organization_id: &str,
    name: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO webknossos.teams (_id, _organization, name) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(organization_id)
        .bind(name)
        .execute(pool)
        .await?;
    Ok(())
}

/// Whether the live team is an organization team; locks its row (FOR UPDATE).
pub(crate) async fn is_organization_team_for_update(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization_id: &str,
) -> sqlx::Result<Option<bool>> {
    sqlx::query_scalar(
        "SELECT isOrganizationTeam FROM webknossos.teams
         WHERE _id = $1 AND _organization = $2 AND NOT isDeleted FOR UPDATE",
    )
    .bind(id)
    .bind(organization_id)
    .fetch_optional(connection)
    .await
}

/// Whether a project or task type references the team.
pub(crate) async fn is_referenced(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.projects_ WHERE _team = $1)
             OR EXISTS (SELECT 1 FROM webknossos.taskTypes_ WHERE _team = $1)",
    )
    .bind(id)
    .fetch_one(connection)
    .await
}

pub(crate) async fn mark_deleted(
    connection: &mut PgConnection,
    id: &ObjectId,
    deleted_suffix: &str,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.teams SET isDeleted = TRUE, name = name || $2 WHERE _id = $1")
        .bind(id)
        .bind(deleted_suffix)
        .execute(connection)
        .await?;
    Ok(())
}

/// Removes every reference to the team from its membership/grant tables.
pub(crate) async fn delete_team_references(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<()> {
    for table in [
        "user_team_roles",
        "invite_team_roles",
        "annotation_sharedTeams",
        "dataset_allowedTeams",
        "folder_allowedTeams",
    ] {
        Sql::new("DELETE FROM webknossos.")
            .push(table)
            .push(" WHERE _team = ")
            .push_bind(id)
            .build()
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}
