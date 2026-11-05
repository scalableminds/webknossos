//! Native functions of `NativeBucketScanner`: scanning and rewriting the segment ids of volume buckets.
//!
//! A bucket is a byte array of little-endian elements with 1, 2, 4 or 8 bytes each, signed or unsigned. Each
//! element is read as an i64 (sign- or zero-extended), which is how segment ids are compared and passed around.

use jni::EnvUnowned;
use jni::objects::{JByteArray, JObject};
use jni::sys::{jboolean, jint, jlong};

use crate::jni_util::{self, NativeResult, invalid_argument};

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
}
