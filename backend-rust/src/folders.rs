//! Folder hierarchy and cumulative team access, backed by the existing closure table.
use std::collections::HashSet;

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post, put},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{FromRow, PgConnection, Postgres, Transaction};

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path, Query},
    util::id::ObjectId,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateQuery {
    parent_id: ObjectId,
    name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveQuery {
    new_parent_id: ObjectId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FolderParameters {
    name: String,
    #[serde(deserialize_with = "crate::util::id::deserialize_strings")]
    allowed_teams: Vec<String>,
    metadata: Vec<Value>,
}
#[derive(FromRow, Serialize)]
struct Folder {
    id: ObjectId,
    name: String,
    metadata: Value,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    created: DateTime<Utc>,
}

/// FolderService.publicWrites.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderJson {
    #[serde(flatten)]
    folder: Folder,
    allowed_teams: Vec<Value>,
    allowed_teams_cumulative: Vec<Value>,
    is_editable: bool,
}

/// One entry of FolderService.publicWritesTree.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderTreeEntry {
    #[serde(flatten)]
    folder: Folder,
    parent: Option<ObjectId>,
    is_editable: bool,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/folders/root", get(root))
        .route("/folders/tree", get(tree))
        .route("/folders/create", post(create))
        .route("/folders/{id}", get(fetch).put(update).delete(remove))
        .route("/folders/{id}/move", put(move_folder))
}

async fn organization_root(
    connection: &mut PgConnection,
    user: &AuthUser,
    lock: bool,
) -> ApiResult<ObjectId> {
    let suffix = if lock { " FOR UPDATE OF f" } else { "" };
    sqlx::query_scalar(&format!(
        "SELECT o._rootFolder FROM webknossos.organizations_ o
        JOIN webknossos.folders_ f ON f._id = o._rootFolder WHERE o._id = $1{suffix}"
    ))
    .bind(&user.organization_id)
    .fetch_optional(connection)
    .await?
    .ok_or_else(|| ApiError::bad_request(FOLDER_NOT_FOUND))
}

async fn access(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
    write: bool,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
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
    .await?)
}

/// Msg.Folder.notFound; FolderController maps it without a status, i.e. 400.
const FOLDER_NOT_FOUND: &str = "Could not find the requested folder.";

async fn load(connection: &mut PgConnection, id: &ObjectId) -> ApiResult<Folder> {
    sqlx::query_as(
        "SELECT _id AS id, name, metadata, created FROM webknossos.folders_ WHERE _id = $1",
    )
    .bind(id)
    .fetch_optional(connection)
    .await?
    .ok_or_else(|| ApiError::bad_request(FOLDER_NOT_FOUND))
}

async fn readable(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<Folder> {
    if !access(connection, user, id, false).await? {
        return Err(ApiError::bad_request(FOLDER_NOT_FOUND));
    }
    load(connection, id).await
}

async fn assert_editable(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<()> {
    if !access(connection, user, id, true).await? {
        return Err(ApiError::forbidden(crate::msg::folder::UPDATE_NOT_ALLOWED));
    }
    Ok(())
}

async fn allowed_teams(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
    cumulative: bool,
) -> ApiResult<Vec<Value>> {
    Ok(sqlx::query_scalar(
        "SELECT DISTINCT jsonb_build_object('id', t._id, 'name', t.name,
             'organization', t._organization, 'isOrganizationTeam', t.isOrganizationTeam)
         FROM webknossos.teams_ t JOIN webknossos.folder_allowedTeams a ON a._team = t._id
         WHERE t._organization = $1 AND ($2 OR EXISTS (
           SELECT 1 FROM webknossos.user_team_roles r WHERE r._team = t._id AND r._user = $3
         )) AND (a._folder = $4 OR ($5 AND EXISTS (
           SELECT 1 FROM webknossos.folder_paths p WHERE p._ancestor = a._folder AND p._descendant = $4
         )))"
    ).bind(&user.organization_id).bind(user.is_admin).bind(&user.id).bind(id).bind(cumulative)
        .fetch_all(connection).await?)
}

async fn public_json(
    connection: &mut PgConnection,
    user: &AuthUser,
    folder: Folder,
) -> ApiResult<FolderJson> {
    let direct = allowed_teams(connection, user, &folder.id, false).await?;
    let cumulative = allowed_teams(connection, user, &folder.id, true).await?;
    let editable = access(connection, user, &folder.id, true).await?;
    Ok(FolderJson {
        folder,
        allowed_teams: direct,
        allowed_teams_cumulative: cumulative,
        is_editable: editable,
    })
}

async fn root(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<FolderJson>> {
    let mut connection = state.pool.acquire().await?;
    let id = organization_root(&mut connection, &user, false).await?;
    let folder = readable(&mut connection, &user, &id).await?;
    Ok(Json(public_json(&mut connection, &user, folder).await?))
}

async fn fetch(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<FolderJson>> {
    let id = ObjectId::parse_path(&id)?;
    let mut connection = state.pool.acquire().await?;
    let folder = readable(&mut connection, &user, &id).await?;
    Ok(Json(public_json(&mut connection, &user, folder).await?))
}

async fn tree(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<Vec<FolderTreeEntry>>> {
    let mut connection = state.pool.acquire().await?;
    let root = organization_root(&mut connection, &user, false).await?;
    let folders: Vec<Folder> = sqlx::query_as(
        "SELECT f._id AS id, f.name, f.metadata, f.created
        FROM webknossos.folders_ f JOIN webknossos.folder_paths p ON p._descendant = f._id
        WHERE p._ancestor = $1 ORDER BY p.depth, f._id",
    )
    .bind(&root)
    .fetch_all(&mut *connection)
    .await?;
    let mut output = Vec::new();
    for folder in folders {
        if access(&mut connection, &user, &folder.id, false).await? {
            let parent: Option<ObjectId> = sqlx::query_scalar(
                "SELECT _ancestor FROM webknossos.folder_paths WHERE _descendant = $1 \
                    AND depth = 1",
            )
            .bind(&folder.id)
            .fetch_optional(&mut *connection)
            .await?;
            let editable = access(&mut connection, &user, &folder.id, true).await?;
            output.push(FolderTreeEntry {
                folder,
                parent,
                is_editable: editable,
            });
        }
    }
    Ok(Json(output))
}

async fn mutation(
    state: &AppState,
    user: &AuthUser,
) -> ApiResult<(Transaction<'static, Postgres>, ObjectId)> {
    let mut transaction = state.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *transaction)
        .await?;
    // Serialize hierarchy and grant changes within an organization around its stable root.
    let root = organization_root(&mut transaction, user, true).await?;
    Ok((transaction, root))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<CreateQuery>,
) -> ApiResult<Json<FolderJson>> {
    validate_name(&query.name)?;
    let (mut transaction, _) = mutation(&state, &user).await?;
    readable(&mut transaction, &user, &query.parent_id).await?;
    assert_editable(&mut transaction, &user, &query.parent_id).await?;
    let id = ObjectId::new();
    sqlx::query("INSERT INTO webknossos.folders (_id, name) VALUES ($1, $2)")
        .bind(&id)
        .bind(&query.name)
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "INSERT INTO webknossos.folder_paths (_ancestor, _descendant, depth)
        SELECT _ancestor, $1, depth + 1 FROM webknossos.folder_paths WHERE _descendant = $2
        UNION ALL SELECT $1, $1, 0",
    )
    .bind(&id)
    .bind(&query.parent_id)
    .execute(&mut *transaction)
    .await?;
    let folder = load(&mut transaction, &id).await?;
    let response = public_json(&mut transaction, &user, folder).await?;
    transaction.commit().await?;
    Ok(Json(response))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    RequestJson(body): RequestJson<FolderParameters>,
) -> ApiResult<Json<FolderJson>> {
    let id = ObjectId::parse_path(&id)?;
    let (mut transaction, _) = mutation(&state, &user).await?;
    readable(&mut transaction, &user, &id).await?;
    assert_editable(&mut transaction, &user, &id).await?;
    validate_name(&body.name)?;
    validate_metadata(&body.metadata)?;
    for team in &body.allowed_teams {
        ObjectId::parse(team)?;
    }
    // Preserve grants to teams this user cannot manage. Dataset managers can manage
    // their memberships; admins can manage all teams in their organization.
    let editable_teams: Vec<String> = sqlx::query_scalar(
        "SELECT t._id FROM webknossos.teams_ t
        WHERE t._organization = $1 AND ($2 OR EXISTS (
            SELECT 1 FROM webknossos.user_team_roles r WHERE r._team = t._id
            AND r._user = $3 AND ($4 OR r.isTeamManager)))",
    )
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(&user.id)
    .bind(user.is_dataset_manager)
    .fetch_all(&mut *transaction)
    .await?;
    sqlx::query(
        "DELETE FROM webknossos.folder_allowedTeams WHERE _folder = $1 AND _team = ANY($2::text[])",
    )
    .bind(&id)
    .bind(&editable_teams)
    .execute(&mut *transaction)
    .await?;
    let editable: HashSet<_> = editable_teams.into_iter().collect();
    let mut seen = HashSet::new();
    for team in &body.allowed_teams {
        if editable.contains(team) && seen.insert(team) {
            sqlx::query("INSERT INTO webknossos.folder_allowedTeams (_folder, _team) VALUES ($1, $2) ON CONFLICT DO NOTHING")
                .bind(&id).bind(team).execute(&mut *transaction).await?;
        }
    }
    sqlx::query("UPDATE webknossos.folders SET name = $2, metadata = $3 WHERE _id = $1")
        .bind(&id)
        .bind(&body.name)
        .bind(json!(body.metadata))
        .execute(&mut *transaction)
        .await?;
    let folder = load(&mut transaction, &id).await?;
    let response = public_json(&mut transaction, &user, folder).await?;
    transaction.commit().await?;
    Ok(Json(response))
}

async fn move_folder(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Query(query): Query<MoveQuery>,
) -> ApiResult<Json<FolderJson>> {
    let id = ObjectId::parse_path(&id)?;
    let (mut transaction, root) = mutation(&state, &user).await?;
    if root == id {
        return Err(ApiError::bad_request(crate::msg::folder::MOVE_ROOT));
    }
    if id == query.new_parent_id {
        return Err(ApiError::bad_request(crate::msg::folder::MOVE_SELF));
    }
    readable(&mut transaction, &user, &id).await?;
    readable(&mut transaction, &user, &query.new_parent_id).await?;
    assert_editable(&mut transaction, &user, &id).await?;
    assert_editable(&mut transaction, &user, &query.new_parent_id).await?;
    let cycle: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.folder_paths WHERE _ancestor = $1 AND _descendant = $2)")
        .bind(&id).bind(&query.new_parent_id).fetch_one(&mut *transaction).await?;
    if cycle {
        return Err(ApiError::bad_request(
            crate::msg::folder::MOVE_INTO_DESCENDANT,
        ));
    }
    sqlx::query("DELETE FROM webknossos.folder_paths p
        WHERE p._descendant IN (SELECT _descendant FROM webknossos.folder_paths WHERE _ancestor = $1)
        AND NOT EXISTS (SELECT 1 FROM webknossos.folder_paths internal
          WHERE internal._ancestor = $1 AND internal._descendant = p._ancestor)")
        .bind(&id).execute(&mut *transaction).await?;
    sqlx::query(
        "INSERT INTO webknossos.folder_paths (_ancestor, _descendant, depth)
        SELECT super._ancestor, sub._descendant, super.depth + sub.depth + 1
        FROM webknossos.folder_paths super CROSS JOIN webknossos.folder_paths sub
        WHERE sub._ancestor = $1 AND super._descendant = $2",
    )
    .bind(&id)
    .bind(&query.new_parent_id)
    .execute(&mut *transaction)
    .await?;
    let folder = load(&mut transaction, &id).await?;
    let response = public_json(&mut transaction, &user, folder).await?;
    transaction.commit().await?;
    Ok(Json(response))
}

async fn remove(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let id = ObjectId::parse_path(&id)?;
    let (mut transaction, root) = mutation(&state, &user).await?;
    if root == id {
        return Err(ApiError::bad_request(crate::msg::folder::DELETE_ROOT));
    }
    readable(&mut transaction, &user, &id).await?;
    assert_editable(&mut transaction, &user, &id).await?;
    let children: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.folder_paths WHERE _ancestor = $1 AND depth = 1)",
    )
    .bind(&id)
    .fetch_one(&mut *transaction)
    .await?;
    if children {
        return Err(ApiError::bad_request(
            crate::msg::folder::DELETE_NOT_EMPTY_CHILDREN,
        ));
    }
    let datasets: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE _folder = $1)")
            .bind(&id)
            .fetch_one(&mut *transaction)
            .await?;
    if datasets {
        return Err(ApiError::bad_request(
            crate::msg::folder::DELETE_NOT_EMPTY_DATASETS,
        ));
    }
    sqlx::query("UPDATE webknossos.folders SET isDeleted = TRUE WHERE _id = $1")
        .bind(&id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM webknossos.folder_paths WHERE _ancestor = $1 OR _descendant = $1")
        .bind(&id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(StatusCode::OK)
}

fn validate_name(name: &str) -> ApiResult<()> {
    if name.contains('/') {
        return Err(ApiError::bad_request(
            crate::msg::folder::NAME_MUST_NOT_CONTAIN_SLASH,
        ));
    }
    Ok(())
}

fn validate_metadata(metadata: &[Value]) -> ApiResult<()> {
    let mut seen = HashSet::new();
    for entry in metadata {
        let object = entry.as_object().ok_or_else(|| {
            ApiError::bad_request(crate::msg::dataset::metadata::ENTRIES_MUST_BE_OBJECTS)
        })?;
        if let Some(key) = object.get("key") {
            let key = key.as_str().ok_or_else(|| {
                ApiError::bad_request(crate::msg::dataset::metadata::KEYS_MUST_BE_STRINGS)
            })?;
            if !seen.insert(key) {
                return Err(ApiError::bad_request(
                    crate::msg::dataset::metadata::DUPLICATE_KEYS,
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
