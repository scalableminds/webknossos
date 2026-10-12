//! Scala BinaryDataService: cached bucket reads, cuboid assembly, bounding-box clipping and packing.
use crate::{
    HealthProblems,
    datareaders::{
        ChunkContentsCache,
        bucket_provider::{BucketProvider, DatasetArrayBucketProvider},
        index_cache::IndexCache,
    },
    datavault::{BoxFuture, DataVaultService, VaultError, VaultResult},
    error::{DsError, DsResult},
    models::{
        BUCKET_LENGTH, BoundingBox, DataFormat, DataSourceId, Vec3Int,
        data_requests::{BucketPosition, DataReadInstruction, DataServiceDataRequest},
    },
    services::dataset_errors::DatasetErrorLoggingService,
};
use futures::{StreamExt, stream};
use std::sync::Arc;
/// DS5 injects the real agglomerate service here; absent service fails an applicable mapping request.
pub trait AgglomerateMapper: Send + Sync {
    fn apply<'a>(
        &'a self,
        request: &'a DataServiceDataRequest,
        input: Vec<u8>,
        token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<Vec<u8>>>;
    fn clear_caches(&self, _id: &DataSourceId, _layer: Option<&str>) -> usize {
        0
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataResponse {
    pub data: Vec<u8>,
    pub missing_indices: Vec<usize>,
    pub failed_indices: Vec<usize>,
}
pub struct BinaryDataService {
    vaults: DataVaultService,
    chunks: Arc<ChunkContentsCache>,
    providers: IndexCache<Arc<dyn BucketProvider>>,
    mapper: Option<Arc<dyn AgglomerateMapper>>,
    pub errors: DatasetErrorLoggingService,
}
impl BinaryDataService {
    pub const MAX_MAG_FOR_AGGLOMERATE_MAPPING: i32 = 16;
    pub fn new(
        vaults: DataVaultService,
        chunks: Arc<ChunkContentsCache>,
        health: HealthProblems,
        mapper: Option<Arc<dyn AgglomerateMapper>>,
    ) -> Self {
        Self {
            vaults,
            chunks,
            providers: IndexCache::with_capacity(5000),
            mapper,
            errors: DatasetErrorLoggingService::new(health),
        }
    }
    pub fn cached_provider_count(&self) -> usize {
        self.providers.len()
    }
    fn provider_key(id: &DataSourceId, layer: &str) -> String {
        serde_json::to_string(&[&id.organization_id, &id.directory_name, layer])
            .expect("string array serializes")
    }
    async fn provider(
        &self,
        r: &DataServiceDataRequest,
    ) -> VaultResult<Arc<Arc<dyn BucketProvider>>> {
        let id = r.data_source_id_or_volume_dummy();
        let key = Self::provider_key(&id, &r.data_layer.name);
        self.providers
            .get_or_load(&key, || async {
                let provider: Arc<dyn BucketProvider> = Arc::new(DatasetArrayBucketProvider::new(
                    Arc::clone(&r.data_layer),
                    id,
                    self.vaults.clone(),
                    Arc::clone(&self.chunks),
                ));
                Ok(provider)
            })
            .await
    }
    fn validate_request(r: &DataServiceDataRequest) -> DsResult<()> {
        r.cuboid.volume()?;
        r.cuboid.bottom_right()?;
        if r.data_layer.data_format == DataFormat::Tracing {
            return Err(DsError::failure(
                "Tracing buckets require the tracingstore bucket provider",
            ));
        }
        Ok(())
    }
    fn checked_bucket_buffer(
        r: &DataServiceDataRequest,
        result: VaultResult<Vec<u8>>,
    ) -> VaultResult<Vec<u8>> {
        let expected = (BUCKET_LENGTH as usize).pow(3) * r.data_layer.bytes_per_element();
        match result {
            Ok(data) if !data.is_empty() && data.len() != expected => {
                Err(VaultError::failure(format!(
                    "Unexpected bucket byte count: expected {expected}, got {}",
                    data.len()
                )))
            }
            other => other,
        }
    }
    async fn load_bucket(
        &self,
        r: &DataServiceDataRequest,
        mut bucket: BucketPosition,
        token: Option<&str>,
    ) -> VaultResult<Vec<u8>> {
        if !r.data_layer.contains_mag(bucket.mag()) {
            return Err(VaultError::NotFound);
        }
        bucket.additional_coordinates = r.settings.additional_coordinates.clone();
        let provider = self.provider(r).await?;
        let id = r.data_source_id_or_volume_dummy();
        let instruction = DataReadInstruction {
            data_source_id: id.clone(),
            data_layer: Arc::clone(&r.data_layer),
            bucket,
            version: r.settings.version,
        };
        self.errors.check(
            &id,
            r.dataset_id.as_deref(),
            "loading bucket",
            Self::checked_bucket_buffer(r, provider.load(&instruction, token).await),
        )
    }
    async fn load_cuboid(
        &self,
        r: &DataServiceDataRequest,
        token: Option<&str>,
    ) -> VaultResult<Vec<u8>> {
        Self::validate_request(r)?;
        if r.cuboid.is_single_bucket() {
            return self
                .load_bucket(r, r.cuboid.top_left.to_bucket(), token)
                .await;
        }
        let size = r
            .cuboid
            .volume()?
            .checked_mul(r.data_layer.bytes_per_element())
            .ok_or_else(|| DsError::failure("Cuboid byte size overflow"))?;
        let mut result = vec![0; size];
        let mut loads = stream::iter(r.cuboid.buckets()?)
            .map(|next| async move {
                let bucket = next?;
                self.load_bucket(r, bucket.clone(), token)
                    .await
                    .map(|data| (bucket, data))
            })
            .buffered(16);
        // Scala flattens successful bucket boxes. Stream the same disjoint rows into the
        // result, bounding live bucket buffers instead of retaining all loaded buckets.
        while let Some(loaded) = loads.next().await {
            match loaded {
                Ok((bucket, data)) => copy_bucket_rows(r, &bucket, &data, &mut result)?,
                Err(VaultError::Failure(e))
                    if e.status == axum::http::StatusCode::NOT_IMPLEMENTED =>
                {
                    return Err(VaultError::Failure(e));
                }
                _ => {}
            }
        }
        Ok(result)
    }
    /// Read + clip + optional mapping + half-byte conversion. HTTP handlers use this API.
    pub async fn read(
        &self,
        r: &DataServiceDataRequest,
        token: Option<&str>,
    ) -> VaultResult<Vec<u8>> {
        let data = self.load_cuboid(r, token).await?;
        self.convert_according_to_request(r, data, token).await
    }
    async fn convert_according_to_request(
        &self,
        r: &DataServiceDataRequest,
        input: Vec<u8>,
        token: Option<&str>,
    ) -> VaultResult<Vec<u8>> {
        let id = r.data_source_id_or_volume_dummy();
        let expected = r
            .cuboid
            .volume()?
            .checked_mul(r.data_layer.bytes_per_element())
            .ok_or_else(|| DsError::failure("Cuboid byte size overflow"))?;
        if input.len() != expected {
            return self.errors.check(
                &id,
                r.dataset_id.as_deref(),
                "checking cuboid size",
                Err(VaultError::failure(format!(
                    "Unexpected cuboid byte count: expected {expected}, got {}",
                    input.len()
                ))),
            );
        }
        let mut data = if !r
            .cuboid
            .mag1_bounding_box()?
            .is_fully_contained_in(&r.data_layer.bounding_box)
        {
            self.errors.check_conversion(
                &id,
                r.dataset_id.as_deref(),
                clip_to_layer_bounding_box(r, &input),
            )?
        } else {
            input
        };
        if r.settings.applied_agglomerate.is_some()
            && r.data_layer.is_segmentation()
            && r.cuboid.mag().max_dim() <= Self::MAX_MAG_FOR_AGGLOMERATE_MAPPING
        {
            let mapper = self.mapper.as_ref().ok_or_else(|| {
                VaultError::Failure(
                    DsError::failure("Agglomerate mapping service is not configured")
                        .wrap("Failed to apply agglomerate mapping"),
                )
            })?;
            data = self.errors.check(
                &id,
                r.dataset_id.as_deref(),
                "converting bucket data",
                mapper.apply(r, data, token).await,
            )?;
            if data.len() != expected {
                return Err(VaultError::failure(
                    "Mapped data has an unexpected byte count",
                ));
            }
        }
        if r.settings.half_byte {
            data = convert_to_half_byte(&data);
        }
        Ok(data)
    }
    /// Scala handleDataRequests: concatenate successful requests in order and retain both index lists.
    pub async fn handle_data_requests(
        &self,
        requests: &[DataServiceDataRequest],
        token: Option<&str>,
    ) -> DataResponse {
        // Construct futures before the stream so its Send bound does not depend on a
        // higher-ranked closure over borrowed requests (required by Axum handlers).
        let mut reads = Vec::with_capacity(requests.len());
        for request in requests {
            reads.push(self.read(request, token));
        }
        let outcomes = stream::iter(reads).buffered(16);
        futures::pin_mut!(outcomes);
        let mut result = DataResponse {
            data: Vec::new(),
            missing_indices: Vec::new(),
            failed_indices: Vec::new(),
        };
        let mut index = 0;
        while let Some(outcome) = outcomes.next().await {
            match outcome {
                Ok(data) => result.data.extend(data),
                Err(VaultError::NotFound) => result.missing_indices.push(index),
                Err(VaultError::Failure(_)) => result.failed_indices.push(index),
            }
            index += 1;
        }
        result
    }
    /// Scala optimized bucket batch: one provider, serial loads, independent results.
    pub async fn handle_multiple_bucket_requests(
        &self,
        requests: &[DataServiceDataRequest],
        token: Option<&str>,
    ) -> DsResult<Vec<VaultResult<Vec<u8>>>> {
        let Some(first) = requests.first() else {
            return Ok(Vec::new());
        };
        if requests.iter().any(|r| !r.cuboid.is_single_bucket()) {
            return Err(DsError::failure(
                "data requests handed to handleMultipleBucketRequests don’t contain bucket requests",
            ));
        }
        let id = first.data_source_id_or_volume_dummy();
        if requests
            .iter()
            .any(|r| r.data_layer != first.data_layer || r.data_source_id_or_volume_dummy() != id)
        {
            return Err(DsError::failure(
                "Expected one unique layer and data source",
            ));
        }
        for r in requests {
            Self::validate_request(r)?;
        }
        let mut selected = Vec::new();
        let mut selected_requests = Vec::new();
        for r in requests {
            if r.data_layer.contains_mag(r.cuboid.mag()) {
                let mut bucket = r.cuboid.top_left.to_bucket();
                bucket.additional_coordinates = r.settings.additional_coordinates.clone();
                selected.push(DataReadInstruction {
                    data_source_id: id.clone(),
                    data_layer: Arc::clone(&r.data_layer),
                    bucket,
                    version: r.settings.version,
                });
                selected_requests.push(r);
            }
        }
        let provider = self.provider(first).await.map_err(DsError::from)?;
        let raw = provider.load_multiple(&selected, token).await;
        let mut converted = Vec::with_capacity(raw.len());
        for (r, outcome) in selected_requests.into_iter().zip(raw) {
            let data = self.errors.check(
                &id,
                first.dataset_id.as_deref(),
                "loading multiple buckets",
                Self::checked_bucket_buffer(r, outcome),
            );
            converted.push(match data {
                Ok(data) => self.convert_according_to_request(r, data, token).await,
                Err(e) => Err(e),
            });
        }
        let mut converted = converted.into_iter();
        let mut result = Vec::with_capacity(requests.len());
        for r in requests {
            if r.data_layer.contains_mag(r.cuboid.mag()) {
                result.push(converted.next().ok_or_else(|| {
                    DsError::failure("Returned bucket count does not match request count.")
                })?);
            } else {
                result.push(Err(VaultError::NotFound));
            }
        }
        Ok(result)
    }
    pub fn clear_cache(
        &self,
        organization: &str,
        directory: &str,
        layer: Option<&str>,
    ) -> (usize, usize, usize) {
        let id = DataSourceId::new(directory, organization);
        // Account for shared chunks before mapper invalidation clears the same source scope.
        let chunks = self.chunks.clear_for_source(&id, layer);
        let closed = self
            .mapper
            .as_ref()
            .map_or(0, |m| m.clear_caches(&id, layer));
        let removed = self.providers.clear_matching(|key| {
            serde_json::from_str::<Vec<String>>(key).is_ok_and(|k| {
                k.len() == 3
                    && k[0] == organization
                    && k[1] == directory
                    && layer.is_none_or(|layer| k[2] == layer)
            })
        });
        self.errors.clear_for_dataset(&id);
        (closed, removed, chunks)
    }
}
/// Expose only the layer bbox. Batched additional-axis reads use output z for the batch.
pub fn clip_to_layer_bounding_box(r: &DataServiceDataRequest, input: &[u8]) -> DsResult<Vec<u8>> {
    let expected = r
        .cuboid
        .volume()?
        .checked_mul(r.data_layer.bytes_per_element())
        .ok_or_else(|| DsError::failure("Cuboid byte size overflow"))?;
    r.cuboid.bottom_right()?;
    if input.len() != expected {
        return Err(DsError::failure(
            "Unexpected cuboid byte count while clipping",
        ));
    }
    let layer = &r.data_layer.bounding_box;
    for (top, size) in [
        (layer.top_left.x, layer.width),
        (layer.top_left.y, layer.height),
        (layer.top_left.z, layer.depth),
    ] {
        if size < 0 || top.checked_add(size).is_none() {
            return Err(DsError::failure("Invalid layer bounding box"));
        }
    }
    let request = r.cuboid.bounding_box_in_mag();
    let mag = r.cuboid.mag();
    let ceil = |size: i32, m: i32| ((i64::from(size) + i64::from(m) - 1) / i64::from(m)) as i32;
    let mut bbox = BoundingBox::new(
        layer.top_left / mag,
        ceil(layer.width, mag.x),
        ceil(layer.height, mag.y),
        ceil(layer.depth, mag.z),
    );
    if r.is_batched_additional_coordinate_request() {
        bbox.top_left.z = request.top_left.z;
        bbox.depth = request.depth;
    }
    let mut out = vec![0; input.len()];
    let Some(intersection) = request
        .intersection(&bbox)
        .map(|b| b.moved(-request.top_left))
    else {
        return Ok(out);
    };
    copy_rows(
        input,
        &mut out,
        &intersection,
        request.width,
        request.height,
        r.data_layer.bytes_per_element(),
    )?;
    Ok(out)
}
fn copy_rows(
    input: &[u8],
    out: &mut [u8],
    bbox: &BoundingBox,
    width: i32,
    height: i32,
    bytes: usize,
) -> DsResult<()> {
    let bottom = bbox.bottom_right();
    for z in bbox.top_left.z..bottom.z {
        for y in bbox.top_left.y..bottom.y {
            let index = (i64::from(bbox.top_left.x)
                + i64::from(y) * i64::from(width)
                + i64::from(z) * i64::from(width) * i64::from(height))
                as usize;
            let offset = index
                .checked_mul(bytes)
                .ok_or_else(|| DsError::failure("Row offset overflow"))?;
            let size = (bottom.x - bbox.top_left.x) as usize * bytes;
            let from = input.get(offset..offset + size).ok_or_else(|| {
                DsError::failure("Input data is smaller than the requested clipping row")
            })?;
            out.get_mut(offset..offset + size)
                .ok_or_else(|| DsError::failure("Clipping row exceeds output size"))?
                .copy_from_slice(from);
        }
    }
    Ok(())
}
pub fn cut_out_cuboid(
    r: &DataServiceDataRequest,
    loaded: Vec<(BucketPosition, Vec<u8>)>,
) -> DsResult<Vec<u8>> {
    let bytes = r.data_layer.bytes_per_element();
    let volume = r.cuboid.volume()?;
    let mut out = vec![
        0;
        volume
            .checked_mul(bytes)
            .ok_or_else(|| DsError::failure("Cuboid byte size overflow"))?
    ];
    for (bucket, data) in loaded.into_iter().rev() {
        copy_bucket_rows(r, &bucket, &data, &mut out)?;
    }
    Ok(out)
}
fn copy_bucket_rows(
    r: &DataServiceDataRequest,
    bucket: &BucketPosition,
    data: &[u8],
    out: &mut [u8],
) -> DsResult<()> {
    let bytes = r.data_layer.bytes_per_element();
    let top = r.cuboid.top_left.in_mag();
    let bottom = r.cuboid.bottom_right()?.in_mag();
    let width = r.cuboid.width;
    let height = r.cuboid.height;
    {
        let p = bucket.top_left()?.in_mag();
        let min = Vec3Int::new(
            0.max(top.x.max(p.x)),
            0.max(top.y.max(p.y)),
            0.max(top.z.max(p.z)),
        );
        let max = Vec3Int::new(
            0.max(bottom.x.min(p.x.saturating_add(BUCKET_LENGTH))),
            0.max(bottom.y.min(p.y.saturating_add(BUCKET_LENGTH))),
            0.max(bottom.z.min(p.z.saturating_add(BUCKET_LENGTH))),
        );
        if max.x <= min.x || max.y <= min.y || max.z <= min.z {
            return Ok(());
        }
        let size = (max.x - min.x) as usize * bytes;
        for z in min.z..max.z {
            for y in min.y..max.y {
                let from = ((min.x % BUCKET_LENGTH)
                    + (y % BUCKET_LENGTH) * BUCKET_LENGTH
                    + (z % BUCKET_LENGTH) * BUCKET_LENGTH * BUCKET_LENGTH)
                    as usize
                    * bytes;
                let position = i64::from(min.x - top.x)
                    + i64::from(y - top.y) * i64::from(width)
                    + i64::from(z - top.z) * i64::from(width) * i64::from(height);
                let to = usize::try_from(position)
                    .ok()
                    .and_then(|n| n.checked_mul(bytes))
                    .ok_or_else(|| DsError::failure("Cuboid row offset overflow"))?;
                let source = data.get(from..from + size).ok_or_else(|| {
                    DsError::failure("Bucket data is smaller than the requested cuboid row")
                })?;
                out.get_mut(to..to + size)
                    .ok_or_else(|| DsError::failure("Cuboid row exceeds output size"))?
                    .copy_from_slice(source);
            }
        }
    }
    Ok(())
}
/// Scala packs high nibbles; an odd trailing input byte is left as zero in the last output byte.
pub fn convert_to_half_byte(input: &[u8]) -> Vec<u8> {
    let mut result = vec![0; input.len().div_ceil(2)];
    for (i, pair) in input.as_chunks::<2>().0.iter().enumerate() {
        result[i] = (pair[0] & 0xf0) | ((pair[1] >> 4) & 0x0f);
    }
    result
}
