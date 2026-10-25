//! WKRemoteDataStoreController `reserveDatasetUpload` /
//! `getUnfinishedDatasetUploadsForUser`: before a resumable dataset upload the
//! datastore reserves a new, unusable virtual dataset (status
//! `notYetUploaded`) for the uploading user, and it lists that user's recent
//! unfinished uploads so the client can resume them.
//!
//! Both routes authenticate the calling datastore with `?key=`
//! ([`ValidatedDataStore`]) and resolve the uploading user from `?token=`;
//! here an unusable token is a 403 (`userForToken ~> FORBIDDEN`). Deviations
//! from Play are listed in checkpoints/remote-datastore-dataset-upload.md.
use axum::{
    Json as ResponseJson, Router,
    extract::State,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use webknossos_common::{datasource::DataSourceId, geometry::Vec3Double};

use crate::{
    AppState,
    auth::AuthUser,
    dataset::create::NewDataset,
    dataset::lifecycle::NOT_YET_UPLOADED,
    dataset::source::{UsableDataSource, VoxelSize},
    dataset::upload_paths::{LinkedLayer, add_initial_teams},
    error::{ApiError, ApiResult},
    extract::{Json, Query},
    remote::datastore::ValidatedDataStore,
    remote::datastore::mag_upload::{ResumableUploadInfo, TokenQuery, user_for_token_forbidden},
    util::id::ObjectId,
};

/// Msg.Dataset.Upload.datastoreRestricted.
const DATASTORE_RESTRICTED: &str = "Your organization does not have permission to upload datasets to this data store. Please choose another data store.";
/// Msg.Dataset.Upload.invalidLinkedLayers (wraps notFound / linkRestricted).
const INVALID_LINKED_LAYERS: &str = "Could not link all requested layers.";
/// Msg.Dataset.Upload.createFailed (wraps every createAndSetUpDataset failure).
const CREATE_FAILED: &str = "Could not create dataset.";
/// Msg.Dataset.Upload.couldNotLoadUnfinishedUploads.
const COULD_NOT_LOAD_UNFINISHED: &str = "Could not load unfinished uploads of user.";
/// UnfinishedUpload.uploadId placeholder; the datastore fills in the real id.
const UPLOAD_ID_PLACEHOLDER: &str = "<filled-in by datastore>";

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/datastores/{name}/reserveDatasetUpload",
            post(reserve_dataset_upload),
        )
        .route(
            "/datastores/{name}/getUnfinishedDatasetUploadsForUser",
            get(unfinished_uploads),
        )
}

fn organization_not_found(id: &str) -> ApiError {
    ApiError::not_found(crate::msg::organization::not_found(id))
}

/// `organizationDAO.findOne(id)(GlobalAccessContext) ~> NOT_FOUND`, then
/// `organization._id == user._organization ~> FORBIDDEN` (the caller places the
/// second check where Scala does). Returns `includedStorage`.
async fn find_organization(pool: &sqlx::PgPool, id: &str) -> ApiResult<Option<i64>> {
    sqlx::query_scalar::<_, Option<i64>>(
        "SELECT includedStorage FROM webknossos.organizations_ WHERE _id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| organization_not_found(id))
}

fn require_own_organization(user: &AuthUser, organization: &str) -> ApiResult<()> {
    if user.organization_id == organization {
        Ok(())
    } else {
        Err(ApiError::forbidden(crate::msg::NOT_ALLOWED))
    }
}

/// OrganizationService.assertUsedStorageNotExceeded with the announced upload
/// size: `used + requested <= included` (no limit when `included` is NULL).
async fn assert_used_storage_not_exceeded(
    pool: &sqlx::PgPool,
    organization: &str,
    included: Option<i64>,
    requested: Option<i64>,
) -> ApiResult<()> {
    let Some(included) = included else {
        return Ok(());
    };
    // OrganizationDAO.getUsedStorage.
    let used: i64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(usedStorageBytes), 0)::bigint FROM (
             SELECT usedStorageBytes FROM webknossos.organization_usedStorage_mags WHERE _organization = $1
             UNION ALL
             SELECT usedStorageBytes FROM webknossos.organization_usedStorage_attachments WHERE _organization = $1) combined"#,
    )
    .bind(organization)
    .fetch_one(pool)
    .await?;
    if i128::from(used) + i128::from(requested.unwrap_or(0)) <= i128::from(included) {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            crate::msg::dataset::upload::STORAGE_EXCEEDED,
        ))
    }
}

/// LayerToLinkService.validateLayerToLink: the linked dataset must be readable
/// by the user (else 404, status kept through `?~>`), and the user must be
/// admin/team manager or dataset manager of its organization, or the dataset
/// public (else 400). Both failures carry Msg.Dataset.Upload.invalidLinkedLayers.
async fn validate_layer_to_link(
    pool: &sqlx::PgPool,
    user: &AuthUser,
    link: &LinkedLayer,
) -> ApiResult<()> {
    let id = &link.dataset_id;
    let not_found = || ApiError::not_found(INVALID_LINKED_LAYERS);
    if !crate::dataset::access::can_read(pool, Some(user), id, None).await? {
        return Err(not_found());
    }
    let allowed: Option<bool> = sqlx::query_scalar(
        r#"SELECT d.isPublic OR (($3 OR $4) AND d._organization = $5) OR EXISTS (
             SELECT 1 FROM webknossos.user_team_roles r JOIN webknossos.teams_ t ON t._id = r._team
             WHERE r._user = $2 AND r.isTeamManager AND t._organization = d._organization)
           FROM webknossos.datasets_ d WHERE d._id = $1"#,
    )
    .bind(id)
    .bind(&user.id)
    .bind(user.is_dataset_manager)
    .bind(user.is_admin)
    .bind(&user.organization_id)
    .fetch_optional(pool)
    .await?;
    match allowed {
        None => Err(not_found()),
        Some(false) => Err(ApiError::bad_request(INVALID_LINKED_LAYERS)),
        Some(true) => Ok(()),
    }
}

// ---------------------------------------------------------------- reserve

/// DatasetUploadInfo (Play JsonAutoFormat; optional fields may be absent or
/// null). `needsConversion` and the voxel size are only used by the datastore.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[expect(
    dead_code,
    reason = "needsConversion and the voxel size are only used by the datastore"
)]
struct DatasetUploadInfo {
    resumable_upload_info: ResumableUploadInfo,
    dataset_name: String,
    organization_id: String,
    layers_to_link: Option<Vec<LinkedLayer>>,
    initial_team_ids: Vec<ObjectId>,
    folder_id: Option<ObjectId>,
    require_unique_name: Option<bool>,
    is_virtual: Option<bool>,
    needs_conversion: Option<bool>,
    voxel_size_factor: Option<[f64; 3]>,
    voxel_size_unit: Option<String>,
}

async fn reserve_dataset_upload(
    State(state): State<AppState>,
    Query(query): Query<TokenQuery>,
    ValidatedDataStore(store): ValidatedDataStore,
    Json(body): Json<DatasetUploadInfo>,
) -> ApiResult<ResponseJson<Value>> {
    let pool = &state.pool;
    let user = user_for_token_forbidden(pool, &query.token).await?;
    let organization = body.organization_id.as_str();
    let included = find_organization(pool, organization).await?;
    assert_used_storage_not_exceeded(
        pool,
        organization,
        included,
        body.resumable_upload_info.total_file_size_in_bytes,
    )
    .await?;
    require_own_organization(&user, organization)?;
    crate::dataset::create::validate_dataset_name(&body.dataset_name)?;
    if store
        .only_allowed_organization
        .as_deref()
        .is_some_and(|allowed| allowed != organization)
    {
        return Err(ApiError::bad_request(DATASTORE_RESTRICTED));
    }
    for link in body.layers_to_link.iter().flatten() {
        validate_layer_to_link(pool, &user, link).await?;
    }
    if body.require_unique_name.unwrap_or(false) {
        // DatasetService.checkNameAvailable(organization._id, datasetName).
        let taken: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE name = $1 AND _organization = $2)",
        )
        .bind(&body.dataset_name)
        .bind(organization)
        .fetch_one(pool)
        .await?;
        if taken {
            return Err(ApiError::bad_request(crate::msg::dataset::name::taken(
                &body.dataset_name,
            )));
        }
    }
    let mut transaction = pool.begin().await?;
    let (id, directory_name) = create_and_set_up_dataset(
        &mut transaction,
        &user,
        &store.name,
        &body.dataset_name,
        body.folder_id.as_ref(),
        body.is_virtual.unwrap_or(true),
    )
    .await?;
    add_initial_teams(&mut transaction, &user, &id, &body.initial_team_ids).await?;
    transaction.commit().await?;
    // DatasetUploadAdditionalInfo.
    Ok(ResponseJson(
        json!({"newDatasetId": id, "directoryName": directory_name}),
    ))
}

/// DatasetService.createAndSetUpDataset with the preliminary
/// `UnusableDataSource(status = notYetUploaded)` and creationType Upload.
/// Every failure is reported as Msg.Dataset.Upload.createFailed (`?~>` keeps
/// a status only for ParamFailures, which do not occur here); database errors
/// stay internal errors. createDataset's realpath scan and mirror write are
/// no-ops for unusable datasets.
async fn create_and_set_up_dataset(
    connection: &mut sqlx::PgConnection,
    user: &AuthUser,
    store: &str,
    name: &str,
    folder: Option<&ObjectId>,
    is_virtual: bool,
) -> ApiResult<(ObjectId, String)> {
    let failed = || ApiError::bad_request(CREATE_FAILED);
    crate::dataset::create::validate_dataset_name(name).map_err(|_| failed())?;
    let root: ObjectId = sqlx::query_scalar(
        "SELECT _rootFolder FROM webknossos.organizations_ WHERE _id = $1 FOR SHARE",
    )
    .bind(&user.organization_id)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(failed)?;
    let folder = folder.unwrap_or(&root);
    if !crate::dataset::create::folder_writable(connection, user, folder).await? {
        return Err(failed());
    }
    let id = ObjectId::new();
    // The voxel size stays unset (`voxel_size: None` below).
    let source = UsableDataSource {
        id: DataSourceId::new(
            crate::dataset::create::generate_directory_name(name, &id),
            &user.organization_id,
        ),
        data_layers: Vec::new(),
        scale: VoxelSize::from_factor_with_default_unit(Vec3Double::new(0.0, 0.0, 0.0)),
        default_view_configuration: None,
        status_opt: Some(NOT_YET_UPLOADED.to_owned()),
    };
    crate::dataset::create::insert_dataset(
        connection,
        NewDataset {
            id: &id,
            store_name: store,
            name,
            source: &source,
            is_usable: false,
            voxel_size: None,
            status: NOT_YET_UPLOADED,
            is_virtual,
            metadata: json!([]),
            description: None,
            creation_type: "Upload",
            import_url: None,
        },
    )
    .await
    .map_err(|error| {
        if error.status.is_server_error() {
            error
        } else {
            failed()
        }
    })?;
    // DatasetDAO.updateFolder + DatasetService.addUploader (fresh dataset).
    sqlx::query("UPDATE webknossos.datasets SET _folder = $2, _uploader = $3 WHERE _id = $1")
        .bind(&id)
        .bind(folder)
        .bind(&user.id)
        .execute(&mut *connection)
        .await?;
    Ok((id, source.id.directory_name))
}

// ---------------------------------------------------------------- unfinished list

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnfinishedQuery {
    token: String,
    // The route (and DSRemoteWebknossosClient) name it organizationName; the controller
    // argument it binds positionally is organizationId.
    #[serde(rename = "organizationName")]
    organization_id: String,
}

#[derive(sqlx::FromRow)]
struct UnfinishedRow {
    directory_name: String,
    organization: String,
    name: String,
    folder: ObjectId,
    created: i64,
    teams: Vec<ObjectId>,
}

async fn unfinished_uploads(
    State(state): State<AppState>,
    Query(query): Query<UnfinishedQuery>,
    ValidatedDataStore(_store): ValidatedDataStore,
) -> ApiResult<ResponseJson<Value>> {
    let pool = &state.pool;
    let user = user_for_token_forbidden(pool, &query.token).await?;
    find_organization(pool, &query.organization_id).await?;
    require_own_organization(&user, &query.organization_id)?;
    // DatasetService.getAllUnfinishedDatasetUploadsOfUser
    // (findAllCompactWithSearch under GlobalAccessContext) joined with
    // TeamDAO.findAllowedTeamIdsForDataset.
    let rows: Vec<UnfinishedRow> = sqlx::query_as(
        r#"SELECT d.directoryName AS directory_name, d._organization AS organization, d.name,
             d._folder AS folder, (EXTRACT(EPOCH FROM d.created) * 1000)::bigint AS created,
             ARRAY(SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset = d._id ORDER BY _team) AS teams
           FROM webknossos.datasets_ d
           WHERE d._uploader = $1 AND d._organization = $2 AND NOT d.isUsable AND d.status = $3
             AND d.created >= NOW() - INTERVAL '14 days'
           ORDER BY d.created, d._id"#,
    )
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(NOT_YET_UPLOADED)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        tracing::error!(%error, "Could not load unfinished uploads");
        ApiError::bad_request(COULD_NOT_LOAD_UNFINISHED)
    })?;
    let uploads: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "uploadId": UPLOAD_ID_PLACEHOLDER,
                "dataSourceId": {"name": row.directory_name, "team": row.organization},
                "datasetName": row.name,
                "folderId": row.folder,
                "created": row.created,
                "allowedTeams": row.teams,
            })
        })
        .collect();
    Ok(ResponseJson(Value::Array(uploads)))
}
