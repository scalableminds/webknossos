//! FolderController: request handling and response shaping. SQL lives in `super::folders_dao`.
use std::collections::HashSet;

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post, put},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, Postgres, Transaction};

use super::folders_dao::{self, Folder, FolderTeam};
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
    allowed_teams: Vec<ObjectId>,
    metadata: Vec<Value>,
}

/// FolderService.publicWrites.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderJson {
    #[serde(flatten)]
    folder: Folder,
    allowed_teams: Vec<FolderTeam>,
    allowed_teams_cumulative: Vec<FolderTeam>,
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

/// Msg.Folder.notFound; FolderController maps it without a status, i.e. 400.
const FOLDER_NOT_FOUND: &str = "Could not find the requested folder.";

async fn organization_root(
    connection: &mut PgConnection,
    user: &AuthUser,
    lock: bool,
) -> ApiResult<ObjectId> {
    folders_dao::organization_root(connection, &user.organization_id, lock)
        .await?
        .ok_or_else(|| ApiError::bad_request(FOLDER_NOT_FOUND))
}

async fn load(connection: &mut PgConnection, id: &ObjectId) -> ApiResult<Folder> {
    folders_dao::find_one(connection, id)
        .await?
        .ok_or_else(|| ApiError::bad_request(FOLDER_NOT_FOUND))
}

async fn readable(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<Folder> {
    if !folders_dao::has_access(connection, user, id, false).await? {
        return Err(ApiError::bad_request(FOLDER_NOT_FOUND));
    }
    load(connection, id).await
}

async fn assert_editable(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<()> {
    if !folders_dao::has_access(connection, user, id, true).await? {
        return Err(ApiError::forbidden(crate::msg::folder::UPDATE_NOT_ALLOWED));
    }
    Ok(())
}

async fn public_json(
    connection: &mut PgConnection,
    user: &AuthUser,
    folder: Folder,
) -> ApiResult<FolderJson> {
    let direct = folders_dao::find_allowed_teams(connection, user, &folder.id, false).await?;
    let cumulative = folders_dao::find_allowed_teams(connection, user, &folder.id, true).await?;
    let editable = folders_dao::has_access(connection, user, &folder.id, true).await?;
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
    let folders = folders_dao::find_subtree(&mut connection, &root).await?;
    let mut output = Vec::new();
    for folder in folders {
        if folders_dao::has_access(&mut connection, &user, &folder.id, false).await? {
            let parent = folders_dao::find_parent(&mut connection, &folder.id).await?;
            let editable =
                folders_dao::has_access(&mut connection, &user, &folder.id, true).await?;
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
    let mut transaction = crate::db::begin_serializable(&state.pool).await?;
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
    folders_dao::insert_as_child(&mut transaction, &query.parent_id, &id, &query.name).await?;
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
    // Preserve grants to teams this user cannot manage. Dataset managers can manage
    // their memberships; admins can manage all teams in their organization.
    let grantable = folders_dao::find_grantable_team_ids(&mut transaction, &user).await?;
    folders_dao::remove_allowed_teams(&mut transaction, &id, &grantable).await?;
    let grantable: HashSet<_> = grantable.into_iter().collect();
    let mut seen = HashSet::new();
    for team in &body.allowed_teams {
        if grantable.contains(team) && seen.insert(team) {
            folders_dao::insert_allowed_team(&mut transaction, &id, team).await?;
        }
    }
    folders_dao::update_name_and_metadata(&mut transaction, &id, &body.name, &json!(body.metadata))
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
    if folders_dao::is_descendant(&mut transaction, &id, &query.new_parent_id).await? {
        return Err(ApiError::bad_request(
            crate::msg::folder::MOVE_INTO_DESCENDANT,
        ));
    }
    folders_dao::move_subtree(&mut transaction, &id, &query.new_parent_id).await?;
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
    if folders_dao::has_children(&mut transaction, &id).await? {
        return Err(ApiError::bad_request(
            crate::msg::folder::DELETE_NOT_EMPTY_CHILDREN,
        ));
    }
    if folders_dao::has_datasets(&mut transaction, &id).await? {
        return Err(ApiError::bad_request(
            crate::msg::folder::DELETE_NOT_EMPTY_DATASETS,
        ));
    }
    folders_dao::delete_one(&mut transaction, &id).await?;
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
mod folders_routes_tests;
