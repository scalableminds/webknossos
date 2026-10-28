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
mod annotation_create_dao;

use axum::extract::FromRef;
use axum::{
    Json, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, request::Parts},
    routing::post,
};
use chrono::Utc;
use serde_json::{Map, Value, json};
use sqlx::PgPool;

use crate::{
    AppState,
    annotation::duplicate::{NewAnnotation, insert_annotation},
    annotation::metadata::PUBLIC_WRITES_FAILED,
    annotation::provider::{
        AnnotationLayer, AnnotationLayerType, AnnotationProvider, ProviderError,
    },
    annotation::tracing_initialization::{
        AnnotationLayerParameters, CREATE_TRACINGS_FAILED, DATA_STORE_NOT_FOUND_FOR_DATASET,
        ExplorationalDataset, FetchedPrecedenceTracing, InitialTracing, PrecedenceFetchRequest,
        RedundantTracingProperties, adapt_skeleton_tracing, adapt_volume_tracing,
        build_skeleton_tracing, layer_name, plan_volume_tracing,
    },
    auth::AuthUser,
    dataset::source::UsableDataSource,
    error::{ApiError, ApiResult},
    extract::{self, Path},
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    state::JobsEnabled,
    stores::client::ServiceClients,
    stores::tracing_client::{TracingStoreClient, VolumeSaveDataSource},
    system::application_info::MiscState,
    util::id::ObjectId,
    util::instant::now_millis,
};

/// Msg.Annotation.createFailed.
pub const CREATE_FAILED: &str = "Could not create annotation.";

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/datasets/{datasetId}/createExplorational",
        post(create_explorational),
    )
}

// ---------------------------------------------------------------------------
// Fox failures
// ---------------------------------------------------------------------------

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
    let row = annotation_create_dao::find_dataset(pool, id).await?;
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
    pub source: UsableDataSource,
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
        return Err(ProviderError::failure(crate::msg::dataset::not_usable(
            dataset.id.as_str(),
        )));
    }
    if !dataset.has_voxel_size {
        return Err(ProviderError::failure(
            crate::msg::dataset::data_source::USABLE_BUT_NO_VOXEL_SIZE,
        )
        .wrap(crate::msg::dataset::data_source::NOT_FOUND)
        .with_status(StatusCode::NOT_FOUND));
    }
    let rendered = crate::dataset::routes::data_source_for_rpc(pool, &dataset.id, true).await?;
    let source = UsableDataSource::from_json(&rendered).map_err(|_| ApiError::internal())?;
    Ok(UsableSource { source, rendered })
}

/// `tracingStoreService.clientFor(dataset)`: first live tracing store
/// (`?~> Msg.TracingStore.notFound`).
pub(crate) async fn tracing_store_url(pool: &PgPool) -> Result<String, ProviderError> {
    crate::stores::tracing_client::find_first_tracing_store_url(pool)
        .await?
        .ok_or_else(|| ProviderError::failure(crate::msg::tracing_store::NOT_FOUND))
}

/// `dataStoreDAO.findOneByName(dataset._dataStore.trim)` (internal URL),
/// `?~> Msg.DataStore.notFoundForDataset`.
pub(crate) async fn data_store_url(
    pool: &PgPool,
    dataset: &DatasetFacts,
) -> Result<String, ProviderError> {
    let url = annotation_create_dao::find_data_store_url(pool, &dataset.data_store).await?;
    url.ok_or_else(|| ProviderError::failure(DATA_STORE_NOT_FOUND_FOR_DATASET))
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
                .map_err(ProviderError::from)?,
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
                .map_err(ProviderError::from)?,
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
            let plan = plan_volume_tracing(&dataset, params).map_err(ProviderError::from)?;
            let has_segment_index = match plan.segment_index_lookup() {
                Some(layer) => clients
                    .has_segment_index(context.data_store_url, &context.dataset.id, layer)
                    .await
                    .map_err(ProviderError::from)?,
                None => false,
            };
            let tracing = plan
                .build(has_segment_index, created)
                .map_err(ProviderError::from)?;
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

impl<S: Send + Sync> FromRequestParts<S> for Services
where
    JobsEnabled: FromRef<S>,
    MiscState: FromRef<S>,
    ServiceClients: FromRef<S>,
    TracingStoreClient: FromRef<S>,
    AnnotationProvider: FromRef<S>,
{
    type Rejection = ApiError;
    async fn from_request_parts(_parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Ok(Self {
            provider: AnnotationProvider::from_ref(state),
            clients: ServiceClients::from_ref(state),
            tracing_store: TracingStoreClient::from_ref(state),
            misc: MiscState::from_ref(state),
            jobs_enabled: JobsEnabled::from_ref(state).0,
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
                .map_err(ProviderError::from)?,
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
                .map_err(ProviderError::from)?,
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
                typ: AnnotationLayerTypeProto::from(layer.typ) as i32,
            })
            .collect(),
        earliest_accessible_version: 0,
        ..Default::default()
    };
    services
        .tracing_store
        .save_annotation_proto(&tracing_store_url, annotation_id, &proto)
        .await
        .map_err(ProviderError::from)?;
    Ok(layers)
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
        crate::dataset::access::can_read(&state.pool, Some(&user), &dataset_id, None).await?;
    let dataset = if readable {
        find_dataset(&state.pool, &dataset_id).await?
    } else {
        None
    }
    .ok_or_else(|| ApiError::not_found(crate::msg::dataset::not_found(&dataset_id)))?;

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
            dataset_id: &dataset.id,
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
        annotation_create_dao::update_layer_statistics(
            &mut transaction,
            &annotation_id,
            &layer.tracing_id,
            zeroed_statistics(layer.typ),
        )
        .await?;
    }
    let json = crate::annotation::lists::full_json(
        &mut transaction,
        &user,
        &annotation_id,
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
    crate::system::analytics::track(
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
mod tests;
