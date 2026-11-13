//! Scala `RemoteLayerExplorer`: shared vault access and layer-building helpers, and the explorer set.
use std::{future::Future, pin::Pin};

use serde_json::Value;

use crate::{
    datareaders::DatasetHeader,
    datavault::{ByteRange, DataVaultService, VaultError, VaultPath, VaultResult},
    error::{DsError, DsResult},
    models::{
        AxisOrder, BoundingBox, LayerKind, MagLocator, StaticLayer, Vec3Double, Vec3Int, VoxelSize,
        enums::{DataFormat, ElementClass},
    },
};
use webknossos_common::explore_layers::Explored;

use super::{
    n5, neuroglancer, ngff, precomputed::explore_precomputed,
    webknossos_zarr::explore_webknossos_zarr, zarr_array::explore_zarr_array,
    zarr3_array::explore_zarr3_array,
};

pub(super) type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Vault access for one exploration (token forwarded to vaults that need it).
#[derive(Clone)]
pub struct ExploreContext {
    pub vaults: DataVaultService,
    pub token: Option<String>,
}

impl ExploreContext {
    pub(super) fn token(&self) -> Option<&str> {
        self.token.as_deref()
    }

    /// Scala `VaultPath.parseAsJson` (missing files are `Empty`).
    pub(super) async fn read_json(&self, path: &VaultPath) -> VaultResult<Value> {
        let bytes = path.read_bytes(ByteRange::Complete, self.token()).await?;
        serde_json::from_slice(&bytes)
            .map_err(|e| VaultError::failure(format!("JSON parsing failed: {e}")))
    }

    pub(super) async fn read_json_or(
        &self,
        path: &VaultPath,
        message: impl Into<String>,
    ) -> DsResult<Value> {
        self.read_json(path)
            .await
            .map_err(|e| e.wrap(message).into())
    }
}

pub(super) fn layer(
    name: &str,
    format: DataFormat,
    bounding_box: BoundingBox,
    element_class: ElementClass,
    mags: Vec<MagLocator>,
    segmentation: bool,
) -> StaticLayer {
    StaticLayer {
        name: name.to_owned(),
        data_format: format,
        bounding_box,
        element_class,
        mags,
        default_view_configuration: None,
        admin_view_configuration: None,
        coordinate_transformations: None,
        additional_axes: None,
        attachments: None,
        kind: if segmentation {
            LayerKind::Segmentation {
                largest_segment_id: None,
                mappings: None,
            }
        } else {
            LayerKind::Color
        },
    }
}

pub(super) fn mag_locator(
    mag: Vec3Int,
    path: &VaultPath,
    axis_order: AxisOrder,
    channel_index: Option<i32>,
    credential_id: Option<&str>,
) -> MagLocator {
    MagLocator {
        path: Some(path.upath().clone()),
        axis_order: Some(axis_order),
        channel_index,
        credential_id: credential_id.map(str::to_owned),
        ..MagLocator::new(mag)
    }
}

/// Scala `looksLikeSegmentationLayer`.
pub(super) fn looks_like_segmentation_layer(name: &str, element_class: ElementClass) -> bool {
    matches!(name.to_lowercase().as_str(), "segmentation" | "labels")
        && element_class.is_segmentation_element_class()
}

/// Scala `MagWithAttributes`.
pub(super) struct MagWithAttributes {
    pub(super) mag: MagLocator,
    pub(super) element_class: ElementClass,
    pub(super) bounding_box: BoundingBox,
}

/// Scala `elementClassFromMags` (`findUniqueElement`).
pub(super) fn element_class_from_mags(mags: &[MagWithAttributes]) -> DsResult<ElementClass> {
    let classes: Vec<ElementClass> = mags.iter().map(|m| m.element_class).collect();
    match classes.first() {
        Some(first) if classes.iter().all(|c| c == first) => Ok(*first),
        _ => Err(DsError::failure(format!(
            "Element class must be the same for all mags of a layer. got List({})",
            classes
                .iter()
                .map(|c| c.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ))),
    }
}

pub(super) fn bounding_box_from_mags(mags: &[MagWithAttributes]) -> BoundingBox {
    BoundingBox::union_all(mags.iter().map(|m| &m.bounding_box))
}

/// Scala `ZarrHeader` / `N5Header` / … `boundingBox(axisOrder)` with its error message.
pub(super) fn bounding_box_of(
    header: &impl DatasetHeader,
    axis_order: &AxisOrder,
    message: &str,
) -> DsResult<BoundingBox> {
    header
        .bounding_box(axis_order)
        .ok_or_else(|| DsError::failure(message))
}

pub(super) fn element_class_of(
    header: &impl DatasetHeader,
    message: &str,
) -> DsResult<ElementClass> {
    header
        .element_class()
        .ok_or_else(|| DsError::failure(message))
}

/// Scala `AxisOrder.asZyxFromRank` / `asCxyzFromRank`.
pub(super) fn zyx_from_rank(rank: usize) -> AxisOrder {
    AxisOrder::as_zyx_from_rank(rank as i32)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Explorer {
    WebknossosZarr,
    NgffV0_4,
    NgffV0_5,
    Zarr3Array,
    ZarrArray(Vec3Int),
    N5Multiscales,
    N5CompactMultiscales,
    N5Array,
    Precomputed,
    NeuroglancerUri,
}

impl Explorer {
    /// Scala order: explorers reading meta information first, raw arrays last.
    pub const REMOTE: [Explorer; 10] = [
        Explorer::WebknossosZarr,
        Explorer::NgffV0_4,
        Explorer::NgffV0_5,
        Explorer::Zarr3Array,
        Explorer::ZarrArray(Vec3Int::new(1, 1, 1)),
        Explorer::N5Multiscales,
        Explorer::N5CompactMultiscales,
        Explorer::N5Array,
        Explorer::Precomputed,
        Explorer::NeuroglancerUri,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Self::WebknossosZarr => "WEBKNOSSOS-based Zarr",
            Self::NgffV0_4 => "OME NGFF Zarr v0.4",
            Self::NgffV0_5 => "OME NGFF Zarr v0.5",
            Self::Zarr3Array => "Zarr v3 Array",
            Self::ZarrArray(_) => "Zarr Array",
            Self::N5Multiscales => "N5 Multiscales",
            Self::N5CompactMultiscales => "N5 Multiscales with compact metadata",
            Self::N5Array => "N5 Array",
            Self::Precomputed => "Neuroglancer Precomputed",
            Self::NeuroglancerUri => "Neuroglancer URI Explorer",
        }
    }

    pub fn explore<'a>(
        self,
        ctx: &'a ExploreContext,
        path: &'a VaultPath,
        credential_id: Option<&'a str>,
    ) -> BoxFuture<'a, DsResult<Vec<Explored>>> {
        Box::pin(async move {
            match self {
                Self::WebknossosZarr => explore_webknossos_zarr(ctx, path, credential_id).await,
                Self::NgffV0_4 => ngff::explore_v0_4(ctx, path, credential_id).await,
                Self::NgffV0_5 => ngff::explore_v0_5(ctx, path, credential_id).await,
                Self::Zarr3Array => explore_zarr3_array(ctx, path, credential_id).await,
                Self::ZarrArray(mag) => explore_zarr_array(ctx, path, credential_id, mag).await,
                Self::N5Multiscales => n5::explore_multiscales(ctx, path, credential_id).await,
                Self::N5CompactMultiscales => n5::explore_compact(ctx, path, credential_id).await,
                Self::N5Array => n5::explore_array(ctx, path, credential_id).await,
                Self::Precomputed => explore_precomputed(ctx, path, credential_id).await,
                Self::NeuroglancerUri => neuroglancer::explore_uri(ctx, path, credential_id).await,
            }
        })
    }
}

pub(super) fn unit_voxel_size() -> VoxelSize {
    VoxelSize::from_factor_with_default_unit(Vec3Double::new(1.0, 1.0, 1.0))
}
