//! Main-application RPC client for the tracing store
//! (`WKRemoteTracingStoreClient.scala`). Built on `service_clients`: the
//! process RPC token is appended as `token`, redirects stay same-origin,
//! bodies are bounded and no URL, token or upstream body enters errors.
use std::{fmt, time::Duration};

use axum::http::StatusCode;
use prost::Message;
use reqwest::Method;
use serde::Serialize;
use serde_json::Value;
use sqlx::{Executor, Postgres};

use crate::{
    annotation_provider::AnnotationDataSourceStore,
    error::{ApiError, ApiResult},
    id::ObjectId,
    nml_writer::{NmlVoxelSize, VolumeDataZipFormat, java_double},
    proto::{
        AnnotationLayerTypeProto, AnnotationProto,
        datastore::{
            SkeletonTracing, SkeletonTracingOpt, SkeletonTracings, SkeletonTracingsWithIds,
            VolumeTracing, VolumeTracingOpt, VolumeTracings,
        },
    },
    service_clients::{PROTOBUF_CONTENT_TYPE, ServiceClientConfig, ServiceClients, ServiceError},
};

/// RPCRequest.withLongTimeout.
pub const LONG_REQUEST_TIMEOUT: Duration = Duration::from_secs(2 * 60 * 60);

/// Msg.TracingStore.notFound.
pub const TRACING_STORE_NOT_FOUND: &str = "Tracing store could not be found or accessed.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TracingStoreError {
    Service(ServiceError),
    /// RPCRequest.parseProtoResponse failure ("returned invalid Protocol Buffer Data").
    InvalidProtobuf,
}

impl fmt::Display for TracingStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Service(error) => error.fmt(f),
            Self::InvalidProtobuf => {
                f.write_str("Tracing store returned invalid Protocol Buffer data.")
            }
        }
    }
}
impl std::error::Error for TracingStoreError {}

impl From<ServiceError> for TracingStoreError {
    fn from(error: ServiceError) -> Self {
        Self::Service(error)
    }
}

impl From<TracingStoreError> for ApiError {
    fn from(error: TracingStoreError) -> Self {
        match error {
            TracingStoreError::Service(error) => error.into(),
            // Plain Fox.failure: Play's default 400.
            TracingStoreError::InvalidProtobuf => {
                ApiError::new(StatusCode::BAD_REQUEST, error.to_string())
            }
        }
    }
}

/// `NamedBoundingBox` JSON (Play `Json.format`): `None` fields are omitted,
/// `topLeft` is `[x,y,z]` and `color` is `[r,g,b]` when alpha is 1, otherwise `[r,g,b,a]`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedBoundingBox {
    pub id: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_visible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "color_json")]
    pub color: Option<[f64; 4]>,
    pub bounding_box: BoundingBox,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundingBox {
    pub top_left: [i32; 3],
    pub width: i32,
    pub height: i32,
    pub depth: i32,
}

fn color_json<S: serde::Serializer>(color: &Option<[f64; 4]>, s: S) -> Result<S::Ok, S::Error> {
    match color {
        Some([r, g, b, a]) if *a == 1.0 => [r, g, b].serialize(s),
        Some(rgba) => rgba.serialize(s),
        None => s.serialize_none(),
    }
}

/// TSAnnotationController `MergedFromIdsRequest` body plus its query parameters.
#[derive(Debug, Clone, PartialEq)]
pub struct MergeRequest {
    pub annotation_ids: Vec<ObjectId>,
    pub owner_ids: Vec<ObjectId>,
    pub additional_bounding_boxes: Vec<NamedBoundingBox>,
    pub new_annotation_id: ObjectId,
    pub to_temporary_store: bool,
    pub requesting_user_id: ObjectId,
    pub remap_segment_ids: bool,
}

impl MergeRequest {
    fn body(&self) -> Value {
        serde_json::json!({
            "annotationIds": self.annotation_ids,
            "ownerIds": self.owner_ids,
            "additionalBoundingBoxes": self.additional_bounding_boxes,
        })
    }
}

/// Typed tracing-store RPCs. Holds one transport with the configured timeout
/// and one with the long (two hour) timeout used by Scala `withLongTimeout`.
#[derive(Clone, Debug)]
pub struct TracingStoreClient {
    clients: ServiceClients,
    long_clients: ServiceClients,
}

impl TracingStoreClient {
    pub fn new(config: ServiceClientConfig) -> Result<Self, ServiceError> {
        Self::with_long_timeout(config, LONG_REQUEST_TIMEOUT)
    }

    pub fn with_long_timeout(
        config: ServiceClientConfig,
        long_request_timeout: Duration,
    ) -> Result<Self, ServiceError> {
        // Scala's `withLongTimeout` RPCs (volume data zips, merges, duplicates)
        // buffer responses without a size limit; the shared cap stays on the
        // default transport only.
        let long_config = ServiceClientConfig {
            request_timeout: long_request_timeout,
            max_response_bytes: usize::MAX,
            ..config.clone()
        };
        Ok(Self {
            clients: ServiceClients::new(config)?,
            long_clients: ServiceClients::new(long_config)?,
        })
    }

    /// `GET /tracings/annotation/:annotationId?version=` (getAnnotationProto).
    pub async fn get_annotation_proto(
        &self,
        tracing_store_url: &str,
        annotation_id: &ObjectId,
        version: Option<i64>,
    ) -> Result<AnnotationProto, TracingStoreError> {
        let query: Vec<(&str, String)> = version
            .map(|version| ("version", version.to_string()))
            .into_iter()
            .collect();
        let response = self
            .clients
            .request(
                Method::GET,
                tracing_store_url,
                &["tracings", "annotation", annotation_id.as_str()],
                &query,
                None,
            )
            .await?;
        decode_annotation_proto(&response.bytes)
    }

    /// The long-timeout (2 h) transport, for RPCs Scala sends `withLongTimeout`
    /// through helpers that take plain `ServiceClients`.
    pub fn long_clients(&self) -> &ServiceClients {
        &self.long_clients
    }

    /// `POST /tracings/annotation/:id/resetToBase` (resetToBase), long timeout.
    pub async fn reset_to_base(
        &self,
        tracing_store_url: &str,
        annotation_id: &str,
    ) -> Result<(), ServiceError> {
        self.long_clients
            .request(
                Method::POST,
                tracing_store_url,
                &["tracings", "annotation", annotation_id, "resetToBase"],
                &[],
                None,
            )
            .await?;
        Ok(())
    }

    /// `POST /tracings/annotation/mergedFromIds` (mergeAnnotationsByIds), long timeout.
    pub async fn merge_annotations_by_ids(
        &self,
        tracing_store_url: &str,
        request: &MergeRequest,
    ) -> Result<AnnotationProto, TracingStoreError> {
        let query = [
            ("toTemporaryStore", request.to_temporary_store.to_string()),
            ("newAnnotationId", request.new_annotation_id.to_string()),
            ("requestingUserId", request.requesting_user_id.to_string()),
            ("remapSegmentIds", request.remap_segment_ids.to_string()),
        ];
        let response = self
            .long_clients
            .request(
                Method::POST,
                tracing_store_url,
                &["tracings", "annotation", "mergedFromIds"],
                &query,
                Some(&request.body()),
            )
            .await?;
        decode_annotation_proto(&response.bytes)
    }

    /// `POST /tracings/skeleton/save?newTracingId=` with the SkeletonTracing
    /// protobuf body (saveSkeletonTracing), long timeout. Response ignored.
    pub async fn save_skeleton_tracing(
        &self,
        tracing_store_url: &str,
        tracing: &SkeletonTracing,
        new_tracing_id: &str,
    ) -> Result<(), ServiceError> {
        self.long_clients
            .request_bytes(
                Method::POST,
                tracing_store_url,
                &["tracings", "skeleton", "save"],
                &[("newTracingId", new_tracing_id.to_owned())],
                PROTOBUF_CONTENT_TYPE,
                tracing.encode_to_vec(),
            )
            .await?;
        Ok(())
    }

    /// saveVolumeTracing without initial data: first registers the data source
    /// in the AnnotationDataSourceTemporaryStore (unconditionally, before the
    /// RPC, as Scala), then `POST /tracings/volume/save?newTracingId=` with the
    /// VolumeTracing protobuf body, default timeout. Response ignored.
    pub async fn save_volume_tracing(
        &self,
        tracing_store_url: &str,
        annotation_id: &ObjectId,
        new_tracing_id: &str,
        tracing: &VolumeTracing,
        data_source: VolumeSaveDataSource<'_>,
    ) -> Result<(), ServiceError> {
        data_source.store.store(
            annotation_id.clone(),
            data_source.data_source.clone(),
            data_source.dataset_id.clone(),
        );
        self.clients
            .request_bytes(
                Method::POST,
                tracing_store_url,
                &["tracings", "volume", "save"],
                &[("newTracingId", new_tracing_id.to_owned())],
                PROTOBUF_CONTENT_TYPE,
                tracing.encode_to_vec(),
            )
            .await?;
        Ok(())
    }

    /// `POST /tracings/annotation/save?annotationId=` with the AnnotationProto
    /// protobuf body (saveAnnotationProto), default timeout. Response ignored.
    pub async fn save_annotation_proto(
        &self,
        tracing_store_url: &str,
        annotation_id: &ObjectId,
        annotation: &AnnotationProto,
    ) -> Result<(), ServiceError> {
        self.clients
            .request_bytes(
                Method::POST,
                tracing_store_url,
                &["tracings", "annotation", "save"],
                &[("annotationId", annotation_id.to_string())],
                PROTOBUF_CONTENT_TYPE,
                annotation.encode_to_vec(),
            )
            .await?;
        Ok(())
    }

    /// The initial-data step of saveVolumeTracing:
    /// `POST /tracings/volume/:tracingId/initialData?annotationId=&minMag=&maxMag=`
    /// with the raw volume data zip as `application/octet-stream` body, long
    /// timeout. `minMag`/`maxMag` (MagRestrictions) are omitted when `None`.
    /// Response ignored. The volume itself is saved by `save_volume_tracing`.
    pub async fn upload_volume_initial_data(
        &self,
        tracing_store_url: &str,
        annotation_id: &ObjectId,
        tracing_id: &str,
        min_mag: Option<i32>,
        max_mag: Option<i32>,
        data: Vec<u8>,
    ) -> Result<(), ServiceError> {
        let mut query = vec![("annotationId", annotation_id.to_string())];
        query.extend(min_mag.map(|mag| ("minMag", mag.to_string())));
        query.extend(max_mag.map(|mag| ("maxMag", mag.to_string())));
        self.long_clients
            .request_bytes(
                Method::POST,
                tracing_store_url,
                &["tracings", "volume", tracing_id, "initialData"],
                &query,
                OCTET_STREAM_CONTENT_TYPE,
                data,
            )
            .await?;
        Ok(())
    }

    /// The RPC of saveEditableMappingIfPresent (both edges zip and base
    /// mapping name present; the presence checks stay with the caller):
    /// `POST /tracings/mapping/:tracingId/save?annotationId=&baseMappingName=&startVersion=`
    /// with the edited-edges zip as `application/octet-stream` body, long
    /// timeout. Returns the JSON Long response (number of saved versions);
    /// any other body is `InvalidJson`.
    pub async fn save_editable_mapping(
        &self,
        tracing_store_url: &str,
        annotation_id: &ObjectId,
        tracing_id: &str,
        base_mapping_name: &str,
        start_version: i64,
        edges_zip: Vec<u8>,
    ) -> Result<i64, ServiceError> {
        let response = self
            .long_clients
            .request_bytes(
                Method::POST,
                tracing_store_url,
                &["tracings", "mapping", tracing_id, "save"],
                &[
                    ("annotationId", annotation_id.to_string()),
                    ("baseMappingName", base_mapping_name.to_owned()),
                    ("startVersion", start_version.to_string()),
                ],
                OCTET_STREAM_CONTENT_TYPE,
                edges_zip,
            )
            .await?;
        serde_json::from_slice::<i64>(&response.bytes).map_err(|_| ServiceError::InvalidJson)
    }

    /// mergeVolumeTracingsByContents, all on the long timeout (Scala sends
    /// `initializeForMerge` and `mergedFromContents` without `withLongTimeout`;
    /// the long transport only lengthens the timeout):
    /// 1. `POST /tracings/volume/initializeForMerge?newTracingId=` with the
    ///    thinned `VolumeTracings` (no segments, segment groups, user bounding
    ///    boxes or user states) as protobuf;
    /// 2. registers the data source in the AnnotationDataSourceTemporaryStore;
    /// 3. `POST /tracings/volume/:newTracingId/initialDataMultiple?annotationId=`
    ///    with `packed_initial_data` (ZipIO-packed data zips, packed by the
    ///    caller) as `application/octet-stream`;
    /// 4. `POST /tracings/volume/mergedFromContents?newTracingId=` with the
    ///    full `VolumeTracings` as protobuf.
    ///
    /// Stops at the first failing RPC. Responses ignored.
    pub async fn merge_volume_tracings_by_contents(
        &self,
        tracing_store_url: &str,
        annotation_id: &ObjectId,
        new_tracing_id: &str,
        tracings: &[VolumeTracing],
        packed_initial_data: Vec<u8>,
        data_source: VolumeSaveDataSource<'_>,
    ) -> Result<(), ServiceError> {
        let thinned = VolumeTracings {
            tracings: tracings
                .iter()
                .map(|tracing| VolumeTracingOpt {
                    tracing: Some(VolumeTracing {
                        segments: Vec::new(),
                        segment_groups: Vec::new(),
                        user_bounding_boxes: Vec::new(),
                        user_states: Vec::new(),
                        ..tracing.clone()
                    }),
                })
                .collect(),
        };
        let full = VolumeTracings {
            tracings: tracings
                .iter()
                .map(|tracing| VolumeTracingOpt {
                    tracing: Some(tracing.clone()),
                })
                .collect(),
        };
        let new_tracing_query = [("newTracingId", new_tracing_id.to_owned())];
        self.long_clients
            .request_bytes(
                Method::POST,
                tracing_store_url,
                &["tracings", "volume", "initializeForMerge"],
                &new_tracing_query,
                PROTOBUF_CONTENT_TYPE,
                thinned.encode_to_vec(),
            )
            .await?;
        data_source.store.store(
            annotation_id.clone(),
            data_source.data_source.clone(),
            data_source.dataset_id.clone(),
        );
        self.long_clients
            .request_bytes(
                Method::POST,
                tracing_store_url,
                &["tracings", "volume", new_tracing_id, "initialDataMultiple"],
                &[("annotationId", annotation_id.to_string())],
                OCTET_STREAM_CONTENT_TYPE,
                packed_initial_data,
            )
            .await?;
        self.long_clients
            .request_bytes(
                Method::POST,
                tracing_store_url,
                &["tracings", "volume", "mergedFromContents"],
                &new_tracing_query,
                PROTOBUF_CONTENT_TYPE,
                full.encode_to_vec(),
            )
            .await?;
        Ok(())
    }

    /// mergeSkeletonTracingsByContents: `POST /tracings/skeleton/mergedFromContents?newTracingId=`
    /// with the `SkeletonTracings` protobuf (every entry present), long
    /// timeout. Response ignored.
    pub async fn merge_skeleton_tracings_by_contents(
        &self,
        tracing_store_url: &str,
        new_tracing_id: &str,
        tracings: &[&SkeletonTracing],
    ) -> Result<(), ServiceError> {
        let body = SkeletonTracings {
            tracings: tracings
                .iter()
                .map(|tracing| SkeletonTracingOpt {
                    tracing: Some((*tracing).clone()),
                })
                .collect(),
        };
        self.long_clients
            .request_bytes(
                Method::POST,
                tracing_store_url,
                &["tracings", "skeleton", "mergedFromContents"],
                &[("newTracingId", new_tracing_id.to_owned())],
                PROTOBUF_CONTENT_TYPE,
                body.encode_to_vec(),
            )
            .await?;
        Ok(())
    }

    /// saveSkeletonTracings: `POST /tracings/skeleton/saveMultiple` with the
    /// `SkeletonTracingsWithIds` protobuf, long timeout, JSON
    /// `List[Box[Boolean]]` response (JsonHelper.boxFormat:
    /// `{"status":"Full","value":<bool>}`, `{"status":"Empty"}`,
    /// `{"status":"Failure","value":<message>}`). Anything else is `InvalidJson`.
    pub async fn save_skeleton_tracings(
        &self,
        tracing_store_url: &str,
        tracings: &SkeletonTracingsWithIds,
    ) -> Result<Vec<SaveMultipleResult>, ServiceError> {
        let response = self
            .long_clients
            .request_bytes(
                Method::POST,
                tracing_store_url,
                &["tracings", "skeleton", "saveMultiple"],
                &[],
                PROTOBUF_CONTENT_TYPE,
                tracings.encode_to_vec(),
            )
            .await?;
        let items: Vec<Value> =
            serde_json::from_slice(&response.bytes).map_err(|_| ServiceError::InvalidJson)?;
        items
            .iter()
            .map(|item| match item.get("status").and_then(Value::as_str) {
                Some("Full") if item.get("value").is_some_and(Value::is_boolean) => {
                    Ok(SaveMultipleResult::Full)
                }
                Some("Empty") => Ok(SaveMultipleResult::Empty),
                Some("Failure") => item
                    .get("value")
                    .and_then(Value::as_str)
                    .map(|message| SaveMultipleResult::Failure(message.to_owned()))
                    .ok_or(ServiceError::InvalidJson),
                _ => Err(ServiceError::InvalidJson),
            })
            .collect()
    }

    /// duplicateAnnotation: `POST /tracings/annotation/:annotationId/duplicate?newAnnotationId=
    /// &version=&datasetBoundingBox=&isFromTask=&ownerId=&requestingUserId=`
    /// with an empty body, long timeout, answering a validated
    /// `AnnotationProto` (postEmptyWithProtoResponse).
    pub async fn duplicate_annotation(
        &self,
        tracing_store_url: &str,
        request: &DuplicateAnnotationRequest,
    ) -> Result<AnnotationProto, TracingStoreError> {
        let response = self
            .long_clients
            .request(
                Method::POST,
                tracing_store_url,
                &[
                    "tracings",
                    "annotation",
                    request.source_annotation_id.as_str(),
                    "duplicate",
                ],
                &request.query(),
                None,
            )
            .await?;
        decode_annotation_proto(&response.bytes)
    }

    /// `GET /tracings/skeleton/:tracingId?annotationId=&version=` (the RPC of
    /// getSkeletonTracing), long timeout, `version` omitted when `None`.
    /// Scala's preceding layer-type assertion (`fetchNotSkeleton`) is the
    /// caller's responsibility.
    pub async fn get_skeleton_tracing(
        &self,
        tracing_store_url: &str,
        tracing_id: &str,
        annotation_id: &ObjectId,
        version: Option<i64>,
    ) -> Result<SkeletonTracing, TracingStoreError> {
        let response = self
            .long_clients
            .request(
                Method::GET,
                tracing_store_url,
                &["tracings", "skeleton", tracing_id],
                &tracing_query(annotation_id, version),
                None,
            )
            .await?;
        decode_skeleton_tracing(&response.bytes)
    }

    /// `GET /tracings/volume/:tracingId?annotationId=&version=` (the RPC of
    /// getVolumeTracing with `skipVolumeAndEdgesData = true`: no volume data,
    /// edited edges or mapping info calls), default timeout. Scala's
    /// layer-type assertion (`fetchNotVolume`) is the caller's responsibility.
    pub async fn get_volume_tracing(
        &self,
        tracing_store_url: &str,
        tracing_id: &str,
        annotation_id: &ObjectId,
        version: Option<i64>,
    ) -> Result<VolumeTracing, TracingStoreError> {
        let response = self
            .clients
            .request(
                Method::GET,
                tracing_store_url,
                &["tracings", "volume", tracing_id],
                &tracing_query(annotation_id, version),
                None,
            )
            .await?;
        decode_volume_tracing(&response.bytes)
    }

    // ---- Download RPCs (AnnotationIOController download paths) ----------

    /// The full download fetch of one volume layer (Scala `getVolumeTracing`
    /// with `skipVolumeAndEdgesData` as given): the tracing (default timeout),
    /// then unless skipped either the volume data zip (no editable mapping)
    /// or the edited-edges zip followed by the mapping info's
    /// `baseMappingName` (editable mapping), in Scala's order.
    pub async fn fetch_volume_layer(
        &self,
        tracing_store_url: &str,
        request: VolumeLayerFetch<'_>,
    ) -> Result<FetchedVolumeLayer, TracingStoreError> {
        let VolumeLayerFetch {
            tracing_id,
            annotation_id,
            version,
            skip_volume_and_edges_data,
            volume_data_zip_format,
            voxel_size,
        } = request;
        let tracing = self
            .get_volume_tracing(tracing_store_url, tracing_id, annotation_id, version)
            .await?;
        let has_editable_mapping = tracing.has_editable_mapping.unwrap_or(false);
        let mut fetched = FetchedVolumeLayer {
            tracing,
            data: None,
            edited_mapping_edges: None,
            base_mapping_name: None,
        };
        if skip_volume_and_edges_data {
            return Ok(fetched);
        }
        if has_editable_mapping {
            fetched.edited_mapping_edges = Some(
                self.get_edited_mapping_edges_zip(tracing_store_url, tracing_id, version)
                    .await?,
            );
            fetched.base_mapping_name = Some(
                self.get_base_mapping_name(tracing_store_url, tracing_id, annotation_id, version)
                    .await?,
            );
        } else {
            fetched.data = Some(
                self.get_volume_data_zip(
                    tracing_store_url,
                    tracing_id,
                    annotation_id,
                    version,
                    volume_data_zip_format,
                    voxel_size,
                )
                .await?,
            );
        }
        Ok(fetched)
    }

    /// `GET /tracings/volume/:tracingId/allDataZip?volumeDataZipFormat=&annotationId=&version=&voxelSizeFactor=&voxelSizeUnit=`
    /// (the data step of getVolumeTracing), long timeout, raw zip bytes.
    /// `version` and both voxel parameters are omitted when `None`; the
    /// factor is Scala's `Vec3Double.toUriLiteral` (`x,y,z`, Java doubles).
    pub async fn get_volume_data_zip(
        &self,
        tracing_store_url: &str,
        tracing_id: &str,
        annotation_id: &ObjectId,
        version: Option<i64>,
        format: VolumeDataZipFormat,
        voxel_size: Option<&NmlVoxelSize>,
    ) -> Result<Vec<u8>, ServiceError> {
        let mut query = vec![("volumeDataZipFormat", format.as_str().to_owned())];
        query.extend(tracing_query(annotation_id, version));
        query.extend(voxel_size_query(voxel_size));
        self.all_data_zip(tracing_store_url, tracing_id, &query)
            .await
    }

    /// `GET /tracings/volume/:tracingId/allDataZip?volumeDataZipFormat=&voxelSizeFactor=&voxelSizeUnit=`
    /// without annotation id or version (getVolumeData, compound downloads),
    /// long timeout, raw zip bytes.
    pub async fn get_volume_data(
        &self,
        tracing_store_url: &str,
        tracing_id: &str,
        format: VolumeDataZipFormat,
        voxel_size: Option<&NmlVoxelSize>,
    ) -> Result<Vec<u8>, ServiceError> {
        let mut query = vec![("volumeDataZipFormat", format.as_str().to_owned())];
        query.extend(voxel_size_query(voxel_size));
        self.all_data_zip(tracing_store_url, tracing_id, &query)
            .await
    }

    async fn all_data_zip(
        &self,
        tracing_store_url: &str,
        tracing_id: &str,
        query: &[(&str, String)],
    ) -> Result<Vec<u8>, ServiceError> {
        let response = self
            .long_clients
            .request(
                Method::GET,
                tracing_store_url,
                &["tracings", "volume", tracing_id, "allDataZip"],
                query,
                None,
            )
            .await?;
        Ok(response.bytes)
    }

    /// `GET /tracings/mapping/:tracingId/editedEdgesZip?version=`, long
    /// timeout, raw zip bytes (no annotationId, as Scala).
    pub async fn get_edited_mapping_edges_zip(
        &self,
        tracing_store_url: &str,
        tracing_id: &str,
        version: Option<i64>,
    ) -> Result<Vec<u8>, ServiceError> {
        let query: Vec<(&str, String)> = version
            .map(|version| ("version", version.to_string()))
            .into_iter()
            .collect();
        let response = self
            .long_clients
            .request(
                Method::GET,
                tracing_store_url,
                &["tracings", "mapping", tracing_id, "editedEdgesZip"],
                &query,
                None,
            )
            .await?;
        Ok(response.bytes)
    }

    /// `GET /tracings/mapping/:tracingId/info?version=&annotationId=`, long
    /// timeout. Scala parses the body as a JSON object and requires its
    /// `baseMappingName` to be a string; anything else is `InvalidJson`.
    pub async fn get_base_mapping_name(
        &self,
        tracing_store_url: &str,
        tracing_id: &str,
        annotation_id: &ObjectId,
        version: Option<i64>,
    ) -> Result<String, ServiceError> {
        let mut query: Vec<(&str, String)> = version
            .map(|version| ("version", version.to_string()))
            .into_iter()
            .collect();
        query.push(("annotationId", annotation_id.to_string()));
        let response = self
            .long_clients
            .request(
                Method::GET,
                tracing_store_url,
                &["tracings", "mapping", tracing_id, "info"],
                &query,
                None,
            )
            .await?;
        let info: serde_json::Map<String, Value> =
            serde_json::from_slice(&response.bytes).map_err(|_| ServiceError::InvalidJson)?;
        match info.get("baseMappingName") {
            Some(Value::String(name)) => Ok(name.clone()),
            _ => Err(ServiceError::InvalidJson),
        }
    }

    /// `POST /tracings/skeleton/getMultiple` (getSkeletonTracings), long
    /// timeout, as AnnotationService.getSkeletonTracings calls it: serial
    /// batches of 1000 selectors (JSON `[{"tracingId":..} | null]`), each
    /// response a validated `SkeletonTracings`, flattened in order. No RPC
    /// for an empty list. The response length is not checked (Scala zips).
    pub async fn get_skeleton_tracings(
        &self,
        tracing_store_url: &str,
        tracing_ids: &[Option<String>],
    ) -> Result<Vec<Option<SkeletonTracing>>, TracingStoreError> {
        let mut tracings = Vec::with_capacity(tracing_ids.len());
        for batch in tracing_ids.chunks(GET_MULTIPLE_BATCH_SIZE) {
            let bytes = self
                .get_multiple(tracing_store_url, "skeleton", batch)
                .await?;
            tracings.extend(
                decode_skeleton_tracings(&bytes)?
                    .tracings
                    .into_iter()
                    .map(|opt| opt.tracing),
            );
        }
        Ok(tracings)
    }

    /// `POST /tracings/volume/getMultiple` (getVolumeTracings); same batching
    /// and decoding as `get_skeleton_tracings`, with `VolumeTracings`.
    pub async fn get_volume_tracings(
        &self,
        tracing_store_url: &str,
        tracing_ids: &[Option<String>],
    ) -> Result<Vec<Option<VolumeTracing>>, TracingStoreError> {
        let mut tracings = Vec::with_capacity(tracing_ids.len());
        for batch in tracing_ids.chunks(GET_MULTIPLE_BATCH_SIZE) {
            let bytes = self
                .get_multiple(tracing_store_url, "volume", batch)
                .await?;
            tracings.extend(
                decode_volume_tracings(&bytes)?
                    .tracings
                    .into_iter()
                    .map(|opt| opt.tracing),
            );
        }
        Ok(tracings)
    }

    async fn get_multiple(
        &self,
        tracing_store_url: &str,
        kind: &str,
        tracing_ids: &[Option<String>],
    ) -> Result<Vec<u8>, ServiceError> {
        // List[Option[TracingSelector]]: None -> null; `version` is None and
        // omitted by the macro format.
        let body = Value::Array(
            tracing_ids
                .iter()
                .map(|id| match id {
                    Some(id) => serde_json::json!({ "tracingId": id }),
                    None => Value::Null,
                })
                .collect(),
        );
        let response = self
            .long_clients
            .request(
                Method::POST,
                tracing_store_url,
                &["tracings", kind, "getMultiple"],
                &[],
                Some(&body),
            )
            .await?;
        Ok(response.bytes)
    }
}

/// Content type of `RPCRequest.postFile` bodies (initialData, mapping save).
const OCTET_STREAM_CONTENT_TYPE: &str = "application/octet-stream";

/// One `Box[Boolean]` of the saveMultiple JSON response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SaveMultipleResult {
    Full,
    Empty,
    /// Failure message.
    Failure(String),
}

/// Parameters of WKRemoteTracingStoreClient.duplicateAnnotation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateAnnotationRequest {
    /// Annotation to copy (path segment).
    pub source_annotation_id: ObjectId,
    pub new_annotation_id: ObjectId,
    /// Owner of the SOURCE annotation (`ownerId`).
    pub owner_id: ObjectId,
    /// The user performing the duplication (`requestingUserId`).
    pub requesting_user_id: ObjectId,
    /// `version` (omitted when `None`; both current callers pass `None`).
    pub version: Option<i64>,
    /// True only when duplicating an annotation that itself belongs to a task
    /// (controller `duplicate` of a Task/TracingBase row); task assignment
    /// passes false.
    pub is_from_task: bool,
    /// Data source bounding box `[x, y, z, width, height, depth]`, sent as
    /// `BoundingBox.toLiteral` (`x,y,z,w,h,d`); only set together with `is_from_task`.
    pub dataset_bounding_box: Option<[i32; 6]>,
}

impl DuplicateAnnotationRequest {
    /// Query parameters in Scala's `addQueryParam` order (token is prepended
    /// by the transport); `None` options are omitted.
    fn query(&self) -> Vec<(&'static str, String)> {
        let mut query = vec![("newAnnotationId", self.new_annotation_id.to_string())];
        if let Some(version) = self.version {
            query.push(("version", version.to_string()));
        }
        if let Some([x, y, z, width, height, depth]) = self.dataset_bounding_box {
            query.push((
                "datasetBoundingBox",
                format!("{x},{y},{z},{width},{height},{depth}"),
            ));
        }
        query.push(("isFromTask", self.is_from_task.to_string()));
        query.push(("ownerId", self.owner_id.to_string()));
        query.push(("requestingUserId", self.requesting_user_id.to_string()));
        query
    }
}

/// AnnotationService.getSkeletonTracings / getVolumeTracings `grouped(1000)`.
pub const GET_MULTIPLE_BATCH_SIZE: usize = 1000;

/// Parameters of `TracingStoreClient::fetch_volume_layer`.
#[derive(Debug, Clone, Copy)]
pub struct VolumeLayerFetch<'a> {
    pub tracing_id: &'a str,
    pub annotation_id: &'a ObjectId,
    pub version: Option<i64>,
    pub skip_volume_and_edges_data: bool,
    pub volume_data_zip_format: VolumeDataZipFormat,
    pub voxel_size: Option<&'a NmlVoxelSize>,
}

/// The tracing-store part of Scala `FetchedAnnotationLayer` for a volume layer.
#[derive(Debug, Clone, PartialEq)]
pub struct FetchedVolumeLayer {
    pub tracing: VolumeTracing,
    /// allDataZip bytes; `None` when skipped or the tracing has an editable mapping.
    pub data: Option<Vec<u8>>,
    /// editedEdgesZip bytes; only with an editable mapping and not skipped.
    pub edited_mapping_edges: Option<Vec<u8>>,
    /// Mapping info `baseMappingName`; only with an editable mapping and not skipped.
    pub base_mapping_name: Option<String>,
}

fn voxel_size_query(voxel_size: Option<&NmlVoxelSize>) -> Vec<(&'static str, String)> {
    voxel_size
        .map(|voxel_size| {
            let [x, y, z] = voxel_size.factor;
            vec![
                (
                    "voxelSizeFactor",
                    format!("{},{},{}", java_double(x), java_double(y), java_double(z)),
                ),
                ("voxelSizeUnit", voxel_size.unit.clone()),
            ]
        })
        .unwrap_or_default()
}

/// Temporary data source registered by `save_volume_tracing`
/// (`annotationDataSourceTemporaryStore.store(annotationId, dataSource, datasetId)`).
#[derive(Debug, Clone, Copy)]
pub struct VolumeSaveDataSource<'a> {
    pub store: &'a AnnotationDataSourceStore,
    /// Rendered `UsableDataSource` JSON.
    pub data_source: &'a Value,
    pub dataset_id: &'a ObjectId,
}

fn tracing_query(annotation_id: &ObjectId, version: Option<i64>) -> Vec<(&'static str, String)> {
    let mut query = vec![("annotationId", annotation_id.to_string())];
    query.extend(version.map(|version| ("version", version.to_string())));
    query
}

/// TracingStoreDAO.findFirst: internal URL of the first live tracing store.
/// Scala's findAll has no ORDER BY; order by name for determinism.
pub async fn first_tracing_store_url<'e, E: Executor<'e, Database = Postgres>>(
    executor: E,
) -> ApiResult<String> {
    find_first_tracing_store_url(executor)
        .await?
        .ok_or_else(|| ApiError::bad_request(TRACING_STORE_NOT_FOUND))
}

/// TracingStoreDAO.findFirst without the error adaptation: `None` when no
/// live tracing store exists, so callers can attach their own Fox chain.
pub async fn find_first_tracing_store_url<'e, E: Executor<'e, Database = Postgres>>(
    executor: E,
) -> ApiResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT url FROM webknossos.tracingStores_ ORDER BY name LIMIT 1")
            .fetch_optional(executor)
            .await?,
    )
}

/// Decode an annotation including the nested proto2 required-field checks
/// performed by ScalaPB. Prost defaults missing scalar fields, so successful
/// decoding alone cannot distinguish an absent field from an explicit zero.
/// Layer types must also be supported by the application layer conversion.
pub fn decode_annotation_proto(bytes: &[u8]) -> Result<AnnotationProto, TracingStoreError> {
    let decoded = AnnotationProto::decode(bytes).map_err(|_| TracingStoreError::InvalidProtobuf)?;
    let invalid = || TracingStoreError::InvalidProtobuf;
    let top_level = field_tags(bytes).ok_or_else(invalid)?;
    if !has_required_fields(&top_level, &[1, 2, 4]) {
        return Err(invalid());
    }
    for (_, layer) in top_level.iter().filter(|(tag, _)| *tag == 3) {
        let layer_tags = field_tags(layer.ok_or_else(invalid)?).ok_or_else(invalid)?;
        if !has_required_fields(&layer_tags, &[1, 2, 3]) {
            return Err(invalid());
        }
    }
    for (_, state) in top_level.iter().filter(|(tag, _)| *tag == 7) {
        let state_fields = field_tags(state.ok_or_else(invalid)?).ok_or_else(invalid)?;
        if !has_required_fields(&state_fields, &[1, 2, 3, 4]) {
            return Err(invalid());
        }
        for (tag, payload) in &state_fields {
            let required: &[u32] = match tag {
                // Vec3IntProto editPosition and Vec3DoubleProto editRotation.
                2 | 3 => &[1, 2, 3],
                // AdditionalCoordinateProto (repeated).
                5 => &[1, 2],
                _ => continue,
            };
            let fields = field_tags(payload.ok_or_else(invalid)?).ok_or_else(invalid)?;
            if !has_required_fields(&fields, required) {
                return Err(invalid());
            }
        }
    }
    if decoded
        .annotation_layers
        .iter()
        .any(|layer| AnnotationLayerTypeProto::try_from(layer.typ).is_err())
    {
        return Err(invalid());
    }
    Ok(decoded)
}

/// Decode a SkeletonTracing, rejecting it like ScalaPB when any proto2
/// required field is missing in the message or any nested message occurrence
/// (same wire-level approach as `decode_annotation_proto`). Unrecognized enum
/// values are accepted, as ScalaPB keeps them as `Unrecognized`.
pub fn decode_skeleton_tracing(bytes: &[u8]) -> Result<SkeletonTracing, TracingStoreError> {
    decode_with_required(bytes, &required::SKELETON_TRACING)
}

/// Decode a VolumeTracing with the proto2 required-field checks of
/// `decode_skeleton_tracing`.
pub fn decode_volume_tracing(bytes: &[u8]) -> Result<VolumeTracing, TracingStoreError> {
    decode_with_required(bytes, &required::VOLUME_TRACING)
}

/// Decode a `SkeletonTracings` (getMultiple response), applying the
/// SkeletonTracing required-field checks to every present
/// `SkeletonTracingOpt.tracing`.
pub fn decode_skeleton_tracings(bytes: &[u8]) -> Result<SkeletonTracings, TracingStoreError> {
    decode_with_required(bytes, &required::SKELETON_TRACINGS)
}

/// Decode a `VolumeTracings` (getMultiple response), applying the
/// VolumeTracing required-field checks to every present `VolumeTracingOpt.tracing`.
pub fn decode_volume_tracings(bytes: &[u8]) -> Result<VolumeTracings, TracingStoreError> {
    decode_with_required(bytes, &required::VOLUME_TRACINGS)
}

fn decode_with_required<M: Message + Default>(
    bytes: &[u8],
    schema: &RequiredFields,
) -> Result<M, TracingStoreError> {
    // prost decoding first: it enforces wire types and its recursion limit,
    // which also bounds the recursion of `satisfies_required`.
    let decoded = M::decode(bytes).map_err(|_| TracingStoreError::InvalidProtobuf)?;
    if !satisfies_required(bytes, schema) {
        return Err(TracingStoreError::InvalidProtobuf);
    }
    Ok(decoded)
}

/// proto2 `required` field tags of a message and its message-typed fields
/// (singular and repeated alike: every occurrence is checked).
struct RequiredFields {
    required: &'static [u32],
    nested: &'static [(u32, &'static RequiredFields)],
}

fn satisfies_required(bytes: &[u8], schema: &RequiredFields) -> bool {
    let Some(fields) = field_tags(bytes) else {
        return false;
    };
    has_required_fields(&fields, schema.required)
        && fields.iter().all(|(tag, payload)| {
            match schema
                .nested
                .iter()
                .find(|(nested_tag, _)| nested_tag == tag)
            {
                Some((_, nested)) => {
                    payload.is_some_and(|payload| satisfies_required(payload, nested))
                }
                None => true,
            }
        })
}

/// Required-field tables transcribed from `webknossos-datastore/proto`
/// (geometry, MetadataEntry, IdWithBool, SkeletonTracing, VolumeTracing).
mod required {
    use super::RequiredFields;

    const fn leaf(required: &'static [u32]) -> RequiredFields {
        RequiredFields {
            required,
            nested: &[],
        }
    }

    static VEC3_INT: RequiredFields = leaf(&[1, 2, 3]);
    static VEC2_INT: RequiredFields = leaf(&[1, 2]);
    static VEC3_DOUBLE: RequiredFields = leaf(&[1, 2, 3]);
    static COLOR: RequiredFields = leaf(&[1, 2, 3, 4]);
    static BOUNDING_BOX: RequiredFields = RequiredFields {
        required: &[1, 2, 3, 4],
        nested: &[(1, &VEC3_INT)],
    };
    static NAMED_BOUNDING_BOX: RequiredFields = RequiredFields {
        required: &[1, 5],
        nested: &[(4, &COLOR), (5, &BOUNDING_BOX)],
    };
    static ADDITIONAL_COORDINATE: RequiredFields = leaf(&[1, 2]);
    static ADDITIONAL_AXIS: RequiredFields = RequiredFields {
        required: &[1, 2, 3],
        nested: &[(3, &VEC2_INT)],
    };
    static METADATA_ENTRY: RequiredFields = leaf(&[1]);
    static ID_WITH_BOOL: RequiredFields = leaf(&[1, 2]);

    static NODE: RequiredFields = RequiredFields {
        required: &[1, 2, 3, 4, 5, 6, 7, 8, 9],
        nested: &[
            (2, &VEC3_INT),
            (3, &VEC3_DOUBLE),
            (10, &ADDITIONAL_COORDINATE),
        ],
    };
    static EDGE: RequiredFields = leaf(&[1, 2]);
    static COMMENT: RequiredFields = leaf(&[1, 2]);
    static BRANCH_POINT: RequiredFields = leaf(&[1, 2]);
    static TREE_AGGLOMERATE_INFO: RequiredFields = leaf(&[1]);
    static TREE: RequiredFields = RequiredFields {
        required: &[1, 7, 8],
        nested: &[
            (2, &NODE),
            (3, &EDGE),
            (4, &COLOR),
            (5, &BRANCH_POINT),
            (6, &COMMENT),
            (13, &METADATA_ENTRY),
            (14, &TREE_AGGLOMERATE_INFO),
        ],
    };
    static TREE_GROUP: RequiredFields = RequiredFields {
        required: &[1, 2],
        nested: &[(3, &TREE_GROUP)],
    };
    static SKELETON_USER_STATE: RequiredFields = RequiredFields {
        required: &[1],
        nested: &[(3, &ID_WITH_BOOL), (4, &ID_WITH_BOOL), (5, &ID_WITH_BOOL)],
    };
    pub(super) static SKELETON_TRACING: RequiredFields = RequiredFields {
        required: &[1, 3, 6, 7, 8, 9],
        nested: &[
            (2, &TREE),
            (4, &BOUNDING_BOX),
            (6, &VEC3_INT),
            (7, &VEC3_DOUBLE),
            (10, &BOUNDING_BOX),
            (11, &TREE_GROUP),
            (12, &NAMED_BOUNDING_BOX),
            (21, &ADDITIONAL_COORDINATE),
            (22, &ADDITIONAL_AXIS),
            (24, &SKELETON_USER_STATE),
        ],
    };

    static SEGMENT: RequiredFields = RequiredFields {
        required: &[1],
        nested: &[
            (2, &VEC3_INT),
            (5, &COLOR),
            (7, &ADDITIONAL_COORDINATE),
            (11, &METADATA_ENTRY),
        ],
    };
    static SEGMENT_GROUP: RequiredFields = RequiredFields {
        required: &[1, 2],
        nested: &[(3, &SEGMENT_GROUP)],
    };
    static VOLUME_USER_STATE: RequiredFields = RequiredFields {
        required: &[1],
        // Id32WithBool (3, 4) and Id64WithBool (5) share their required tags.
        nested: &[(3, &ID_WITH_BOOL), (4, &ID_WITH_BOOL), (5, &ID_WITH_BOOL)],
    };
    pub(super) static VOLUME_TRACING: RequiredFields = RequiredFields {
        required: &[2, 3, 4, 5, 6, 7, 10, 11],
        nested: &[
            (2, &BOUNDING_BOX),
            (5, &VEC3_INT),
            (6, &VEC3_DOUBLE),
            (12, &BOUNDING_BOX),
            (13, &NAMED_BOUNDING_BOX),
            (15, &VEC3_INT),
            (16, &SEGMENT),
            (19, &SEGMENT_GROUP),
            (21, &ADDITIONAL_COORDINATE),
            (22, &ADDITIONAL_AXIS),
            (26, &VOLUME_USER_STATE),
        ],
    };

    // SkeletonTracingOpt / VolumeTracingOpt: `optional <Tracing> tracing = 1`.
    static SKELETON_TRACING_OPT: RequiredFields = RequiredFields {
        required: &[],
        nested: &[(1, &SKELETON_TRACING)],
    };
    static VOLUME_TRACING_OPT: RequiredFields = RequiredFields {
        required: &[],
        nested: &[(1, &VOLUME_TRACING)],
    };
    // SkeletonTracings / VolumeTracings: `repeated <Tracing>Opt tracings = 1`.
    pub(super) static SKELETON_TRACINGS: RequiredFields = RequiredFields {
        required: &[],
        nested: &[(1, &SKELETON_TRACING_OPT)],
    };
    pub(super) static VOLUME_TRACINGS: RequiredFields = RequiredFields {
        required: &[],
        nested: &[(1, &VOLUME_TRACING_OPT)],
    };
}

/// A field tag with its length-delimited payload, if any.
type WireField<'a> = (u32, Option<&'a [u8]>);

fn has_required_fields(fields: &[WireField<'_>], required: &[u32]) -> bool {
    required
        .iter()
        .all(|required| fields.iter().any(|(tag, _)| tag == required))
}

/// Top-level field tags; length-delimited payloads are returned for nesting.
fn field_tags(mut bytes: &[u8]) -> Option<Vec<WireField<'_>>> {
    use prost::encoding::{WireType, decode_key, decode_varint};
    let mut tags = Vec::new();
    while !bytes.is_empty() {
        let (tag, wire_type) = decode_key(&mut bytes).ok()?;
        let payload = match wire_type {
            WireType::Varint => {
                decode_varint(&mut bytes).ok()?;
                None
            }
            WireType::SixtyFourBit => {
                bytes = bytes.get(8..)?;
                None
            }
            WireType::ThirtyTwoBit => {
                bytes = bytes.get(4..)?;
                None
            }
            WireType::LengthDelimited => {
                let length = usize::try_from(decode_varint(&mut bytes).ok()?).ok()?;
                let payload = bytes.get(..length)?;
                bytes = &bytes[length..];
                Some(payload)
            }
            // ScalaPB's UnknownFieldSet rejects groups, including well-formed
            // unknown groups. Keep the same behavior (see the Scala fixture corpus).
            WireType::StartGroup | WireType::EndGroup => return None,
        };
        tags.push((tag, payload));
    }
    Some(tags)
}
