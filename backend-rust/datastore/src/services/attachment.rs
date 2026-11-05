//! Scaffolding shared by the services reading layer attachments (Zarr3 groups, local HDF5 files).
use crate::{
    cache::AlfuCache,
    datareaders::{
        ArrayAxes, ArraySource, ChunkContentsCache, DatasetArray, zarr3::open_zarr3_array,
    },
    datavault::{ByteRange, DataVaultService, VaultError},
    error::{DsError, DsResult},
    models::{DataSourceId, LayerAttachment, StaticLayer, UPath},
};
use serde_json::Value;
use std::sync::Arc;

/// Scala `MeshFileKey`, `ConnectomeFileKey`, `SegmentIndexFileKey`, `AgglomerateFileKey`, ...
#[derive(Debug, Clone, PartialEq)]
pub struct AttachmentFileKey {
    pub source: DataSourceId,
    pub layer: String,
    pub attachment: LayerAttachment,
}

/// Cache identity of an [`AttachmentFileKey`]: the attachment without its data format.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AttachmentId {
    source: DataSourceId,
    layer: String,
    name: String,
    path: UPath,
    credential_id: Option<String>,
}

impl AttachmentFileKey {
    /// Scala `lookUp*FileKey`: `kind` names the file in the relative-path failure.
    pub fn new(
        source: &DataSourceId,
        layer: &StaticLayer,
        attachment: LayerAttachment,
        kind: &str,
    ) -> DsResult<Self> {
        if !attachment.path.is_absolute() {
            return Err(DsError::failure(format!(
                "Path of {kind} file is ambiguous, must be absolute."
            )));
        }
        Ok(Self {
            source: source.clone(),
            layer: layer.name.clone(),
            attachment,
        })
    }

    pub fn id(&self) -> AttachmentId {
        AttachmentId {
            source: self.source.clone(),
            layer: self.layer.clone(),
            name: self.attachment.name.clone(),
            path: self.attachment.path.clone(),
            credential_id: self.attachment.credential_id.clone(),
        }
    }

    /// [`Self::id`] ignoring the credential, for caches of local files read without one.
    pub fn local_id(&self) -> AttachmentId {
        AttachmentId {
            credential_id: None,
            ..self.id()
        }
    }
}

impl AttachmentId {
    pub fn belongs_to(&self, source: &DataSourceId, layer: Option<&str>) -> bool {
        self.source == *source && layer.is_none_or(|layer| layer == self.layer)
    }
}

/// Zarr3 attachment groups: their cached arrays and `zarr.json` attributes.
pub struct AttachmentArrays {
    pub vaults: DataVaultService,
    chunks: Arc<ChunkContentsCache>,
    arrays: AlfuCache<(AttachmentId, String), Arc<DatasetArray>>,
}

impl AttachmentArrays {
    pub fn new(vaults: DataVaultService, chunks: Arc<ChunkContentsCache>) -> Self {
        Self {
            vaults,
            chunks,
            arrays: AlfuCache::with_defaults(),
        }
    }

    /// The array `name` of the attachment group.
    pub async fn get(
        &self,
        key: &AttachmentFileKey,
        name: &str,
        token: Option<&str>,
    ) -> DsResult<Arc<DatasetArray>> {
        self.arrays
            .get_or_load((key.id(), name.into()), || async {
                let group = self
                    .vaults
                    .vault_path_for_attachment(&key.attachment)
                    .await?;
                let source = ArraySource {
                    path: &group.join(name),
                    data_source_id: key.source.clone(),
                    layer_name: &key.layer,
                    cache: Arc::clone(&self.chunks),
                };
                Ok(Arc::new(
                    open_zarr3_array(source, ArrayAxes::default(), token).await?,
                ))
            })
            .await
    }

    /// `attributes.voxelytics` of the group's `zarr.json`; failed reads and invalid JSON are
    /// reported through `read_error` and `parse_error`.
    pub async fn voxelytics_attributes(
        &self,
        attachment: &LayerAttachment,
        token: Option<&str>,
        read_error: impl FnOnce(VaultError) -> DsError,
        parse_error: impl FnOnce(serde_json::Error) -> DsError,
    ) -> DsResult<Value> {
        let group = self.vaults.vault_path_for_attachment(attachment).await?;
        let bytes = group
            .join("zarr.json")
            .read_bytes(ByteRange::Complete, token)
            .await
            .map_err(read_error)?;
        let mut json: Value = serde_json::from_slice(&bytes).map_err(parse_error)?;
        Ok(json
            .pointer_mut("/attributes/voxelytics")
            .map(Value::take)
            .unwrap_or_default())
    }

    /// Clears the arrays and chunks of `source` (and `layer`, if given).
    pub fn clear(&self, source: &DataSourceId, layer: Option<&str>) -> usize {
        self.arrays
            .clear_matching(|(id, _)| id.belongs_to(source, layer))
            + self.chunks.clear_for_source(source, layer)
    }
}
