//! Scala `NgffExplorationUtils`, `NgffV0_4Explorer` and `NgffV0_5Explorer`.
use std::collections::BTreeSet;

use serde_json::{Map, Value, json};

use crate::{
    datareaders::{
        DatasetHeader,
        zarr::{
            ZarrHeader,
            ngff::{NgffAxis, NgffCoordinateTransformation, NgffMetadata, NgffMultiscalesItem},
        },
        zarr3::{Zarr3Header, ngff::NgffZarr3GroupHeader},
    },
    datavault::VaultPath,
    error::{DsError, DsResult},
    models::{
        AdditionalAxis, AxisOrder, BoundingBox, CoordinateTransformation, StaticLayer, Vec3Double,
        Vec3Int, VoxelSize,
        enums::{CoordinateTransformationType, DataFormat, ElementClass, LengthUnit},
    },
};
use webknossos_common::explore_layers::Explored;

use super::remote_layer_explorer::{
    ExploreContext, MagWithAttributes, bounding_box_from_mags, element_class_from_mags, layer,
    looks_like_segmentation_layer, mag_locator,
};

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
    let replaced = crate::services::upload::finish::normalize_text(name);
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
    let axis = axis_order(&multiscale.axes).map_err(|e| {
        e.wrap(
            "Could not extract XYZ axis order mapping. Does the data have x, y and z \
            axes, stated in multiscales metadata?",
        )
    })?;
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
    let (view_config, channel_name) = parse_channel_attributes(attributes, dataset_name, channel)?;
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
    let axis = axis_order(&multiscale.axes).map_err(|e| {
        e.wrap(
            "Could not extract XYZ axis order mapping. Does the data have x, y and z \
            axes, stated in multiscales metadata?",
        )
    })?;
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
