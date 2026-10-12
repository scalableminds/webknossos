//! AnnotationController.createExplorational
//! (`POST /datasets/:datasetId/createExplorational`, JSON body
//! `List[AnnotationLayerParameters]`) and the I/O half of
//! AnnotationService.createTracingForExplorational shared with the
//! tracing-store `createTracing` callback (`remote_tracingstore_create`).
//!
//! Order (Scala createExplorationalFor / createLayersForExplorational): the
//! tracing store, the usable data source, then per layer parameters serially
//! the tracing is built ([`create_tracing`]) and saved in the tracing store,
//! then the AnnotationProto is saved; only after all RPCs succeeded the
//! annotation row and its layers are inserted in one transaction. Any failure
//! before the insert renders `Msg.Annotation.createFailed` (chain:
//! `createTracingsFailed`, inner message) and keeps a ParamFailure status.
use axum::{
    Extension, Json, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, request::Parts},
    routing::post,
};
use chrono::{DateTime, Utc};
use serde_json::{Map, Value, json};
use sqlx::PgPool;

use crate::{
    AppState,
    annotation_duplicate::{NewAnnotation, insert_annotation},
    annotation_lists,
    annotation_metadata::PUBLIC_WRITES_FAILED,
    annotation_provider::{
        AnnotationLayer, AnnotationLayerType, AnnotationProvider, DATA_SOURCE_NOT_FOUND,
        FoxFailure, ProviderError, USABLE_BUT_NO_VOXEL_SIZE, dataset_not_usable,
    },
    annotation_sandbox::dataset_not_found,
    application_info::MiscState,
    auth::AuthUser,
    dataset_access,
    dataset_source::{self, DataSource},
    error::{ApiError, ApiResult},
    extract::{self, Path},
    id::ObjectId,
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    service_clients::{ServiceClients, ServiceError},
    tracing_initialization::{
        AnnotationLayerParameters, CREATE_TRACINGS_FAILED, DATA_STORE_NOT_FOUND_FOR_DATASET,
        ExplorationalDataset, FetchedPrecedenceTracing, InitialTracing, PrecedenceFetchRequest,
        RedundantTracingProperties, TracingInitError, adapt_skeleton_tracing, adapt_volume_tracing,
        build_skeleton_tracing, layer_name, plan_volume_tracing,
    },
    tracingstore_client::{
        self, TRACING_STORE_NOT_FOUND, TracingStoreClient, TracingStoreError, VolumeSaveDataSource,
    },
};

/// Msg.Annotation.createFailed.
pub const CREATE_FAILED: &str = "Could not create annotation.";

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route(
            "/datasets/{datasetId}/createExplorational",
            post(create_explorational),
        )
        .layer(Extension(JobsEnabled(jobs_enabled)))
}

// ---------------------------------------------------------------------------
// Fox failures
// ---------------------------------------------------------------------------

fn failure(message: impl Into<String>, status: Option<StatusCode>) -> ProviderError {
    ProviderError::Failure(FoxFailure {
        message: message.into(),
        chain: Vec::new(),
        status,
    })
}

/// RPC failures are Fox failures; an unsuccessful upstream HTTP status is
/// kept as ParamFailure status (RPCRequest `~> result.status`).
fn service_failure(error: ServiceError) -> ProviderError {
    let status = match error {
        ServiceError::UpstreamStatus(code) => StatusCode::from_u16(code).ok(),
        _ => None,
    };
    failure(error.to_string(), status)
}

fn tracing_store_failure(error: TracingStoreError) -> ProviderError {
    match error {
        TracingStoreError::Service(error) => service_failure(error),
        other @ TracingStoreError::InvalidProtobuf => failure(other.to_string(), None),
    }
}

/// TI1 errors: a message is a plain Fox failure; a missing fallback layer is
/// Scala's message-less `Fox.empty`.
fn init_failure(error: TracingInitError) -> ProviderError {
    match error.message() {
        Some(message) => failure(message, None),
        None => ProviderError::Empty,
    }
}

// ---------------------------------------------------------------------------
// Shared createTracingForExplorational I/O
// ---------------------------------------------------------------------------

/// The dataset columns createTracingForExplorational reads (read globally;
/// callers have already checked access).
#[derive(Clone, Debug)]
pub(crate) struct DatasetFacts {
    pub id: ObjectId,
    pub name: String,
    pub organization_id: String,
    /// `dataset._dataStore.trim`.
    pub data_store: String,
    pub is_usable: bool,
    pub has_voxel_size: bool,
}

/// `datasets_` row by id under GlobalAccessContext; `None` when missing or deleted.
pub(crate) async fn find_dataset(pool: &PgPool, id: &ObjectId) -> ApiResult<Option<DatasetFacts>> {
    let row: Option<(String, String, String, bool, bool)> = sqlx::query_as(
        "SELECT name,_organization,trim(_dataStore),isUsable,voxelSizeFactor IS NOT NULL
         FROM webknossos.datasets_ WHERE _id=$1",
    )
    .bind(id.as_str())
    .fetch_optional(pool)
    .await?;
    Ok(row.map(
        |(name, organization_id, data_store, is_usable, has_voxel_size)| DatasetFacts {
            id: id.clone(),
            name,
            organization_id,
            data_store,
            is_usable,
            has_voxel_size,
        },
    ))
}

/// `datasetService.usableDataSourceFor(dataset)`: the parsed data source and
/// its rendered JSON (stored in the AnnotationDataSourceTemporaryStore by
/// saveVolumeTracing).
pub(crate) struct UsableSource {
    pub source: DataSource,
    pub rendered: Value,
}

/// usableDataSourceFor: a usable dataset without voxel size fails with
/// `usableButNoVoxelSize ?~> DataSource.notFound ~> 404`; an unusable one
/// with `Msg.Dataset.notUsable` (400).
pub(crate) async fn usable_data_source(
    pool: &PgPool,
    dataset: &DatasetFacts,
) -> Result<UsableSource, ProviderError> {
    if !dataset.is_usable {
        return Err(failure(dataset_not_usable(dataset.id.as_str()), None));
    }
    if !dataset.has_voxel_size {
        return Err(failure(USABLE_BUT_NO_VOXEL_SIZE, None)
            .wrap(DATA_SOURCE_NOT_FOUND)
            .with_status(StatusCode::NOT_FOUND));
    }
    let rendered = crate::datasets::data_source_for_rpc(pool, dataset.id.as_str(), true).await?;
    let source = dataset_source::parse_data_source(&rendered).map_err(|_| ApiError::internal())?;
    Ok(UsableSource { source, rendered })
}

/// `tracingStoreService.clientFor(dataset)`: first live tracing store
/// (`?~> Msg.TracingStore.notFound`).
pub(crate) async fn tracing_store_url(pool: &PgPool) -> Result<String, ProviderError> {
    tracingstore_client::find_first_tracing_store_url(pool)
        .await?
        .ok_or_else(|| failure(TRACING_STORE_NOT_FOUND, None))
}

/// `dataStoreDAO.findOneByName(dataset._dataStore.trim)` (internal URL),
/// `?~> Msg.DataStore.notFoundForDataset`.
pub(crate) async fn data_store_url(
    pool: &PgPool,
    dataset: &DatasetFacts,
) -> Result<String, ProviderError> {
    let url: Option<String> =
        sqlx::query_scalar("SELECT url FROM webknossos.dataStores_ WHERE name=$1")
            .bind(&dataset.data_store)
            .fetch_optional(pool)
            .await?;
    url.ok_or_else(|| failure(DATA_STORE_NOT_FOUND_FOR_DATASET, None))
}

trait WithStatus {
    fn with_status(self, status: StatusCode) -> Self;
}

impl WithStatus for ProviderError {
    /// Fox `~> status` on a failure (ParamFailure).
    fn with_status(self, status: StatusCode) -> Self {
        match self {
            Self::Failure(failure) => Self::Failure(FoxFailure {
                status: Some(status),
                ..failure
            }),
            other => other,
        }
    }
}

/// Everything createTracingForExplorational resolved before its
/// type-specific steps.
pub(crate) struct TracingContext<'a> {
    pub dataset: &'a DatasetFacts,
    pub source: &'a UsableSource,
    pub data_store_url: &'a str,
}

/// fetchOldPrecedenceLayer's RPC + extractPrecedenceProperties.
pub(crate) async fn fetch_precedence_properties(
    tracing_store: &TracingStoreClient,
    tracing_store_url: &str,
    request: &PrecedenceFetchRequest,
) -> Result<RedundantTracingProperties, ProviderError> {
    let fetched = match request.typ {
        AnnotationLayerType::Skeleton => FetchedPrecedenceTracing::Skeleton(
            tracing_store
                .get_skeleton_tracing(
                    tracing_store_url,
                    &request.tracing_id,
                    &request.annotation_id,
                    request.version,
                )
                .await
                .map_err(tracing_store_failure)?,
        ),
        AnnotationLayerType::Volume => FetchedPrecedenceTracing::Volume(
            tracing_store
                .get_volume_tracing(
                    tracing_store_url,
                    &request.tracing_id,
                    &request.annotation_id,
                    request.version,
                )
                .await
                .map_err(tracing_store_failure)?,
        ),
    };
    Ok(RedundantTracingProperties::extract(&fetched))
}

/// createTracingForExplorational after datastore/data source/tracing store
/// resolution and the old-precedence fetch: skeleton defaults, or the
/// volume plan + hasSegmentIndexFile RPC (only with a fallback layer), then
/// the precedence adaptation.
pub(crate) async fn create_tracing(
    clients: &ServiceClients,
    context: &TracingContext<'_>,
    params: &AnnotationLayerParameters,
    old_precedence: Option<&RedundantTracingProperties>,
) -> Result<InitialTracing, ProviderError> {
    let dataset = ExplorationalDataset {
        data_source: &context.source.source,
        dataset_name: &context.dataset.name,
        organization_id: &context.dataset.organization_id,
    };
    let created = Utc::now().timestamp_millis();
    match params.typ {
        AnnotationLayerType::Skeleton => Ok(InitialTracing::Skeleton(adapt_skeleton_tracing(
            build_skeleton_tracing(&dataset, created),
            old_precedence,
        ))),
        AnnotationLayerType::Volume => {
            let plan = plan_volume_tracing(&dataset, params).map_err(init_failure)?;
            let has_segment_index = match plan.segment_index_lookup() {
                Some(layer) => clients
                    .has_segment_index(context.data_store_url, &context.dataset.id, layer)
                    .await
                    .map_err(service_failure)?,
                None => false,
            };
            let tracing = plan
                .build(has_segment_index, created)
                .map_err(init_failure)?;
            Ok(InitialTracing::Volume(adapt_volume_tracing(
                tracing,
                old_precedence,
            )))
        }
    }
}

// ---------------------------------------------------------------------------
// createExplorational
// ---------------------------------------------------------------------------

struct Services {
    provider: AnnotationProvider,
    clients: ServiceClients,
    tracing_store: TracingStoreClient,
    misc: MiscState,
    jobs_enabled: bool,
}

fn extension<T: Clone + Send + Sync + 'static>(parts: &Parts) -> ApiResult<T> {
    parts
        .extensions
        .get::<T>()
        .cloned()
        .ok_or_else(ApiError::internal)
}

impl<S: Send + Sync> FromRequestParts<S> for Services {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        Ok(Self {
            provider: extension(parts)?,
            clients: extension(parts)?,
            tracing_store: extension(parts)?,
            misc: extension(parts)?,
            jobs_enabled: extension::<JobsEnabled>(parts)?.0,
        })
    }
}

/// AnnotationLayerStatistics.zeroedForType.
fn zeroed_statistics(typ: AnnotationLayerType) -> Value {
    match typ {
        AnnotationLayerType::Skeleton => json!({
            "treeCount": 0,
            "nodeCount": 0,
            "edgeCount": 0,
            "branchPointCount": 0,
            "boundingBoxCount": 0,
        }),
        AnnotationLayerType::Volume => json!({"segmentCount": 0, "boundingBoxCount": 0}),
    }
}

fn layer_type_proto(typ: AnnotationLayerType) -> AnnotationLayerTypeProto {
    match typ {
        AnnotationLayerType::Skeleton => AnnotationLayerTypeProto::Skeleton,
        AnnotationLayerType::Volume => AnnotationLayerTypeProto::Volume,
    }
}

/// createLayersForExplorational: every tracing-store write, no database writes.
async fn create_layers(
    pool: &PgPool,
    services: &Services,
    dataset: &DatasetFacts,
    annotation_id: &ObjectId,
    all_params: &[AnnotationLayerParameters],
) -> Result<Vec<AnnotationLayer>, ProviderError> {
    let tracing_store_url = tracing_store_url(pool).await?;
    let source = usable_data_source(pool, dataset).await?;
    let mut layers = Vec::with_capacity(all_params.len());
    for params in all_params {
        // createTracingForExplorational(existingAnnotationId = None,
        // existingAnnotationLayers = Nil, previousVersion = None): the
        // datastore is resolved per call; without existing layers there is
        // no precedence fetch.
        let data_store_url = data_store_url(pool, dataset).await?;
        let context = TracingContext {
            dataset,
            source: &source,
            data_store_url: &data_store_url,
        };
        let tracing = create_tracing(&services.clients, &context, params, None).await?;
        let name = layer_name(params, &tracing);
        // TracingId.generate.
        let tracing_id = uuid::Uuid::new_v4().to_string();
        match &tracing {
            InitialTracing::Skeleton(skeleton) => services
                .tracing_store
                .save_skeleton_tracing(&tracing_store_url, skeleton, &tracing_id)
                .await
                .map_err(service_failure)?,
            InitialTracing::Volume(volume) => services
                .tracing_store
                .save_volume_tracing(
                    &tracing_store_url,
                    annotation_id,
                    &tracing_id,
                    volume,
                    VolumeSaveDataSource {
                        store: services.provider.data_sources(),
                        data_source: &source.rendered,
                        dataset_id: &dataset.id,
                    },
                )
                .await
                .map_err(service_failure)?,
        }
        layers.push(AnnotationLayer {
            tracing_id,
            typ: params.typ,
            name,
        });
    }
    let proto = AnnotationProto {
        description: String::new(),
        version: 0,
        annotation_layers: layers
            .iter()
            .map(|layer| AnnotationLayerProto {
                tracing_id: layer.tracing_id.clone(),
                name: layer.name.clone(),
                typ: layer_type_proto(layer.typ) as i32,
            })
            .collect(),
        earliest_accessible_version: 0,
        ..Default::default()
    };
    services
        .tracing_store
        .save_annotation_proto(&tracing_store_url, annotation_id, &proto)
        .await
        .map_err(service_failure)?;
    Ok(layers)
}

/// Instant.now (millisecond precision).
fn now_millis() -> DateTime<Utc> {
    DateTime::from_timestamp_millis(Utc::now().timestamp_millis()).unwrap_or_else(Utc::now)
}

/// POST /datasets/:datasetId/createExplorational
async fn create_explorational(
    State(state): State<AppState>,
    services: Services,
    Path(dataset_id): Path<String>,
    user: AuthUser,
    extract::Json(params): extract::Json<Vec<AnnotationLayerParameters>>,
) -> ApiResult<Json<Value>> {
    let dataset_id = ObjectId::parse_path(&dataset_id)?;
    // datasetDAO.findOne(datasetId) under the user's access context.
    let readable =
        dataset_access::can_read(&state.pool, Some(&user), dataset_id.as_str(), None).await?;
    let dataset = if readable {
        find_dataset(&state.pool, &dataset_id).await?
    } else {
        None
    }
    .ok_or_else(|| ApiError::not_found(dataset_not_found(dataset_id.as_str())))?;

    // createExplorationalFor ?~> createFailed; createLayersForExplorational
    // ?~> createTracingsFailed. Database faults stay 5xx.
    let annotation_id = ObjectId::new();
    let layers = create_layers(&state.pool, &services, &dataset, &annotation_id, &params)
        .await
        .map_err(|error| ApiError::from(error.wrap(CREATE_TRACINGS_FAILED).wrap(CREATE_FAILED)))?;

    // AnnotationDAO.insertOne (row + layers with zeroed statistics), then
    // publicWrites before commit so a serializer failure leaves no row.
    let mut transaction = state.pool.begin().await?;
    insert_annotation(
        &mut transaction,
        &NewAnnotation {
            id: &annotation_id,
            dataset_id: dataset.id.as_str(),
            task_id: None,
            owner_id: &user.id,
            description: "",
            name: "",
            annotation_type: "Explorational",
            visibility: "Internal",
            collaboration_mode: "OwnerOnly",
            created: now_millis(),
        },
        &layers,
    )
    .await?;
    for layer in &layers {
        sqlx::query(
            "UPDATE webknossos.annotation_layers SET statistics=$3 WHERE _annotation=$1 AND tracingId=$2",
        )
        .bind(annotation_id.as_str())
        .bind(&layer.tracing_id)
        .bind(zeroed_statistics(layer.typ))
        .execute(&mut *transaction)
        .await?;
    }
    let json = annotation_lists::full_json(
        &mut transaction,
        &user,
        annotation_id.as_str(),
        services.jobs_enabled,
    )
    .await
    .map_err(|error| {
        if error.status.is_server_error() {
            error
        } else {
            ApiError::bad_request(PUBLIC_WRITES_FAILED)
        }
    })?;
    transaction.commit().await?;

    // analyticsService.track(CreateAnnotationEvent(user, annotation)).
    let mut properties = Map::new();
    properties.insert("annotation_id".into(), annotation_id.as_str().into());
    properties.insert("annotation_dataset_id".into(), dataset.id.as_str().into());
    crate::analytics::track(
        &state,
        &services.misc,
        &user,
        "create_annotation".into(),
        properties,
    );
    // mailchimpClient.tagUser(user, HasAnnotated): the crate has no Mailchimp
    // client; logged only.
    tracing::debug!(user = %user.id, "Mailchimp tag HasAnnotated skipped (no client)");
    Ok(Json(json))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zeroed_statistics_match_scala() {
        assert_eq!(
            zeroed_statistics(AnnotationLayerType::Skeleton),
            json!({"treeCount":0,"nodeCount":0,"edgeCount":0,"branchPointCount":0,"boundingBoxCount":0})
        );
        assert_eq!(
            zeroed_statistics(AnnotationLayerType::Volume),
            json!({"segmentCount":0,"boundingBoxCount":0})
        );
    }

    #[test]
    fn empty_fallback_failure_wraps_to_create_failed() {
        let error = init_failure(TracingInitError::FallbackLayerNotFound("x".into()))
            .wrap(CREATE_TRACINGS_FAILED)
            .wrap(CREATE_FAILED);
        assert_eq!(error.chain(), [CREATE_TRACINGS_FAILED]);
        let api = ApiError::from(error);
        assert_eq!(api.status, StatusCode::BAD_REQUEST);
        assert_eq!(api.message, CREATE_FAILED);
    }

    #[test]
    fn upstream_status_is_kept_through_wrapping() {
        let error = service_failure(ServiceError::UpstreamStatus(503))
            .wrap(CREATE_TRACINGS_FAILED)
            .wrap(CREATE_FAILED);
        let api = ApiError::from(error);
        assert_eq!(api.status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(api.message, CREATE_FAILED);
    }
}
