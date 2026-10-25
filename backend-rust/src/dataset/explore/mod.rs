//! exploreRemote, exploreAndAddRemote (WKExploreRemoteLayerService), addVirtualDataset
//! and duplicateToOrga.
use std::time::Duration;

use axum::{Extension, Json, Router, extract::State, routing::post};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use webknossos_common::{datasource::DataSourceId, enums::LengthUnit, geometry::Vec3Double};

use crate::{
    AppState,
    auth::AuthUser,
    dataset::create::{NewDataset, SetUp},
    dataset::source::{UsableDataSource, VoxelSize},
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path, Query},
    remote::datastore::credentials::CredentialInput,
    slack::SlackNotificationService,
    sql::Sql,
    stores::client::{ServiceClients, ServiceError},
    util::id::{ObjectId, PathObjectId},
};

#[derive(Clone, Copy)]
pub struct DatastoreTokenConfig {
    pub expiry: Duration,
    pub idle_timeout: Duration,
}

pub fn router(tokens: DatastoreTokenConfig) -> Router<AppState> {
    Router::new()
        .route("/datasets/exploreRemote", post(explore_remote))
        .route(
            "/datasets/exploreAndAddRemote",
            post(explore_and_add_remote),
        )
        .route(
            "/datasets/addVirtualDataset/{name}",
            post(add_virtual_dataset),
        )
        .route(
            "/datasets/{datasetId}/duplicateToOrga",
            post(duplicate_to_orga),
        )
        .layer(Extension(tokens))
}

const ADD_PATHS_NOT_ALLOWED: &str = "Cannot directly add a data source with local paths that leave the dataset, or with paths that match the WEBKNOSSOS reserved paths.";
const ZERO_LAYERS: &str = "Explored dataset has no layers.";

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExploreParameters {
    remote_uri: String,
    credential_identifier: Option<String>,
    credential_secret: Option<String>,
    preferred_voxel_size: Option<Value>,
    data_store_name: Option<String>,
}

/// ExploreLayerUtils URI clean-up used before credentials are derived.
fn credential_uri(layer_uri: &str) -> Option<url::Url> {
    let mut uri = layer_uri.split('|').next().unwrap_or_default().to_owned();
    for suffix in [
        "attributes.json",
        ".zarray",
        ".zattrs",
        ".zgroup",
        "info",
        "zarr.json",
    ] {
        if let Some(stripped) = uri.strip_suffix(suffix) {
            uri = stripped.to_owned();
        }
    }
    if let Some(index) = uri.find('#') {
        let (head, tail) = uri.split_at(index + 1);
        uri = format!("{head}{}", tail.replace('#', "%23"));
    }
    url::Url::parse(&uri).ok()
}

/// A fresh DataStore token for the user, like createAndInitDataStoreTokenForUser.
async fn datastore_token(
    pool: &sqlx::PgPool,
    user: &AuthUser,
    config: DatastoreTokenConfig,
) -> ApiResult<String> {
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|_| ApiError::internal())?;
    let value = URL_SAFE_NO_PAD.encode(random);
    let expiry = i64::try_from(config.expiry.as_millis()).map_err(|_| ApiError::internal())?;
    let idle = i64::try_from(config.idle_timeout.as_millis()).map_err(|_| ApiError::internal())?;
    sqlx::query(
        r#"INSERT INTO webknossos.tokens (_id, value, _user, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created)
           VALUES ($1, $2, $3, statement_timestamp(), statement_timestamp() + $4::bigint * INTERVAL '1 millisecond', $5,
             'DataStore', statement_timestamp())"#,
    )
    .bind(ObjectId::new().as_str())
    .bind(&value)
    .bind(&user.id)
    .bind(expiry)
    .bind(idle)
    .execute(pool)
    .await?;
    Ok(value)
}

/// WKExploreRemoteLayerService.exploreRemoteDatasource. Stored credentials are
/// committed first: the datastore loads them by id while exploring.
async fn explore(
    state: &AppState,
    clients: &ServiceClients,
    tokens: DatastoreTokenConfig,
    user: &AuthUser,
    parameters: &[ExploreParameters],
) -> ApiResult<Value> {
    let mut layer_parameters = Vec::new();
    for parameter in parameters {
        let invalid =
            || ApiError::bad_request(format!("Received invalid URI: {}", parameter.remote_uri));
        let uri = credential_uri(&parameter.remote_uri).ok_or_else(invalid)?;
        let credential = CredentialInput::for_uri(
            &uri,
            parameter.credential_identifier.as_deref(),
            parameter.credential_secret.as_deref(),
        );
        let credential_id = match credential {
            Some(credential) => Some(
                crate::remote::datastore::credentials::store_credential(
                    &state.pool,
                    user,
                    &credential,
                )
                .await?
                .to_string(),
            ),
            None => None,
        };
        let mut value = json!({"remoteUri": parameter.remote_uri});
        if let Some(id) = credential_id {
            value["credentialId"] = json!(id);
        }
        if let Some(size) = &parameter.preferred_voxel_size {
            VoxelSize::from_json(size).map_err(crate::dataset::source::invalid_body)?;
            value["preferredVoxelSize"] = size.clone();
        }
        layer_parameters.push(value);
    }
    let mut names: Vec<&Option<String>> = Vec::new();
    for parameter in parameters {
        if !names.contains(&&parameter.data_store_name) {
            names.push(&parameter.data_store_name);
        }
    }
    if names.len() != 1 {
        return Err(ApiError::bad_request(
            crate::msg::dataset::explore::DATA_STORE_MUST_BE_EQUAL_FOR_ALL,
        ));
    }
    let url: Option<String> = sqlx::query_scalar(
        "SELECT url FROM webknossos.dataStores_ WHERE ($1::text IS NULL AND allowsUpload OR name = $1) ORDER BY name LIMIT 1",
    )
    .bind(names[0])
    .fetch_optional(&state.pool)
    .await?;
    let url = url.ok_or_else(|| ApiError::bad_request(crate::msg::data_store::NOT_FOUND))?;
    let token = datastore_token(&state.pool, user, tokens).await?;
    let response = clients
        .request_with_token(
            Method::POST,
            &url,
            &["data", "datasets", "exploreRemote"],
            &[],
            &token,
            Some(&json!({"layerParameters": layer_parameters, "organizationId": user.organization_id})),
        )
        .await?;
    let mut result: Value = serde_json::from_slice(&response.bytes)
        .map_err(|_| ApiError::from(ServiceError::InvalidJson))?;
    if !result["report"].is_string() {
        return Err(ServiceError::InvalidJson.into());
    }
    // Play reads the response into its data source model and writes it back, which normalizes the data source
    // (e.g. drops empty layer view configurations); do the same.
    if result["dataSource"].is_object() {
        let source = UsableDataSource::from_json(&result["dataSource"])
            .map_err(|_| ApiError::from(ServiceError::InvalidJson))?;
        result["dataSource"] = serde_json::to_value(&source).map_err(|_| ApiError::internal())?;
    }
    Ok(result)
}

async fn explore_remote(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(clients): Extension<ServiceClients>,
    Extension(tokens): Extension<DatastoreTokenConfig>,
    RequestJson(parameters): RequestJson<Vec<ExploreParameters>>,
) -> ApiResult<Json<Value>> {
    Ok(Json(
        explore(&state, &clients, tokens, &user, &parameters).await?,
    ))
}

/// DatasetService.validatePaths via the datastore.
async fn validate_paths(
    clients: &ServiceClients,
    store_url: &str,
    source: &UsableDataSource,
) -> ApiResult<()> {
    let paths: Vec<String> = source
        .all_explicit_paths()
        .into_iter()
        .map(ToString::to_string)
        .collect();
    let response = clients
        .request(
            Method::POST,
            store_url,
            &["data", "datasets", "validatePaths"],
            &[],
            Some(&json!(paths)),
        )
        .await
        .map_err(|_| ApiError::bad_request(ADD_PATHS_NOT_ALLOWED))?;
    let results: Vec<Value> = serde_json::from_slice(&response.bytes)
        .map_err(|_| ApiError::from(ServiceError::InvalidJson))?;
    if results.iter().any(|r| r["valid"] != json!(true)) {
        return Err(ApiError::bad_request(ADD_PATHS_NOT_ALLOWED));
    }
    Ok(())
}

/// Java String.split("/"): trailing empty strings are removed.
fn split_path(literal: &str) -> Vec<&str> {
    if literal.is_empty() {
        return vec![""];
    }
    let mut parts: Vec<&str> = literal.split('/').collect();
    while parts.last().is_some_and(|p| p.is_empty()) {
        parts.pop();
    }
    parts
}

/// Folders (alias `f`) visible to `user`: below the root of an organization
/// they administer or manage datasets of, below or above a folder shared with
/// one of their teams, or above a public dataset or one shared with their teams.
fn push_visible_folder<'a>(q: &mut Sql<'a>, user: &'a ObjectId) {
    q.push(
        r#"(
        f._id IN (SELECT fp._descendant FROM webknossos.folder_paths fp WHERE fp._ancestor IN (
          SELECT o._rootFolder FROM webknossos.organizations_ o JOIN webknossos.users_ u ON u._organization = o._id
          WHERE u._id = "#,
    )
    .push_bind(user)
    .push(
        r#" AND (u.isAdmin OR u.isDatasetManager)))
        OR f._id IN (SELECT fp._descendant FROM webknossos.folder_paths fp WHERE fp._ancestor IN (
          SELECT at._folder FROM webknossos.folder_allowedTeams at
          JOIN webknossos.user_team_roles tr ON at._team = tr._team WHERE tr._user = "#,
    )
    .push_bind(user)
    .push(
        r#"))
        OR f._id IN (SELECT fp._ancestor FROM webknossos.folder_paths fp WHERE fp._descendant IN (
          SELECT at._folder FROM webknossos.folder_allowedTeams at
          JOIN webknossos.user_team_roles utr ON at._team = utr._team WHERE utr._user = "#,
    )
    .push_bind(user)
    .push(
        r#"))
        OR f._id IN (SELECT fp._ancestor FROM webknossos.folder_paths fp WHERE fp._descendant IN (
          SELECT d._folder FROM webknossos.datasets_ d LEFT JOIN webknossos.dataset_allowedTeams dt ON dt._dataset = d._id
          LEFT JOIN webknossos.user_team_roles utr ON dt._team = utr._team WHERE utr._user = "#,
    )
    .push_bind(user)
    .push(" OR d.isPublic)))");
}

/// FolderService.getOrCreateFromPathLiteral with the user's folder visibility.
async fn get_or_create_folder(
    connection: &mut sqlx::PgConnection,
    user: &AuthUser,
    literal: &str,
) -> ApiResult<String> {
    let failed = || ApiError::bad_request(crate::msg::dataset::explore::AUTO_ADD_GET_FOLDER_FAILED);
    let root: String =
        sqlx::query_scalar("SELECT _rootFolder FROM webknossos.organizations_ WHERE _id = $1")
            .bind(&user.organization_id)
            .fetch_one(&mut *connection)
            .await?;
    let mut q = Sql::new(
        r#"SELECT f._id, f.name, fp._ancestor FROM webknossos.folders_ f JOIN webknossos.folder_paths fp ON f._id = fp._descendant
           WHERE fp.depth = 1 AND f._id IN (SELECT _descendant FROM webknossos.folder_paths WHERE _ancestor = "#,
    );
    q.push_bind(&root).push(") AND ");
    push_visible_folder(&mut q, &user.id);
    q.push(" UNION ALL SELECT f._id, f.name, NULL FROM webknossos.folders_ f WHERE f._id = ")
        .push_bind(&root)
        .push(" AND ");
    push_visible_folder(&mut q, &user.id);
    let folders: Vec<(String, String, Option<String>)> =
        q.build_query_as().fetch_all(&mut *connection).await?;
    let root_folder = folders.iter().find(|f| f.2.is_none()).ok_or_else(failed)?;
    let rest = literal.strip_prefix('/').ok_or_else(failed)?;
    let names = split_path(rest);
    if names.first() != Some(&root_folder.1.as_str()) {
        return Err(failed());
    }
    let mut current = root_folder.0.clone();
    let mut remaining = &names[1..];
    while let Some(next) = remaining.first().and_then(|name| {
        folders
            .iter()
            .find(|f| f.2.as_deref() == Some(current.as_str()) && f.1 == *name)
    }) {
        current = next.0.clone();
        remaining = &remaining[1..];
    }
    for name in remaining {
        if !crate::dataset::create::folder_writable(connection, user, &current).await? {
            return Err(failed());
        }
        let id = ObjectId::new().to_string();
        sqlx::query("INSERT INTO webknossos.folders (_id, name, created) VALUES ($1, $2, NOW())")
            .bind(&id)
            .bind(name)
            .execute(&mut *connection)
            .await
            .map_err(|_| failed())?;
        sqlx::query(
            r#"INSERT INTO webknossos.folder_paths (_ancestor, _descendant, depth)
               SELECT _ancestor, $1, depth + 1 FROM webknossos.folder_paths WHERE _descendant = $2
               UNION ALL SELECT $1, $1, 0"#,
        )
        .bind(&id)
        .bind(&current)
        .execute(&mut *connection)
        .await?;
        current = id;
    }
    Ok(current)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExploreAndAddParameters {
    remote_uri: String,
    credential_identifier: Option<String>,
    credential_secret: Option<String>,
    dataset_name: String,
    folder_id: Option<ObjectId>,
    folder_path: Option<String>,
    data_store_name: Option<String>,
}

async fn upload_store(
    connection: &mut sqlx::PgConnection,
    user: &AuthUser,
) -> ApiResult<(String, String)> {
    sqlx::query_as(
        "SELECT name, url FROM webknossos.dataStores_ WHERE allowsUpload AND (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization = $1) ORDER BY name LIMIT 1",
    )
    .bind(&user.organization_id)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| ApiError::bad_request(crate::msg::data_store::NOT_FOUND))
}

async fn explore_and_add_remote(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(clients): Extension<ServiceClients>,
    Extension(tokens): Extension<DatastoreTokenConfig>,
    RequestJson(body): RequestJson<ExploreAndAddParameters>,
) -> ApiResult<Json<ObjectId>> {
    let parameters = ExploreParameters {
        remote_uri: body.remote_uri.clone(),
        credential_identifier: body.credential_identifier.clone(),
        credential_secret: body.credential_secret.clone(),
        preferred_voxel_size: None,
        data_store_name: body.data_store_name.clone(),
    };
    let explored = explore(&state, &clients, tokens, &user, &[parameters]).await?;
    let source = explored
        .get("dataSource")
        .filter(|s| !s.is_null())
        .ok_or_else(|| ApiError::bad_request(crate::msg::dataset::explore::FAILED))?;
    let source = UsableDataSource::from_json(source)
        .map_err(|_| ApiError::from(ServiceError::InvalidJson))?;
    if source.data_layers.is_empty() {
        return Err(ApiError::bad_request(ZERO_LAYERS));
    }
    let mut connection = state.pool.acquire().await?;
    let (store_name, store_url) = upload_store(&mut connection, &user).await?;
    drop(connection);
    validate_paths(&clients, &store_url, &source).await?;
    let mut transaction = state.pool.begin().await?;
    let folder = match (&body.folder_id, &body.folder_path) {
        (Some(folder), _) => Some(folder.to_string()),
        (None, Some(path)) => Some(get_or_create_folder(&mut transaction, &user, path).await?),
        (None, None) => None,
    };
    crate::dataset::create::validate_dataset_name(&body.dataset_name)?;
    for layer in &source.data_layers {
        crate::dataset::create::validate_layer_name_lax(&layer.name)?;
    }
    let id = crate::dataset::create::set_up_dataset(
        &mut transaction,
        &user,
        SetUp {
            name: &body.dataset_name,
            store_name: &store_name,
            source: &source,
            folder: folder.as_deref(),
            creation_type: "ExploreAndAdd",
            import_url: None,
        },
    )
    .await
    .map_err(|error| {
        if error.status.is_server_error() {
            error
        } else {
            ApiError::bad_request(crate::msg::dataset::explore::AUTO_ADD_FAILED)
        }
    })?;
    transaction.commit().await?;
    crate::dataset::create::after_create(&state.pool, &clients, &id).await?;
    Ok(Json(id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistrationInfo {
    data_source: Value,
    folder_id: Option<ObjectId>,
    data_store_name: String,
    import_url: Option<String>,
}

async fn add_virtual_dataset(
    State(state): State<AppState>,
    user: AuthUser,
    Path(name): Path<String>,
    Extension(clients): Extension<ServiceClients>,
    slack: SlackNotificationService,
    RequestJson(body): RequestJson<RegistrationInfo>,
) -> ApiResult<Json<Value>> {
    let source = UsableDataSource::from_json(&body.data_source)
        .map_err(crate::dataset::source::invalid_body)?;
    let store: Option<(String, String)> = sqlx::query_as(
        "SELECT name, url FROM webknossos.dataStores_ WHERE name = $1 AND (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization = $2)",
    )
    .bind(&body.data_store_name)
    .bind(&user.organization_id)
    .fetch_optional(&state.pool)
    .await?;
    let (store_name, store_url) =
        store.ok_or_else(|| ApiError::not_found(crate::msg::data_store::NOT_FOUND))?;
    let team_manager: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.user_team_roles r JOIN webknossos.teams_ t ON t._id = r._team WHERE r._user = $1 AND r.isTeamManager AND t._organization = $2)",
    )
    .bind(&user.id)
    .bind(&user.organization_id)
    .fetch_one(&state.pool)
    .await?;
    if !(team_manager || user.is_admin || user.is_dataset_manager) {
        return Err(crate::dataset::lifecycle::not_allowed());
    }
    if source.data_layers.is_empty() {
        return Err(ApiError::bad_request(ZERO_LAYERS));
    }
    validate_paths(&clients, &store_url, &source).await?;
    let mut transaction = state.pool.begin().await?;
    let id = crate::dataset::create::set_up_dataset(
        &mut transaction,
        &user,
        SetUp {
            name: &name,
            store_name: &store_name,
            source: &source,
            folder: body.folder_id.as_ref().map(ObjectId::as_str),
            creation_type: "ExploreAndAdd",
            import_url: body.import_url.as_deref(),
        },
    )
    .await?;
    transaction.commit().await?;
    crate::dataset::create::after_create(&state.pool, &clients, &id).await?;
    // datasetService.trackNewDataset(needsConversion = false): Slack notice
    // only (its analytics event and Mailchimp tag are not ported here).
    slack.notice_dataset_added(
        &state.pool,
        &user.organization_id,
        user.is_superuser,
        &id,
        "via explore+add",
    );
    Ok(Json(json!({ "newDatasetId": id })))
}

#[derive(sqlx::FromRow)]
struct DuplicateSource {
    name: String,
    metadata: Value,
    description: Option<String>,
    status: String,
    factor: Option<Vec<f64>>,
    unit: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateQuery {
    target_organization_id: String,
}

async fn duplicate_to_orga(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Query(query): Query<DuplicateQuery>,
    Extension(clients): Extension<ServiceClients>,
) -> ApiResult<Json<ObjectId>> {
    if !user.is_superuser {
        return Err(ApiError::forbidden(crate::msg::user::SUPER_USER_ROUTE_ONLY));
    }
    let record = crate::dataset::lifecycle::load_record(&state.pool, &id)
        .await?
        .ok_or_else(|| crate::dataset::lifecycle::not_found(&id))?;
    let DuplicateSource {
        name,
        metadata,
        description,
        status,
        factor,
        unit,
    } = sqlx::query_as(
        r#"SELECT name, metadata, description, status,
             CASE WHEN voxelSizeFactor IS NULL THEN NULL ELSE ARRAY[(voxelSizeFactor).x, (voxelSizeFactor).y, (voxelSizeFactor).z] END AS factor,
             COALESCE(voxelSizeUnit::text, 'nanometer') AS unit
           FROM webknossos.datasets_ WHERE _id = $1"#,
    )
    .bind(id.as_str())
    .fetch_one(&state.pool)
    .await?;
    let unit = unit
        .as_deref()
        .and_then(LengthUnit::from_name)
        .unwrap_or(VoxelSize::DEFAULT_UNIT);
    let source = if record.is_usable {
        crate::dataset::source::load(&state.pool, &id).await?
    } else {
        UsableDataSource {
            id: DataSourceId::new("", ""),
            data_layers: Vec::new(),
            scale: VoxelSize {
                factor: Vec3Double::new(0.0, 0.0, 0.0),
                unit,
            },
            default_view_configuration: None,
            status_opt: Some(status.clone()),
        }
    };
    let store_name = record
        .store_name
        .clone()
        .ok_or_else(|| ApiError::bad_request(crate::msg::data_store::NOT_FOUND))?;
    if !record.is_virtual {
        return Err(ApiError::bad_request(
            crate::msg::dataset::DUPLICATE_ONLY_VIRTUAL,
        ));
    }
    let organization_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.organizations_ WHERE _id = $1)",
    )
    .bind(&query.target_organization_id)
    .fetch_one(&state.pool)
    .await?;
    if !organization_exists {
        return Err(ApiError::bad_request(crate::msg::organization::not_found(
            &query.target_organization_id,
        )));
    }
    let new_id = ObjectId::new();
    let mut adapted = source;
    adapted.id = DataSourceId::new(
        crate::dataset::create::generate_directory_name(&name, new_id.as_str()),
        &query.target_organization_id,
    );
    let voxel_size = if record.is_usable {
        Some(adapted.scale)
    } else {
        factor.as_ref().filter(|f| f.len() == 3).map(|f| VoxelSize {
            factor: Vec3Double::new(f[0], f[1], f[2]),
            unit,
        })
    };
    let mut transaction = state.pool.begin().await?;
    crate::dataset::create::insert_dataset(
        &mut transaction,
        NewDataset {
            id: &new_id,
            store_name: &store_name,
            name: &name,
            source: &adapted,
            is_usable: record.is_usable,
            voxel_size,
            status: adapted.status_opt.as_deref().unwrap_or(""),
            is_virtual: true,
            metadata,
            description: description.as_deref(),
            creation_type: "DuplicateToOrga",
            import_url: None,
        },
    )
    .await?;
    transaction.commit().await?;
    crate::dataset::create::after_create(&state.pool, &clients, &new_id).await?;
    Ok(Json(new_id))
}

#[cfg(test)]
mod tests;
