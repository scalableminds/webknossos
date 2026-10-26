//! ScriptDAO: the scripts queries (plus the owner and task references they touch).
use sqlx::{PgConnection, PgPool};

use super::Script;
use crate::{error::ApiResult, sql::Sql, util::id::ObjectId};

/// Live scripts; callers append further conditions. Compact owner JSON is the
/// UserService.compactWrites contract, including memberships.
pub(crate) const SELECT_LIVE_SCRIPTS: &str =
    "SELECT s._id AS id, s._owner AS owner_id, s.name, s.gist,
    jsonb_build_object('id', u._id, 'email', m.email, 'firstName', m.firstName,
      'lastName', m.lastName, 'isAdmin', u.isAdmin, 'isDatasetManager', u.isDatasetManager,
      'isActive', NOT u.isDeactivated, 'isAnonymous', false,
      'teams', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t._id, 'name', t.name,
        'isTeamManager', r.isTeamManager) ORDER BY t._id)
        FROM webknossos.user_team_roles r JOIN webknossos.teams_ t ON t._id = r._team
        WHERE r._user = u._id), '[]'::jsonb)) AS owner
    FROM webknossos.scripts s
    JOIN webknossos.users_ u ON u._id = s._owner
    JOIN webknossos.multiUsers_ m ON m._id = u._multiUser
    WHERE NOT s.isDeleted";

/// The live scripts of `organization`.
fn select_scripts(organization: &str) -> Sql<'_> {
    let mut q = Sql::new(SELECT_LIVE_SCRIPTS);
    q.push(" AND u._organization = ").push_bind(organization);
    q
}

pub(crate) async fn find_all(pool: &PgPool, organization_id: &str) -> ApiResult<Vec<Script>> {
    let mut q = select_scripts(organization_id);
    q.push(" ORDER BY s._id");
    Ok(q.build_query_as::<Script>().fetch_all(pool).await?)
}

/// With `lock`, the script row is locked (FOR UPDATE).
pub(crate) async fn find_one(
    connection: &mut PgConnection,
    organization_id: &str,
    id: &ObjectId,
    lock: bool,
) -> ApiResult<Option<Script>> {
    let mut q = select_scripts(organization_id);
    q.push(" AND s._id = ").push_bind(id);
    if lock {
        q.push(" FOR UPDATE OF s");
    }
    Ok(q.build_query_as::<Script>()
        .fetch_optional(connection)
        .await?)
}

pub(crate) async fn insert_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    owner: &ObjectId,
    name: &str,
    gist: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO webknossos.scripts (_id, _owner, name, gist) VALUES ($1, $2, $3, $4)")
        .bind(id)
        .bind(owner)
        .bind(name)
        .bind(gist)
        .execute(connection)
        .await?;
    Ok(())
}

/// Whether the user exists in the organization (the owner check on update).
pub(crate) async fn is_user_in_organization(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    organization_id: &str,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.users_ WHERE _id = $1 AND _organization = $2)",
    )
    .bind(user_id)
    .bind(organization_id)
    .fetch_one(connection)
    .await?)
}

pub(crate) async fn update_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    owner: &ObjectId,
    name: &str,
    gist: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.scripts SET _owner = $2, name = $3, gist = $4 WHERE _id = $1")
        .bind(id)
        .bind(owner)
        .bind(name)
        .bind(gist)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn delete_one(connection: &mut PgConnection, id: &ObjectId) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.scripts SET isDeleted = TRUE WHERE _id = $1")
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

/// TaskDAO.removeScriptFromAllTasks. Includes deleted tasks.
pub(crate) async fn remove_script_from_all_tasks(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.tasks SET _script = NULL WHERE _script = $1")
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}
