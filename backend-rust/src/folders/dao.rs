//! FolderDAO: the folders, folder_paths and folder_allowedTeams queries.
//!
//! Callers own the connection and transaction; these functions only run SQL
//! and return rows. Mapping a missing row to an error is up to the caller.
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgConnection};

use crate::{auth::AuthUser, sql::Sql, util::id::ObjectId};

#[derive(FromRow, Serialize)]
pub(crate) struct Folder {
    pub id: ObjectId,
    pub name: String,
    pub metadata: Value,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    pub created: DateTime<Utc>,
}

/// A team granted access to a folder, as TeamService.publicWrites renders it.
#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderTeam {
    pub id: ObjectId,
    pub name: String,
    pub organization: String,
    pub is_organization_team: bool,
}

/// The root folder of the user's organization. `lock` takes a row lock on it,
/// which serializes hierarchy and grant changes within the organization.
pub(crate) async fn organization_root(
    connection: &mut PgConnection,
    organization_id: &str,
    lock: bool,
) -> sqlx::Result<Option<ObjectId>> {
    let suffix = if lock { " FOR UPDATE OF f" } else { "" };
    let mut q = Sql::new(
        "SELECT o._rootFolder FROM webknossos.organizations_ o
        JOIN webknossos.folders_ f ON f._id = o._rootFolder WHERE o._id = ",
    );
    q.push_bind(organization_id).push(suffix);
    q.build_query_scalar().fetch_optional(connection).await
}

/// FolderDAO.rawAccessQ: whether `user` may read (or, with `write`, edit) the folder.
pub(crate) async fn has_access(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
    write: bool,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.folders_ f
          JOIN webknossos.folder_paths own_path ON own_path._descendant = f._id
          JOIN webknossos.organizations_ o ON o._rootFolder = own_path._ancestor
          WHERE f._id = $1 AND o._id = $2 AND (
            $3 OR $4 OR EXISTS (
              SELECT 1 FROM webknossos.folder_paths p
              JOIN webknossos.folder_allowedTeams a ON a._folder = p._ancestor
              JOIN webknossos.teams_ t ON t._id = a._team AND t._organization = $2
              JOIN webknossos.user_team_roles r ON r._team = t._id
              WHERE p._descendant = f._id AND r._user = $5 AND (NOT $6 OR r.isTeamManager)
            ) OR (NOT $6 AND (EXISTS (
              SELECT 1 FROM webknossos.folder_paths p
              JOIN webknossos.folder_allowedTeams a ON a._folder = p._descendant
              JOIN webknossos.teams_ t ON t._id = a._team AND t._organization = $2
              JOIN webknossos.user_team_roles r ON r._team = t._id
              WHERE p._ancestor = f._id AND r._user = $5
            ) OR EXISTS (
              SELECT 1 FROM webknossos.folder_paths p
              JOIN webknossos.datasets_ d ON d._folder = p._descendant AND d._organization = $2
              WHERE p._ancestor = f._id AND (d.isPublic OR EXISTS (
                SELECT 1 FROM webknossos.dataset_allowedTeams a
                JOIN webknossos.teams_ t ON t._id = a._team AND t._organization = $2
                JOIN webknossos.user_team_roles r ON r._team = t._id
                WHERE a._dataset = d._id AND r._user = $5
              ))
            )))
          ))",
    )
    .bind(id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(user.is_dataset_manager)
    .bind(&user.id)
    .bind(write)
    .fetch_one(connection)
    .await
}

pub(crate) async fn find_one(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<Option<Folder>> {
    sqlx::query_as(
        "SELECT _id AS id, name, metadata, created FROM webknossos.folders_ WHERE _id = $1",
    )
    .bind(id)
    .fetch_optional(connection)
    .await
}

/// The folder and all its descendants, parents before children.
pub(crate) async fn find_subtree(
    connection: &mut PgConnection,
    root: &ObjectId,
) -> sqlx::Result<Vec<Folder>> {
    sqlx::query_as(
        "SELECT f._id AS id, f.name, f.metadata, f.created
        FROM webknossos.folders_ f JOIN webknossos.folder_paths p ON p._descendant = f._id
        WHERE p._ancestor = $1 ORDER BY p.depth, f._id",
    )
    .bind(root)
    .fetch_all(connection)
    .await
}

pub(crate) async fn find_parent(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar(
        "SELECT _ancestor FROM webknossos.folder_paths WHERE _descendant = $1 AND depth = 1",
    )
    .bind(id)
    .fetch_optional(connection)
    .await
}

/// The teams granted on the folder itself or, with `cumulative`, on it or an
/// ancestor. Non-admins only see teams they are a member of.
pub(crate) async fn find_allowed_teams(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
    cumulative: bool,
) -> sqlx::Result<Vec<FolderTeam>> {
    sqlx::query_as(
        "SELECT DISTINCT t._id AS id, t.name, t._organization AS organization,
             t.isOrganizationTeam AS is_organization_team
         FROM webknossos.teams_ t JOIN webknossos.folder_allowedTeams a ON a._team = t._id
         WHERE t._organization = $1 AND ($2 OR EXISTS (
           SELECT 1 FROM webknossos.user_team_roles r WHERE r._team = t._id AND r._user = $3
         )) AND (a._folder = $4 OR ($5 AND EXISTS (
           SELECT 1 FROM webknossos.folder_paths p
           WHERE p._ancestor = a._folder AND p._descendant = $4
         )))",
    )
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(&user.id)
    .bind(id)
    .bind(cumulative)
    .fetch_all(connection)
    .await
}

/// The teams whose folder grants `user` may change: all teams of the
/// organization for admins, otherwise the teams they manage (any membership
/// for dataset managers).
pub(crate) async fn find_grantable_team_ids(
    connection: &mut PgConnection,
    user: &AuthUser,
) -> sqlx::Result<Vec<ObjectId>> {
    sqlx::query_scalar(
        "SELECT t._id FROM webknossos.teams_ t
        WHERE t._organization = $1 AND ($2 OR EXISTS (
            SELECT 1 FROM webknossos.user_team_roles r WHERE r._team = t._id
            AND r._user = $3 AND ($4 OR r.isTeamManager)))",
    )
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(&user.id)
    .bind(user.is_dataset_manager)
    .fetch_all(connection)
    .await
}

pub(crate) async fn is_descendant(
    connection: &mut PgConnection,
    ancestor: &ObjectId,
    descendant: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.folder_paths \
            WHERE _ancestor = $1 AND _descendant = $2)",
    )
    .bind(ancestor)
    .bind(descendant)
    .fetch_one(connection)
    .await
}

pub(crate) async fn has_children(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.folder_paths WHERE _ancestor = $1 AND depth = 1)",
    )
    .bind(id)
    .fetch_one(connection)
    .await
}

pub(crate) async fn has_datasets(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE _folder = $1)")
        .bind(id)
        .fetch_one(connection)
        .await
}

/// Inserts the folder and its closure-table paths below `parent`.
pub(crate) async fn insert_as_child(
    connection: &mut PgConnection,
    parent: &ObjectId,
    id: &ObjectId,
    name: &str,
) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO webknossos.folders (_id, name) VALUES ($1, $2)")
        .bind(id)
        .bind(name)
        .execute(&mut *connection)
        .await?;
    sqlx::query(
        "INSERT INTO webknossos.folder_paths (_ancestor, _descendant, depth)
        SELECT _ancestor, $1, depth + 1 FROM webknossos.folder_paths WHERE _descendant = $2
        UNION ALL SELECT $1, $1, 0",
    )
    .bind(id)
    .bind(parent)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn update_name_and_metadata(
    connection: &mut PgConnection,
    id: &ObjectId,
    name: &str,
    metadata: &Value,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.folders SET name = $2, metadata = $3 WHERE _id = $1")
        .bind(id)
        .bind(name)
        .bind(metadata)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn remove_allowed_teams(
    connection: &mut PgConnection,
    id: &ObjectId,
    teams: &[ObjectId],
) -> sqlx::Result<()> {
    sqlx::query(
        "DELETE FROM webknossos.folder_allowedTeams WHERE _folder = $1 AND _team = ANY($2::text[])",
    )
    .bind(id)
    .bind(teams)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn insert_allowed_team(
    connection: &mut PgConnection,
    id: &ObjectId,
    team: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.folder_allowedTeams (_folder, _team) VALUES ($1, $2) \
            ON CONFLICT DO NOTHING",
    )
    .bind(id)
    .bind(team)
    .execute(connection)
    .await?;
    Ok(())
}

/// Detaches the subtree rooted at `id` from its ancestors and re-attaches it
/// below `new_parent`. The caller rules out moving a folder into itself.
pub(crate) async fn move_subtree(
    connection: &mut PgConnection,
    id: &ObjectId,
    new_parent: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "DELETE FROM webknossos.folder_paths p
        WHERE p._descendant IN (SELECT _descendant FROM webknossos.folder_paths WHERE _ancestor = $1)
        AND NOT EXISTS (SELECT 1 FROM webknossos.folder_paths internal
          WHERE internal._ancestor = $1 AND internal._descendant = p._ancestor)",
    )
    .bind(id)
    .execute(&mut *connection)
    .await?;
    sqlx::query(
        "INSERT INTO webknossos.folder_paths (_ancestor, _descendant, depth)
        SELECT super._ancestor, sub._descendant, super.depth + sub.depth + 1
        FROM webknossos.folder_paths super CROSS JOIN webknossos.folder_paths sub
        WHERE sub._ancestor = $1 AND super._descendant = $2",
    )
    .bind(id)
    .bind(new_parent)
    .execute(connection)
    .await?;
    Ok(())
}

/// Soft-deletes the folder and drops its paths. The caller ensures it is empty.
pub(crate) async fn delete_one(connection: &mut PgConnection, id: &ObjectId) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.folders SET isDeleted = TRUE WHERE _id = $1")
        .bind(id)
        .execute(&mut *connection)
        .await?;
    sqlx::query("DELETE FROM webknossos.folder_paths WHERE _ancestor = $1 OR _descendant = $1")
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}
