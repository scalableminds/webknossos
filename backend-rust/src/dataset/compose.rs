//! POST /datasets/compose and /datasets/{id}/compose/add{Layer,Mag,Attachment} (ComposeService).
use axum::{Extension, Json, Router, extract::State, routing::post};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState,
    auth::AuthUser,
    dataset::lifecycle::{AttachmentType, DatasetRecord},
    dataset::source::{DataSource, Layer, Transform},
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

#[derive(Clone, Debug, PartialEq)]
struct VoxelSize {
    factor: [f64; 3],
    unit: String,
}

impl VoxelSize {
    fn nanometers(&self) -> [f64; 3] {
        let scale = crate::dataset::source::nanometers_per_unit(&self.unit);
        self.factor.map(|f| f * scale)
    }
    /// VoxelSize./ (same unit: factors, otherwise nanometers).
    fn divide(&self, other: &VoxelSize) -> [f64; 3] {
        let (a, b) = if self.unit == other.unit {
            (self.factor, other.factor)
        } else {
            (self.nanometers(), other.nanometers())
        };
        std::array::from_fn(|i| a[i] / b[i])
    }
}

fn is_power_of_two(x: i32) -> bool {
    x != 0 && (x & x.wrapping_sub(1)) == 0
}

/// Java Math.round(double).toInt.
fn round(x: f64) -> i32 {
    let rounded = (x + 0.5).floor();
    (if rounded.is_nan() { 0 } else { rounded as i64 }) as i32
}

/// ExploreLayerUtils.adaptLayersAndVoxelSize without a preferred voxel size:
/// rescale all layers to the finest common voxel size (powers of two only)
/// and make layer names unique.
fn adapt_layers_and_voxel_size(
    layers: Vec<(Layer, VoxelSize)>,
) -> Result<(Vec<Layer>, VoxelSize), String> {
    let mut voxel_sizes: Vec<VoxelSize> = Vec::new();
    for (layer, size) in &layers {
        for mag in &layer.mags {
            let scaled = VoxelSize {
                factor: std::array::from_fn(|i| size.factor[i] * f64::from(mag.mag[i])),
                unit: size.unit.clone(),
            };
            if !voxel_sizes.contains(&scaled) {
                voxel_sizes.push(scaled);
            }
        }
    }
    let base = voxel_sizes
        .iter()
        .min_by(|a, b| {
            let (a, b) = (a.nanometers(), b.nanometers());
            a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned()
        .ok_or("Could not extract common voxel size from layers")?;
    let mut mags = Vec::new();
    for size in &voxel_sizes {
        let mag = size.divide(&base).map(round);
        if !mag.iter().all(|m| is_power_of_two(*m)) {
            return Err("voxel sizes for layers are not uniform".into());
        }
        mags.push(mag);
    }
    let mut max_dims: Vec<i32> = mags.iter().map(|m| m[0].max(m[1]).max(m[2])).collect();
    let count = max_dims.len();
    max_dims.sort_unstable();
    max_dims.dedup();
    if max_dims.len() != count {
        return Err("detected mags are not unique".into());
    }
    let mut result: Vec<Layer> = Vec::new();
    let mut names = std::collections::HashSet::new();
    for (mut layer, size) in layers {
        let factors = size.divide(&base).map(|f| f as i32);
        for (i, factor) in factors.iter().enumerate() {
            layer.bounding_box[i] = layer.bounding_box[i].wrapping_mul(*factor);
            layer.bounding_box[i + 3] = layer.bounding_box[i + 3].wrapping_mul(*factor);
        }
        for mag in &mut layer.mags {
            mag.mag = std::array::from_fn(|i| mag.mag[i].wrapping_mul(factors[i]));
        }
        let mut candidate = layer.name.clone();
        let mut index = 1;
        while names.contains(&candidate) {
            index += 1;
            candidate = format!("{}_{index}", layer.name);
        }
        names.insert(candidate.clone());
        layer.name = candidate;
        result.push(layer);
    }
    Ok((result, base))
}

/// usableDataSourceFor on a dataset the user can read.
async fn readable_source(
    state: &AppState,
    user: &AuthUser,
    id: &ObjectId,
) -> Result<(DatasetRecord, DataSource), ()> {
    let record = crate::dataset::lifecycle::require_readable(state, user, id)
        .await
        .map_err(|_| ())?;
    if !record.is_usable {
        return Err(());
    }
    let source = crate::dataset::source::load(&state.pool, id.as_str())
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
#[allow(dead_code)]
struct ComposeRequest {
    new_dataset_name: String,
    target_folder_id: ObjectId,
    organization_id: String,
    voxel_size: Value,
    layers: Vec<ComposeLayer>,
}

fn transforms(values: &Option<Vec<Value>>) -> ApiResult<Option<Vec<Transform>>> {
    values
        .as_ref()
        .map(|list| {
            list.iter()
                .map(crate::dataset::source::transform)
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()
        .map_err(crate::dataset::source::invalid_body)
}

async fn compose(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(clients): Extension<ServiceClients>,
    RequestJson(body): RequestJson<ComposeRequest>,
) -> ApiResult<Json<Value>> {
    let (factor, unit) = crate::dataset::source::voxel_size(&body.voxel_size)
        .map_err(crate::dataset::source::invalid_body)?;
    let requested_size = VoxelSize { factor, unit };
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
            .layers
            .into_iter()
            .find(|l| l.name == request.source_layer_name)
            .ok_or_else(failed)?;
        layer.name = request.target_layer_name.clone();
        let mut combined = layer.coordinate_transformations.take().unwrap_or_default();
        combined.extend(extra.unwrap_or_default());
        layer.coordinate_transformations = (!combined.is_empty()).then_some(combined);
        layers.push((
            layer,
            VoxelSize {
                factor: source.factor,
                unit: source.unit,
            },
        ));
    }
    let mut distinct_sizes: Vec<&VoxelSize> = Vec::new();
    for (_, size) in &layers {
        if !distinct_sizes.contains(&size) {
            distinct_sizes.push(size);
        }
    }
    let (layers, size) =
        if body.layers.iter().all(|l| l.transformations.is_none()) && distinct_sizes.len() > 1 {
            adapt_layers_and_voxel_size(layers).map_err(|_| failed())?
        } else {
            (layers.into_iter().map(|(l, _)| l).collect(), requested_size)
        };
    let source = DataSource {
        directory_name: body.new_dataset_name.clone(),
        organization: body.organization_id.clone(),
        layers,
        factor: size.factor,
        unit: size.unit,
        default_view_configuration: None,
        status_opt: None,
    };
    let mut transaction = state.pool.begin().await?;
    let store: Option<String> = sqlx::query_scalar(
        "SELECT name FROM webknossos.dataStores_ WHERE allowsUpload AND (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization = $1) ORDER BY name LIMIT 1",
    )
    .bind(&user.organization_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let store = store.ok_or_else(failed)?;
    let id = crate::dataset::create::set_up_dataset(
        &mut transaction,
        &user,
        crate::dataset::create::SetUp {
            name: &body.new_dataset_name,
            store_name: &store,
            source: &source,
            folder: Some(body.target_folder_id.as_str()),
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
    Ok(Json(json!({ "newDatasetId": id })))
}

/// Shared start of the in-place compose routes: the target must be a usable
/// virtual dataset. Scala only requires read access here; editing a dataset
/// in place additionally requires edit access in this port.
async fn target_and_source(
    state: &AppState,
    user: &AuthUser,
    target_id: &ObjectId,
    source_id: &ObjectId,
    failure: &'static str,
) -> ApiResult<(DatasetRecord, DataSource, DataSource)> {
    let failed = || ApiError::bad_request(failure);
    let target = crate::dataset::lifecycle::require_readable(state, user, target_id)
        .await
        .map_err(|_| failed())?;
    if !crate::dataset::access::can_edit(&state.pool, user, target_id.as_str()).await? {
        return Err(crate::dataset::lifecycle::not_allowed());
    }
    if !target.is_virtual || !target.is_usable {
        return Err(failed());
    }
    let target_source = crate::dataset::source::load(&state.pool, target_id.as_str()).await?;
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
    source: &DataSource,
) -> ApiResult<()> {
    let mut transaction = state.pool.begin().await?;
    crate::dataset::access::lock_edit(&mut transaction, user, &target.id, true).await?;
    sqlx::query(
        r#"UPDATE webknossos.datasets SET inboxSourceHash = NULL, isUsable = true, status = '',
             voxelSizeFactor = ROW($2, $3, $4)::webknossos.VECTOR3, voxelSizeUnit = $5::webknossos.LENGTH_UNIT
           WHERE _id = $1"#,
    )
    .bind(&target.id)
    .bind(source.factor[0])
    .bind(source.factor[1])
    .bind(source.factor[2])
    .bind(&source.unit)
    .execute(&mut *transaction)
    .await?;
    crate::dataset::source::write_layers(&mut transaction, &target.id, &source.layers).await?;
    transaction.commit().await?;
    crate::dataset::lifecycle::invalidate_cache(clients, target).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddLayerRequest {
    source_dataset_id: ObjectId,
    source_layer_name: String,
    target_layer_name: String,
    #[allow(dead_code)]
    transformations: Option<Vec<Value>>,
}

async fn add_layer(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(clients): Extension<ServiceClients>,
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
        .layers
        .iter()
        .any(|l| l.name == body.target_layer_name)
    {
        return Err(failed());
    }
    let mut layer = source
        .layers
        .into_iter()
        .find(|l| l.name == body.source_layer_name)
        .ok_or_else(failed)?;
    layer.name = body.target_layer_name.clone();
    target_source.layers.push(layer);
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
    Extension(clients): Extension<ServiceClients>,
    RequestJson(body): RequestJson<AddMagRequest>,
) -> ApiResult<()> {
    let source_mag = crate::dataset::source::vec3_int(&body.source_mag)
        .map_err(crate::dataset::source::invalid_body)?;
    let target_mag = body
        .target_mag
        .as_ref()
        .filter(|v| !v.is_null())
        .map(crate::dataset::source::vec3_int)
        .transpose()
        .map_err(crate::dataset::source::invalid_body)?;
    let failed = || ApiError::bad_request(ADD_MAG_FAILED);
    let (target, mut target_source, source) =
        target_and_source(&state, &user, &id, &body.source_dataset_id, ADD_MAG_FAILED).await?;
    if !target_source
        .layers
        .iter()
        .any(|l| l.name == body.target_layer_name)
    {
        return Err(failed());
    }
    let mut mag = source
        .layers
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
        .layers
        .iter_mut()
        .find(|l| l.name == body.target_layer_name)
        .ok_or_else(failed)?;
    layer.mags.push(mag);
    layer
        .mags
        .sort_by_key(|m| m.mag[0].max(m.mag[1]).max(m.mag[2]));
    let mut max_dims = std::collections::HashSet::new();
    if !layer
        .mags
        .iter()
        .all(|m| max_dims.insert(m.mag[0].max(m.mag[1]).max(m.mag[2])))
    {
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
    attachment_type: AttachmentType,
    source_attachment_name: String,
    target_attachment_name: Option<String>,
}

async fn add_attachment(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(clients): Extension<ServiceClients>,
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
    let typ = body.attachment_type.as_str();
    if !target_source
        .layers
        .iter()
        .any(|l| l.name == body.target_layer_name)
    {
        return Err(failed());
    }
    let mut attachment = source
        .layers
        .iter()
        .find(|l| l.name == body.source_layer_name)
        .ok_or_else(failed)?
        .attachments
        .as_ref()
        .and_then(|attachments| {
            attachments
                .typed()
                .into_iter()
                .find(|(t, a)| *t == typ && a.name == body.source_attachment_name)
                .map(|(_, a)| a.clone())
        })
        .ok_or_else(failed)?;
    if let Some(name) = &body.target_attachment_name {
        attachment.name = name.clone();
    }
    let layer = target_source
        .layers
        .iter_mut()
        .find(|l| l.name == body.target_layer_name)
        .ok_or_else(failed)?;
    let mut attachments = layer.attachments.take().unwrap_or_default();
    attachments.add(typ, attachment);
    if attachments.contains_duplicate_names() {
        return Err(failed());
    }
    layer.attachments = Some(attachments);
    save(&state, &user, &clients, &target, &target_source).await
}

#[cfg(test)]
mod tests;
