//! Scala `FindDataService` (+ `DataFinder`, `DataConverter`): sample bucket positions of a layer to
//! find a position with data and to build value histograms.
use std::sync::Arc;

use futures::future::join_all;
use serde::Serialize;

use crate::{
    error::{DsError, DsResult},
    models::{
        BUCKET_LENGTH, DataSourceId, ElementClass, StaticLayer, Vec3Int,
        data_requests::{
            Cuboid, DataServiceDataRequest, DataServiceRequestSettings, VoxelPosition,
        },
        json::play_f64,
    },
    services::BinaryDataService,
};

const LOADING_DATA_FAILED: &str = "Could not load data for the requested dataset.";
const NO_MAGS: &str = "Data layer does not contain any mags.";

/// Scala `Histogram(elementCounts, min, max)`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Histogram {
    pub element_counts: Vec<i64>,
    #[serde(serialize_with = "play_f64")]
    pub min: f64,
    #[serde(serialize_with = "play_f64")]
    pub max: f64,
}

/// Which dataset/layer the sampled buckets come from.
pub struct FindDataTarget<'a> {
    pub dataset_id: &'a str,
    pub data_source_id: &'a DataSourceId,
    pub layer: &'a Arc<StaticLayer>,
}

impl FindDataTarget<'_> {
    async fn bucket_at(
        &self,
        service: &BinaryDataService,
        position: Vec3Int,
        mag: Vec3Int,
        token: Option<&str>,
    ) -> DsResult<Vec<u8>> {
        let request = DataServiceDataRequest {
            dataset_id: Some(self.dataset_id.to_owned()),
            data_source_id: Some(self.data_source_id.clone()),
            data_layer: Arc::clone(self.layer),
            cuboid: Cuboid::new(
                VoxelPosition::new(position, mag)?,
                Vec3Int::full(BUCKET_LENGTH),
            ),
            settings: DataServiceRequestSettings::default(),
        };
        Ok(service.read(&request, token).await?)
    }
}

/// Scala `createPositions`: a coarse-to-fine grid inside the bounding box plus its top-left
/// corner, aligned to buckets, duplicates removed (first occurrence wins).
pub fn create_positions(layer: &StaticLayer, iteration_count: u32) -> Vec<Vec3Int> {
    let bbox = &layer.bounding_box;
    let mut positions = Vec::new();
    for exponent in 1..=iteration_count {
        let power = 2i32.pow(exponent);
        let space = Vec3Int::new(bbox.width / power, bbox.height / power, bbox.depth / power);
        if space.x < BUCKET_LENGTH && space.y < BUCKET_LENGTH && space.z < BUCKET_LENGTH {
            break;
        }
        for z in 1..power {
            for y in 1..power {
                for x in 1..power {
                    positions.push(Vec3Int::new(
                        bbox.top_left.x.wrapping_add(x.wrapping_mul(space.x)),
                        bbox.top_left.y.wrapping_add(y.wrapping_mul(space.y)),
                        bbox.top_left.z.wrapping_add(z.wrapping_mul(space.z)),
                    ));
                }
            }
        }
    }
    positions.push(bbox.top_left);
    let mut distinct: Vec<Vec3Int> = Vec::with_capacity(positions.len());
    for position in positions {
        let aligned = position.align_with_grid_floor(Vec3Int::full(BUCKET_LENGTH));
        if !distinct.contains(&aligned) {
            distinct.push(aligned);
        }
    }
    distinct
}

/// Scala `getPositionOfNonZeroData`: the first non-zero voxel (x fastest) of a bucket, added to
/// the bucket position without mag scaling (as Scala does).
pub fn position_of_non_zero_data(
    data: &[u8],
    offset: Vec3Int,
    bytes_per_element: usize,
) -> Option<Vec3Int> {
    if !data.iter().any(|b| *b != 0) {
        return None;
    }
    let length = BUCKET_LENGTH as usize;
    let mut exact = Vec3Int::new(0, 0, 0);
    'search: for z in 0..length {
        for y in 0..length {
            for x in 0..length {
                let start = (x + y * length + z * length * length) * bytes_per_element;
                let end = (start + bytes_per_element).min(data.len());
                if start < end && data[start..end].iter().any(|b| *b != 0) {
                    exact = Vec3Int::new(x as i32, y as i32, z as i32);
                    break 'search;
                }
            }
        }
    }
    Some(offset + exact)
}

/// Scala `findPositionWithData`: mags from finest (by max dimension) to coarsest; within a mag,
/// positions in order. Failed bucket reads count as "no data".
pub async fn find_position_with_data(
    service: &BinaryDataService,
    target: &FindDataTarget<'_>,
    token: Option<&str>,
) -> Option<(Vec3Int, Vec3Int)> {
    let positions = create_positions(target.layer, 4);
    let mut mags = target.layer.resolutions();
    mags.sort_by_key(|m| m.max_dim());
    for mag in mags {
        for &position in &positions {
            if let Ok(data) = target.bucket_at(service, position, mag, token).await
                && let Some(found) =
                    position_of_non_zero_data(&data, position, target.layer.bytes_per_element())
            {
                return Some((found, mag));
            }
        }
    }
    None
}

/// Scala `createHistogram`: buckets at a coarse grid in the finest mag, zeros removed (except
/// uint24), binned into 256 buckets per channel.
pub async fn create_histogram(
    service: &BinaryDataService,
    target: &FindDataTarget<'_>,
    token: Option<&str>,
) -> DsResult<Vec<Histogram>> {
    let mags = target.layer.resolutions();
    let mag = *mags
        .iter()
        .min_by_key(|m| m.max_dim())
        .ok_or_else(|| DsError::failure(NO_MAGS))?;
    let positions = create_positions(target.layer, 2);
    // Scala `Fox.sequenceOfFulls`: all reads in parallel, failed or missing buckets dropped.
    let buckets: Vec<Vec<u8>> = join_all(
        positions
            .iter()
            .map(|p| target.bucket_at(service, *p, mag, token)),
    )
    .await
    .into_iter()
    .filter_map(Result::ok)
    .collect();
    if buckets.is_empty() {
        return Err(DsError::failure(LOADING_DATA_FAILED).wrap(LOADING_DATA_FAILED));
    }
    calculate_histogram_values(&buckets.concat(), target.layer.element_class)
}

fn bin_counts<const N: usize, T: Copy>(
    data: &[u8],
    decode: fn([u8; N]) -> T,
    keep: impl Fn(T) -> bool,
    bin: impl Fn(T) -> usize,
    counts: &mut [i64],
) {
    for chunk in data.as_chunks::<N>().0 {
        let value = decode(*chunk);
        if keep(value) {
            counts[bin(value)] += 1;
        }
    }
}

/// Scala `filterZeroes(convertData(..))` + `calculateHistogramValues`.
pub fn calculate_histogram_values(
    data: &[u8],
    element_class: ElementClass,
) -> DsResult<Vec<Histogram>> {
    let bytes = element_class.bytes_per_element() as i32;
    let signed = element_class.is_signed();
    let (mut min, mut max) = if signed {
        (-(2f64.powi(8 * bytes - 1)), 2f64.powi(8 * bytes - 1) - 1.0)
    } else {
        (0.0, 2f64.powi(8 * bytes) - 1.0)
    };
    let mut counts = vec![
        0i64;
        if element_class == ElementClass::Uint24 {
            768
        } else {
            256
        }
    ];
    match element_class {
        ElementClass::Uint24 => {
            // Not zero-filtered; per-channel bins. Scala reads `i + 1`/`i + 2` unguarded.
            if !data.len().is_multiple_of(3) {
                return Err(DsError::failure(
                    "java.lang.ArrayIndexOutOfBoundsException while binning uint24 data",
                ));
            }
            for rgb in data.as_chunks::<3>().0 {
                counts[rgb[0] as usize] += 1;
                counts[rgb[1] as usize + 256] += 1;
                counts[rgb[2] as usize + 512] += 1;
            }
            if !data.is_empty() {
                (min, max) = (0.0, 255.0);
            }
        }
        ElementClass::Uint8 | ElementClass::Int8 => bin_counts::<1, u8>(
            data,
            |b| b[0],
            |v| v != 0,
            |v| {
                if signed {
                    (v as i8 as i32 + 128) as usize
                } else {
                    v as usize
                }
            },
            &mut counts,
        ),
        ElementClass::Uint16 | ElementClass::Int16 => bin_counts::<2, i16>(
            data,
            i16::from_le_bytes,
            |v| v != 0,
            |v| {
                if signed {
                    ((v >> 8) as i32 + 128) as usize
                } else {
                    ((v as u16) >> 8) as usize
                }
            },
            &mut counts,
        ),
        ElementClass::Uint32 | ElementClass::Int32 => bin_counts::<4, i32>(
            data,
            i32::from_le_bytes,
            |v| v != 0,
            |v| {
                if signed {
                    ((v >> 24) + 128) as usize
                } else {
                    ((v as u32) >> 24) as usize
                }
            },
            &mut counts,
        ),
        ElementClass::Uint64 | ElementClass::Int64 => bin_counts::<8, i64>(
            data,
            i64::from_le_bytes,
            |v| v != 0,
            |v| {
                if signed {
                    ((v >> 56) as i32 + 128) as usize
                } else {
                    ((v as u64) >> 56) as usize
                }
            },
            &mut counts,
        ),
        ElementClass::Float => {
            let values: Vec<f32> = data
                .as_chunks::<4>()
                .0
                .iter()
                .map(|c| f32::from_le_bytes(*c))
                .filter(|v| !v.is_nan() && v.abs() >= 1e-7)
                .collect();
            if let Some(&first) = values.first() {
                let (lo, hi) = values
                    .iter()
                    .fold((first, first), |(lo, hi), &v| (lo.min(v), hi.max(v)));
                let bin_size = (hi - lo) / 255.0;
                let bin_size = if bin_size.abs() < 1e-7 { 1.0 } else { bin_size };
                for v in values {
                    // Java float → int: NaN → 0, saturating; out-of-range bins throw in Scala.
                    let bin = ((v - lo) / bin_size).floor() as i32;
                    let slot = usize::try_from(bin)
                        .ok()
                        .and_then(|b| counts.get_mut(b))
                        .ok_or_else(|| {
                            DsError::failure(format!(
                                "java.lang.ArrayIndexOutOfBoundsException: Index {bin} out of bounds for length 256"
                            ))
                        })?;
                    *slot += 1;
                }
                (min, max) = (f64::from(lo), f64::from(hi));
            }
        }
        ElementClass::Double => {
            // Scala `convertData` has no case for double and throws a MatchError.
            return Err(DsError::failure(
                "scala.MatchError: double (of class scala.Enumeration$Val)",
            ));
        }
    }
    if element_class == ElementClass::Uint24 {
        Ok(counts
            .chunks(256)
            .map(|channel| {
                let mut element_counts = channel.to_vec();
                element_counts[0] = 0;
                Histogram {
                    element_counts,
                    min,
                    max,
                }
            })
            .collect())
    } else {
        Ok(vec![Histogram {
            element_counts: counts,
            min,
            max,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_and_unsigned_bins_match_scala() {
        let h = calculate_histogram_values(&[0, 1, 255, 128], ElementClass::Uint8).unwrap();
        assert_eq!(h[0].element_counts[1], 1);
        assert_eq!(h[0].element_counts[255], 1);
        assert_eq!(h[0].element_counts[128], 1);
        assert_eq!(h[0].element_counts[0], 0);
        assert_eq!((h[0].min, h[0].max), (0.0, 255.0));

        let h = calculate_histogram_values(&[0xff, 0x7f], ElementClass::Int8).unwrap();
        assert_eq!(h[0].element_counts[127], 1); // -1
        assert_eq!(h[0].element_counts[255], 1); // 127
        assert_eq!((h[0].min, h[0].max), (-128.0, 127.0));

        let data: Vec<u8> = [-1i16, 0x0100, i16::MIN]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let h = calculate_histogram_values(&data, ElementClass::Uint16).unwrap();
        assert_eq!(h[0].element_counts[255], 1);
        assert_eq!(h[0].element_counts[1], 1);
        assert_eq!(h[0].element_counts[128], 1);
        let h = calculate_histogram_values(&data, ElementClass::Int16).unwrap();
        assert_eq!(h[0].element_counts[127], 1);
        assert_eq!(h[0].element_counts[129], 1);
        assert_eq!(h[0].element_counts[0], 1);
    }

    #[test]
    fn uint24_keeps_zeros_but_clears_bin_zero() {
        let h = calculate_histogram_values(&[0, 5, 255, 0, 5, 1], ElementClass::Uint24).unwrap();
        assert_eq!(h.len(), 3);
        assert_eq!(h[0].element_counts[0], 0);
        assert_eq!(h[1].element_counts[5], 2);
        assert_eq!(h[2].element_counts[255], 1);
        assert_eq!(h[2].element_counts[1], 1);
        assert_eq!((h[0].min, h[0].max), (0.0, 255.0));
    }

    #[test]
    fn float_bins_span_observed_range() {
        let data: Vec<u8> = [0.0f32, f32::NAN, 1.0, 2.0, 3.0]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let h = calculate_histogram_values(&data, ElementClass::Float).unwrap();
        assert_eq!(h[0].element_counts[0], 1);
        // Java float oracle: (3-1)/((3-1)/255) == 254.99998f, so the maximum lands in bin 254.
        assert_eq!(h[0].element_counts[127], 1);
        assert_eq!(h[0].element_counts[254], 1);
        assert_eq!((h[0].min, h[0].max), (1.0, 3.0));
        // All-zero float data keeps the signed 32-bit default extrema.
        let h = calculate_histogram_values(&[0; 8], ElementClass::Float).unwrap();
        assert_eq!((h[0].min, h[0].max), (-2147483648.0, 2147483647.0));
        assert_eq!(
            serde_json::to_value(&h[0]).unwrap()["min"],
            serde_json::json!(-2147483648i64)
        );
    }

    #[test]
    fn finds_first_non_zero_voxel_x_fastest() {
        let mut data = vec![0u8; 32 * 32 * 32 * 2];
        data[(3 + 2 * 32 + 32 * 32) * 2 + 1] = 7;
        assert_eq!(
            position_of_non_zero_data(&data, Vec3Int::new(64, 0, 32), 2),
            Some(Vec3Int::new(67, 2, 33))
        );
        assert_eq!(
            position_of_non_zero_data(&[0; 8], Vec3Int::new(0, 0, 0), 1),
            None
        );
    }
}
