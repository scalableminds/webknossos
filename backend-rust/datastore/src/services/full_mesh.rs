//! FullMeshService: Draco fragments, indexed 32-cell meshing and iterative 128-cell BFS.
use crate::{
    AppState,
    access::TokenContext,
    datareaders::RequestedAdditionalCoordinate,
    error::{DsError, DsResult},
    models::{
        DataSourceId, StaticLayer, UsableDataSource, Vec3Int,
        data_requests::{Cuboid, VoxelPosition},
        datasource::read_unsigned_long,
        json::{Fields, JsResult, read_i32, read_i64, read_list, read_string},
    },
    services::{
        ad_hoc_mesh::{AdHocMeshRequest, MappingType},
        mesh_file::{ChunkRequest, MeshFileService},
        mesh_geometry::{ad_hoc_to_stl, combine_stl, draco_to_stl, surface_area},
        segment_index::{
            SegmentIndexService, segment_ids_for_agglomerate_id_if_needed,
            top_lefts_to_target_mag_buckets,
        },
    },
    wk_client::AlfuCache,
};
use futures::{StreamExt, TryStreamExt, stream};
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashSet, sync::Arc, time::Duration};
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
}
impl Default for FullMeshService {
    fn default() -> Self {
        Self {
            areas: AlfuCache::new(10000, Duration::from_secs(7200), Duration::from_secs(3600)),
        }
    }
}
impl FullMeshService {
    pub fn clear_caches(&self, source: &DataSourceId, layer: Option<&str>) -> usize {
        self.areas
            .clear_matching(|k| k.source == *source && layer.is_none_or(|l| k.layer == l))
    }
    pub async fn load(
        state: &AppState,
        dataset: &str,
        source: &UsableDataSource,
        layer: Arc<StaticLayer>,
        request: &FullMeshRequest,
        tc: &TokenContext,
    ) -> DsResult<Vec<u8>> {
        combine_stl(&raw_chunks(state, dataset, source, layer, request, tc).await?)
    }
    pub async fn cached_surface_area(
        &self,
        state: &AppState,
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
                let chunks = raw_chunks(state, dataset, source, layer, request, tc).await?;
                chunks
                    .iter()
                    .try_fold(0f32, |sum, c| Ok(sum + surface_area(c)?))
            })
            .await
    }
}
async fn raw_chunks(
    state: &AppState,
    dataset: &str,
    source: &UsableDataSource,
    layer: Arc<StaticLayer>,
    request: &FullMeshRequest,
    tc: &TokenContext,
) -> DsResult<Vec<Vec<u8>>> {
    if let Some(name) = request.mesh_file_name.as_deref() {
        let key = MeshFileService::look_up(&source.id, &layer, name)?;
        let mapping = state
            .mesh_files
            .mapping_name(&key, tc.user_token.as_deref())
            .await?;
        let ids = segment_ids_for_agglomerate_id_if_needed(
            &state.agglomerates,
            &state.wk_client,
            &state.tracingstore,
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
        let bits = state
            .mesh_files
            .vertex_quantization_bits(&key, tc.user_token.as_deref())
            .await?;
        let info = state
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
            let (bytes, encoding) = state
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
            let raw =
                tokio::task::spawn_blocking(move || draco_to_stl(&bytes, offset, scale, bits))
                    .await
                    .map_err(DsError::from_exception)??;
            chunks.push(raw);
        }
        return Ok(chunks);
    }
    let mag = request.mag.ok_or_else(|| {
        DsError::failure("A mag needs to be provided for ad-hoc mesh computation.")
    })?;
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
            &state.agglomerates,
            &state.wk_client,
            &state.tracingstore,
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
                state
                    .segment_index
                    .read_segment_index(&key, id, tc.user_token.as_deref())
                    .await?,
            );
        }
        let buckets = top_lefts_to_target_mag_buckets(&top_lefts, mag);
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
        batch(
            state, dataset, source, &layer, request, positions, 33, false, tc,
        )
        .await?
        .into_iter()
        .map(|(v, _)| v)
        .collect()
    } else {
        let seed = request.seed_position.ok_or_else(|| {
            DsError::failure("A seed position needs to be provided for ad-hoc mesh computation.")
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
            visited.extend(frontier.iter().copied());
            let results = batch(
                state,
                dataset,
                source,
                &layer,
                request,
                frontier.clone(),
                129,
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
                        d.checked_mul(128)
                            .and_then(|d| d.checked_mul(m))
                            .and_then(|d| p.checked_add(d))
                            .ok_or_else(|| DsError::failure("Mesh neighbor coordinate overflow."))
                    };
                    let p = VoxelPosition::new(
                        Vec3Int::new(
                            axis(position.mag1.x, mag.x, delta[0])?,
                            axis(position.mag1.y, mag.y, delta[1])?,
                            axis(position.mag1.z, mag.z, delta[2])?,
                        ),
                        mag,
                    )?;
                    // BinaryDataService clips to the layer bounds. Outside cuboids cannot
                    // contribute segment geometry; bounding traversal also makes background
                    // meshing finite (Scala otherwise follows zero-filled space forever).
                    let bounds = Cuboid::new(p, Vec3Int::full(129)).mag1_bounding_box()?;
                    if bounds.intersects(&layer.bounding_box)
                        && !visited.contains(&p)
                        && seen.insert(p)
                    {
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
    state: &AppState,
    dataset: &str,
    source: &UsableDataSource,
    layer: &Arc<StaticLayer>,
    full: &FullMeshRequest,
    positions: Vec<VoxelPosition>,
    size: i32,
    neighbors: bool,
    tc: &TokenContext,
) -> DsResult<Vec<(Vec<f32>, Vec<i32>)>> {
    let limit = (state.config.ad_hoc_mesh.actor_pool_size as usize).max(1);
    let requests = positions.into_iter().map(|position| {
        state.ad_hoc_mesh.generate(
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
    stream::iter(requests).buffered(limit).try_collect().await
}
