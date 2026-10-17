//! Scala `ExploreLayerUtils`: combining layers of different voxel sizes into one data source
//! (dataset exploration in the datastore, dataset composition in the backend).

use std::collections::BTreeSet;

use crate::{
    datasource::{CoordinateTransformation, StaticLayer, VoxelSize},
    enums::CoordinateTransformationType,
    geometry::Vec3Int,
};

/// A layer with the voxel size of the data source it was found in.
pub type Explored = (StaticLayer, VoxelSize);

const COMMON_VOXEL_SIZE_FAILED: &str = "Could not extract common voxel size from layers";

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
///
/// Failures are returned as Scala's failure chain, innermost message first.
pub fn adapt_layers_and_voxel_size(
    explored: Vec<Explored>,
    preferred: Option<VoxelSize>,
) -> Result<(Vec<StaticLayer>, VoxelSize), Vec<String>> {
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
        .ok_or_else(|| vec![COMMON_VOXEL_SIZE_FAILED.to_owned()])?;
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
            return Err(vec![
                format!("invalid mag: {mag}. Must all be powers of two"),
                format!(
                    "voxel sizes for layers are not uniform, got List({})",
                    explored
                        .iter()
                        .map(|(_, v)| format!("{v:?}"))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                COMMON_VOXEL_SIZE_FAILED.to_owned(),
            ]);
        }
        mags.push(mag);
    }
    let mut by_max_dim: std::collections::BTreeMap<i32, Vec<Vec3Int>> = Default::default();
    for mag in mags {
        by_max_dim.entry(mag.max_dim()).or_default().push(mag);
    }
    for group in by_max_dim.values() {
        if group.len() != 1 {
            return Err(vec![
                format!(
                    "detected mags are not unique, found List({})",
                    group
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                COMMON_VOXEL_SIZE_FAILED.to_owned(),
            ]);
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

#[cfg(test)]
mod tests;
