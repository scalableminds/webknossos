//! FullMeshService: Draco fragments, indexed 32-cell meshing and iterative 128-cell BFS.
use crate::cache::{DEFAULT_TIME_TO_IDLE, DEFAULT_TIME_TO_LIVE};
use crate::{
    access::TokenContext,
    cache::AlfuCache,
    clients::{tracingstore::TracingstoreClient, wk::WkClient},
    datareaders::RequestedAdditionalCoordinate,
    error::{DsError, DsResult, blocking},
    models::{
        DataSourceId, StaticLayer, UsableDataSource, Vec3Int,
        data_requests::{Cuboid, VoxelPosition},
        datasource::read_unsigned_long,
        json::{Fields, JsResult, read_i32, read_i64, read_list, read_string},
    },
    services::{
        agglomerate::AgglomerateService,
        mesh::ad_hoc::{AdHocMeshRequest, AdHocMeshService, MappingType},
        mesh::file::{ChunkRequest, MeshFileService},
        mesh::geometry::{ad_hoc_to_stl, combine_stl, draco_to_stl, surface_area},
        segment::index::{
            SegmentIndexService, segment_ids_for_agglomerate_id_if_needed,
            top_lefts_to_target_mag_buckets,
        },
    },
};
use futures::{StreamExt, TryStreamExt, stream};
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashSet, sync::Arc};
/// Scala `FullMeshHelper.maxAdHocFullMeshChunks`: upper bound for ad-hoc meshing requests per
/// full mesh, so that huge segments cannot occupy the meshing workers indefinitely.
pub const MAX_AD_HOC_FULL_MESH_CHUNKS: usize = 25000;
/// Scala `FullMeshHelper.adHocChunkSize` (per axis, in the target mag).
const AD_HOC_CHUNK_SIZE: i32 = 128;
fn too_many_ad_hoc_mesh_requests() -> DsError {
    DsError::failure(format!(
        "Segment is too large for ad-hoc full mesh computation (more than \
         {MAX_AD_HOC_FULL_MESH_CHUNKS} meshing requests). Consider computing a mesh file."
    ))
}
#[derive(Debug, Clone, Serialize)]
pub struct FullMeshRequest {
    pub mesh_file_name: Option<String>,
    pub lod: Option<i32>,
    pub segment_id: u64,
    pub mapping_name: Option<String>,
    pub mapping_type: Option<MappingType>,
    pub editable_mapping_tracing_id: Option<String>,
    pub annotation_version: Option<i64>,
    pub mag: Option<Vec3Int>,
    pub seed_position: Option<Vec3Int>,
    pub additional_coordinates: Option<Vec<RequestedAdditionalCoordinate>>,
}
impl FullMeshRequest {
    pub fn from_json(value: &Value) -> JsResult<Self> {
        let mut f = Fields::new(value);
        let file = f.opt("meshFileName", read_string);
        let lod = f.opt("lod", read_i32);
        let segment = f.req("segmentId", read_unsigned_long);
        let mapping = f.opt("mappingName", read_string);
        let kind = f.opt("mappingType", MappingType::from_json);
        let editable = f.opt("editableMappingTracingId", read_string);
        let version = f.opt("annotationVersion", read_i64);
        let mag = f.opt("mag", Vec3Int::from_json);
        let seed = f.opt("seedPosition", Vec3Int::from_json);
        let coordinates = f.opt("additionalCoordinates", |v| {
            read_list(v, RequestedAdditionalCoordinate::from_json)
        });
        f.finish()?;
        Ok(Self {
            mesh_file_name: file?,
            lod: lod?,
            segment_id: segment?,
            mapping_name: mapping?,
            mapping_type: kind?,
            editable_mapping_tracing_id: editable?,
            annotation_version: version?,
            mag: mag?,
            seed_position: seed?,
            additional_coordinates: coordinates?,
        })
    }
}
#[derive(Clone, Hash, PartialEq, Eq)]
struct AreaKey {
    source: DataSourceId,
    dataset: String,
    layer: String,
    request: String,
}
pub struct FullMeshService {
    areas: AlfuCache<AreaKey, f32>,
    mesh_files: Arc<MeshFileService>,
    segment_index: Arc<SegmentIndexService>,
    agglomerates: Arc<AgglomerateService>,
    wk_client: WkClient,
    tracingstore: TracingstoreClient,
    ad_hoc_mesh: Arc<AdHocMeshService>,
    /// Ad-hoc meshing requests in flight per full mesh (the ad-hoc actor pool size).
    ad_hoc_concurrency: usize,
}
impl FullMeshService {
    pub fn new(
        mesh_files: Arc<MeshFileService>,
        segment_index: Arc<SegmentIndexService>,
        agglomerates: Arc<AgglomerateService>,
        wk_client: WkClient,
        tracingstore: TracingstoreClient,
        ad_hoc_mesh: Arc<AdHocMeshService>,
        ad_hoc_concurrency: usize,
    ) -> Self {
        Self {
            areas: AlfuCache::new(10000, DEFAULT_TIME_TO_LIVE, DEFAULT_TIME_TO_IDLE),
            mesh_files,
            segment_index,
            agglomerates,
            wk_client,
            tracingstore,
            ad_hoc_mesh,
            ad_hoc_concurrency: ad_hoc_concurrency.max(1),
        }
    }
    pub fn clear_caches(&self, source: &DataSourceId, layer: Option<&str>) -> usize {
        self.areas
            .clear_matching(|k| k.source == *source && layer.is_none_or(|l| k.layer == l))
    }
    pub async fn load(
        &self,
        dataset: &str,
        source: &UsableDataSource,
        layer: Arc<StaticLayer>,
        request: &FullMeshRequest,
        tc: &TokenContext,
    ) -> DsResult<Vec<u8>> {
        combine_stl(&self.raw_chunks(dataset, source, layer, request, tc).await?)
    }
    pub async fn cached_surface_area(
        &self,
        dataset: &str,
        source: &UsableDataSource,
        layer: Arc<StaticLayer>,
        request: &FullMeshRequest,
        tc: &TokenContext,
    ) -> DsResult<f32> {
        let key = AreaKey {
            source: source.id.clone(),
            dataset: dataset.into(),
            layer: layer.name.clone(),
            request: serde_json::to_string(request).map_err(DsError::from_exception)?,
        };
        self.areas
            .get_or_load(key, || async {
                let chunks = self.raw_chunks(dataset, source, layer, request, tc).await?;
                chunks
                    .iter()
                    .try_fold(0f32, |sum, c| Ok(sum + surface_area(c)?))
            })
            .await
    }
    async fn raw_chunks(
        &self,
        dataset: &str,
        source: &UsableDataSource,
        layer: Arc<StaticLayer>,
        request: &FullMeshRequest,
        tc: &TokenContext,
    ) -> DsResult<Vec<Vec<u8>>> {
        if let Some(name) = request.mesh_file_name.as_deref() {
            let key = MeshFileService::look_up(&source.id, &layer, name)?;
            let mapping = self
                .mesh_files
                .mapping_name(&key, tc.user_token.as_deref())
                .await?;
            let ids = segment_ids_for_agglomerate_id_if_needed(
                &self.agglomerates,
                &self.wk_client,
                &self.tracingstore,
                &source.id,
                &layer,
                request.mapping_name.as_deref(),
                request.editable_mapping_tracing_id.as_deref(),
                request.annotation_version,
                request.segment_id as i64,
                mapping.as_deref(),
                false,
                tc,
            )
            .await?;
            let bits = self
                .mesh_files
                .vertex_quantization_bits(&key, tc.user_token.as_deref())
                .await?;
            let info = self
                .mesh_files
                .list_chunks(&key, &ids, tc.user_token.as_deref())
                .await?;
            let lod = usize::try_from(request.lod.unwrap_or(0))
                .ok()
                .and_then(|i| info.lods.get(i))
                .ok_or_else(|| DsError::failure("Invalid mesh LOD index."))?;
            let scale = std::array::from_fn(|d| lod.transform[d][d]);
            let mut chunks = Vec::new();
            for chunk in &lod.chunks {
                // Preserve Scala's requested-segment addressing in the precomputed branch.
                let range = ChunkRequest {
                    byte_offset: chunk.byte_offset,
                    byte_size: chunk.byte_size,
                    segment_id: Some(request.segment_id),
                };
                let (bytes, encoding) = self
                    .mesh_files
                    .read_chunks(&key, &[range], tc.user_token.as_deref())
                    .await
                    .map_err(|e| e.wrap("Could not load mesh chunk for segment."))?;
                if encoding != "draco" {
                    return Err(DsError::failure(format!(
                        "mesh file encoding is {encoding}, only draco is supported"
                    )));
                }
                let offset = chunk.position;
                let raw = blocking(move || draco_to_stl(&bytes, offset, scale, bits)).await?;
                chunks.push(raw);
            }
            return Ok(chunks);
        }
        let mag = request.mag.ok_or_else(|| {
            DsError::failure("A mag needs to be provided for ad-hoc mesh computation.")
        })?;
        if request.segment_id == 0 {
            return Err(DsError::failure(
                "Cannot compute an ad-hoc mesh for segment id 0.",
            ));
        }
        VoxelPosition::new(Vec3Int::zeros(), mag)?;
        if !layer.is_segmentation() {
            return Err(DsError::failure("Data layer must be a segmentation layer."));
        }
        let vertices: Vec<Vec<f32>> = if layer
            .attachments
            .as_ref()
            .and_then(|a| a.segment_index.as_ref())
            .is_some()
        {
            let key = SegmentIndexService::look_up(&source.id, &layer)?;
            let ids = segment_ids_for_agglomerate_id_if_needed(
                &self.agglomerates,
                &self.wk_client,
                &self.tracingstore,
                &source.id,
                &layer,
                request.mapping_name.as_deref(),
                request.editable_mapping_tracing_id.as_deref(),
                request.annotation_version,
                request.segment_id as i64,
                None,
                false,
                tc,
            )
            .await?;
            let mut top_lefts = Vec::new();
            for id in ids {
                top_lefts.extend(
                    self.segment_index
                        .read_segment_index(&key, id, tc.user_token.as_deref())
                        .await?,
                );
            }
            let buckets = top_lefts_to_target_mag_buckets(&top_lefts, mag);
            if buckets.len() > MAX_AD_HOC_FULL_MESH_CHUNKS {
                return Err(too_many_ad_hoc_mesh_requests());
            }
            let positions = buckets
                .into_iter()
                .map(|p| {
                    let axis = |p: i32, m: i32| {
                        p.checked_mul(m)
                            .and_then(|p| p.checked_mul(32))
                            .ok_or_else(|| DsError::failure("Mesh bucket coordinate overflow."))
                    };
                    VoxelPosition::new(
                        Vec3Int::new(axis(p.x, mag.x)?, axis(p.y, mag.y)?, axis(p.z, mag.z)?),
                        mag,
                    )
                })
                .collect::<DsResult<Vec<_>>>()?;
            self.batch(dataset, source, &layer, request, positions, 33, false, tc)
                .await?
                .into_iter()
                .map(|(v, _)| v)
                .collect()
        } else {
            let seed = request.seed_position.ok_or_else(|| {
                DsError::failure(
                    "A seed position needs to be provided for ad-hoc mesh computation.",
                )
            })?;
            let mut frontier = vec![VoxelPosition::new(seed, mag)?];
            let mut visited = HashSet::new();
            let mut waves = Vec::new();
            const NEIGHBORS: [[i32; 3]; 6] = [
                [0, 0, -1],
                [0, -1, 0],
                [-1, 0, 0],
                [0, 0, 1],
                [0, 1, 0],
                [1, 0, 0],
            ];
            while !frontier.is_empty() {
                if visited.len() + frontier.len() > MAX_AD_HOC_FULL_MESH_CHUNKS {
                    return Err(too_many_ad_hoc_mesh_requests());
                }
                visited.extend(frontier.iter().copied());
                let results = self
                    .batch(
                        dataset,
                        source,
                        &layer,
                        request,
                        frontier.clone(),
                        AD_HOC_CHUNK_SIZE + 1,
                        true,
                        tc,
                    )
                    .await?;
                let mut next = Vec::new();
                let mut seen = HashSet::new();
                let mut wave = Vec::new();
                for (position, (vertices, neighbors)) in frontier.into_iter().zip(results) {
                    wave.push(vertices);
                    for neighbor in neighbors {
                        let delta = NEIGHBORS[neighbor as usize];
                        let axis = |p: i32, m: i32, d: i32| {
                            d.checked_mul(AD_HOC_CHUNK_SIZE)
                                .and_then(|d| d.checked_mul(m))
                                .and_then(|d| p.checked_add(d))
                                .ok_or_else(|| {
                                    DsError::failure("Mesh neighbor coordinate overflow.")
                                })
                        };
                        let p = VoxelPosition::new(
                            Vec3Int::new(
                                axis(position.mag1.x, mag.x, delta[0])?,
                                axis(position.mag1.y, mag.y, delta[1])?,
                                axis(position.mag1.z, mag.z, delta[2])?,
                            ),
                            mag,
                        )?;
                        // Scala `FullMeshHelper.chunkIntersects`: only chunks intersecting the layer
                        // bounding box are meshed. A chunk whose end overflows i32 lies beyond any
                        // layer bounding box.
                        let intersects = Cuboid::new(p, Vec3Int::full(AD_HOC_CHUNK_SIZE))
                            .mag1_bounding_box()
                            .is_ok_and(|bounds| bounds.intersects(&layer.bounding_box));
                        if intersects && !visited.contains(&p) && seen.insert(p) {
                            next.push(p);
                        }
                    }
                }
                waves.push(wave);
                frontier = next;
            }
            waves.into_iter().rev().flatten().collect()
        };
        vertices.iter().map(|v| ad_hoc_to_stl(v)).collect()
    }
    #[allow(clippy::too_many_arguments)]
    async fn batch(
        &self,
        dataset: &str,
        source: &UsableDataSource,
        layer: &Arc<StaticLayer>,
        full: &FullMeshRequest,
        positions: Vec<VoxelPosition>,
        size: i32,
        neighbors: bool,
        tc: &TokenContext,
    ) -> DsResult<Vec<(Vec<f32>, Vec<i32>)>> {
        let requests = positions.into_iter().map(|position| {
            self.ad_hoc_mesh.generate(
                AdHocMeshRequest {
                    dataset_id: Some(dataset.into()),
                    data_source_id: Some(source.id.clone()),
                    layer: Arc::clone(layer),
                    cuboid: Cuboid::new(position, Vec3Int::full(size)),
                    segment_id: full.segment_id,
                    voxel_size_factor: source.scale.factor,
                    mapping: full.mapping_name.clone(),
                    mapping_type: full.mapping_type,
                    additional_coordinates: full.additional_coordinates.clone(),
                    annotation_version: full.annotation_version,
                    find_neighbors: neighbors,
                },
                tc.user_token.as_deref(),
            )
        });
        stream::iter(requests)
            .buffered(self.ad_hoc_concurrency)
            .try_collect()
            .await
    }
}
