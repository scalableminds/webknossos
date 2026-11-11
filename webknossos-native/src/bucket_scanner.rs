//! Native functions of `NativeBucketScanner`: scanning and rewriting the segment ids of volume buckets.
//!
//! A bucket is a byte array of little-endian elements with 1, 2, 4 or 8 bytes each, signed or unsigned. Each
//! element is read as an i64 (sign- or zero-extended), which is how segment ids are compared and passed around.
//!
//! Segment ids are hashed with rustc-hash's FxHash: the default SipHash is DoS resistant, which is not needed
//! here, and several times slower.

use jni::EnvUnowned;
use jni::objects::{JByteArray, JIntArray, JLongArray, JObject};
use jni::sys::{jboolean, jint, jlong};
use rustc_hash::{FxHashMap, FxHashSet};

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

/// Builds a segment id mapping from parallel source and destination arrays. For duplicate source ids the later
/// entry wins.
pub fn id_mapping(src: &[i64], dst: &[i64]) -> NativeResult<FxHashMap<i64, i64>> {
    if src.len() != dst.len() {
        return invalid_argument("idMappingSrc and idMappingDst must have same length.");
    }
    Ok(src.iter().copied().zip(dst.iter().copied()).collect())
}

/// Looks up ids in a mapping, missing ids map to 0. Buckets mostly consist of long runs of the same id, so the
/// last lookup is cached.
struct CachedLookup<'a> {
    mapping: &'a FxHashMap<i64, i64>,
    last: Option<(i64, i64)>,
}

impl<'a> CachedLookup<'a> {
    fn new(mapping: &'a FxHashMap<i64, i64>) -> Self {
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
    let mut ids = FxHashSet::<i64>::default();
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

fn apply_segment_id_mapping_typed<T: Element>(
    bucket: &[u8],
    mapping: &FxHashMap<i64, i64>,
) -> Vec<u8> {
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
    mapping: Option<&FxHashMap<i64, i64>>,
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
mod tests;
