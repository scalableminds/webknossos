//! Scala DatasetArrayBucketProvider: all static formats, credentialized paths, 50-mag cache.
use crate::{
    datareaders::{
        ChunkContentsCache, DatasetArray, index_cache::IndexCache, n5::open_n5_array,
        precomputed::open_precomputed_array, wkw::open_wkw_array, zarr::open_zarr_array,
        zarr3::open_zarr3_array,
    },
    datavault::{BoxFuture, DataVaultService, VaultError, VaultResult},
    error::DsError,
    models::{
        BUCKET_LENGTH, DataFormat, DataSourceId, ElementClass, StaticLayer,
        data_requests::DataReadInstruction,
    },
};
use std::{sync::Arc, time::Instant};
pub trait BucketProvider: Send + Sync {
    fn load<'a>(
        &'a self,
        instruction: &'a DataReadInstruction,
        token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<Vec<u8>>>;
    fn load_multiple<'a>(
        &'a self,
        instructions: &'a [DataReadInstruction],
        token: Option<&'a str>,
    ) -> BoxFuture<'a, Vec<VaultResult<Vec<u8>>>> {
        Box::pin(async move {
            let mut out = Vec::with_capacity(instructions.len());
            for i in instructions {
                out.push(self.load(i, token).await);
            }
            out
        })
    }
}
pub struct DatasetArrayBucketProvider {
    layer: Arc<StaticLayer>,
    id: DataSourceId,
    vaults: DataVaultService,
    chunks: Arc<ChunkContentsCache>,
    arrays: IndexCache<DatasetArray>,
}
impl DatasetArrayBucketProvider {
    pub fn new(
        layer: Arc<StaticLayer>,
        id: DataSourceId,
        vaults: DataVaultService,
        chunks: Arc<ChunkContentsCache>,
    ) -> Self {
        Self {
            layer,
            id,
            vaults,
            chunks,
            arrays: IndexCache::with_capacity(50),
        }
    }
    pub fn cached_array_count(&self) -> usize {
        self.arrays.len()
    }
    async fn array(
        &self,
        i: &DataReadInstruction,
        token: Option<&str>,
    ) -> VaultResult<Arc<DatasetArray>> {
        let mag = i.bucket.mag();
        let key = mag.to_mag_literal(false);
        self.arrays
            .get_or_load(&key, || async {
                let locator = self
                    .layer
                    .mags
                    .iter()
                    .find(|m| m.mag == mag)
                    .ok_or(VaultError::NotFound)?;
                if locator.path.is_none() {
                    return Err(VaultError::NotFound);
                }
                let path = self
                    .vaults
                    .vault_path_for_mag(locator)
                    .await
                    .map_err(VaultError::from)?;
                let before = Instant::now();
                let result = match self.layer.data_format {
                    DataFormat::Wkw => {
                        open_wkw_array(
                            &path,
                            self.id.clone(),
                            &self.layer.name,
                            Arc::clone(&self.chunks),
                            token,
                        )
                        .await
                    }
                    DataFormat::Zarr => {
                        open_zarr_array(
                            &path,
                            self.id.clone(),
                            &self.layer.name,
                            locator.axis_order,
                            locator.channel_index,
                            self.layer.additional_axes.clone(),
                            Arc::clone(&self.chunks),
                            token,
                        )
                        .await
                    }
                    DataFormat::Zarr3 => {
                        open_zarr3_array(
                            &path,
                            self.id.clone(),
                            &self.layer.name,
                            locator.axis_order,
                            locator.channel_index,
                            self.layer.additional_axes.clone(),
                            Arc::clone(&self.chunks),
                            token,
                        )
                        .await
                    }
                    DataFormat::N5 => {
                        open_n5_array(
                            &path,
                            self.id.clone(),
                            &self.layer.name,
                            locator.axis_order,
                            locator.channel_index,
                            self.layer.additional_axes.clone(),
                            Arc::clone(&self.chunks),
                            token,
                        )
                        .await
                    }
                    DataFormat::NeuroglancerPrecomputed => {
                        open_precomputed_array(
                            &path,
                            self.id.clone(),
                            &self.layer.name,
                            locator.axis_order,
                            locator.channel_index,
                            self.layer.additional_axes.clone(),
                            Arc::clone(&self.chunks),
                            token,
                        )
                        .await
                    }
                    DataFormat::Tracing => Err(DsError::failure(format!(
                        "Cannot open {} layer “{}” as DatasetArray",
                        self.layer.data_format, self.layer.name,
                    ))),
                };
                if before.elapsed().as_secs() >= 1 {
                    tracing::warn!(source=%self.id, layer=%self.layer.name,
                        elapsed=?before.elapsed(), "Opening DatasetArray was slow");
                }
                result.map_err(VaultError::from)
            })
            .await
    }
}
impl BucketProvider for DatasetArrayBucketProvider {
    fn load<'a>(
        &'a self,
        i: &'a DataReadInstruction,
        token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<Vec<u8>>> {
        Box::pin(async move {
            let array = self.array(i, token).await?;
            array
                .read_bytes_with_additional_coordinates(
                    i.bucket.top_left().map_err(VaultError::from)?.in_mag(),
                    crate::models::Vec3Int::full(BUCKET_LENGTH),
                    i.bucket.additional_coordinates.as_deref(),
                    self.layer.element_class == ElementClass::Uint24,
                    token,
                )
                .await
                .map_err(VaultError::from)
        })
    }
}
