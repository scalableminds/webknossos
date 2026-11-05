//! Native functions of `NativeBucketScanner`: scanning and rewriting the segment ids of volume buckets.
//!
//! A bucket is a byte array of little-endian elements with 1, 2, 4 or 8 bytes each, signed or unsigned. Each
//! element is read as an i64 (sign- or zero-extended), which is how segment ids are compared and passed around.

use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};

use jni::EnvUnowned;
use jni::objects::{JByteArray, JIntArray, JLongArray, JObject};
use jni::sys::{jboolean, jint, jlong};

use crate::jni_util::{self, NativeResult, invalid_argument};
use crate::voxel_runs::{self, write as write_voxel_runs};

/// One of the eight element types of a bucket.
pub trait Element: Copy {
    const SIZE: usize;
    /// Reads one element from exactly `SIZE` bytes, extended to i64.
    fn read(bytes: &[u8]) -> i64;
    /// Writes the low `SIZE` bytes of `value` into exactly `SIZE` bytes.
    fn write(bytes: &mut [u8], value: i64);
}

macro_rules! impl_element {
    ($($t:ty),*) => {$(
        impl Element for $t {
            const SIZE: usize = std::mem::size_of::<$t>();
            #[inline(always)]
            fn read(bytes: &[u8]) -> i64 {
                <$t>::from_le_bytes(bytes.try_into().unwrap()) as i64
            }
            #[inline(always)]
            fn write(bytes: &mut [u8], value: i64) {
                bytes.copy_from_slice(&(value as $t).to_le_bytes());
            }
        }
    )*};
}
impl_element!(u8, i8, u16, i16, u32, i32, u64, i64);

/// Calls the generic function `$function::<T>($args)` for the element type given by bytes per element and
/// signedness, or returns an error for an unsupported element size.
macro_rules! with_element_type {
    ($bytes_per_element:expr, $is_signed:expr, $function:ident($($arg:expr),*)) => {
        match ($bytes_per_element, $is_signed) {
            (1, false) => Ok($function::<u8>($($arg),*)),
            (1, true) => Ok($function::<i8>($($arg),*)),
            (2, false) => Ok($function::<u16>($($arg),*)),
            (2, true) => Ok($function::<i16>($($arg),*)),
            (4, false) => Ok($function::<u32>($($arg),*)),
            (4, true) => Ok($function::<i32>($($arg),*)),
            (8, false) => Ok($function::<u64>($($arg),*)),
            (8, true) => Ok($function::<i64>($($arg),*)),
            _ => invalid_argument("unsupported bytesPerElement value"),
        }
    };
}

/// The number of elements in a bucket of `length_bytes` bytes.
pub fn element_count(length_bytes: usize, bytes_per_element: i32) -> NativeResult<usize> {
    if bytes_per_element == 0 {
        return invalid_argument("bytesPerElement cannot be zero");
    }
    if bytes_per_element < 0 {
        return invalid_argument("bytesPerElement cannot be negative");
    }
    let bytes_per_element = bytes_per_element as usize;
    if !length_bytes.is_multiple_of(bytes_per_element) {
        return invalid_argument("Bucket bytes length must be divisible by bytesPerElement");
    }
    Ok(length_bytes / bytes_per_element)
}

fn count_segment_voxels_typed<T: Element>(bucket: &[u8], segment_id: i64) -> usize {
    bucket
        .chunks_exact(T::SIZE)
        .filter(|element| T::read(element) == segment_id)
        .count()
}

/// The number of elements of the bucket that equal `segment_id`.
pub fn count_segment_voxels(
    bucket: &[u8],
    bytes_per_element: i32,
    is_signed: bool,
    segment_id: i64,
) -> NativeResult<usize> {
    if element_count(bucket.len(), bytes_per_element)? == 0 {
        return Ok(0); // an unsupported element size is only an error once an element is read
    }
    with_element_type!(
        bytes_per_element,
        is_signed,
        count_segment_voxels_typed(bucket, segment_id)
    )
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_countSegmentVoxels<
    'local,
>(
    env: EnvUnowned<'local>,
    _this: JObject<'local>,
    bucket_bytes: JByteArray<'local>,
    bytes_per_element: jint,
    is_signed: jboolean,
    segment_id: jlong,
) -> jlong {
    jni_util::run(env, "BucketScanner countSegmentVoxels", |env| {
        let bucket = jni_util::read_bytes(env, &bucket_bytes)?;
        Ok(count_segment_voxels(&bucket, bytes_per_element, is_signed, segment_id)? as jlong)
    })
}

/// A fast hasher for segment ids (the multiply-rotate of rustc-hash). The default SipHash is DoS resistant,
/// which is not needed here, and several times slower.
#[derive(Default, Clone, Copy)]
pub struct IdHasher(u64);

impl Hasher for IdHasher {
    #[inline(always)]
    fn write(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.write_u64(byte as u64);
        }
    }
    #[inline(always)]
    fn write_u64(&mut self, value: u64) {
        self.0 = (self.0.wrapping_add(value)).wrapping_mul(0xf135_7aea_2e62_a9c5);
    }
    #[inline(always)]
    fn write_i64(&mut self, value: i64) {
        self.write_u64(value as u64);
    }
    #[inline(always)]
    fn finish(&self) -> u64 {
        self.0.rotate_left(26)
    }
}

type IdBuildHasher = BuildHasherDefault<IdHasher>;
pub type IdSet = HashSet<i64, IdBuildHasher>;
pub type IdMap = HashMap<i64, i64, IdBuildHasher>;

/// Builds a segment id mapping from parallel source and destination arrays. For duplicate source ids the later
/// entry wins.
pub fn id_mapping(src: &[i64], dst: &[i64]) -> NativeResult<IdMap> {
    if src.len() != dst.len() {
        return invalid_argument("idMappingSrc and idMappingDst must have same length.");
    }
    Ok(src.iter().copied().zip(dst.iter().copied()).collect())
}

/// Looks up ids in a mapping, missing ids map to 0. Buckets mostly consist of long runs of the same id, so the
/// last lookup is cached.
struct CachedLookup<'a> {
    mapping: &'a IdMap,
    last: Option<(i64, i64)>,
}

impl<'a> CachedLookup<'a> {
    fn new(mapping: &'a IdMap) -> Self {
        CachedLookup {
            mapping,
            last: None,
        }
    }

    #[inline(always)]
    fn get(&mut self, id: i64) -> i64 {
        match self.last {
            Some((last_id, last_mapped)) if last_id == id => last_mapped,
            _ => {
                let mapped = self.mapping.get(&id).copied().unwrap_or(0);
                self.last = Some((id, mapped));
                mapped
            }
        }
    }
}

fn collect_segment_ids_typed<T: Element>(bucket: &[u8], skip_zeroes: bool) -> Vec<i64> {
    let mut ids = IdSet::default();
    let mut last = None;
    for element in bucket.chunks_exact(T::SIZE) {
        let id = T::read(element);
        if last == Some(id) {
            continue;
        }
        last = Some(id);
        if !skip_zeroes || id != 0 {
            ids.insert(id);
        }
    }
    ids.into_iter().collect()
}

/// The distinct elements of the bucket, in no particular order, optionally without 0.
pub fn collect_segment_ids(
    bucket: &[u8],
    bytes_per_element: i32,
    is_signed: bool,
    skip_zeroes: bool,
) -> NativeResult<Vec<i64>> {
    element_count(bucket.len(), bytes_per_element)?;
    // Unlike the other functions, an unsupported element size is an error even for an empty bucket.
    with_element_type!(
        bytes_per_element,
        is_signed,
        collect_segment_ids_typed(bucket, skip_zeroes)
    )
}

/// A bounding box as `[min x, min y, min z, max x, max y, max z]`, all inclusive.
pub type BoundingBox = [i32; 6];

fn extend_segment_bounding_box_typed<T: Element>(
    bucket: &[u8],
    bucket_length: usize,
    segment_id: i64,
    top_left: [i32; 3],
    mut bbox: BoundingBox,
) -> BoundingBox {
    // Rows of x in zyx (fortran) order: row index y + bucket_length * z.
    for (row_index, row) in bucket.chunks_exact(T::SIZE * bucket_length).enumerate() {
        let mut row_has_segment = false;
        for (x, element) in row.chunks_exact(T::SIZE).enumerate() {
            if T::read(element) == segment_id {
                let global_x = (x as i32).wrapping_add(top_left[0]);
                bbox[0] = bbox[0].min(global_x);
                bbox[3] = bbox[3].max(global_x);
                row_has_segment = true;
            }
        }
        if row_has_segment {
            let global_y = ((row_index % bucket_length) as i32).wrapping_add(top_left[1]);
            let global_z = ((row_index / bucket_length) as i32).wrapping_add(top_left[2]);
            bbox[1] = bbox[1].min(global_y);
            bbox[4] = bbox[4].max(global_y);
            bbox[2] = bbox[2].min(global_z);
            bbox[5] = bbox[5].max(global_z);
        }
    }
    bbox
}

/// Extends `existing_bbox` (in global coordinates) so that it contains every voxel of the bucket that equals
/// `segment_id`. The bucket is a cube of `bucket_length`^3 elements with x fastest, at `bucket_top_left`.
pub fn extend_segment_bounding_box(
    bucket: &[u8],
    bytes_per_element: i32,
    is_signed: bool,
    bucket_length: i32,
    segment_id: i64,
    bucket_top_left: [i32; 3],
    existing_bbox: BoundingBox,
) -> NativeResult<BoundingBox> {
    let count = element_count(bucket.len(), bytes_per_element)?;
    if (bucket_length as i128).pow(3) != count as i128 {
        return invalid_argument("elementCount must match exactly one bucket.");
    }
    if count == 0 {
        return Ok(existing_bbox); // an unsupported element size is only an error once an element is read
    }
    with_element_type!(
        bytes_per_element,
        is_signed,
        extend_segment_bounding_box_typed(
            bucket,
            bucket_length as usize,
            segment_id,
            bucket_top_left,
            existing_bbox
        )
    )
}

fn apply_segment_id_mapping_typed<T: Element>(bucket: &[u8], mapping: &IdMap) -> Vec<u8> {
    let mut lookup = CachedLookup::new(mapping);
    let mut output = vec![0u8; bucket.len()];
    for (input, output) in bucket
        .chunks_exact(T::SIZE)
        .zip(output.chunks_exact_mut(T::SIZE))
    {
        T::write(output, lookup.get(T::read(input)));
    }
    output
}

/// A copy of the bucket with every element replaced by its mapped id. Ids missing from the mapping become 0.
pub fn apply_segment_id_mapping(
    bucket: &[u8],
    bytes_per_element: i32,
    is_signed: bool,
    id_mapping_src: &[i64],
    id_mapping_dst: &[i64],
) -> NativeResult<Vec<u8>> {
    let mapping = id_mapping(id_mapping_src, id_mapping_dst)?;
    if element_count(bucket.len(), bytes_per_element)? == 0 {
        return Ok(Vec::new()); // an unsupported element size is only an error once an element is read
    }
    with_element_type!(
        bytes_per_element,
        is_signed,
        apply_segment_id_mapping_typed(bucket, &mapping)
    )
}

fn merge_volume_bucket_in_place_typed<T: Element>(
    bucket: &mut [u8],
    incoming_bucket: &[u8],
    mapping: Option<&IdMap>,
) {
    let mut lookup = mapping.map(CachedLookup::new);
    for (target, incoming) in bucket
        .chunks_exact_mut(T::SIZE)
        .zip(incoming_bucket.chunks_exact(T::SIZE))
    {
        let id = T::read(incoming);
        if id == 0 {
            continue;
        }
        let id = match &mut lookup {
            Some(lookup) => lookup.get(id),
            None => id,
        };
        T::write(target, id);
    }
}

/// Writes every non-zero element of `incoming_bucket` into `bucket`, mapped with the id mapping unless
/// `skip_mapping` is set. Ids missing from the mapping become 0.
pub fn merge_volume_bucket_in_place(
    bucket: &mut [u8],
    incoming_bucket: &[u8],
    skip_mapping: bool,
    id_mapping_src: &[i64],
    id_mapping_dst: &[i64],
    bytes_per_element: i32,
    is_signed: bool,
) -> NativeResult<()> {
    let count = element_count(bucket.len(), bytes_per_element)?;
    if id_mapping_src.len() != id_mapping_dst.len() {
        return invalid_argument("idMappingSrc and idMappingDst must have same length.");
    }
    if bucket.len() != incoming_bucket.len() {
        return invalid_argument(
            "bucketBytesMutable and incomingBucketBytes must have same length.",
        );
    }
    if count == 0 {
        return Ok(()); // an unsupported element size is only an error once an element is read
    }
    let mapping = if skip_mapping {
        None
    } else {
        Some(id_mapping(id_mapping_src, id_mapping_dst)?)
    };
    with_element_type!(
        bytes_per_element,
        is_signed,
        merge_volume_bucket_in_place_typed(bucket, incoming_bucket, mapping.as_ref())
    )
}

fn delete_segment_from_bucket_typed<T: Element>(bucket: &mut [u8], segment_id: i64) {
    for element in bucket.chunks_exact_mut(T::SIZE) {
        if T::read(element) == segment_id {
            T::write(element, 0);
        }
    }
}

/// A copy of the bucket in which every element that equals `segment_id` is 0.
pub fn delete_segment_from_bucket(
    bucket: &[u8],
    bytes_per_element: i32,
    is_signed: bool,
    segment_id: i64,
) -> NativeResult<Vec<u8>> {
    let mut output = bucket.to_vec();
    if element_count(bucket.len(), bytes_per_element)? > 0 {
        // an unsupported element size is only an error once an element is read
        with_element_type!(
            bytes_per_element,
            is_signed,
            delete_segment_from_bucket_typed(&mut output, segment_id)
        )?;
    }
    Ok(output)
}

/// A copy of the bucket (32^3 elements) with the voxel runs (see [voxel_runs]) applied. The whole voxel runs
/// buffer is validated first. The signedness does not matter, a value is written as its low bytes.
pub fn apply_voxel_runs(
    bucket: &[u8],
    bytes_per_element: i32,
    voxel_runs: &[u8],
) -> NativeResult<Vec<u8>> {
    if element_count(bucket.len(), bytes_per_element)? != voxel_runs::BUCKET_VOXEL_COUNT {
        return invalid_argument("voxel runs can only be applied to a bucket of 32^3 elements");
    }
    let header = voxel_runs::validate(voxel_runs)?;
    let mut output = bucket.to_vec();
    with_element_type!(
        bytes_per_element,
        false,
        write_voxel_runs(voxel_runs, &header, &mut output)
    )?;
    Ok(output)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_collectSegmentIds<
    'local,
>(
    env: EnvUnowned<'local>,
    _this: JObject<'local>,
    bucket_bytes: JByteArray<'local>,
    bytes_per_element: jint,
    is_signed: jboolean,
    skip_zeroes: jboolean,
) -> JLongArray<'local> {
    jni_util::run(env, "BucketScanner collectSegmentIds", |env| {
        let bucket = jni_util::read_bytes(env, &bucket_bytes)?;
        let ids = collect_segment_ids(&bucket, bytes_per_element, is_signed, skip_zeroes)?;
        jni_util::new_long_array(env, &ids)
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_extendSegmentBoundingBox<
    'local,
>(
    env: EnvUnowned<'local>,
    _this: JObject<'local>,
    bucket_bytes: JByteArray<'local>,
    bytes_per_element: jint,
    is_signed: jboolean,
    bucket_length: jint,
    segment_id: jlong,
    bucket_top_left_x: jint,
    bucket_top_left_y: jint,
    bucket_top_left_z: jint,
    existing_bbox_top_left_x: jint,
    existing_bbox_top_left_y: jint,
    existing_bbox_top_left_z: jint,
    existing_bbox_bottom_right_x: jint,
    existing_bbox_bottom_right_y: jint,
    existing_bbox_bottom_right_z: jint,
) -> JIntArray<'local> {
    jni_util::run(env, "BucketScanner extendSegmentBoundingBox", |env| {
        let bucket = jni_util::read_bytes(env, &bucket_bytes)?;
        let bbox = extend_segment_bounding_box(
            &bucket,
            bytes_per_element,
            is_signed,
            bucket_length,
            segment_id,
            [bucket_top_left_x, bucket_top_left_y, bucket_top_left_z],
            [
                existing_bbox_top_left_x,
                existing_bbox_top_left_y,
                existing_bbox_top_left_z,
                existing_bbox_bottom_right_x,
                existing_bbox_bottom_right_y,
                existing_bbox_bottom_right_z,
            ],
        )?;
        jni_util::new_int_array(env, &bbox)
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_applySegmentIdMapping<
    'local,
>(
    env: EnvUnowned<'local>,
    _this: JObject<'local>,
    bucket_bytes: JByteArray<'local>,
    bytes_per_element: jint,
    is_signed: jboolean,
    id_mapping_src: JLongArray<'local>,
    id_mapping_dst: JLongArray<'local>,
) -> JByteArray<'local> {
    jni_util::run(env, "BucketScanner applySegmentIdMapping", |env| {
        let bucket = jni_util::read_bytes(env, &bucket_bytes)?;
        let src = jni_util::read_longs(env, &id_mapping_src)?;
        let dst = jni_util::read_longs(env, &id_mapping_dst)?;
        let output = apply_segment_id_mapping(&bucket, bytes_per_element, is_signed, &src, &dst)?;
        jni_util::new_byte_array(env, &output)
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_mergeVolumeBucketInPlace<
    'local,
>(
    env: EnvUnowned<'local>,
    _this: JObject<'local>,
    bucket_bytes_mutable: JByteArray<'local>,
    incoming_bucket_bytes: JByteArray<'local>,
    skip_mapping: jboolean,
    id_mapping_src: JLongArray<'local>,
    id_mapping_dst: JLongArray<'local>,
    bytes_per_element: jint,
    is_signed: jboolean,
) {
    jni_util::run(env, "BucketScanner mergeVolumeBucketInPlace", |env| {
        let mut bucket = jni_util::read_bytes(env, &bucket_bytes_mutable)?;
        let incoming = jni_util::read_bytes(env, &incoming_bucket_bytes)?;
        let src = jni_util::read_longs(env, &id_mapping_src)?;
        let dst = jni_util::read_longs(env, &id_mapping_dst)?;
        merge_volume_bucket_in_place(
            &mut bucket,
            &incoming,
            skip_mapping,
            &src,
            &dst,
            bytes_per_element,
            is_signed,
        )?;
        jni_util::write_bytes(env, &bucket_bytes_mutable, &bucket)
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_deleteSegmentFromBucket<
    'local,
>(
    env: EnvUnowned<'local>,
    _this: JObject<'local>,
    bucket_bytes: JByteArray<'local>,
    bytes_per_element: jint,
    is_signed: jboolean,
    segment_id: jlong,
) -> JByteArray<'local> {
    jni_util::run(env, "BucketScanner deleteSegmentFromBucket", |env| {
        let bucket = jni_util::read_bytes(env, &bucket_bytes)?;
        let output = delete_segment_from_bucket(&bucket, bytes_per_element, is_signed, segment_id)?;
        jni_util::new_byte_array(env, &output)
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_applyVoxelRuns<
    'local,
>(
    env: EnvUnowned<'local>,
    _this: JObject<'local>,
    bucket_bytes: JByteArray<'local>,
    bytes_per_element: jint,
    _is_signed: jboolean,
    voxel_runs_binary: JByteArray<'local>,
) -> JByteArray<'local> {
    jni_util::run(env, "BucketScanner applyVoxelRuns", |env| {
        let bucket = jni_util::read_bytes(env, &bucket_bytes)?;
        let voxel_runs = jni_util::read_bytes(env, &voxel_runs_binary)?;
        let output = apply_voxel_runs(&bucket, bytes_per_element, &voxel_runs)?;
        jni_util::new_byte_array(env, &output)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bucket<T: Element>(values: &[i64]) -> Vec<u8> {
        let mut bytes = vec![0u8; values.len() * T::SIZE];
        for (chunk, &value) in bytes.chunks_exact_mut(T::SIZE).zip(values) {
            T::write(chunk, value);
        }
        bytes
    }

    #[test]
    fn element_count_validates_the_element_size() {
        assert_eq!(element_count(64, 8).unwrap(), 8);
        assert!(element_count(64, 0).is_err());
        assert!(element_count(64, -1).is_err());
        assert!(element_count(63, 2).is_err());
    }

    #[test]
    fn elements_are_sign_or_zero_extended() {
        assert_eq!(u8::read(&[0xff]), 255);
        assert_eq!(i8::read(&[0xff]), -1);
        assert_eq!(u16::read(&[0x00, 0x80]), 32768);
        assert_eq!(i16::read(&[0x00, 0x80]), -32768);
        assert_eq!(u64::read(&[0xff; 8]), -1);
    }

    #[test]
    fn counts_segment_voxels_for_all_element_types() {
        let values = [0, 5, 5, 255, 5, 0];
        assert_eq!(
            count_segment_voxels(&bucket::<u8>(&values), 1, false, 5).unwrap(),
            3
        );
        assert_eq!(
            count_segment_voxels(&bucket::<u8>(&values), 1, false, 255).unwrap(),
            1
        );
        assert_eq!(
            count_segment_voxels(&bucket::<u8>(&values), 1, true, 255).unwrap(),
            0
        );
        assert_eq!(
            count_segment_voxels(&bucket::<u8>(&values), 1, true, -1).unwrap(),
            1
        );
        assert_eq!(
            count_segment_voxels(&bucket::<u32>(&values), 4, false, 0).unwrap(),
            2
        );
        assert_eq!(
            count_segment_voxels(&bucket::<u64>(&[-1, -1]), 8, false, -1).unwrap(),
            2
        );
    }

    #[test]
    fn rejects_unsupported_element_sizes_unless_the_bucket_is_empty() {
        assert!(count_segment_voxels(&[0u8; 6], 3, false, 0).is_err());
        assert_eq!(count_segment_voxels(&[], 3, false, 0).unwrap(), 0);
    }

    #[test]
    fn collects_distinct_segment_ids() {
        let values = [0, 5, 5, 255, 5, 0, 7, 7];
        let mut ids = collect_segment_ids(&bucket::<u8>(&values), 1, false, false).unwrap();
        ids.sort();
        assert_eq!(ids, vec![0, 5, 7, 255]);
        let mut ids = collect_segment_ids(&bucket::<i8>(&values), 1, true, true).unwrap();
        ids.sort();
        assert_eq!(ids, vec![-1, 5, 7]);
        assert!(collect_segment_ids(&[], 3, false, false).is_err());
        assert!(collect_segment_ids(&[0u8; 3], 2, false, false).is_err());
        assert!(
            collect_segment_ids(&bucket::<u64>(&[]), 8, false, false)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn extends_the_bounding_box() {
        let length = 4;
        let mut values = vec![0i64; length * length * length];
        let index = |x: usize, y: usize, z: usize| x + length * (y + length * z);
        values[index(1, 2, 3)] = 9;
        values[index(3, 0, 1)] = 9;
        values[index(2, 2, 2)] = 8;
        let input = bucket::<u16>(&values);
        let empty = [i32::MAX, i32::MAX, i32::MAX, i32::MIN, i32::MIN, i32::MIN];
        let extend = |segment_id, existing| {
            extend_segment_bounding_box(&input, 2, false, 4, segment_id, [10, 20, 30], existing)
        };
        assert_eq!(extend(9, empty).unwrap(), [11, 20, 31, 13, 22, 33]);
        assert_eq!(extend(8, empty).unwrap(), [12, 22, 32, 12, 22, 32]);
        assert_eq!(extend(7, empty).unwrap(), empty);
        let existing = [0, 21, 32, 12, 21, 40];
        assert_eq!(extend(9, existing).unwrap(), [0, 20, 31, 13, 22, 40]);
        assert!(extend_segment_bounding_box(&input, 2, false, 3, 9, [0; 3], empty).is_err());
        assert!(extend_segment_bounding_box(&[0u8; 3 * 8], 3, false, 2, 9, [0; 3], empty).is_err());
        assert_eq!(
            extend_segment_bounding_box(&[], 3, false, 0, 9, [0; 3], empty).unwrap(),
            empty
        );
    }

    #[test]
    fn applies_a_segment_id_mapping() {
        let values = [0, 1, 1, 2, 3, -1];
        let input = bucket::<i16>(&values);
        let output =
            apply_segment_id_mapping(&input, 2, true, &[1, 2, 1, -1], &[10, 20, 11, 300]).unwrap();
        // unmapped ids become 0, the later of duplicate keys wins
        assert_eq!(output, bucket::<i16>(&[0, 11, 11, 20, 0, 300]));
        assert!(apply_segment_id_mapping(&input, 2, true, &[1, 2], &[1]).is_err());
        assert!(apply_segment_id_mapping(&[0u8; 6], 3, true, &[], &[]).is_err());
        assert!(
            apply_segment_id_mapping(&[], 3, true, &[], &[])
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn merges_volume_buckets_in_place() {
        let incoming = bucket::<u32>(&[0, 1, 2, 0, 3]);
        let mut merged = bucket::<u32>(&[7, 7, 7, 7, 7]);
        merge_volume_bucket_in_place(&mut merged, &incoming, false, &[1, 2], &[10, 20], 4, false)
            .unwrap();
        assert_eq!(merged, bucket::<u32>(&[7, 10, 20, 7, 0]));

        let mut merged = bucket::<u32>(&[7, 7, 7, 7, 7]);
        merge_volume_bucket_in_place(&mut merged, &incoming, true, &[1], &[10], 4, false).unwrap();
        assert_eq!(merged, bucket::<u32>(&[7, 1, 2, 7, 3]));

        let mut merged = bucket::<u32>(&[7, 7, 7, 7, 7]);
        assert!(
            merge_volume_bucket_in_place(&mut merged, &incoming, true, &[1], &[], 4, false)
                .is_err()
        );
        assert!(
            merge_volume_bucket_in_place(&mut merged, &incoming[4..], true, &[], &[], 4, false)
                .is_err()
        );
        assert_eq!(merged, bucket::<u32>(&[7, 7, 7, 7, 7]));
    }

    #[test]
    fn deletes_a_segment() {
        let input = bucket::<u64>(&[1, -1, 2, -1]);
        assert_eq!(
            delete_segment_from_bucket(&input, 8, false, -1).unwrap(),
            bucket::<u64>(&[1, 0, 2, 0])
        );
        assert!(delete_segment_from_bucket(&[0u8; 6], 3, false, 0).is_err());
        assert!(delete_segment_from_bucket(&[0u8; 5], 2, false, 0).is_err());
        assert!(
            delete_segment_from_bucket(&[], 3, false, 0)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn applies_voxel_runs_to_a_copy() {
        let count = voxel_runs::BUCKET_VOXEL_COUNT;
        let input = vec![1u8; count * 2];
        // format version 1, axis 0, value 0x0203, 2 runs: (gap 1, length 2), (gap 0, length 1)
        let mut runs = vec![1u8, 0, 3, 2, 0, 0, 0, 0, 0, 0, 2, 1, 2, 0, 1];
        let output = apply_voxel_runs(&input, 2, &runs).unwrap();
        assert_eq!(&output[..10], &[1, 1, 3, 2, 3, 2, 3, 2, 1, 1]);
        assert_eq!(&output[10..], &input[10..]);
        assert!(apply_voxel_runs(&input[..1024], 2, &runs).is_err());
        assert!(apply_voxel_runs(&vec![0u8; count * 3], 3, &runs).is_err());
        runs.push(0);
        assert!(apply_voxel_runs(&input, 2, &runs).is_err());
    }
}
