//! Scala `N5Explorer`, `N5MultiscalesExplorer`, `N5CompactMultiscalesExplorer` and `N5ArrayExplorer`.

use serde_json::Value;

use crate::{
    datareaders::{DatasetHeader, n5::N5Header},
    datavault::{ByteRange, VaultPath},
    error::{DsError, DsResult},
    models::{AxisOrder, StaticLayer, Vec3Double, Vec3Int, VoxelSize, enums::DataFormat},
};
use webknossos_common::explore_layers::Explored;

use super::remote_layer_explorer::{
    ExploreContext, MagWithAttributes, bounding_box_from_mags, bounding_box_of,
    element_class_from_mags, element_class_of, layer, looks_like_segmentation_layer, mag_locator,
    unit_voxel_size, zyx_from_rank,
};

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
    let axis = axis_order(&t.axes).map_err(|e| {
        e.wrap(
            "Could not extract XYZ axis order mapping. Does the data have x, y and z \
            axes, stated in multiscales metadata?",
        )
    })?;
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
        .map_err(|e| DsError::from(e.wrap(format!("failed to read n5 header at {header_path}"))))?;
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
            let axis = axis_order(&t.axes).map_err(|e| {
                e.wrap(
                    "Could not extract XYZ axis order mapping. Does the data have x, y \
                    and z axes, stated in multiscales metadata?",
                )
            })?;
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
        .map_err(|e| DsError::from(e.wrap(format!("failed to read n5 header at {header_path}"))))?;
    let header = N5Header::parse(&bytes)
        .map_err(|e| e.wrap(format!("failed to read n5 header at {header_path}")))?;
    let name = path.basename();
    let element_class = element_class_of(&header, "failed to read element class from n5 header")?;
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
