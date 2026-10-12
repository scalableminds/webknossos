//! Scala `explore` package: guess WEBKNOSSOS layers from Zarr / Zarr3 / OME-NGFF / N5 /
//! Neuroglancer precomputed data (and Neuroglancer URIs) reachable through data vaults.
//!
//! Every explorer returns layers with the voxel size they were found at; `ExploreRemoteLayerService`
//! tries all explorers per path (first success wins, in explorer order), recurses into up to 10
//! children per directory for at most 3 levels, and finally unifies voxel sizes across layers.
use std::{collections::BTreeSet, future::Future, pin::Pin};

use futures::future::join_all;
use serde_json::{Map, Value, json};

use crate::{
    datareaders::{
        DatasetHeader,
        n5::N5Header,
        precomputed::PrecomputedHeader,
        zarr::{
            ZarrHeader,
            ngff::{NgffAxis, NgffCoordinateTransformation, NgffMetadata, NgffMultiscalesItem},
        },
        zarr3::{Zarr3Header, ngff::NgffZarr3GroupHeader},
    },
    datavault::{ByteRange, DataVaultService, VaultError, VaultPath, VaultResult},
    error::{DsError, DsResult},
    models::{
        AdditionalAxis, AxisOrder, BoundingBox, CoordinateTransformation, DataLayerAttachments,
        DataSourceId, LayerAttachment, LayerKind, MagLocator, StaticLayer, UPath, UsableDataSource,
        Vec3Double, Vec3Int, VoxelSize,
        enums::{
            CoordinateTransformationType, DataFormat, ElementClass, LayerAttachmentDataformat,
            LengthUnit,
        },
    },
};

pub type Explored = (StaticLayer, VoxelSize);
type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

const MAX_RECURSIVE_SEARCH_DEPTH: usize = 3;
const MAX_EXPLORED_ITEMS_PER_LEVEL: usize = 10;

/// Vault access for one exploration (token forwarded to vaults that need it).
#[derive(Clone)]
pub struct ExploreContext {
    pub vaults: DataVaultService,
    pub token: Option<String>,
}

impl ExploreContext {
    fn token(&self) -> Option<&str> {
        self.token.as_deref()
    }

    /// Scala `VaultPath.parseAsJson` (missing files are `Empty`).
    async fn read_json(&self, path: &VaultPath) -> VaultResult<Value> {
        let bytes = path.read_bytes(ByteRange::Complete, self.token()).await?;
        serde_json::from_slice(&bytes)
            .map_err(|e| VaultError::failure(format!("JSON parsing failed: {e}")))
    }

    async fn read_json_or(&self, path: &VaultPath, message: impl Into<String>) -> DsResult<Value> {
        self.read_json(path)
            .await
            .map_err(|e| e.wrap(message).into())
    }
}

fn layer(
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

fn mag_locator(
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
fn looks_like_segmentation_layer(name: &str, element_class: ElementClass) -> bool {
    matches!(name.to_lowercase().as_str(), "segmentation" | "labels")
        && element_class.is_segmentation_element_class()
}

/// Scala `MagWithAttributes`.
struct MagWithAttributes {
    mag: MagLocator,
    element_class: ElementClass,
    bounding_box: BoundingBox,
}

/// Scala `elementClassFromMags` (`findUniqueElement`).
fn element_class_from_mags(mags: &[MagWithAttributes]) -> DsResult<ElementClass> {
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

fn bounding_box_from_mags(mags: &[MagWithAttributes]) -> BoundingBox {
    BoundingBox::union_all(mags.iter().map(|m| &m.bounding_box))
}

/// Scala `ZarrHeader` / `N5Header` / … `boundingBox(axisOrder)` with its error message.
fn bounding_box_of(
    header: &impl DatasetHeader,
    axis_order: &AxisOrder,
    message: &str,
) -> DsResult<BoundingBox> {
    header
        .bounding_box(axis_order)
        .ok_or_else(|| DsError::failure(message))
}

fn element_class_of(header: &impl DatasetHeader, message: &str) -> DsResult<ElementClass> {
    header
        .element_class()
        .ok_or_else(|| DsError::failure(message))
}

/// Scala `AxisOrder.asZyxFromRank` / `asCxyzFromRank`.
fn zyx_from_rank(rank: usize) -> AxisOrder {
    AxisOrder::as_zyx_from_rank(rank as i32)
}

// ---- explorers -------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Explorer {
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

fn unit_voxel_size() -> VoxelSize {
    VoxelSize::from_factor_with_default_unit(Vec3Double::new(1.0, 1.0, 1.0))
}

/// Scala `ZarrArrayExplorer`.
async fn explore_zarr_array(
    ctx: &ExploreContext,
    path: &VaultPath,
    credential_id: Option<&str>,
    mag: Vec3Int,
) -> DsResult<Vec<Explored>> {
    let zarray_path = path.join(crate::datareaders::zarr::FILENAME_DOT_ZARRAY);
    let name = path.basename();
    let json = ctx
        .read_json_or(
            &zarray_path,
            format!("failed to read zarr header at {zarray_path}"),
        )
        .await?;
    let header = ZarrHeader::from_json(&json)
        .map_err(|e| e.wrap(format!("failed to read zarr header at {zarray_path}")))?;
    let element_class = element_class_of(&header, "failed to read element class from zarr header")?;
    let axis_order = zyx_from_rank(header.rank());
    let bbox = bounding_box_of(
        &header,
        &axis_order,
        "failed to read bounding box from zarr header. Make sure data is in (T/C)ZYX format",
    )?;
    let locator = mag_locator(mag, path, axis_order, None, credential_id);
    let segmentation = looks_like_segmentation_layer(&name, element_class);
    Ok(vec![(
        layer(
            &name,
            DataFormat::Zarr,
            bbox,
            element_class,
            vec![locator],
            segmentation,
        ),
        unit_voxel_size(),
    )])
}

/// Scala `Zarr3ArrayExplorer`.
async fn explore_zarr3_array(
    ctx: &ExploreContext,
    path: &VaultPath,
    credential_id: Option<&str>,
) -> DsResult<Vec<Explored>> {
    let json_path = path.join(crate::datareaders::zarr3::FILENAME_ZARR_JSON);
    let name = path.basename();
    let json = ctx
        .read_json_or(
            &json_path,
            format!("failed to read zarr v3 header at {json_path}"),
        )
        .await?;
    let header = Zarr3Header::for_exploration(&json)?;
    let element_class = element_class_of(&header, "failed to read element class from zarr header")?;
    let axis_order = AxisOrder::as_cxyz_from_rank(header.rank() as i32);
    let bbox = bounding_box_of(
        &header,
        &axis_order,
        "failed to read bounding box from zarr header. Make sure data is in (T/C)ZYX format",
    )?;
    let locator = mag_locator(Vec3Int::new(1, 1, 1), path, axis_order, None, credential_id);
    let segmentation = looks_like_segmentation_layer(&name, element_class);
    Ok(vec![(
        layer(
            &name,
            DataFormat::Zarr3,
            bbox,
            element_class,
            vec![locator],
            segmentation,
        ),
        unit_voxel_size(),
    )])
}

/// Scala `WebknossosZarrExplorer`: a WEBKNOSSOS Zarr streaming datasource with resolved paths.
async fn explore_webknossos_zarr(
    ctx: &ExploreContext,
    path: &VaultPath,
    credential_id: Option<&str>,
) -> DsResult<Vec<Explored>> {
    let properties = path.join(crate::models::FILENAME_DATASOURCE_PROPERTIES_JSON);
    let json = ctx.read_json(&properties).await.map_err(DsError::from)?;
    let source = UsableDataSource::from_json(&json)
        .map_err(|e| DsError::failure(e.validation_failure_message()))?;
    let base = path.upath().clone();
    let mut result = Vec::new();
    for layer in &source.data_layers {
        let header = match layer.data_format {
            DataFormat::Zarr => crate::datareaders::zarr::FILENAME_DOT_ZARRAY,
            DataFormat::Zarr3 => crate::datareaders::zarr3::FILENAME_ZARR_JSON,
            other => {
                return Err(DsError::failure(format!(
                    "Invalid layer dataformat {other}, can only explore zarr, zarr3 as WebknossosZarr"
                )));
            }
        };
        let mut mags = Vec::new();
        for mag in &layer.mags {
            let resolved = match &mag.path {
                Some(p) => p.resolved_in(&base),
                None => {
                    let mag_path = path.join(&layer.name).join(&mag.mag.to_mag_literal(true));
                    mag_path
                        .join(header)
                        .read_bytes(ByteRange::Complete, ctx.token())
                        .await
                        .map_err(|e| DsError::from(e.wrap(format!("Could not find {mag_path}"))))?;
                    mag_path.upath().clone()
                }
            };
            mags.push(MagLocator {
                path: Some(resolved),
                credential_id: credential_id.map(str::to_owned),
                ..mag.clone()
            });
        }
        let attachments = layer.attachments.as_ref().map(|a| a.resolved_in(&base));
        result.push((
            StaticLayer {
                mags,
                attachments,
                ..layer.clone()
            },
            source.scale,
        ));
    }
    Ok(result)
}

/// Scala `PrecomputedExplorer`.
async fn explore_precomputed(
    ctx: &ExploreContext,
    path: &VaultPath,
    credential_id: Option<&str>,
) -> DsResult<Vec<Explored>> {
    let info_path = path.join(crate::datareaders::precomputed::header::FILENAME_INFO);
    let json = ctx
        .read_json_or(
            &info_path,
            format!("Failed to read neuroglancer precomputed metadata at {info_path}"),
        )
        .await?;
    let header: PrecomputedHeader = serde_json::from_value(json).map_err(|e| {
        DsError::failure(e.to_string()).wrap(format!(
            "Failed to read neuroglancer precomputed metadata at {info_path}"
        ))
    })?;
    let name = path.basename();
    let first = header.scales.first().ok_or_else(DsError::empty)?;
    let offset = first.voxel_offset.clone().unwrap_or_else(|| vec![0, 0, 0]);
    let size: Vec<i32> = first.size.iter().map(|s| *s as i32).collect();
    let bbox = match (offset.as_slice(), size.as_slice()) {
        ([x, y, z], [w, h, d]) => BoundingBox::new(Vec3Int::new(*x, *y, *z), *w, *h, *d),
        _ => return Err(DsError::empty()),
    };
    let element_class = match header.data_type.to_lowercase().as_str() {
        "uint8" => ElementClass::Uint8,
        "uint16" => ElementClass::Uint16,
        "uint32" => ElementClass::Uint32,
        "uint64" => ElementClass::Uint64,
        "float32" => ElementClass::Float,
        _ => {
            return Err(DsError::failure(format!(
                "Unknown data type {}",
                header.data_type
            )));
        }
    };
    let smallest = first.resolution.clone();
    let voxel_size = match smallest.as_slice() {
        [x, y, z] => Vec3Double::new(*x, *y, *z),
        _ => return Err(DsError::empty()),
    };
    let mut mags = Vec::new();
    for scale in &header.scales {
        let normalized: Vec<i32> = scale
            .resolution
            .iter()
            .zip(&smallest)
            .map(|(r, m)| (r / m) as i32)
            .collect();
        let mag = Vec3Int::from_slice(&normalized).ok_or_else(DsError::empty)?;
        mags.push(mag_locator(
            mag,
            &path.join(&scale.key),
            AxisOrder::XYZ,
            None,
            credential_id,
        ));
    }
    let mesh_path = path.join(header.mesh_path());
    let meshes = explore_precomputed_meshes(ctx, &mesh_path, credential_id).await;
    let mut explored = layer(
        &name,
        DataFormat::NeuroglancerPrecomputed,
        bbox,
        element_class,
        mags,
        header.describes_segmentation_layer(),
    );
    if header.describes_segmentation_layer() && !meshes.is_empty() {
        explored.attachments = Some(DataLayerAttachments {
            meshes,
            ..Default::default()
        });
    }
    Ok(vec![(
        explored,
        VoxelSize::from_factor_with_default_unit(voxel_size),
    )])
}

/// Scala `exploreMeshesForLayer`: a valid mesh `info` (12-element transform) adds the `mesh`
/// attachment; any failure means no meshes.
async fn explore_precomputed_meshes(
    ctx: &ExploreContext,
    mesh_path: &VaultPath,
    credential_id: Option<&str>,
) -> Vec<LayerAttachment> {
    let Ok(info) = ctx.read_json(&mesh_path.join("info")).await else {
        return Vec::new();
    };
    let valid = info
        .get("lod_scale_multiplier")
        .is_some_and(Value::is_number)
        && info
            .get("vertex_quantization_bits")
            .is_some_and(Value::is_i64)
        && info
            .get("transform")
            .and_then(Value::as_array)
            .is_some_and(|t| t.iter().all(Value::is_number) && t.len() == 12);
    if !valid {
        return Vec::new();
    }
    vec![LayerAttachment {
        name: "mesh".into(),
        path: mesh_path.upath().clone(),
        data_format: LayerAttachmentDataformat::NeuroglancerPrecomputed,
        credential_id: credential_id.map(str::to_owned),
    }]
}

mod n5 {
    use super::*;

    /// Scala `N5Explorer.spaceUnitToNmFactor`.
    fn space_unit_to_nm(unit: &str) -> DsResult<f64> {
        Ok(match unit.to_lowercase().as_str() {
            "ym" => 1e-15,
            "zm" => 1e-12,
            "am" => 1e-9,
            "fm" => 1e-6,
            "pm" => 1e-3,
            "nm" => 1.0,
            "µm" | "um" | "" => 1e3,
            "mm" => 1e6,
            "cm" => 1e7,
            "dm" => 1e8,
            "m" => 1e9,
            other => {
                return Err(DsError::failure(format!(
                    "Unknown space axis unit: {other}"
                )));
            }
        })
    }

    fn index_error() -> DsError {
        DsError::failure("java.lang.IndexOutOfBoundsException")
    }

    pub(super) fn axis_unit_factors(
        units: Option<&[String]>,
        axis: &AxisOrder,
    ) -> DsResult<Vec3Double> {
        match units {
            Some(units) => {
                let get = |i: i32| units.get(i as usize).ok_or_else(index_error);
                Ok(Vec3Double::new(
                    space_unit_to_nm(get(axis.x)?)?,
                    space_unit_to_nm(get(axis.y)?)?,
                    space_unit_to_nm(get(axis.z_with_fallback())?)?,
                ))
            }
            None => Ok(Vec3Double::new(1e3, 1e3, 1e3)),
        }
    }

    pub(super) fn axis_order(axes: &[String]) -> DsResult<AxisOrder> {
        let find = |n: &str| axes.iter().position(|a| a == n).map_or(-1, |i| i as i32);
        let (x, y, z, c) = (find("x"), find("y"), find("z"), find("c"));
        if x < 0 || y < 0 || z < 0 {
            return Err(DsError::failure(format!(
                "invalid xyz axis order: {x},{y},{z}."
            )));
        }
        Ok(AxisOrder::new(x, y, Some(z), (c >= 0).then_some(c)))
    }

    fn voxel_size_in_axis_units(scale: &[f64], axis: &AxisOrder) -> DsResult<Vec3Double> {
        let get = |i: i32| scale.get(i as usize).copied().ok_or_else(index_error);
        Ok(Vec3Double::new(
            get(axis.x)?,
            get(axis.y)?,
            get(axis.z_with_fallback())?,
        ))
    }

    fn strings(value: &Value) -> Option<Vec<String>> {
        value
            .as_array()?
            .iter()
            .map(|v| v.as_str().map(str::to_owned))
            .collect()
    }

    fn doubles(value: &Value) -> Option<Vec<f64>> {
        value.as_array()?.iter().map(Value::as_f64).collect()
    }

    /// Scala `N5Transform`.
    struct Transform {
        axes: Vec<String>,
        scale: Vec<f64>,
        units: Option<Vec<String>>,
    }

    fn transform(value: &Value) -> Option<Transform> {
        Some(Transform {
            axes: strings(value.get("axes")?)?,
            scale: doubles(value.get("scale")?)?,
            units: match value.get("units") {
                None | Some(Value::Null) => None,
                Some(u) => Some(strings(u)?),
            },
        })
    }

    fn voxel_size_from_transform(t: &Transform) -> DsResult<Vec3Double> {
        let axis = axis_order(&t.axes).map_err(|e| e.wrap("Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"))?;
        let factors = axis_unit_factors(t.units.as_deref(), &axis)
            .map_err(|e| e.wrap("Could not extract axis unit-to-nm factors"))?;
        let in_units = voxel_size_in_axis_units(&t.scale, &axis)
            .map_err(|e| e.wrap("Could not extract voxel size from scale transforms"))?;
        Ok(in_units * factors)
    }

    async fn mag_with_attributes(
        ctx: &ExploreContext,
        mag: Vec3Int,
        mag_path: &VaultPath,
        axis: AxisOrder,
        credential_id: Option<&str>,
    ) -> DsResult<MagWithAttributes> {
        let header_path = mag_path.join("attributes.json");
        let bytes = mag_path
            .join("attributes.json")
            .read_bytes(ByteRange::Complete, ctx.token())
            .await
            .map_err(|e| {
                DsError::from(e.wrap(format!("failed to read n5 header at {header_path}")))
            })?;
        let header = N5Header::parse(&bytes)
            .map_err(|e| e.wrap(format!("failed to read n5 header at {header_path}")))?;
        let element_class = element_class_of(
            &header,
            &format!("failed to read element class from n5 header at {header_path}"),
        )?;
        let bbox = bounding_box_of(
            &header,
            &axis,
            &format!("failed to read bounding box from n5 header at {header_path}"),
        )?;
        Ok(MagWithAttributes {
            mag: mag_locator(mag, mag_path, axis, None, credential_id),
            element_class,
            bounding_box: bbox,
        })
    }

    /// Scala `layerFromMagsWithAttributes`.
    fn layer_from_mags(mags: Vec<MagWithAttributes>, path: &VaultPath) -> DsResult<StaticLayer> {
        if mags.is_empty() {
            return Err(DsError::failure("zero mags in layer"));
        }
        let element_class = element_class_from_mags(&mags)
            .map_err(|e| e.wrap("Could not extract element class from mags"))?;
        let bbox = bounding_box_from_mags(&mags);
        let name = path.basename();
        let segmentation = looks_like_segmentation_layer(&name, element_class);
        Ok(layer(
            &name,
            DataFormat::N5,
            bbox,
            element_class,
            mags.into_iter().map(|m| m.mag).collect(),
            segmentation,
        ))
    }

    /// Scala `N5MultiscalesExplorer`.
    pub(super) async fn explore_multiscales(
        ctx: &ExploreContext,
        path: &VaultPath,
        credential_id: Option<&str>,
    ) -> DsResult<Vec<Explored>> {
        let metadata_path = path.join("attributes.json");
        let message = format!("Failed to read N5 header at {metadata_path}");
        let json = ctx.read_json_or(&metadata_path, &message).await?;
        let multiscales = json
            .get("multiscales")
            .and_then(Value::as_array)
            .ok_or_else(|| DsError::failure("'multiscales' is undefined").wrap(&message))?;
        let mut result = Vec::new();
        for item in multiscales {
            let datasets: Vec<(String, Transform)> = item
                .get("datasets")
                .and_then(Value::as_array)
                .and_then(|ds| {
                    ds.iter()
                        .map(|d| {
                            Some((
                                d.get("path")?.as_str()?.to_owned(),
                                transform(d.get("transform")?)?,
                            ))
                        })
                        .collect()
                })
                .ok_or_else(|| DsError::failure("invalid N5 multiscales item").wrap(&message))?;
            let sizes = datasets
                .iter()
                .map(|(_, t)| voxel_size_from_transform(t))
                .collect::<DsResult<Vec<_>>>()?;
            let voxel_size = sizes
                .iter()
                .copied()
                .reduce(|a, b| if b.max_dim() < a.max_dim() { b } else { a })
                .ok_or_else(|| DsError::failure("empty.minBy"))?;
            let mut mags = Vec::new();
            for (dataset_path, t) in &datasets {
                let axis = axis_order(&t.axes).map_err(|e| e.wrap("Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"))?;
                let mag_voxel_size = voxel_size_from_transform(t)
                    .map_err(|e| e.wrap("Could not extract mag from transforms"))?;
                let mag = (mag_voxel_size / voxel_size).round().to_vec3_int();
                if !mag.is_all_powers_of_two() {
                    return Err(DsError::failure(format!(
                        "invalid mag: {mag}. Must all be powers of two"
                    ))
                    .wrap("Could not extract mag from transforms"));
                }
                mags.push(
                    mag_with_attributes(ctx, mag, &path.join(dataset_path), axis, credential_id)
                        .await?,
                );
            }
            let explored = layer_from_mags(mags, path)?;
            result.push((
                explored,
                VoxelSize::from_factor_with_default_unit(voxel_size),
            ));
        }
        Ok(result)
    }

    /// Scala `N5CompactMultiscalesExplorer`.
    pub(super) async fn explore_compact(
        ctx: &ExploreContext,
        path: &VaultPath,
        credential_id: Option<&str>,
    ) -> DsResult<Vec<Explored>> {
        let metadata_path = path.join("attributes.json");
        let message = format!("Failed to read N5 header at {metadata_path}");
        let json = ctx.read_json_or(&metadata_path, &message).await?;
        let resolution = json
            .get("resolution")
            .and_then(doubles)
            .ok_or_else(|| DsError::failure("'resolution' is undefined").wrap(&message))?;
        if json.get("multiScale").and_then(Value::as_bool) != Some(true) {
            return Err(DsError::failure(format!(
                "N5 header at {metadata_path} does not have multiScale=true"
            )));
        }
        let axes = json
            .get("axes")
            .and_then(strings)
            .unwrap_or_else(|| vec!["x".into(), "y".into(), "z".into()]);
        let axis = axis_order(&axes)?;
        let factors_json = json
            .get("downsamplingFactors")
            .filter(|v| !v.is_null())
            .or_else(|| json.get("scales").filter(|v| !v.is_null()))
            .ok_or_else(|| {
                DsError::failure(format!(
                    "N5 header at {metadata_path} does not have downsamplingFactors/scales"
                ))
            })?;
        let factors: Vec<Vec<i64>> = serde_json::from_value(factors_json.clone())
            .map_err(|e| DsError::failure(e.to_string()).wrap(&message))?;
        let units = json.get("units").and_then(strings);
        let unit_factors = axis_unit_factors(units.as_deref(), &axis)
            .map_err(|e| e.wrap("Could not extract axis unit-to-nm factors"))?;
        let in_units = voxel_size_in_axis_units(&resolution, &axis)
            .map_err(|e| e.wrap("Could not extract voxel size from scale transforms"))?;
        let voxel_size = VoxelSize::from_factor_with_default_unit(in_units * unit_factors);
        let mut mags = Vec::new();
        for (index, factor) in factors.iter().enumerate() {
            let get = |i: i32| {
                factor
                    .get(i as usize)
                    .map(|v| *v as i32)
                    .ok_or_else(index_error)
            };
            let mag = Vec3Int::new(get(axis.x)?, get(axis.y)?, get(axis.z_with_fallback())?);
            mags.push(
                mag_with_attributes(
                    ctx,
                    mag,
                    &path.join(&format!("s{index}")),
                    axis,
                    credential_id,
                )
                .await?,
            );
        }
        let explored = layer_from_mags(mags, path)?;
        Ok(vec![(explored, voxel_size)])
    }

    /// Scala `N5ArrayExplorer`.
    pub(super) async fn explore_array(
        ctx: &ExploreContext,
        path: &VaultPath,
        credential_id: Option<&str>,
    ) -> DsResult<Vec<Explored>> {
        let header_path = path.join("attributes.json");
        let bytes = header_path
            .read_bytes(ByteRange::Complete, ctx.token())
            .await
            .map_err(|e| {
                DsError::from(e.wrap(format!("failed to read n5 header at {header_path}")))
            })?;
        let header = N5Header::parse(&bytes)
            .map_err(|e| e.wrap(format!("failed to read n5 header at {header_path}")))?;
        let name = path.basename();
        let element_class =
            element_class_of(&header, "failed to read element class from n5 header")?;
        let axis = zyx_from_rank(header.rank());
        let bbox = bounding_box_of(
            &header,
            &axis,
            "failed to read bounding box from zarr header. Make sure data is in (T/C)ZYX format",
        )?;
        let locator = mag_locator(Vec3Int::new(1, 1, 1), path, axis, None, credential_id);
        let segmentation = looks_like_segmentation_layer(&name, element_class);
        Ok(vec![(
            layer(
                &name,
                DataFormat::N5,
                bbox,
                element_class,
                vec![locator],
                segmentation,
            ),
            unit_voxel_size(),
        )])
    }
}

mod ngff {
    use super::*;

    /// Scala `ChannelAttributes` from omero metadata.
    #[derive(Clone)]
    struct ChannelAttributes {
        color: Option<[i64; 3]>,
        name: Option<String>,
        window: Option<(f64, f64, f64, f64)>,
        inverted: Option<bool>,
        active: Option<bool>,
    }

    /// Scala `Color.fromHTML(..).getOrElse(Color(1, 1, 1, 0))` + `toArrayOfInts`.
    fn color_ints(code: &str) -> [i64; 3] {
        match crate::services::thumbnail::Color::from_html(code) {
            Some(c) => [c.r, c.g, c.b].map(|v| (v * 255.0) as i64),
            None => [255, 255, 255],
        }
    }

    fn channel_attributes(
        omero: Option<&crate::datareaders::zarr::ngff::NgffOmeroMetadata>,
    ) -> Option<Vec<ChannelAttributes>> {
        Some(
            omero?
                .channels
                .iter()
                .map(|c| ChannelAttributes {
                    color: c.color.as_deref().map(color_ints),
                    name: c.label.clone(),
                    window: c.window.as_ref().map(|w| (w.start, w.end, w.min, w.max)),
                    inverted: c.inverted,
                    active: c.active,
                })
                .collect(),
        )
    }

    /// Scala `TextUtils.normalizeStrong`.
    fn normalize_strong(name: &str) -> Option<String> {
        let replaced = crate::services::upload_finish::normalize_text(name);
        let kept: String = replaced
            .chars()
            .filter(|c| {
                c.is_ascii_alphanumeric()
                    || matches!(c, '_' | '-' | ' ' | '\t' | '\n' | '\x0B' | '\x0C' | '\r')
            })
            .collect();
        (!kept.is_empty()).then_some(kept)
    }

    /// Scala `parseChannelAttributes`.
    fn parse_channel_attributes(
        attributes: Option<&[ChannelAttributes]>,
        dataset_name: &str,
        channel: usize,
    ) -> DsResult<(Map<String, Value>, String)> {
        let Some(attributes) = attributes else {
            return Ok((Map::new(), dataset_name.to_owned()));
        };
        let this = attributes.get(channel).ok_or_else(|| {
            DsError::failure(format!("java.lang.IndexOutOfBoundsException: {channel}"))
        })?;
        let name = this
            .name
            .as_deref()
            .map(|n| {
                normalize_strong(n)
                    .unwrap_or_else(|| dataset_name.to_owned())
                    .replace(' ', "")
            })
            .unwrap_or_else(|| dataset_name.to_owned());
        let mut config = Map::new();
        if let Some(color) = this.color {
            config.insert("color".into(), json!(color));
        }
        if let Some((start, end, min, max)) = this.window {
            config.insert("intensityRange".into(), json!([start, end]));
            config.insert("min".into(), json!(min));
            config.insert("max".into(), json!(max));
        }
        if let Some(inverted) = this.inverted {
            config.insert("isInverted".into(), json!(inverted));
        }
        if let Some(active) = this.active {
            config.insert("isDisabled".into(), json!(!active));
        }
        Ok((config, name))
    }

    fn axis_order(axes: &[NgffAxis]) -> DsResult<AxisOrder> {
        let space = |name: &str| {
            axes.iter()
                .position(|a| a.name.to_lowercase() == name && a.kind == "space")
                .map_or(-1, |i| i as i32)
        };
        let (x, y, z) = (space("x"), space("y"), space("z"));
        let c = axes
            .iter()
            .position(|a| a.kind == "channel")
            .map(|i| i as i32);
        if x < 0 || y < 0 {
            return Err(DsError::failure(format!(
                "invalid xyz axis order: {x},{y},{z}. {}",
                x >= 0 && y >= 0
            )));
        }
        Ok(AxisOrder::new(x, y, (z >= 0).then_some(z), c))
    }

    fn axis_error() -> DsError {
        DsError::failure("java.lang.IndexOutOfBoundsException")
    }

    fn length_unit(axes: &[NgffAxis], index: i32) -> DsResult<LengthUnit> {
        axes.get(index as usize)
            .ok_or_else(axis_error)?
            .length_unit()?
            .ok_or_else(DsError::empty)
    }

    /// Scala `selectAxisUnit`: the smallest unit of the spatial axes.
    fn select_axis_unit(axes: &[NgffAxis], axis: &AxisOrder) -> DsResult<LengthUnit> {
        let mut units = vec![length_unit(axes, axis.x)?, length_unit(axes, axis.y)?];
        if axis.has_z_axis() {
            units.push(length_unit(axes, axis.z_with_fallback())?);
        }
        Ok(units
            .into_iter()
            .reduce(|a, b| {
                if b.to_nanometer() < a.to_nanometer() {
                    b
                } else {
                    a
                }
            })
            .expect("two units"))
    }

    fn axis_unit_factors(
        unit: LengthUnit,
        axes: &[NgffAxis],
        axis: &AxisOrder,
    ) -> DsResult<Vec3Double> {
        let target = unit.to_nanometer();
        let x = length_unit(axes, axis.x)?.to_nanometer() / target;
        let y = length_unit(axes, axis.y)?.to_nanometer() / target;
        let z = if axis.has_z_axis() {
            length_unit(axes, axis.z_with_fallback())?.to_nanometer() / target
        } else {
            1.0
        };
        Ok(Vec3Double::new(x, y, z))
    }

    /// Scala `extractAndCombineScaleTransforms`.
    fn combined_scale(
        transforms: &[NgffCoordinateTransformation],
        axis: &AxisOrder,
    ) -> DsResult<Vec3Double> {
        let scales: Vec<&Vec<f64>> = transforms
            .iter()
            .filter(|t| t.kind == "scale")
            .filter_map(|t| t.scale.as_ref())
            .collect();
        let factor = |i: i32| -> DsResult<f64> {
            scales
                .iter()
                .map(|s| s.get(i as usize).copied().ok_or_else(axis_error))
                .product()
        };
        let z = if axis.has_z_axis() {
            factor(axis.z_with_fallback())?
        } else {
            1.0
        };
        Ok(Vec3Double::new(factor(axis.x)?, factor(axis.y)?, z))
    }

    /// Scala `extractVoxelSizeInAxisUnits`.
    fn voxel_size_in_axis_units(
        all: &[Vec<NgffCoordinateTransformation>],
        axis: &AxisOrder,
    ) -> DsResult<Vec3Double> {
        let scales = all
            .iter()
            .map(|t| combined_scale(t, axis))
            .collect::<DsResult<Vec<_>>>()?;
        let min_by = |f: fn(&Vec3Double) -> f64| {
            scales
                .iter()
                .copied()
                .reduce(|a, b| if f(&b) < f(&a) { b } else { a })
        };
        let (mx, my, mz) = (min_by(|v| v.x), min_by(|v| v.y), min_by(|v| v.z));
        if !(mx == my && my == mz) {
            return Err(DsError::failure(
                "ngff scales do not agree on smallest dimension",
            ));
        }
        mx.ok_or_else(|| DsError::failure("empty.minBy"))
    }

    fn mag_from_transforms(
        transforms: &[NgffCoordinateTransformation],
        voxel_size: Vec3Double,
        axis: &AxisOrder,
    ) -> DsResult<Vec3Int> {
        let mag = (combined_scale(transforms, axis)? / voxel_size)
            .round()
            .to_vec3_int();
        let pow2 = |v: i32| v != 0 && (v & (v - 1)) == 0;
        if !(pow2(mag.x) && pow2(mag.y) && pow2(mag.z)) {
            return Err(DsError::failure(format!(
                "invalid mag: {mag}. Must all be powers of two"
            )));
        }
        Ok(mag)
    }

    /// Scala `getTranslation`.
    fn translation(multiscale: &NgffMultiscalesItem) -> Option<Vec<CoordinateTransformation>> {
        let is_2d = !multiscale.axes.iter().any(|a| a.name == "z");
        let first = multiscale.datasets.first()?;
        if !first
            .coordinate_transformations
            .iter()
            .any(|t| t.kind == "translation")
        {
            return None;
        }
        let mut translation = if is_2d {
            vec![1.0, 1.0]
        } else {
            vec![1.0, 1.0, 1.0]
        };
        for ct in &first.coordinate_transformations {
            let list = if ct.kind == "translation" {
                ct.translation.as_ref()
            } else {
                ct.scale.as_ref()
            };
            if let Some(list) = list {
                for (i, v) in translation.iter_mut().enumerate() {
                    let other = *list.get(list.len().checked_sub(1 + i)?)?;
                    if ct.kind == "translation" {
                        *v *= other;
                    } else {
                        *v /= other;
                    }
                }
            }
        }
        if is_2d {
            translation.push(0.0);
        }
        Some(vec![CoordinateTransformation {
            transformation_type: CoordinateTransformationType::Affine,
            matrix: Some(vec![
                vec![1.0, 0.0, 0.0, translation[0]],
                vec![0.0, 1.0, 0.0, translation[1]],
                vec![0.0, 0.0, 1.0, translation[2]],
                vec![0.0, 0.0, 0.0, 1.0],
            ]),
            correspondences: None,
        }])
    }

    fn ensure_segmentation_element_class(e: ElementClass) -> ElementClass {
        match e {
            ElementClass::Int8 => ElementClass::Uint8,
            ElementClass::Int16 => ElementClass::Uint16,
            ElementClass::Int32 => ElementClass::Uint32,
            ElementClass::Int64 => ElementClass::Uint64,
            other => other,
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Version {
        V0_4,
        V0_5,
    }

    /// Mag header of either version: (element class, bounding box, shape).
    async fn mag_header(
        ctx: &ExploreContext,
        version: Version,
        mag_path: &VaultPath,
        axis: Option<&AxisOrder>,
    ) -> DsResult<(Option<ElementClass>, Option<BoundingBox>, Vec<i64>)> {
        match version {
            Version::V0_4 => {
                let zarray = mag_path.join(crate::datareaders::zarr::FILENAME_DOT_ZARRAY);
                let message = format!("failed to read zarr header at {zarray}");
                let json = ctx.read_json_or(&zarray, &message).await?;
                let mut header = ZarrHeader::from_json(&json).map_err(|e| e.wrap(&message))?;
                if header.shape.len() == 2 {
                    header.shape.push(1);
                    header.chunks.push(1);
                }
                let bbox = axis.and_then(|a| header.bounding_box(a));
                Ok((header.element_class(), bbox, header.shape.clone()))
            }
            Version::V0_5 => {
                let json_path = mag_path.join(crate::datareaders::zarr3::FILENAME_ZARR_JSON);
                let message = format!("failed to read zarr header at {json_path}");
                let json = ctx.read_json_or(&json_path, &message).await?;
                let header = Zarr3Header::for_exploration(&json).map_err(|e| e.wrap(&message))?;
                let bbox = axis.and_then(|a| header.bounding_box(a));
                let shape = header.dataset_shape().unwrap_or_default().to_vec();
                Ok((header.element_class(), bbox, shape))
            }
        }
    }

    /// Scala `getAdditionalAxes`.
    async fn additional_axes(
        ctx: &ExploreContext,
        version: Version,
        multiscale: &NgffMultiscalesItem,
        path: &VaultPath,
    ) -> DsResult<Vec<AdditionalAxis>> {
        let first = multiscale.datasets.first().ok_or_else(DsError::empty)?;
        let (_, _, shape) = mag_header(ctx, version, &path.join(&first.path), None).await?;
        let mut axes = Vec::new();
        for (index, axis) in multiscale
            .axes
            .iter()
            .filter(|a| !["c", "x", "y", "z"].contains(&a.name.as_str()))
            .enumerate()
        {
            let name = normalize_strong(&axis.name).ok_or_else(|| {
                DsError::failure(format!(
                    "Axis name '{}' would be empty if sanitized",
                    axis.name
                ))
            })?;
            let size = *shape.get(index).ok_or_else(axis_error)?;
            axes.push(AdditionalAxis {
                name,
                bounds: vec![0, size as i32],
                index: index as i32,
            });
        }
        let names: Vec<&String> = axes.iter().map(|a| &a.name).collect();
        let mut seen = BTreeSet::new();
        let mut duplicates = Vec::new();
        for n in &names {
            if !seen.insert(*n) && !duplicates.contains(n) {
                duplicates.push(*n);
            }
        }
        if !duplicates.is_empty() {
            return Err(DsError::failure(format!(
                "Additional axes names ({}) are not unique.",
                duplicates
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )));
        }
        Ok(axes)
    }

    async fn channel_count(
        ctx: &ExploreContext,
        version: Version,
        multiscale: &NgffMultiscalesItem,
        path: &VaultPath,
    ) -> DsResult<usize> {
        let first = multiscale.datasets.first().ok_or_else(DsError::empty)?;
        let (_, _, shape) = mag_header(ctx, version, &path.join(&first.path), None).await?;
        let axis = axis_order(&multiscale.axes).map_err(|e| e.wrap("Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"))?;
        Ok(match axis.c {
            Some(c) => *shape.get(c as usize).ok_or_else(axis_error)? as usize,
            None => 1,
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn create_layer(
        ctx: &ExploreContext,
        version: Version,
        path: &VaultPath,
        credential_id: Option<&str>,
        multiscale: &NgffMultiscalesItem,
        channel: usize,
        attributes: Option<&[ChannelAttributes]>,
        dataset_name: &str,
        voxel_size: Vec3Double,
        axis: &AxisOrder,
        is_segmentation: bool,
    ) -> DsResult<StaticLayer> {
        let mut mags = Vec::new();
        for dataset in &multiscale.datasets {
            let mag = mag_from_transforms(&dataset.coordinate_transformations, voxel_size, axis)
                .map_err(|e| e.wrap("Could not extract mag from scale transforms"))?;
            let mag_path = path.join(&dataset.path);
            let header_name = match version {
                Version::V0_4 => crate::datareaders::zarr::FILENAME_DOT_ZARRAY,
                Version::V0_5 => crate::datareaders::zarr3::FILENAME_ZARR_JSON,
            };
            let header_path = mag_path.join(header_name);
            let (element_class, bbox, _) = mag_header(ctx, version, &mag_path, Some(axis)).await?;
            mags.push(MagWithAttributes {
                mag: mag_locator(mag, &mag_path, *axis, Some(channel as i32), credential_id),
                element_class: element_class.ok_or_else(|| {
                    DsError::failure(format!(
                        "failed to read element class from zarr header at {header_path}"
                    ))
                })?,
                bounding_box: bbox.ok_or_else(|| {
                    DsError::failure(format!(
                        "failed to read bounding box from zarr header at {header_path}"
                    ))
                })?,
            });
        }
        if mags.is_empty() {
            return Err(DsError::failure("zero mags in layer"));
        }
        let raw = element_class_from_mags(&mags)
            .map_err(|e| e.wrap("Could not extract element class from mags"))?;
        let element_class = if is_segmentation {
            ensure_segmentation_element_class(raw)
        } else {
            raw
        };
        let (view_config, channel_name) =
            parse_channel_attributes(attributes, dataset_name, channel)?;
        let bbox = bounding_box_from_mags(&mags);
        let axes = additional_axes(ctx, version, multiscale, path).await?;
        let format = match version {
            Version::V0_4 => DataFormat::Zarr,
            Version::V0_5 => DataFormat::Zarr3,
        };
        let segmentation =
            looks_like_segmentation_layer(dataset_name, element_class) || is_segmentation;
        let mut result = layer(
            &channel_name,
            format,
            bbox,
            element_class,
            mags.into_iter().map(|m| m.mag).collect(),
            segmentation,
        );
        result.additional_axes = Some(axes);
        result.default_view_configuration = Some(view_config);
        result.coordinate_transformations = translation(multiscale);
        Ok(result)
    }

    /// Scala `layersFromNgffMultiscale`.
    #[allow(clippy::too_many_arguments)]
    async fn layers_from_multiscale(
        ctx: &ExploreContext,
        version: Version,
        multiscale: &NgffMultiscalesItem,
        path: &VaultPath,
        credential_id: Option<&str>,
        channels: usize,
        attributes: Option<&[ChannelAttributes]>,
        is_segmentation: bool,
    ) -> DsResult<Vec<Explored>> {
        let axis = axis_order(&multiscale.axes).map_err(|e| e.wrap("Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"))?;
        let unit = select_axis_unit(&multiscale.axes, &axis)?;
        let factors = axis_unit_factors(unit, &multiscale.axes, &axis)
            .map_err(|e| e.wrap("Could not extract axis unit-to-nm factors"))?;
        let transforms: Vec<Vec<NgffCoordinateTransformation>> = multiscale
            .datasets
            .iter()
            .map(|d| d.coordinate_transformations.clone())
            .collect();
        let voxel_size = voxel_size_in_axis_units(&transforms, &axis)
            .map_err(|e| e.wrap("Could not extract voxel size from scale transforms"))?;
        let dataset_name = multiscale
            .name
            .as_deref()
            .and_then(normalize_strong)
            .unwrap_or_else(|| path.basename());
        let mut layers = Vec::new();
        for channel in 0..channels {
            layers.push(
                create_layer(
                    ctx,
                    version,
                    path,
                    credential_id,
                    multiscale,
                    channel,
                    attributes,
                    &dataset_name,
                    voxel_size,
                    &axis,
                    is_segmentation,
                )
                .await?,
            );
        }
        let size = VoxelSize {
            factor: voxel_size * factors,
            unit,
        };
        Ok(layers.into_iter().map(|l| (l, size)).collect())
    }

    /// Scala `exploreLabelLayers` (failures mean no label layers).
    async fn label_layers(
        ctx: &ExploreContext,
        version: Version,
        path: &VaultPath,
        credential_id: Option<&str>,
    ) -> DsResult<Vec<Explored>> {
        let labels = ctx
            .read_json(&path.join(crate::datareaders::zarr::ngff::LABEL_PATH))
            .await
            .map_err(DsError::from)?;
        let labels: Vec<String> = labels
            .get("labels")
            .and_then(Value::as_array)
            .and_then(|l| l.iter().map(|v| v.as_str().map(str::to_owned)).collect())
            .ok_or_else(|| DsError::failure("'labels' is undefined"))?;
        let mut result = Vec::new();
        for label in labels {
            let label_path = path.join("labels").join(&label);
            let multiscales = multiscales_at(ctx, version, &label_path).await?.0;
            for mut multiscale in multiscales {
                multiscale.name = Some(format!("labels-{label}"));
                result.extend(
                    layers_from_multiscale(
                        ctx,
                        version,
                        &multiscale,
                        &label_path,
                        credential_id,
                        1,
                        None,
                        true,
                    )
                    .await?,
                );
            }
        }
        Ok(result)
    }

    /// The multiscales (as v0.4 items) and omero metadata at a group.
    async fn multiscales_at(
        ctx: &ExploreContext,
        version: Version,
        path: &VaultPath,
    ) -> DsResult<(
        Vec<NgffMultiscalesItem>,
        Option<crate::datareaders::zarr::ngff::NgffOmeroMetadata>,
    )> {
        match version {
            Version::V0_4 => {
                let zattrs = path.join(crate::datareaders::zarr::ngff::FILENAME_DOT_ZATTRS);
                let message = format!("Failed to read OME NGFF header at {zattrs}");
                let json = ctx.read_json_or(&zattrs, &message).await?;
                let header: NgffMetadata = serde_json::from_value(json)
                    .map_err(|e| DsError::failure(e.to_string()).wrap(&message))?;
                Ok((header.multiscales, header.omero))
            }
            Version::V0_5 => {
                let zarr_json = path.join(crate::datareaders::zarr3::FILENAME_ZARR_JSON);
                let message = format!("Failed to read OME NGFF header at {zarr_json}");
                let json = ctx.read_json_or(&zarr_json, &message).await?;
                let header: NgffZarr3GroupHeader = serde_json::from_value(json)
                    .map_err(|e| DsError::failure(e.to_string()).wrap(&message))?;
                Ok((
                    header
                        .ngff_metadata
                        .multiscales
                        .iter()
                        .map(|m| m.as_v0_4())
                        .collect(),
                    header.ngff_metadata.omero,
                ))
            }
        }
    }

    async fn explore(
        ctx: &ExploreContext,
        version: Version,
        path: &VaultPath,
        credential_id: Option<&str>,
    ) -> DsResult<Vec<Explored>> {
        let (multiscales, omero) = multiscales_at(ctx, version, path).await?;
        let labels = label_layers(ctx, version, path, credential_id)
            .await
            .unwrap_or_default();
        let attributes = channel_attributes(omero.as_ref());
        let mut result = Vec::new();
        for multiscale in &multiscales {
            let channels = channel_count(ctx, version, multiscale, path).await?;
            result.extend(
                layers_from_multiscale(
                    ctx,
                    version,
                    multiscale,
                    path,
                    credential_id,
                    channels,
                    attributes.as_deref(),
                    false,
                )
                .await?,
            );
        }
        result.extend(labels);
        Ok(result)
    }

    pub(super) async fn explore_v0_4(
        ctx: &ExploreContext,
        path: &VaultPath,
        credential_id: Option<&str>,
    ) -> DsResult<Vec<Explored>> {
        explore(ctx, Version::V0_4, path, credential_id).await
    }

    pub(super) async fn explore_v0_5(
        ctx: &ExploreContext,
        path: &VaultPath,
        credential_id: Option<&str>,
    ) -> DsResult<Vec<Explored>> {
        explore(ctx, Version::V0_5, path, credential_id).await
    }
}

mod neuroglancer {
    use super::*;

    /// Scala `extractRawFragment`: the part after the first `#!`.
    pub fn raw_fragment(uri: &str) -> Option<&str> {
        uri.split_once("#!").map(|(_, f)| f)
    }

    /// Java `URLDecoder.decode` with `+` preserved (pre-escaped to `%2B`).
    fn decode_preserving_plus(value: &str) -> Option<String> {
        let escaped = value.replace('+', "%2B");
        let bytes = escaped.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' {
                let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            } else {
                out.push(bytes[i]);
                i += 1;
            }
        }
        String::from_utf8(out).ok()
    }

    /// Scala `parseFragmentAsJson`: as-is, then decoded once, then twice.
    pub fn parse_fragment(raw: &str) -> Option<Map<String, Value>> {
        let parse = |s: &str| match serde_json::from_str::<Value>(s) {
            Ok(Value::Object(o)) => Some(o),
            _ => None,
        };
        parse(raw).or_else(|| {
            let once = decode_preserving_plus(raw)?;
            parse(&once).or_else(|| parse(&decode_preserving_plus(&once)?))
        })
    }

    /// Scala `extractPrimarySourceUrl`.
    pub fn primary_source_url(source: &Value) -> DsResult<String> {
        match source {
            Value::String(url) => Ok(url.clone()),
            Value::Object(o) => o
                .get("url")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| DsError::failure("'url' is undefined")),
            Value::Array(values) if !values.is_empty() => primary_source_url(&values[0]),
            _ => Err(DsError::failure("Neuroglancer layer has no valid 'source'")),
        }
    }

    async fn first_success(
        ctx: &ExploreContext,
        path: &VaultPath,
        explorers: &[Explorer],
    ) -> DsResult<Vec<Explored>> {
        let results = join_all(explorers.iter().map(|e| e.explore(ctx, path, None))).await;
        let mut last = DsError::empty();
        for result in results {
            match result {
                Ok(layers) => return Ok(layers),
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    async fn explore_layer(ctx: &ExploreContext, spec: &Value) -> DsResult<Vec<Explored>> {
        let object = spec
            .as_object()
            .ok_or_else(|| DsError::failure("expected a JSON object"))?;
        let source_url = primary_source_url(object.get("source").unwrap_or(&Value::Null))?;
        let layer_type = source_url
            .split_once("://")
            .map(|(s, _)| s)
            .unwrap_or_default()
            .to_owned();
        let name = object
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| DsError::failure("'name' is undefined"))?;
        let rest = source_url.get(layer_type.len() + 3..).unwrap_or_default();
        let upath = UPath::parse(rest)?;
        let path = ctx
            .vaults
            .vault_path_for(&upath)
            .await
            .map_err(|e| e.wrap("Failed to set up remote file system"))?;
        let opacity = object.get("opacity").and_then(Value::as_f64).unwrap_or(1.0);
        let mut view = Map::new();
        view.insert("alpha".into(), json!(opacity * 100.0));
        if let Some(range) = object
            .get("shaderControls")
            .and_then(|s| s.get("normalized"))
            .and_then(|n| n.get("range"))
            .filter(|r| r.is_array())
        {
            view.insert("intensityRange".into(), range.clone());
        }
        let _ = name;
        let explored = match layer_type.as_str() {
            "n5" => {
                first_success(
                    ctx,
                    &path,
                    &[
                        Explorer::N5Array,
                        Explorer::N5Multiscales,
                        Explorer::N5CompactMultiscales,
                    ],
                )
                .await?
            }
            "precomputed" => Explorer::Precomputed.explore(ctx, &path, None).await?,
            "zarr" | "zarr2" => {
                first_success(
                    ctx,
                    &path,
                    &[
                        Explorer::NgffV0_4,
                        Explorer::NgffV0_5,
                        Explorer::ZarrArray(Vec3Int::new(1, 1, 1)),
                    ],
                )
                .await?
            }
            "zarr3" => Explorer::Zarr3Array.explore(ctx, &path, None).await?,
            other => {
                return Err(DsError::failure(format!(
                    "Can not explore layer of {other} type"
                )));
            }
        };
        Ok(explored
            .into_iter()
            .map(|(mut l, v)| {
                l.default_view_configuration = Some(view.clone());
                (l, v)
            })
            .collect())
    }

    /// Scala `NeuroglancerUriExplorer`.
    pub(super) async fn explore_uri(
        ctx: &ExploreContext,
        path: &VaultPath,
        credential_id: Option<&str>,
    ) -> DsResult<Vec<Explored>> {
        let uri = path.to_string();
        let raw = raw_fragment(&uri).ok_or_else(|| {
            DsError::failure("URI has no matching fragment part")
                .wrap("URI has no matching fragment part")
        })?;
        let spec = parse_fragment(raw)
            .ok_or_else(|| DsError::failure("Did not find JSON object in URI"))?;
        let layers = spec
            .get("layers")
            .and_then(Value::as_array)
            .ok_or_else(|| DsError::failure("'layers' is undefined"))?;
        if credential_id.is_some() {
            return Err(DsError::failure(
                "Neuroglancer URI Explorer does not support credentials",
            ));
        }
        let explored = join_all(layers.iter().map(|l| explore_layer(ctx, l))).await;
        let mut all = Vec::new();
        for result in explored {
            all.extend(result?);
        }
        let (layers, sizes): (Vec<StaticLayer>, Vec<VoxelSize>) = all.into_iter().unzip();
        Ok(make_layer_names_unique(layers)
            .into_iter()
            .zip(sizes)
            .collect())
    }
}

// ---- layer set utilities (Scala `ExploreLayerUtils`) ------------------------------------------

/// Scala `formatFailureChain` (an `Empty` box renders as `Empty`).
pub fn format_failure(error: &DsError) -> String {
    if *error == DsError::empty() {
        "Empty".to_owned()
    } else {
        error.to_string()
    }
}

/// Scala `makeLayerNamesUnique`: `name`, `name_2`, `name_3`, …
pub fn make_layer_names_unique(layers: Vec<StaticLayer>) -> Vec<StaticLayer> {
    let mut names = BTreeSet::new();
    layers
        .into_iter()
        .map(|mut layer| {
            let mut candidate = layer.name.clone();
            let mut index = 1;
            while names.contains(&candidate) {
                index += 1;
                candidate = format!("{}_{index}", layer.name);
            }
            names.insert(candidate.clone());
            layer.name = candidate;
            layer
        })
        .collect()
}

fn is_power_of_two_f(x: f64) -> bool {
    let l = x.ln() / 2f64.ln();
    (l - l.round()).abs() < 0.0001
}

fn coordinate_transformation_for_voxel_size(
    found: &VoxelSize,
    preferred: Option<&VoxelSize>,
) -> Option<Vec<CoordinateTransformation>> {
    let preferred = preferred?;
    if preferred == found {
        return None;
    }
    let s = found.ratio(preferred);
    Some(vec![CoordinateTransformation {
        transformation_type: CoordinateTransformationType::Affine,
        matrix: Some(vec![
            vec![s.x, 0.0, 0.0, 0.0],
            vec![0.0, s.y, 0.0, 0.0],
            vec![0.0, 0.0, s.z, 0.0],
            vec![0.0, 0.0, 0.0, 1.0],
        ]),
        correspondences: None,
    }])
}

/// Scala `rescaleLayersByCommonVoxelSize` + `makeLayerNamesUnique` + coordinate transformations.
pub fn adapt_layers_and_voxel_size(
    explored: Vec<Explored>,
    preferred: Option<VoxelSize>,
) -> DsResult<(Vec<StaticLayer>, VoxelSize)> {
    let wrap = |e: DsError| e.wrap("Could not extract common voxel size from layers");
    let mut all: Vec<VoxelSize> = Vec::new();
    for (layer, voxel_size) in &explored {
        for mag in layer.resolutions() {
            let scaled = voxel_size.scaled(mag.to_vec3_double());
            if !all.contains(&scaled) {
                all.push(scaled);
            }
        }
    }
    let min = all
        .iter()
        .copied()
        .reduce(|a, b| {
            let (na, nb) = (a.to_nanometer(), b.to_nanometer());
            if (nb.x, nb.y, nb.z) < (na.x, na.y, na.z) {
                b
            } else {
                a
            }
        })
        .ok_or_else(|| DsError::failure("Could not extract common voxel size from layers"))?;
    let base = match &preferred {
        Some(p) => {
            let mag = min.ratio(p);
            if is_power_of_two_f(mag.x) && is_power_of_two_f(mag.y) && is_power_of_two_f(mag.z) {
                *p
            } else {
                min
            }
        }
        None => min,
    };
    let pow2 = |v: i32| v != 0 && (v & (v - 1)) == 0;
    let mut mags = Vec::new();
    for size in &all {
        let mag = size.ratio(&base).round().to_vec3_int();
        if !(pow2(mag.x) && pow2(mag.y) && pow2(mag.z)) {
            return Err(wrap(
                DsError::failure(format!("invalid mag: {mag}. Must all be powers of two")).wrap(
                    format!(
                        "voxel sizes for layers are not uniform, got List({})",
                        explored
                            .iter()
                            .map(|(_, v)| format!("{v:?}"))
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                ),
            ));
        }
        mags.push(mag);
    }
    let mut by_max_dim: std::collections::BTreeMap<i32, Vec<Vec3Int>> = Default::default();
    for mag in mags {
        by_max_dim.entry(mag.max_dim()).or_default().push(mag);
    }
    for group in by_max_dim.values() {
        if group.len() != 1 {
            return Err(wrap(DsError::failure(format!(
                "detected mags are not unique, found List({})",
                group
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ))));
        }
    }
    let rescaled: Vec<StaticLayer> = explored
        .into_iter()
        .map(|(mut layer, voxel_size)| {
            let factors = voxel_size.ratio(&base).to_vec3_int();
            layer.bounding_box = layer.bounding_box.mul_mag(factors);
            for mag in &mut layer.mags {
                mag.mag = mag.mag * factors;
            }
            layer
        })
        .collect();
    let renamed = make_layer_names_unique(rescaled);
    let generated = coordinate_transformation_for_voxel_size(&base, preferred.as_ref());
    let with_transformations = renamed
        .into_iter()
        .map(|mut layer| {
            layer.coordinate_transformations =
                match (layer.coordinate_transformations.take(), &generated) {
                    (Some(mut existing), Some(g)) => {
                        existing.extend(g.iter().cloned());
                        Some(existing)
                    }
                    (Some(existing), None) => Some(existing),
                    (None, g) => g.clone(),
                };
            layer
        })
        .collect();
    Ok((with_transformations, base))
}

/// Scala `removeHeaderFileNamesFromUriSuffix`.
pub fn remove_header_file_names_from_uri_suffix(uri: &str) -> String {
    let mut out = uri;
    for suffix in [
        "attributes.json",
        ".zarray",
        ".zattrs",
        ".zgroup",
        "info",
        "zarr.json",
    ] {
        out = out.strip_suffix(suffix).unwrap_or(out);
    }
    out.to_owned()
}

/// Scala `removeNeuroglancerPrefixesFromUri`.
pub fn remove_neuroglancer_prefixes_from_uri(uri: &str) -> String {
    let mut out = uri;
    for prefix in ["zarr3://", "zarr://", "precomputed://", "n5://"] {
        out = out.strip_prefix(prefix).unwrap_or(out);
    }
    out.to_owned()
}

/// Scala `ExploreRemoteLayerParameters`.
#[derive(Debug, Clone)]
pub struct ExploreRemoteLayerParameters {
    pub remote_uri: String,
    pub credential_id: Option<String>,
    pub preferred_voxel_size: Option<VoxelSize>,
}

/// Scala `ExploreRemoteLayerService` (credentials and S3 endpoints come from the vault service).
pub struct ExploreRemoteLayerService<'a> {
    pub ctx: ExploreContext,
    pub wk_client: &'a crate::wk_client::WkClient,
    pub local_directory_whitelist: &'a [String],
}

impl ExploreRemoteLayerService<'_> {
    /// Scala `exploreRemoteDatasource`.
    pub async fn explore_remote_datasource(
        &self,
        parameters: &[ExploreRemoteLayerParameters],
        report: &mut Vec<String>,
    ) -> DsResult<UsableDataSource> {
        let mut explored = Vec::new();
        for p in parameters {
            explored.extend(
                self.explore_one_uri(&p.remote_uri, p.credential_id.as_deref(), report)
                    .await?,
            );
        }
        let preferred = parameters.iter().find_map(|p| p.preferred_voxel_size);
        if explored.is_empty() {
            return Err(DsError::failure("Detected zero layers"));
        }
        let (layers, voxel_size) = adapt_layers_and_voxel_size(explored, preferred)?;
        Ok(UsableDataSource {
            id: DataSourceId::new("", ""),
            data_layers: layers,
            scale: voxel_size,
            default_view_configuration: None,
            status_opt: None,
        })
    }

    async fn explore_one_uri(
        &self,
        uri: &str,
        credential_id: Option<&str>,
        report: &mut Vec<String>,
    ) -> DsResult<Vec<Explored>> {
        let cleaned =
            remove_neuroglancer_prefixes_from_uri(&remove_header_file_names_from_uri_suffix(uri));
        let parsed =
            UPath::parse(&cleaned).map_err(|e| e.wrap(format!("Received invalid URI: {uri}")))?;
        let credential = match credential_id {
            Some(id) => {
                let value = self.wk_client.get_credential(id).await?;
                Some(
                    crate::datavault::DataVaultCredential::from_json(&value)
                        .map_err(DsError::failure)?,
                )
            }
            None => None,
        };
        let upath = match &parsed {
            UPath::ZipEntry(..) => parsed.clone(),
            _ if [".zip", ".ozx"]
                .iter()
                .any(|e| parsed.to_string().to_lowercase().ends_with(e)) =>
            {
                UPath::ZipEntry(Box::new(parsed.clone()), String::new())
            }
            _ => parsed.clone(),
        };
        if !upath.is_remote() {
            let allowed = self.local_directory_whitelist.iter().any(|entry| {
                upath.starts_with(&UPath::from_local_path(std::path::Path::new(entry)))
            });
            if !allowed {
                return Err(DsError::failure(format!(
                    "Absolute path {upath} in local file system is not in path whitelist. Consider adding it to datastore.localDirectoryWhitelist"
                )));
            }
        }
        let path = self
            .ctx
            .vaults
            .vault_path_for_credentialized(crate::datavault::CredentializedUPath::new(
                upath, credential,
            ))
            .await
            .map_err(|e| e.wrap("Failed to set up remote file system"))?;
        let mut queue = vec![(path, 0usize)];
        let explorers = Explorer::REMOTE;
        while !queue.is_empty() {
            let (path, depth) = queue.remove(0);
            if depth > MAX_RECURSIVE_SEARCH_DEPTH {
                return Err(DsError::empty());
            }
            let results = join_all(
                explorers
                    .iter()
                    .map(|e| e.explore(&self.ctx, &path, credential_id)),
            )
            .await;
            let mut found = None;
            for (explorer, result) in explorers.iter().zip(results) {
                match result {
                    Ok(layers) => {
                        report.push(format!(
                            "Found {} {} layers at {path}.",
                            layers.len(),
                            explorer.name()
                        ));
                        found.get_or_insert(layers);
                    }
                    Err(e) => report.push(format!(
                        "Error when reading {path} as {}: {e}",
                        explorer.name()
                    )),
                }
            }
            if let Some(layers) = found {
                return Ok(layers);
            }
            let children = path
                .list_directory(MAX_EXPLORED_ITEMS_PER_LEVEL, self.ctx.token())
                .await
                .map_err(DsError::from)?;
            queue.extend(children.into_iter().map(|c| (c, depth + 1)));
        }
        // Scala `Fox.empty` once nothing is left to search.
        Err(DsError::empty())
    }
}

// ---- local exploration (Scala `ExploreLocalLayerService`) -------------------------------------

fn local_upath(path: &std::path::Path) -> UPath {
    let upath = UPath::from_local_path(path);
    if [".zip", ".ozx"]
        .iter()
        .any(|e| path.to_string_lossy().to_lowercase().ends_with(e))
    {
        UPath::ZipEntry(Box::new(upath), String::new())
    } else {
        upath
    }
}

fn map_mag_paths(layers: Vec<StaticLayer>, f: impl Fn(&UPath) -> UPath) -> Vec<StaticLayer> {
    layers
        .into_iter()
        .map(|mut layer| {
            for mag in &mut layer.mags {
                mag.path = mag.path.as_ref().map(&f);
            }
            layer
        })
        .collect()
}

/// Scala `selectLastDirectory`.
fn select_last_directory(p: &UPath) -> UPath {
    let parent = p.parent();
    if &parent == p {
        p.clone()
    } else {
        p.relativized_in(&parent)
    }
}

/// Scala `selectLastTwoDirectories`.
fn select_last_two_directories(p: &UPath) -> UPath {
    let parent = p.parent();
    let grand_parent = parent.parent();
    if &parent == p || grand_parent == parent {
        p.clone()
    } else {
        p.relativized_in(&grand_parent)
    }
}

fn directory_entries(path: &std::path::Path) -> DsResult<Vec<std::path::PathBuf>> {
    let mut entries: Vec<_> = std::fs::read_dir(path)
        .map_err(|e| DsError::failure(e.to_string()))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .collect();
    entries.sort();
    Ok(entries)
}

/// Scala `exploreLocalLayer`.
async fn explore_local_layer(
    ctx: &ExploreContext,
    explorer: Explorer,
    relative: fn(&UPath) -> UPath,
    path: &std::path::Path,
    id: &DataSourceId,
    layer_directory: &str,
) -> DsResult<UsableDataSource> {
    let layer = if layer_directory.is_empty() {
        match directory_entries(path)?.as_slice() {
            [single] => single
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            _ => String::new(),
        }
    } else {
        layer_directory.to_owned()
    };
    let resolved = if layer.is_empty() {
        path.to_path_buf()
    } else {
        path.join(&layer)
    };
    let vault_path = ctx
        .vaults
        .vault_path_for(&local_upath(&resolved))
        .await
        .map_err(|e| e.wrap("Failed to set up remote file system"))?;
    let explored = explorer.explore(ctx, &vault_path, None).await?;
    let (layers, voxel_size) = adapt_layers_and_voxel_size(explored, None)?;
    Ok(UsableDataSource {
        id: id.clone(),
        data_layers: map_mag_paths(layers, relative),
        scale: voxel_size,
        default_view_configuration: None,
        status_opt: None,
    })
}

/// Scala `exploreLocalZarrArray`: every entry of the layer directory must be a mag directory.
async fn explore_local_zarr_array(
    ctx: &ExploreContext,
    path: &std::path::Path,
    id: &DataSourceId,
    layer_directory: &str,
) -> DsResult<UsableDataSource> {
    let dir = if layer_directory.is_empty() {
        path.to_path_buf()
    } else {
        path.join(layer_directory)
    };
    let entries = directory_entries(&dir).map_err(|e| {
        e.wrap(format!(
            "Could not resolve color directory as child of {}",
            path.display()
        ))
    })?;
    let mut explored = Vec::new();
    for entry in entries {
        let name = entry
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let mag = Vec3Int::from_mag_literal(&name, true)
            .ok_or_else(|| DsError::failure(format!("invalid mag: {name}")))?;
        let vault_path = ctx
            .vaults
            .vault_path_for(&UPath::from_local_path(&entry))
            .await
            .map_err(|e| e.wrap("Failed to set up remote file system"))?;
        explored.extend(
            Explorer::ZarrArray(mag)
                .explore(ctx, &vault_path, None)
                .await?,
        );
    }
    let (layers, voxel_size) = adapt_layers_and_voxel_size(explored, None)?;
    Ok(UsableDataSource {
        id: id.clone(),
        data_layers: map_mag_paths(layers, select_last_two_directories),
        scale: voxel_size,
        default_view_configuration: None,
        status_opt: None,
    })
}

fn has_n5_header(dir: &std::path::Path) -> bool {
    std::fs::read(dir.join("attributes.json")).is_ok_and(|b| N5Header::parse(&b).is_ok())
}

/// Scala `PathUtils.recurseSubdirsUntil` (depth-first, max depth 10).
fn recurse_subdirs_until(
    path: &std::path::Path,
    condition: &dyn Fn(&std::path::Path) -> bool,
    depth: usize,
) -> Option<std::path::PathBuf> {
    if depth > 10 {
        return None;
    }
    if condition(path) {
        return Some(path.to_path_buf());
    }
    directory_entries(path)
        .ok()?
        .into_iter()
        .filter(|p| p.is_dir())
        .find_map(|dir| recurse_subdirs_until(&dir, condition, depth + 1))
}

/// Scala `exploreLocalN5Array`.
async fn explore_local_n5_array(
    ctx: &ExploreContext,
    path: &std::path::Path,
    id: &DataSourceId,
) -> DsResult<UsableDataSource> {
    let layer_path =
        recurse_subdirs_until(path, &has_n5_header, 0).unwrap_or_else(|| path.to_path_buf());
    let base = UPath::from_local_path(path);
    let mut explored =
        explore_local_layer(ctx, Explorer::N5Array, |p| p.clone(), &layer_path, id, "").await?;
    explored.data_layers = map_mag_paths(explored.data_layers, |p| p.relativized_in(&base));
    Ok(explored)
}

/// Scala `ExploreLocalLayerService.exploreLocal`: first successful local explorer.
pub async fn explore_local(
    ctx: &ExploreContext,
    path: &std::path::Path,
    id: &DataSourceId,
    layer_directory: &str,
) -> DsResult<UsableDataSource> {
    let attempts = [
        explore_local_layer(
            ctx,
            Explorer::NgffV0_4,
            select_last_two_directories,
            path,
            id,
            "",
        )
        .await,
        explore_local_layer(
            ctx,
            Explorer::NgffV0_5,
            select_last_two_directories,
            path,
            id,
            "",
        )
        .await,
        explore_local_zarr_array(ctx, path, id, layer_directory).await,
        explore_local_layer(
            ctx,
            Explorer::Precomputed,
            select_last_directory,
            path,
            id,
            layer_directory,
        )
        .await,
        explore_local_layer(
            ctx,
            Explorer::N5CompactMultiscales,
            select_last_directory,
            path,
            id,
            layer_directory,
        )
        .await,
        explore_local_layer(
            ctx,
            Explorer::N5Multiscales,
            select_last_directory,
            path,
            id,
            layer_directory,
        )
        .await,
        explore_local_n5_array(ctx, path, id).await,
    ];
    let mut last = DsError::empty();
    for attempt in attempts {
        match attempt {
            Ok(source) => return Ok(source),
            Err(e) => last = e,
        }
    }
    Err(last.wrap("Could not explore local data source"))
}

/// Scala `writeLocalDatasourceProperties` (compact JSON).
pub fn write_local_datasource_properties(
    source: &UsableDataSource,
    path: &std::path::Path,
) -> DsResult<()> {
    let value = serde_json::to_value(source).map_err(DsError::from_exception)?;
    let bytes = serde_json::to_vec(&crate::models::json::PlayValue(&value))
        .map_err(DsError::from_exception)?;
    std::fs::write(
        path.join(crate::models::FILENAME_DATASOURCE_PROPERTIES_JSON),
        bytes,
    )
    .map_err(|e| DsError::failure(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_uri_decorations() {
        assert_eq!(
            remove_header_file_names_from_uri_suffix("s3://b/x/.zarray"),
            "s3://b/x/"
        );
        assert_eq!(
            remove_neuroglancer_prefixes_from_uri("zarr://https://h/x"),
            "https://h/x"
        );
    }

    #[test]
    fn parses_neuroglancer_fragments() {
        let raw = neuroglancer::raw_fragment("https://ng/#!%7B%22layers%22:[]%7D").unwrap();
        assert_eq!(
            neuroglancer::parse_fragment(raw).unwrap()["layers"],
            json!([])
        );
        let twice = "%257B%2522a%2522:%2522x+y%2522%257D";
        assert_eq!(neuroglancer::parse_fragment(twice).unwrap()["a"], "x+y");
        assert_eq!(
            neuroglancer::primary_source_url(&json!([{"url": "zarr://s3://b/x"}])).unwrap(),
            "zarr://s3://b/x"
        );
    }

    #[test]
    fn renames_duplicate_layers() {
        let l = |n: &str| {
            layer(
                n,
                DataFormat::Zarr,
                BoundingBox::new(Vec3Int::new(0, 0, 0), 1, 1, 1),
                ElementClass::Uint8,
                vec![],
                false,
            )
        };
        let names: Vec<String> = make_layer_names_unique(vec![l("a"), l("a"), l("a_2"), l("b")])
            .into_iter()
            .map(|l| l.name)
            .collect();
        assert_eq!(names, ["a", "a_2", "a_2_2", "b"]);
    }

    #[test]
    fn unifies_voxel_sizes_by_powers_of_two() {
        let mag = |m: [i32; 3]| MagLocator::new(Vec3Int::new(m[0], m[1], m[2]));
        let l = |name: &str, mags: Vec<MagLocator>| StaticLayer {
            mags,
            ..layer(
                name,
                DataFormat::Zarr,
                BoundingBox::new(Vec3Int::new(0, 0, 0), 10, 10, 10),
                ElementClass::Uint8,
                vec![],
                false,
            )
        };
        let v = |x: f64| VoxelSize::from_factor_with_default_unit(Vec3Double::new(x, x, x));
        let (layers, base) = adapt_layers_and_voxel_size(
            vec![
                (l("fine", vec![mag([1, 1, 1])]), v(4.0)),
                (l("coarse", vec![mag([1, 1, 1])]), v(8.0)),
            ],
            None,
        )
        .unwrap();
        assert_eq!(base, v(4.0));
        assert_eq!(layers[1].mags[0].mag, Vec3Int::new(2, 2, 2));
        assert_eq!(layers[1].bounding_box.width, 20);
        let error = adapt_layers_and_voxel_size(
            vec![
                (l("x", vec![mag([1, 1, 1])]), v(4.0)),
                (l("y", vec![mag([1, 1, 1])]), v(12.0)),
            ],
            None,
        )
        .unwrap_err();
        assert_eq!(
            error.message,
            "Could not extract common voxel size from layers"
        );
        // A power-of-two compatible preferred voxel size becomes the base (no transformation).
        let (layers, base) =
            adapt_layers_and_voxel_size(vec![(l("x", vec![mag([1, 1, 1])]), v(4.0))], Some(v(2.0)))
                .unwrap();
        assert_eq!(base, v(2.0));
        assert_eq!(layers[0].mags[0].mag, Vec3Int::new(2, 2, 2));
        assert!(layers[0].coordinate_transformations.is_none());
        // Otherwise the found size is kept and scaled to the preferred one.
        let (layers, base) =
            adapt_layers_and_voxel_size(vec![(l("x", vec![mag([1, 1, 1])]), v(4.0))], Some(v(3.0)))
                .unwrap();
        assert_eq!(base, v(4.0));
        let matrix = layers[0].coordinate_transformations.as_ref().unwrap()[0]
            .matrix
            .clone()
            .unwrap();
        assert!((matrix[0][0] - 4.0 / 3.0).abs() < 1e-12);
    }
}
