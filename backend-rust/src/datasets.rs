use axum::{
    Extension, Json, Router,
    extract::State,
    routing::{get, patch},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState, analytics,
    application_info::MiscState,
    auth::{AuthUser, OptionalAuthUser},
    dataset_access,
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path, Query},
    id::{ObjectId, PathObjectId},
};

const UNREPORTED: &str = "No longer available on datastore.";
const DELETED_BY_USER: &str = "Deleted by user.";

/// Contracts shared by API v10-v16. List format changed in v16, so the list
/// route is kept in a separate router and must not be mounted on legacy APIs.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/datasets/{datasetName}/isValidNewName", get(valid_name))
        .route(
            "/datasets/{datasetId}/sharingToken",
            get(sharing_token).delete(delete_sharing_token),
        )
        .route("/datasets/{datasetId}/teams", patch(update_teams))
        .route("/datasets/{datasetId}/accessList", get(access_list))
        .route(
            "/datasets/{datasetId}/dataSourceForSuperUser",
            get(superuser_data_source),
        )
}

pub fn list_router() -> Router<AppState> {
    Router::new().route("/datasets", get(list))
}

#[derive(Clone, Copy)]
pub struct DatasetFeatures {
    pub jobs_enabled: bool,
}

pub fn read_router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/datasets/{datasetId}", get(read))
        .layer(Extension(DatasetFeatures { jobs_enabled }))
}

/// Main settings PATCH has no legacy response adapter; keep it separate from
/// the read router, which older API versions wrap in bigint compatibility.
pub fn metadata_router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/datasets/{datasetId}", patch(update_metadata))
        .layer(Extension(DatasetFeatures { jobs_enabled }))
}

pub fn lookup_router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/datasets/findByImportURL", get(find_by_import_url))
        .route(
            "/datasets/disambiguate/{datasetName}/toNew",
            get(organization_for_name),
        )
        .route(
            "/datasets/disambiguate/{organizationId}/{datasetName}/toId",
            get(id_for_directory_name),
        )
        .layer(Extension(DatasetFeatures { jobs_enabled }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportQuery {
    #[serde(rename = "importURL")]
    import_url: String,
}

async fn find_by_import_url(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<ImportQuery>,
    Extension(features): Extension<DatasetFeatures>,
) -> ApiResult<Json<Value>> {
    let id:Option<String>=sqlx::query_scalar(&format!("SELECT d._id FROM webknossos.datasets_ d WHERE {} AND d._organization=$3 AND d.importURL=$4 ORDER BY d.created,d._id LIMIT 1",dataset_access::READ_PREDICATE))
        .bind(&user.id).bind(Option::<&str>::None).bind(&user.organization_id).bind(query.import_url).fetch_optional(&state.pool).await?;
    Ok(Json(match id {
        Some(id) => full_json(&state.pool, Some(&user), &id, features.jobs_enabled).await?,
        None => Value::Null,
    }))
}

async fn organization_for_name(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path(name): Path<String>,
    Query(query): Query<ReadQuery>,
) -> ApiResult<Json<Value>> {
    let organization:Option<String>=sqlx::query_scalar(&format!("SELECT d._organization FROM webknossos.datasets_ d WHERE {} AND d.name=$3 ORDER BY d.created LIMIT 1",dataset_access::READ_PREDICATE))
        .bind(user.as_ref().map(|u|u.id.as_str())).bind(query.sharing_token).bind(name).fetch_optional(&state.pool).await?;
    Ok(Json(
        json!({"organization":organization.ok_or_else(||ApiError::not_found("Dataset not found."))?}),
    ))
}

async fn id_for_directory_name(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path((organization, name)): Path<(String, String)>,
    Query(query): Query<ReadQuery>,
) -> ApiResult<Json<Value>> {
    let selected:Option<(String,Value)>=sqlx::query_as("SELECT d._id,jsonb_build_object('id',d._id,'name',d.name,'organization',d._organization,'directoryName',d.directoryName) FROM webknossos.datasets_ d JOIN webknossos.organizations_ o ON o._id=d._organization WHERE d._organization=$1 AND d.directoryName=$2 ORDER BY d.created LIMIT 1")
        .bind(&organization).bind(name).fetch_optional(&state.pool).await?;
    let (id, result) = selected.ok_or_else(|| ApiError::not_found("Dataset not found."))?;
    if dataset_access::can_read(
        &state.pool,
        user.as_ref(),
        &id,
        query.sharing_token.as_deref(),
    )
    .await?
    {
        return Ok(Json(result));
    }
    // AccessibleBySwitchingService only tests another identity's grant. This
    // endpoint returns the id without changing the active identity or token.
    let user = user.ok_or_else(|| ApiError::not_found("Dataset not found."))?;
    if user.is_superuser && user.organization_id != organization {
        return Ok(Json(result));
    }
    if user.organization_id != organization {
        let identities:Vec<AuthUser>=sqlx::query_as("SELECT identity._id AS id,identity._organization AS organization_id,identity.isAdmin AS is_admin,identity.isDatasetManager AS is_dataset_manager,multi.isSuperUser AS is_superuser FROM webknossos.users_ identity JOIN webknossos.users_ requester ON requester._multiUser=identity._multiUser JOIN webknossos.multiUsers_ multi ON multi._id=identity._multiUser JOIN webknossos.organizations_ o ON o._id=identity._organization WHERE requester._id=$1 AND identity._organization=$2 AND NOT identity.isDeactivated ORDER BY identity._id")
            .bind(&user.id).bind(organization).fetch_all(&state.pool).await?;
        for identity in identities {
            if dataset_access::can_read(&state.pool, Some(&identity), &id, None).await? {
                return Ok(Json(result));
            }
        }
    }
    Err(ApiError::not_found("Dataset not found."))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetadataUpdate {
    description: Option<String>,
    name: Option<String>,
    display_name: Option<String>,
    #[serde(default, deserialize_with = "crate::instant::optional")]
    sorting_key: Option<chrono::DateTime<chrono::Utc>>,
    is_public: bool,
    tags: Vec<String>,
    metadata: Option<Vec<Value>>,
    folder_id: Option<ObjectId>,
}

pub(crate) fn validate_metadata(metadata: &[Value]) -> ApiResult<()> {
    fn keys(value: &Value, seen: &mut std::collections::HashSet<String>) -> ApiResult<()> {
        match value {
            Value::Object(object) => {
                for (key, value) in object {
                    if key == "key" {
                        let key = value.as_str().ok_or_else(|| {
                            ApiError::bad_request("Metadata keys must be strings.")
                        })?;
                        if !seen.insert(key.to_owned()) {
                            return Err(ApiError::bad_request("Metadata keys must be unique."));
                        }
                    }
                    keys(value, seen)?;
                }
            }
            Value::Array(array) => {
                for value in array {
                    keys(value, seen)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    let mut seen = std::collections::HashSet::new();
    for entry in metadata {
        if !entry.is_object() {
            return Err(ApiError::bad_request("Metadata entries must be objects."));
        }
        keys(entry, &mut seen)?;
    }
    Ok(())
}

async fn update_metadata(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(features): Extension<DatasetFeatures>,
    Extension(misc): Extension<MiscState>,
    RequestJson(body): RequestJson<MetadataUpdate>,
) -> ApiResult<Json<Value>> {
    require_edit(&state, &user, &id).await?;
    let mut transaction = state.pool.begin().await?;
    dataset_access::lock_edit(&mut transaction, &user, id.as_str(), true).await?;
    let (existing_metadata, existing_folder, organization, created): (
        Value,
        String,
        String,
        chrono::DateTime<chrono::Utc>,
    ) = sqlx::query_as(
        "SELECT metadata,_folder,_organization,created FROM webknossos.datasets_ WHERE _id=$1",
    )
    .bind(id.as_str())
    .fetch_one(&mut *transaction)
    .await?;
    let metadata = body
        .metadata
        .unwrap_or_else(|| existing_metadata.as_array().cloned().unwrap_or_default());
    validate_metadata(&metadata)?;
    let folder = body.folder_id.map(String::from).unwrap_or(existing_folder);
    // Keep folder references live and within the dataset's organization. A
    // settings editor can move a dataset without managing the target folder.
    sqlx::query("SELECT f._id FROM webknossos.folders_ f JOIN webknossos.folder_paths fp ON fp._descendant=f._id JOIN webknossos.organizations_ o ON o._rootFolder=fp._ancestor WHERE f._id=$1 AND o._id=$2 FOR SHARE OF f, fp")
        .bind(&folder).bind(&organization).fetch_optional(&mut *transaction).await?
        .ok_or_else(||ApiError::bad_request("Folder does not belong to the dataset organization."))?;
    let sorting_key = body.sorting_key.unwrap_or(created);
    sqlx::query("UPDATE webknossos.datasets SET description=$2,name=$3,sortingKey=$4,isPublic=$5,tags=$6,metadata=$7,_folder=$8 WHERE _id=$1 AND NOT isDeleted")
        .bind(id.as_str()).bind(body.description).bind(body.display_name.or(body.name)).bind(sorting_key)
        .bind(body.is_public).bind(body.tags).bind(json!(metadata)).bind(folder).execute(&mut *transaction).await?;
    let readable: bool = sqlx::query_scalar(&format!(
        "SELECT {} FROM webknossos.datasets_ d WHERE d._id=$3",
        dataset_access::READ_PREDICATE
    ))
    .bind(&user.id)
    .bind(Option::<&str>::None)
    .bind(id.as_str())
    .fetch_one(&mut *transaction)
    .await?;
    if !readable {
        return Err(ApiError::not_found("Dataset not found."));
    }
    let result = full_json_on_connection(
        &mut transaction,
        Some(&user),
        id.as_str(),
        features.jobs_enabled,
    )
    .await?;
    transaction.commit().await?;
    // ChangeDatasetSettingsEvent(request.identity, updated)
    analytics::track(
        &state,
        &misc,
        &user,
        "change_dataset_settings".into(),
        analytics::properties("dataset_id", id.as_str()),
    );
    Ok(Json(result))
}

async fn access_list(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<Json<Vec<Value>>> {
    require_read(&state, &user, &id).await?;
    let organization: String =
        sqlx::query_scalar("SELECT _organization FROM webknossos.datasets_ WHERE _id=$1")
            .bind(id.as_str())
            .fetch_one(&state.pool)
            .await?;
    let can_read_organization:bool=sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.organizations_ o WHERE o._id=$1 AND ($3 OR EXISTS (SELECT 1 FROM webknossos.users_ identity JOIN webknossos.users_ requesting_identity ON requesting_identity._multiUser=identity._multiUser WHERE requesting_identity._id=$2 AND identity._organization=o._id)))")
        .bind(&organization).bind(&user.id).bind(user.is_superuser).fetch_one(&state.pool).await?;
    if !can_read_organization {
        return Err(ApiError::not_found("Organization not found."));
    }
    let rows=sqlx::query_scalar(r#"SELECT jsonb_build_object('id',u._id,'email',m.email,'firstName',m.firstName,'lastName',m.lastName,
      'isAdmin',u.isAdmin,'isDatasetManager',u.isDatasetManager,'isActive',NOT u.isDeactivated,'isAnonymous',false,
      'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t._id,'name',t.name,'isTeamManager',r.isTeamManager) ORDER BY t._id)
        FROM webknossos.user_team_roles r JOIN webknossos.teams_ t ON t._id=r._team AND t._organization=u._organization WHERE r._user=u._id),'[]'::jsonb))
      FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON m._id=u._multiUser
      WHERE u._organization=$2 AND NOT u.isDeactivated AND NOT u.isUnlisted
      AND (u._id=$1 OR ($3 AND u._organization=$4) OR EXISTS (
        SELECT 1 FROM webknossos.user_team_roles target JOIN webknossos.user_team_roles requester ON requester._team=target._team
        JOIN webknossos.teams_ t ON t._id=requester._team AND t._organization=$4 AND t._organization=u._organization
        WHERE target._user=u._id AND requester._user=$1 AND requester.isTeamManager))
      AND (u.isAdmin OR u.isDatasetManager OR EXISTS (
        SELECT 1 FROM webknossos.user_team_roles r JOIN webknossos.teams_ t ON t._id=r._team AND t._organization=u._organization
        WHERE r._user=u._id AND (r._team IN (SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset=$5)
          OR r._team IN (SELECT ft._team FROM webknossos.folder_allowedTeams ft JOIN webknossos.folder_paths fp ON fp._ancestor=ft._folder
            JOIN webknossos.datasets_ d ON d._folder=fp._descendant WHERE d._id=$5)))) ORDER BY u._id"#)
        .bind(&user.id).bind(organization).bind(user.is_admin).bind(&user.organization_id).bind(id.as_str())
        .fetch_all(&state.pool).await?;
    Ok(Json(rows))
}

async fn superuser_data_source(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<Json<Value>> {
    if !user.is_superuser {
        return Err(ApiError::forbidden(
            "This route is only allowed for super users.",
        ));
    }
    Ok(Json(
        data_source_json(
            &state.pool,
            id.as_str(),
            CredentialIdExposure::Include,
            true,
        )
        .await?,
    ))
}

#[derive(Clone, Copy)]
enum CredentialIdExposure {
    Omit,
    Include,
}

/// DataSource JSON as sent to the datastore (credential ids included). With
/// `use_real_paths = false`, stored paths are used instead of resolved real paths.
pub(crate) async fn data_source_for_rpc(
    pool: &sqlx::PgPool,
    id: &str,
    use_real_paths: bool,
) -> ApiResult<Value> {
    data_source_json(pool, id, CredentialIdExposure::Include, use_real_paths).await
}

async fn data_source_json(
    pool: &sqlx::PgPool,
    id: &str,
    exposure: CredentialIdExposure,
    use_real_paths: bool,
) -> ApiResult<Value> {
    let (usable,mut source):(bool,Value)=sqlx::query_as(r#"SELECT isUsable,jsonb_build_object('id',jsonb_build_object('name',directoryName,'team',_organization),
      'status',status,'scale',CASE WHEN voxelSizeFactor IS NOT NULL THEN jsonb_build_object('factor',jsonb_build_array((voxelSizeFactor).x,(voxelSizeFactor).y,(voxelSizeFactor).z),
        'unit',COALESCE(voxelSizeUnit::text,'nanometer')) ELSE NULL END) FROM webknossos.datasets_ WHERE _id=$1"#)
        .bind(id).fetch_one(pool).await?;
    if usable {
        if source["scale"].is_null() {
            return Err(ApiError::internal());
        }
        source.as_object_mut().unwrap().remove("status");
        source["dataLayers"] =
            json!(full_layers_with_exposure(pool, id, exposure, use_real_paths).await?);
    } else {
        omit_null_fields(&mut source, &["scale"]);
    }
    Ok(source)
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadQuery {
    sharing_token: Option<String>,
}

async fn read(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path(id): Path<PathObjectId>,
    Query(query): Query<ReadQuery>,
    Extension(features): Extension<DatasetFeatures>,
    Extension(misc): Extension<MiscState>,
) -> ApiResult<Json<Value>> {
    if !dataset_access::can_read(
        &state.pool,
        user.as_ref(),
        id.as_str(),
        query.sharing_token.as_deref(),
    )
    .await?
    {
        return Err(ApiError::not_found("Dataset not found."));
    }
    if let Some(user) = user.as_ref() {
        sqlx::query("INSERT INTO webknossos.dataset_lastUsedTimes (_dataset,_user,lastUsedTime) VALUES ($1,$2,NOW()) ON CONFLICT (_dataset,_user) DO UPDATE SET lastUsedTime = NOW()")
            .bind(id.as_str()).bind(&user.id).execute(&state.pool).await?;
    }
    let result = full_json(
        &state.pool,
        user.as_ref(),
        id.as_str(),
        features.jobs_enabled,
    )
    .await?;
    if let Some(user) = user {
        analytics::track_open_dataset(&state, &misc, &user, id.as_str());
        sqlx::query("UPDATE webknossos.users SET lastActivity = NOW() WHERE _id = $1")
            .bind(user.id)
            .execute(&state.pool)
            .await?;
    }
    Ok(Json(result))
}

/// Render DatasetService.publicWrites after the caller has checked read access.
/// Credentials and datastore keys are never selected into the returned JSON.
pub(crate) async fn full_json(
    pool: &sqlx::PgPool,
    user: Option<&AuthUser>,
    dataset_id: &str,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let mut connection = pool.acquire().await?;
    full_json_on_connection(&mut connection, user, dataset_id, jobs_enabled).await
}

pub(crate) async fn full_json_on_connection(
    connection: &mut sqlx::PgConnection,
    user: Option<&AuthUser>,
    dataset_id: &str,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let sql = format!(
        r#"SELECT jsonb_build_object(
      'id',d._id,'name',d.name,'owningOrganization',o._id,'directoryName',d.directoryName,
      'isActive',d.isUsable,'isPublic',d.isPublic,'description',d.description,
      'created',floor(extract(epoch from d.created)*1000)::bigint,
      'thumbnailCacheVersion',d.thumbnailCacheVersion,'isEditable',{edit},
      'lastUsedByUser',COALESCE((SELECT floor(extract(epoch from lastUsedTime)*1000)::bigint FROM webknossos.dataset_lastUsedTimes l WHERE l._dataset=d._id AND l._user=$1),0),
      'logoUrl',COALESCE(d.logoUrl,o.logoUrl),'sortingKey',floor(extract(epoch from d.sortingKey)*1000)::bigint,
      'metadata',d.metadata,'isUnreported',d.status=$4,'tags',ARRAY(SELECT unnest(d.tags) ORDER BY 1),
      'folderId',d._folder,'isVirtual',d.isVirtual,'creationType',d.creationType,
      'rootPath',d.rootPath,'rootRealPath',d.rootRealPath,'mirrorPath',d.mirrorPath,
      'uploaderFullName',(SELECT concat(m.firstName,' ',m.lastName) FROM webknossos.users_ up
        JOIN webknossos.multiUsers_ m ON m._id=up._multiUser WHERE up._id=d._uploader AND up._organization=$3),
      'allowedTeams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t._id,'name',t.name,
        'organization',o._id,'isOrganizationTeam',t.isOrganizationTeam)) FROM webknossos.teams_ t
        WHERE t._organization=$3 AND t._id IN (SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset=d._id)
        AND (EXISTS (SELECT 1 FROM webknossos.user_team_roles r WHERE r._team=t._id AND r._user=$1)
          OR EXISTS (SELECT 1 FROM webknossos.users_ u WHERE u._id=$1 AND u.isAdmin AND u._organization=t._organization))), '[]'::jsonb),
      'allowedTeamsCumulative',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t._id,'name',t.name,
        'organization',o._id,'isOrganizationTeam',t.isOrganizationTeam)) FROM webknossos.teams_ t
        WHERE t._organization=$3 AND t._id IN (SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset=d._id
          UNION SELECT ft._team FROM webknossos.folder_allowedTeams ft JOIN webknossos.folder_paths fp ON fp._ancestor=ft._folder WHERE fp._descendant=d._folder)
        AND (EXISTS (SELECT 1 FROM webknossos.user_team_roles r WHERE r._team=t._id AND r._user=$1)
          OR EXISTS (SELECT 1 FROM webknossos.users_ u WHERE u._id=$1 AND u.isAdmin AND u._organization=t._organization))), '[]'::jsonb),
      'usedStorageBytes',CASE WHEN d._organization=$3 THEN
        COALESCE((SELECT sum(usedStorageBytes) FROM webknossos.organization_usedStorage_mags WHERE _dataset=d._id),0)
        + COALESCE((SELECT sum(usedStorageBytes) FROM webknossos.organization_usedStorage_attachments WHERE _dataset=d._id),0) ELSE 0 END,
      'dataSource',jsonb_build_object('id',jsonb_build_object('name',d.directoryName,'team',d._organization),
        'scale',CASE WHEN d.voxelSizeFactor IS NOT NULL THEN jsonb_build_object('factor',jsonb_build_array((d.voxelSizeFactor).x,(d.voxelSizeFactor).y,(d.voxelSizeFactor).z),
          'unit',COALESCE(d.voxelSizeUnit::text,'nanometer')) ELSE NULL END,'status',d.status),
      'dataStore',jsonb_build_object('name',store.name))
      FROM webknossos.datasets_ d JOIN webknossos.organizations_ o ON o._id=d._organization
      JOIN webknossos.dataStores_ store ON store.name=trim(d._dataStore) WHERE d._id=$2"#,
        edit = dataset_access::EDIT_PREDICATE
    );
    let mut result: Value = sqlx::query_scalar(&sql)
        .bind(user.map(|u| u.id.as_str()))
        .bind(dataset_id)
        .bind(user.map(|u| u.organization_id.as_str()))
        .bind(UNREPORTED)
        .fetch_one(&mut *connection)
        .await?;
    let datastore_name = result["dataStore"]["name"]
        .as_str()
        .ok_or_else(ApiError::internal)?
        .to_owned();
    result["dataStore"] =
        public_datastore_json_on_connection(connection, &datastore_name, jobs_enabled).await?;
    let usable = result["isActive"].as_bool().unwrap_or(false);
    let datasource = result["dataSource"]
        .as_object_mut()
        .ok_or_else(ApiError::internal)?;
    if datasource["scale"].is_null() {
        if usable {
            return Err(ApiError::internal());
        }
        datasource.remove("scale");
    }
    if usable {
        datasource.remove("status");
        datasource.insert(
            "dataLayers".to_owned(),
            Value::Array(
                full_layers_with_exposure_on_connection(
                    connection,
                    dataset_id,
                    CredentialIdExposure::Omit,
                    true,
                )
                .await?,
            ),
        );
    }
    scrub_credentials(&mut result["dataSource"]);
    Ok(result)
}

/// DataStoreService.publicWrites, including WorkerDAO's command validation.
/// Datastore list routes can share this after applying their own read predicate.
pub(crate) async fn public_datastore_json_on_connection(
    connection: &mut sqlx::PgConnection,
    name: &str,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let (name, url, allows_upload): (String, String, bool) = sqlx::query_as(
        "SELECT name,publicUrl,allowsUpload FROM webknossos.dataStores_ WHERE name=$1",
    )
    .bind(name)
    .fetch_one(&mut *connection)
    .await?;
    let mut commands:Vec<String>=sqlx::query_scalar("SELECT DISTINCT unnest(supportedJobCommands) FROM webknossos.workers_ WHERE _dataStore=$1 ORDER BY 1")
        .bind(&name).fetch_all(&mut *connection).await?;
    for command in &commands {
        if !matches!(
            command.as_str(),
            "compute_mesh_file"
                | "compute_segment_index_file"
                | "convert_to_wkw"
                | "export_tiff"
                | "find_largest_segment_id"
                | "materialize_volume_annotation"
                | "render_animation"
                | "align_sections"
                | "infer_neurons"
                | "infer_instances"
                | "infer_mitochondria"
                | "train_neuron_model"
                | "train_instance_model"
                | "globalize_floodfills"
                | "train_model"
                | "infer_with_model"
                | "infer_nuclei"
        ) {
            return Err(ApiError::internal());
        }
    }
    let enabled = jobs_enabled && !commands.is_empty();
    if !jobs_enabled {
        commands.clear();
    }
    Ok(
        json!({"name":name,"url":url,"allowsUpload":allows_upload,"jobsSupportedByAvailableWorkers":commands,"jobsEnabled":enabled}),
    )
}

fn scrub_credentials(value: &mut Value) {
    match value {
        Value::Object(object) => {
            object.remove("credentialId");
            object.remove("credentials");
            for nested in object.values_mut() {
                scrub_credentials(nested);
            }
        }
        Value::Array(array) => {
            for nested in array {
                scrub_credentials(nested);
            }
        }
        _ => {}
    }
}

fn omit_null_fields(value: &mut Value, keys: &[&str]) {
    if let Some(object) = value.as_object_mut() {
        for key in keys {
            if object.get(*key).is_some_and(Value::is_null) {
                object.remove(*key);
            }
        }
    }
}

#[derive(Deserialize, serde::Serialize)]
struct AxisOrder {
    x: i32,
    y: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    z: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    c: Option<i32>,
}

fn canonicalize_axis_order(mag: &mut Value) {
    fn integer(value: &Value) -> Option<i32> {
        let number = value.as_f64()?;
        (number.fract() == 0.0 && number >= f64::from(i32::MIN) && number <= f64::from(i32::MAX))
            .then_some(number as i32)
    }
    if let Some(object) = mag.as_object_mut()
        && let Some(raw) = object.remove("axisOrder")
    {
        let optional_valid = |key| {
            raw.get(key)
                .is_none_or(|v| v.is_null() || integer(v).is_some())
        };
        if let (Some(x), Some(y)) = (integer(&raw["x"]), integer(&raw["y"]))
            && optional_valid("z")
            && optional_valid("c")
        {
            object.insert(
                "axisOrder".to_owned(),
                json!(AxisOrder {
                    x,
                    y,
                    z: integer(&raw["z"]),
                    c: integer(&raw["c"])
                }),
            );
        }
    }
}

fn vec3_list(value: &Value) -> bool {
    value.as_array().is_some_and(|vectors| {
        vectors.iter().all(|vector| {
            vector.as_array().is_some_and(|coordinates| {
                coordinates.len() == 3 && coordinates.iter().all(Value::is_number)
            })
        })
    })
}

fn canonicalize_transform(transform: &mut Value) -> ApiResult<()> {
    match transform["type"].as_str() {
        Some("affine") => {
            if !transform["matrix"].as_array().is_some_and(|rows| {
                rows.iter().all(|row| {
                    row.as_array()
                        .is_some_and(|values| values.iter().all(Value::is_number))
                })
            }) {
                return Err(ApiError::internal());
            }
            transform.as_object_mut().unwrap().remove("correspondences");
        }
        Some("thin_plate_spline") => {
            if !vec3_list(&transform["correspondences"]["source"])
                || !vec3_list(&transform["correspondences"]["target"])
            {
                return Err(ApiError::internal());
            }
            let correspondences = json!({"source":transform["correspondences"]["source"],"target":transform["correspondences"]["target"]});
            transform["correspondences"] = correspondences;
            transform.as_object_mut().unwrap().remove("matrix");
        }
        _ => return Err(ApiError::internal()),
    }
    Ok(())
}

pub(crate) async fn full_layers(pool: &sqlx::PgPool, dataset_id: &str) -> ApiResult<Vec<Value>> {
    full_layers_with_exposure(pool, dataset_id, CredentialIdExposure::Omit, true).await
}

async fn full_layers_with_exposure(
    pool: &sqlx::PgPool,
    dataset_id: &str,
    exposure: CredentialIdExposure,
    use_real_paths: bool,
) -> ApiResult<Vec<Value>> {
    let mut connection = pool.acquire().await?;
    full_layers_with_exposure_on_connection(&mut connection, dataset_id, exposure, use_real_paths)
        .await
}

async fn full_layers_with_exposure_on_connection(
    connection: &mut sqlx::PgConnection,
    dataset_id: &str,
    exposure: CredentialIdExposure,
    use_real_paths: bool,
) -> ApiResult<Vec<Value>> {
    let rows:Vec<Value>=sqlx::query_scalar(r#"SELECT jsonb_build_object('name',l.name,'category',l.category,
      'elementClass',l.elementClass,'dataFormat',l.dataFormat,
      'boundingBox',jsonb_build_object('topLeft',jsonb_build_array((l.boundingBox).x::int,(l.boundingBox).y::int,(l.boundingBox).z::int),
        'width',(l.boundingBox).width::int,'height',(l.boundingBox).height::int,'depth',(l.boundingBox).depth::int),
      'numChannels',CASE WHEN l.elementClass='uint24' THEN 3 ELSE 1 END,
      'defaultViewConfiguration',l.defaultViewConfiguration,'adminViewConfiguration',l.adminViewConfiguration,
      'largestSegmentId',l.largestSegmentId,'mappings',l.mappings,
      'coordinateTransformations',(SELECT jsonb_agg(jsonb_build_object('type',c.type,'matrix',c.matrix,'correspondences',c.correspondences) ORDER BY c.insertionOrderIndex)
        FROM webknossos.dataset_layer_coordinateTransformations c WHERE c._dataset=l._dataset AND c.layerName=l.name),
      'additionalAxes',(SELECT jsonb_agg(jsonb_build_object('name',a.name,'bounds',jsonb_build_array(a.lowerBound,a.upperBound),'index',a.index))
        FROM webknossos.dataset_layer_additionalAxes a WHERE a._dataset=l._dataset AND a.layerName=l.name),
      'mags',COALESCE((SELECT jsonb_agg(jsonb_build_object('mag',jsonb_build_array((m.mag).x::int,(m.mag).y::int,(m.mag).z::int),
        'path',CASE WHEN $2 THEN COALESCE(m.realPath,m.path) ELSE m.path END,'axisOrder',m.axisOrder,'channelIndex',m.channelIndex,'credentialId',m.credentialId)
        ORDER BY greatest((m.mag).x,(m.mag).y,(m.mag).z)) FROM webknossos.dataset_mags m
        WHERE m._dataset=l._dataset AND m.dataLayerName=l.name AND NOT m.uploadToPathIsPending AND NOT m.uploadIsPending),'[]'::jsonb))
      FROM webknossos.dataset_layers l WHERE l._dataset=$1 ORDER BY l.name"#).bind(dataset_id).bind(use_real_paths).fetch_all(&mut *connection).await?;
    let attachments:Vec<(String,String,Value)>=sqlx::query_as(r#"SELECT layerName,type::text,jsonb_build_object('name',name,
        'path',CASE WHEN $2 THEN COALESCE(realPath,path) ELSE path END,'dataFormat',dataFormat,'credentialId',credentialId) FROM webknossos.dataset_layer_attachments
        WHERE _dataset=$1 AND NOT uploadToPathIsPending AND NOT uploadIsPending"#)
        .bind(dataset_id).bind(use_real_paths).fetch_all(&mut *connection).await?;
    let attachments = attachments
        .into_iter()
        .map(|(name, typ, mut attachment)| {
            omit_null_fields(&mut attachment, &["credentialId"]);
            if matches!(exposure, CredentialIdExposure::Omit) {
                attachment.as_object_mut().unwrap().remove("credentialId");
            }
            (name, typ, attachment)
        })
        .collect::<Vec<_>>();
    let mut result = Vec::new();
    for mut layer in rows {
        if layer["dataFormat"].is_null()
            || !matches!(layer["category"].as_str(), Some("color" | "segmentation"))
        {
            return Err(ApiError::internal());
        }
        let segmentation = layer["category"] == "segmentation";
        if let Some(id) = layer["largestSegmentId"].as_i64().filter(|_| segmentation) {
            layer["largestSegmentId"] =
                json!({"customJsonEncoding":"bigint","value":(id as u64).to_string()});
        } else {
            layer.as_object_mut().unwrap().remove("largestSegmentId");
        }
        if !segmentation || layer["mappings"].as_array().is_none_or(Vec::is_empty) {
            layer.as_object_mut().unwrap().remove("mappings");
        } else if let Some(mappings) = layer["mappings"].as_array_mut() {
            let mut seen = std::collections::HashSet::new();
            mappings.retain(|mapping| seen.insert(mapping.as_str().unwrap_or_default().to_owned()));
        }
        if let Some(mags) = layer["mags"].as_array_mut() {
            for mag in mags {
                omit_null_fields(mag, &["path", "axisOrder", "channelIndex", "credentialId"]);
                if matches!(exposure, CredentialIdExposure::Omit) {
                    mag.as_object_mut().unwrap().remove("credentialId");
                }
                canonicalize_axis_order(mag);
            }
        }
        layer["resolutions"] = json!(
            layer["mags"]
                .as_array()
                .unwrap()
                .iter()
                .map(|mag| mag["mag"].clone())
                .collect::<Vec<_>>()
        );
        if let Some(transforms) = layer["coordinateTransformations"].as_array_mut() {
            for transform in transforms {
                canonicalize_transform(transform)?;
            }
        }
        omit_null_fields(
            &mut layer,
            &[
                "defaultViewConfiguration",
                "adminViewConfiguration",
                "coordinateTransformations",
                "additionalAxes",
            ],
        );
        let mut wrapper = json!({"meshes":[],"agglomerates":[],"connectomes":[]});
        let mut present = false;
        for (_, typ, attachment) in attachments
            .iter()
            .filter(|(name, _, _)| layer["name"].as_str() == Some(name))
        {
            present = true;
            match typ.as_str() {
                "mesh" => wrapper["meshes"]
                    .as_array_mut()
                    .unwrap()
                    .push(attachment.clone()),
                "agglomerate" => wrapper["agglomerates"]
                    .as_array_mut()
                    .unwrap()
                    .push(attachment.clone()),
                "connectome" => wrapper["connectomes"]
                    .as_array_mut()
                    .unwrap()
                    .push(attachment.clone()),
                singleton => {
                    wrapper
                        .as_object_mut()
                        .unwrap()
                        .entry(singleton.to_owned())
                        .or_insert_with(|| attachment.clone());
                }
            }
        }
        if present {
            layer["attachments"] = wrapper;
        }
        result.push(layer);
    }
    Ok(result)
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListQuery {
    is_active: Option<bool>,
    is_unreported: Option<bool>,
    organization_id: Option<String>,
    only_my_organization: Option<bool>,
    uploader_id: Option<ObjectId>,
    folder_id: Option<ObjectId>,
    include_subfolders: Option<bool>,
    search_query: Option<String>,
    limit: Option<i64>,
    pub(crate) include_annotation_count: Option<bool>,
    pub(crate) compact: Option<bool>,
}

async fn list(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<Vec<Value>>> {
    let rows = list_values(&state.pool, user.as_ref(), &query).await?;
    if let Some(user) = user {
        sqlx::query("UPDATE webknossos.users SET lastActivity = NOW() WHERE _id = $1")
            .bind(user.id)
            .execute(&state.pool)
            .await?;
    }
    Ok(Json(rows))
}

pub(crate) async fn list_values(
    pool: &sqlx::PgPool,
    user: Option<&AuthUser>,
    query: &ListQuery,
) -> ApiResult<Vec<Value>> {
    if query.limit.is_some_and(|n| n < 0) {
        return Err(ApiError::bad_request("Invalid limit."));
    }
    let organization = if query.only_my_organization.unwrap_or(false) {
        user.as_ref().map(|u| u.organization_id.as_str())
    } else {
        query.organization_id.as_deref()
    };
    let tokens: Vec<String> = query
        .search_query
        .as_deref()
        .map(|s| {
            s.trim()
                .to_lowercase()
                .split(' ')
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let searched_id = tokens
        .first()
        .filter(|s| tokens.len() == 1 && ObjectId::parse(s).is_ok());
    // Compact Scala writes historically use folder membership (without the
    // manager flag) for this informational field. Mutations use can_edit.
    let compact_edit = dataset_access::EDIT_PREDICATE.replace(
        "WHERE fp._descendant = d._folder AND r._user = u._id AND r.isTeamManager",
        "WHERE fp._descendant = d._folder AND r._user = u._id",
    );
    let sql = format!(
        r#"SELECT jsonb_build_object(
      'id', d._id, 'name', d.name, 'owningOrganization', d._organization,
      'folderId', d._folder, 'isActive', d.isUsable, 'directoryName', d.directoryName,
      'created', floor(extract(epoch from d.created)*1000)::bigint,
      'isEditable', {compact_edit},
      'lastUsedByUser', COALESCE((SELECT floor(extract(epoch from l.lastUsedTime)*1000)::bigint
         FROM webknossos.dataset_lastUsedTimes l WHERE l._dataset = d._id AND l._user = $1), 0),
      'status', d.status, 'tags', d.tags, 'isUnreported', d.status IN ($8, $9),
      'colorLayerNames', COALESCE((SELECT jsonb_agg(l.name ORDER BY l.name)
         FROM webknossos.dataset_layers l WHERE l._dataset = d._id AND l.category = 'color'), '[]'::jsonb),
      'segmentationLayerNames', COALESCE((SELECT jsonb_agg(l.name ORDER BY l.name)
         FROM webknossos.dataset_layers l WHERE l._dataset = d._id AND l.category = 'segmentation'), '[]'::jsonb),
      'usedStorageBytes', CASE WHEN d._organization = $13 THEN
         COALESCE((SELECT sum(s.usedStorageBytes) FROM webknossos.organization_usedStorage_mags s WHERE s._dataset = d._id), 0)
         + COALESCE((SELECT sum(s.usedStorageBytes) FROM webknossos.organization_usedStorage_attachments s WHERE s._dataset = d._id), 0) ELSE 0 END,
      'thumbnailCacheVersion', d.thumbnailCacheVersion,
      'annotationCount', CASE WHEN $14 AND $1::text IS NOT NULL THEN (SELECT count(*)
         FROM webknossos.annotations_ a WHERE a._dataset = d._id AND a.typ = 'Explorational' AND a.state = 'Active'
         AND (a._user = $1 OR (a.visibility IN ('Public', 'Internal') AND (
           EXISTS (SELECT 1 FROM webknossos.annotation_sharedTeams st JOIN webknossos.user_team_roles r ON r._team = st._team
             WHERE st._annotation = a._id AND r._user = $1)
           OR EXISTS (SELECT 1 FROM webknossos.annotation_contributors c WHERE c._annotation = a._id AND c._user = $1))))) ELSE NULL END)
      FROM webknossos.datasets_ d JOIN webknossos.organizations o ON o._id = d._organization
      WHERE {read} AND ($3::boolean IS NULL OR d.isUsable = $3)
      AND ($4::boolean IS NULL OR (d.status IN ($8, $9)) = $4)
      AND ($5::text IS NULL OR d._organization = $5)
      AND ($6::text IS NULL OR d._uploader = $6)
      AND ($7::text IS NULL OR CASE WHEN $10 THEN EXISTS (SELECT 1 FROM webknossos.folder_paths fp
          WHERE fp._ancestor = $7 AND fp._descendant = d._folder) ELSE d._folder = $7 END)
      AND (CASE WHEN $11::text IS NOT NULL THEN d._id = $11 ELSE NOT EXISTS (
        SELECT 1 FROM unnest($12::text[]) t WHERE position(t IN lower(d.name)) = 0
          AND position(t IN lower(d.directoryName)) = 0) END) LIMIT $15"#,
        read = dataset_access::READ_PREDICATE
    );
    let mut rows = sqlx::query_scalar::<_, Value>(&sql)
        .bind(user.as_ref().map(|u| u.id.as_str()))
        .bind(Option::<&str>::None)
        .bind(query.is_active)
        .bind(query.is_unreported)
        .bind(organization)
        .bind(query.uploader_id.as_ref().map(ObjectId::as_str))
        .bind(query.folder_id.as_ref().map(ObjectId::as_str))
        .bind(UNREPORTED)
        .bind(DELETED_BY_USER)
        .bind(query.include_subfolders.unwrap_or(false))
        .bind(searched_id)
        .bind(&tokens)
        .bind(user.as_ref().map(|u| u.organization_id.as_str()))
        .bind(query.include_annotation_count.unwrap_or(false))
        .bind(query.limit)
        .fetch_all(pool)
        .await?;
    for row in &mut rows {
        omit_null_fields(row, &["annotationCount"]);
    }
    Ok(rows)
}

async fn require_read(state: &AppState, user: &AuthUser, id: &ObjectId) -> ApiResult<()> {
    if !dataset_access::can_read(&state.pool, Some(user), id.as_str(), None).await? {
        return Err(ApiError::not_found("Dataset not found."));
    }
    Ok(())
}

async fn require_edit(state: &AppState, user: &AuthUser, id: &ObjectId) -> ApiResult<()> {
    require_read(state, user, id).await?;
    if !dataset_access::can_edit(&state.pool, user, id.as_str()).await? {
        return Err(ApiError::forbidden("Not allowed."));
    }
    Ok(())
}

async fn sharing_token(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<Json<Value>> {
    require_read(&state, &user, &id).await?;
    let result: Option<String> = sqlx::query_scalar(&format!("UPDATE webknossos.datasets d SET sharingToken = COALESCE(sharingToken, $5) WHERE d._id = $3 AND d._organization = $4 AND NOT d.isDeleted AND {} RETURNING sharingToken", dataset_access::READ_PREDICATE))
        .bind(user.id).bind(Option::<&str>::None).bind(id.as_str()).bind(user.organization_id).bind(uuid::Uuid::new_v4().simple().to_string())
        .fetch_optional(&state.pool).await?;
    Ok(Json(
        json!({"sharingToken": result.ok_or_else(|| ApiError::forbidden("Not allowed."))?.trim()}),
    ))
}

async fn delete_sharing_token(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<()> {
    require_edit(&state, &user, &id).await?;
    let result = sqlx::query(&format!("UPDATE webknossos.datasets d SET sharingToken = NULL WHERE d._id = $3 AND d._organization = $4 AND NOT d.isDeleted AND {} AND {}",dataset_access::READ_PREDICATE,dataset_access::EDIT_PREDICATE))
        .bind(user.id).bind(Option::<&str>::None).bind(id.as_str()).bind(user.organization_id).execute(&state.pool).await?;
    if result.rows_affected() != 1 {
        return Err(ApiError::forbidden("Not allowed."));
    }
    Ok(())
}

async fn update_teams(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    RequestJson(requested): RequestJson<Vec<ObjectId>>,
) -> ApiResult<Json<Vec<String>>> {
    require_edit(&state, &user, &id).await?;
    let mut transaction = state.pool.begin().await?;
    dataset_access::lock_edit(&mut transaction, &user, id.as_str(), true).await?;
    // Dataset managers can update teams they can read; other users only teams
    // they manage. Unmanageable current grants must survive the replacement.
    let managed: Vec<String> = sqlx::query_scalar(
        r#"SELECT t._id FROM webknossos.teams_ t WHERE t._organization = $2 AND
      ($3 OR EXISTS (SELECT 1 FROM webknossos.user_team_roles r
        WHERE r._team = t._id AND r._user = $1 AND ($4 OR r.isTeamManager)))"#,
    )
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(user.is_dataset_manager)
    .fetch_all(&mut *transaction)
    .await?;
    let current: Vec<String> =
        sqlx::query_scalar("SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset = $1")
            .bind(id.as_str())
            .fetch_all(&mut *transaction)
            .await?;
    let mut updated: Vec<String> = requested
        .into_iter()
        .map(String::from)
        .filter(|t| managed.contains(t))
        .collect();
    updated.extend(current.into_iter().filter(|t| !managed.contains(t)));
    let mut seen = std::collections::HashSet::new();
    updated.retain(|t| seen.insert(t.clone()));
    sqlx::query("DELETE FROM webknossos.dataset_allowedTeams WHERE _dataset = $1")
        .bind(id.as_str())
        .execute(&mut *transaction)
        .await?;
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams (_dataset, _team) SELECT $1, unnest($2::text[])")
        .bind(id.as_str()).bind(&updated).execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(Json(updated))
}

async fn valid_name(_user: AuthUser, Path(name): Path<String>) -> Json<Value> {
    let error = if !name
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || b"_-.".contains(&c))
    {
        Some(
            "Dataset name is invalid. Please use only letters, digits, dots, underscores, hyphens.",
        )
    } else if name.starts_with('.') {
        Some("Dataset name is invalid. Please use a name that does not start with a dot.")
    } else if name.len() < 3 {
        Some("Dataset name is invalid. Please use at least three characters.")
    } else {
        None
    };
    Json(
        error
            .map(|e| json!({"isValid": false, "errors": e}))
            .unwrap_or_else(|| json!({"isValid": true})),
    )
}
