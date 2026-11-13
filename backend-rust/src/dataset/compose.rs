//! POST /datasets/compose and /datasets/{id}/compose/add{Layer,Mag,Attachment} (ComposeService).
use axum::{Json, Router, extract::State, routing::post};
use serde::Deserialize;
use serde_json::Value;
use webknossos_common::{
    datasource::DataSourceId, enums::LayerAttachmentType,
    explore_layers::adapt_layers_and_voxel_size, geometry::Vec3Int,
};

use crate::{
    AppState,
    auth::AuthUser,
    dataset::create::CreatedDataset,
    dataset::lifecycle::DatasetRecord,
    dataset::source::{CoordinateTransformation, UsableDataSource, VoxelSize},
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path},
    stores::client::ServiceClients,
    util::id::{ObjectId, PathObjectId},
};

const COMPOSE_FAILED: &str = "Could not compose dataset.";
const ADD_LAYER_FAILED: &str = "Could not add layer to composed dataset.";
const ADD_MAG_FAILED: &str = "Could not add mag to composed dataset.";
const ADD_ATTACHMENT_FAILED: &str = "Could not add attachment to composed dataset.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/datasets/compose", post(compose))
        .route("/datasets/{datasetId}/compose/addLayer", post(add_layer))
        .route("/datasets/{datasetId}/compose/addMag", post(add_mag))
        .route(
            "/datasets/{datasetId}/compose/addAttachment",
            post(add_attachment),
        )
}

/// usableDataSourceFor on a dataset the user can read.
async fn readable_source(
    state: &AppState,
    user: &AuthUser,
    id: &ObjectId,
) -> Result<(DatasetRecord, UsableDataSource), ()> {
    let record = crate::dataset::lifecycle::require_readable(state, user, id)
        .await
        .map_err(|_| ())?;
    if !record.is_usable {
        return Err(());
    }
    let source = crate::dataset::source::load(&state.pool, id)
        .await
        .map_err(|_| ())?;
    Ok((record, source))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComposeLayer {
    source_dataset_id: ObjectId,
    source_layer_name: String,
    target_layer_name: String,
    transformations: Option<Vec<Value>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComposeRequest {
    new_dataset_name: String,
    target_folder_id: ObjectId,
    organization_id: String,
    voxel_size: Value,
    layers: Vec<ComposeLayer>,
}

fn transforms(values: &Option<Vec<Value>>) -> ApiResult<Option<Vec<CoordinateTransformation>>> {
    values
        .as_ref()
        .map(|list| {
            list.iter()
                .map(CoordinateTransformation::from_json)
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()
        .map_err(crate::dataset::source::invalid_body)
}

async fn compose(
    State(state): State<AppState>,
    user: AuthUser,
    State(clients): State<ServiceClients>,
    RequestJson(body): RequestJson<ComposeRequest>,
) -> ApiResult<Json<CreatedDataset>> {
    let requested_size =
        VoxelSize::from_json(&body.voxel_size).map_err(crate::dataset::source::invalid_body)?;
    let mut extra_transforms = Vec::new();
    for layer in &body.layers {
        extra_transforms.push(transforms(&layer.transformations)?);
    }
    let failed = || ApiError::bad_request(COMPOSE_FAILED);
    if body.layers.is_empty() {
        return Err(failed());
    }
    let mut stores = Vec::new();
    for layer in &body.layers {
        let record =
            crate::dataset::lifecycle::require_readable(&state, &user, &layer.source_dataset_id)
                .await
                .map_err(|_| failed())?;
        let store = record.store_name.unwrap_or_default();
        if !stores.contains(&store) {
            stores.push(store);
        }
    }
    if stores.len() != 1 {
        return Err(failed());
    }
    let mut layers = Vec::new();
    for (request, extra) in body.layers.iter().zip(extra_transforms) {
        let (_, source) = readable_source(&state, &user, &request.source_dataset_id)
            .await
            .map_err(|_| failed())?;
        let mut layer = source
            .data_layers
            .into_iter()
            .find(|l| l.name == request.source_layer_name)
            .ok_or_else(failed)?;
        layer.name = request.target_layer_name.clone();
        let mut combined = layer.coordinate_transformations.take().unwrap_or_default();
        combined.extend(extra.unwrap_or_default());
        layer.coordinate_transformations = (!combined.is_empty()).then_some(combined);
        layers.push((layer, source.scale));
    }
    let mut distinct_sizes: Vec<&VoxelSize> = Vec::new();
    for (_, size) in &layers {
        if !distinct_sizes.contains(&size) {
            distinct_sizes.push(size);
        }
    }
    let (layers, size) =
        if body.layers.iter().all(|l| l.transformations.is_none()) && distinct_sizes.len() > 1 {
            adapt_layers_and_voxel_size(layers, None).map_err(|_| failed())?
        } else {
            (layers.into_iter().map(|(l, _)| l).collect(), requested_size)
        };
    let source = UsableDataSource {
        id: DataSourceId::new(&body.new_dataset_name, &body.organization_id),
        data_layers: layers,
        scale: size,
        default_view_configuration: None,
        status_opt: None,
    };
    let mut transaction = state.pool.begin().await?;
    let store = crate::dataset::dataset_dao::find_upload_store_name(
        &mut transaction,
        &user.organization_id,
    )
    .await?;
    let store = store.ok_or_else(failed)?;
    let id = crate::dataset::create::set_up_dataset(
        &mut transaction,
        &user,
        crate::dataset::create::SetUp {
            name: &body.new_dataset_name,
            store_name: &store,
            source: &source,
            folder: Some(&body.target_folder_id),
            creation_type: "Compose",
            import_url: None,
        },
    )
    .await
    .map_err(|error| {
        if error.status.is_server_error() || error.status.as_u16() == 409 {
            error
        } else {
            failed()
        }
    })?;
    transaction.commit().await?;
    crate::dataset::create::after_create(&state.pool, &clients, &id).await?;
    Ok(Json(CreatedDataset { new_dataset_id: id }))
}

/// Shared start of the in-place compose routes: the target must be readable
/// and editable (DatasetService.assertEditableBy, 403 kept through the route's
/// `?~> failure`) and a usable virtual dataset.
async fn target_and_source(
    state: &AppState,
    user: &AuthUser,
    target_id: &ObjectId,
    source_id: &ObjectId,
    failure: &'static str,
) -> ApiResult<(DatasetRecord, UsableDataSource, UsableDataSource)> {
    let failed = || ApiError::bad_request(failure);
    let target = crate::dataset::lifecycle::require_readable(state, user, target_id)
        .await
        .map_err(|_| failed())?;
    if !crate::dataset::access::can_edit(&state.pool, user, target_id).await? {
        return Err(ApiError::forbidden(failure));
    }
    if !target.is_virtual || !target.is_usable {
        return Err(failed());
    }
    let target_source = crate::dataset::source::load(&state.pool, target_id).await?;
    let (source, source_data) = readable_source(state, user, source_id)
        .await
        .map_err(|_| failed())?;
    if source.store_name != target.store_name {
        return Err(failed());
    }
    Ok((target, target_source, source_data))
}

/// DatasetDAO.updateDataSource(isUsable = true) and datastore invalidation.
async fn save(
    state: &AppState,
    user: &AuthUser,
    clients: &ServiceClients,
    target: &DatasetRecord,
    source: &UsableDataSource,
) -> ApiResult<()> {
    let mut transaction = state.pool.begin().await?;
    crate::dataset::access::lock_edit(&mut transaction, user, &target.id, true).await?;
    crate::dataset::dataset_dao::update_voxel_size_usable(&mut transaction, &target.id, source)
        .await?;
    crate::dataset::source::write_layers(&mut transaction, &target.id, &source.data_layers).await?;
    transaction.commit().await?;
    crate::dataset::lifecycle::invalidate_cache(clients, target).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddLayerRequest {
    source_dataset_id: ObjectId,
    source_layer_name: String,
    target_layer_name: String,
    transformations: Option<Vec<Value>>,
}

async fn add_layer(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    State(clients): State<ServiceClients>,
    RequestJson(body): RequestJson<AddLayerRequest>,
) -> ApiResult<()> {
    transforms(&body.transformations)?;
    let failed = || ApiError::bad_request(ADD_LAYER_FAILED);
    let (target, mut target_source, source) = target_and_source(
        &state,
        &user,
        &id,
        &body.source_dataset_id,
        ADD_LAYER_FAILED,
    )
    .await?;
    if target_source
        .data_layers
        .iter()
        .any(|l| l.name == body.target_layer_name)
    {
        return Err(failed());
    }
    let mut layer = source
        .data_layers
        .into_iter()
        .find(|l| l.name == body.source_layer_name)
        .ok_or_else(failed)?;
    layer.name = body.target_layer_name.clone();
    target_source.data_layers.push(layer);
    save(&state, &user, &clients, &target, &target_source).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddMagRequest {
    source_dataset_id: ObjectId,
    source_layer_name: String,
    target_layer_name: String,
    source_mag: Value,
    target_mag: Option<Value>,
}

async fn add_mag(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    State(clients): State<ServiceClients>,
    RequestJson(body): RequestJson<AddMagRequest>,
) -> ApiResult<()> {
    let source_mag =
        Vec3Int::from_json(&body.source_mag).map_err(crate::dataset::source::invalid_body)?;
    let target_mag = body
        .target_mag
        .as_ref()
        .filter(|v| !v.is_null())
        .map(Vec3Int::from_json)
        .transpose()
        .map_err(crate::dataset::source::invalid_body)?;
    let failed = || ApiError::bad_request(ADD_MAG_FAILED);
    let (target, mut target_source, source) =
        target_and_source(&state, &user, &id, &body.source_dataset_id, ADD_MAG_FAILED).await?;
    if !target_source
        .data_layers
        .iter()
        .any(|l| l.name == body.target_layer_name)
    {
        return Err(failed());
    }
    let mut mag = source
        .data_layers
        .iter()
        .find(|l| l.name == body.source_layer_name)
        .ok_or_else(failed)?
        .mags
        .iter()
        .find(|m| m.mag == source_mag)
        .cloned()
        .ok_or_else(failed)?;
    mag.mag = target_mag.unwrap_or(source_mag);
    let layer = target_source
        .data_layers
        .iter_mut()
        .find(|l| l.name == body.target_layer_name)
        .ok_or_else(failed)?;
    layer.mags.push(mag);
    layer.mags.sort_by_key(|m| m.mag.max_dim());
    let mut max_dims = std::collections::HashSet::new();
    if !layer.mags.iter().all(|m| max_dims.insert(m.mag.max_dim())) {
        return Err(failed());
    }
    save(&state, &user, &clients, &target, &target_source).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddAttachmentRequest {
    source_dataset_id: ObjectId,
    source_layer_name: String,
    target_layer_name: String,
    attachment_type: LayerAttachmentType,
    source_attachment_name: String,
    target_attachment_name: Option<String>,
}

async fn add_attachment(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    State(clients): State<ServiceClients>,
    RequestJson(body): RequestJson<AddAttachmentRequest>,
) -> ApiResult<()> {
    let failed = || ApiError::bad_request(ADD_ATTACHMENT_FAILED);
    let (target, mut target_source, source) = target_and_source(
        &state,
        &user,
        &id,
        &body.source_dataset_id,
        ADD_ATTACHMENT_FAILED,
    )
    .await?;
    let typ = body.attachment_type;
    if !target_source
        .data_layers
        .iter()
        .any(|l| l.name == body.target_layer_name)
    {
        return Err(failed());
    }
    let mut attachment = source
        .data_layers
        .iter()
        .find(|l| l.name == body.source_layer_name)
        .ok_or_else(failed)?
        .attachments
        .as_ref()
        .and_then(|attachments| attachments.get_by_type_and_name(typ, &body.source_attachment_name))
        .cloned()
        .ok_or_else(failed)?;
    if let Some(name) = &body.target_attachment_name {
        attachment.name = name.clone();
    }
    let layer = target_source
        .data_layers
        .iter_mut()
        .find(|l| l.name == body.target_layer_name)
        .ok_or_else(failed)?;
    let attachments = layer
        .attachments
        .take()
        .unwrap_or_default()
        .with_added(attachment, typ);
    if attachments.contains_duplicate_names() {
        return Err(failed());
    }
    layer.attachments = Some(attachments);
    save(&state, &user, &clients, &target, &target_source).await
}
