//! Native functions of `NativeCompressoCompressor`: decoding Compresso streams (segmentation chunks of
//! Neuroglancer precomputed datasets with `"encoding": "compresso"`) with the `compresso-rs` crate.
//!
//! The streams come from user datasets, i.e. are untrusted. compresso-rs returns an error for malformed streams,
//! but allocates the output based on the volume size declared in the header. So that a tiny stream cannot make us
//! allocate gigabytes, the size from the header is checked against the caller's limit before decoding.

use jni::EnvUnowned;
use jni::objects::{JByteArray, JObject};
use jni::sys::jint;

use crate::jni_util::{self, NativeError, NativeResult, invalid_argument};

/// Size of the Compresso stream header in bytes.
const HEADER_SIZE: usize = compresso::Header::SIZE;

/// The number of bytes of the decoded volume as declared by the header: label width (byte 5) times the
/// little-endian u16 sizes x, y and z (bytes 6..12). `header` must hold at least [HEADER_SIZE] bytes.
fn output_length_from_header(header: &[u8]) -> u64 {
    let size_at = |i: usize| u64::from(u16::from_le_bytes([header[i], header[i + 1]]));
    u64::from(header[5]) * size_at(6) * size_at(8) * size_at(10)
}

/// The decoded labels of a Compresso stream, in the label width of the stream.
pub enum Labels {
    U8(Vec<u8>),
    U16(Vec<u16>),
    U32(Vec<u32>),
    U64(Vec<u64>),
}

impl Labels {
    /// The labels as little-endian bytes (x fastest), without copying them.
    pub fn as_le_bytes(&self) -> &[u8] {
        fn bytes<T: Copy>(labels: &[T]) -> &[u8] {
            // Integers have no padding and u8 has alignment 1, so any integer slice can be viewed as bytes. They
            // are little-endian on every target we build for, see the assertion below.
            unsafe {
                std::slice::from_raw_parts(
                    labels.as_ptr().cast::<u8>(),
                    std::mem::size_of_val(labels),
                )
            }
        }
        match self {
            Labels::U8(labels) => labels,
            Labels::U16(labels) => bytes(labels),
            Labels::U32(labels) => bytes(labels),
            Labels::U64(labels) => bytes(labels),
        }
    }
}

// as_le_bytes returns the labels in native byte order.
const _: () = assert!(
    cfg!(target_endian = "little"),
    "as_le_bytes assumes a little-endian target"
);

/// Decodes a Compresso stream into its labels. Fails if the decoded volume would be empty or larger than
/// `max_output_length` bytes, before anything is allocated.
///
/// The labels are decoded in their own width (rather than with `compresso::decompress_bytes`, which converts them
/// to bytes in a second buffer), so that the decoded volume is held in native memory only once.
pub fn decompress(input: &[u8], max_output_length: i32) -> NativeResult<Labels> {
    if input.len() < HEADER_SIZE {
        return invalid_argument(format!(
            "Expected at least {HEADER_SIZE} bytes of input for the compresso header, got {}",
            input.len()
        ));
    }
    let output_length = output_length_from_header(input);
    if output_length == 0 || max_output_length < 0 || output_length > max_output_length as u64 {
        return invalid_argument(format!(
            "output length as read from header must be >0 and at most {max_output_length}, got {output_length}"
        ));
    }
    let to_error = |error: compresso::Error| NativeError::InvalidArgument(error.to_string());
    let labels = match input[5] {
        1 => Labels::U8(compresso::decompress(input).map_err(to_error)?),
        2 => Labels::U16(compresso::decompress(input).map_err(to_error)?),
        4 => Labels::U32(compresso::decompress(input).map_err(to_error)?),
        8 => Labels::U64(compresso::decompress(input).map_err(to_error)?),
        width => return invalid_argument(format!("Invalid compresso label width {width}")),
    };
    let decoded_length = labels.as_le_bytes().len();
    if decoded_length as u64 != output_length {
        // Cannot happen for a stream that decodes, but the caller relies on the size.
        return invalid_argument(format!(
            "compresso decoded {decoded_length} bytes, expected {output_length}"
        ));
    }
    Ok(labels)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_scalableminds_webknossos_datastore_compresso_NativeCompressoCompressor_decompress<
    'local,
>(
    env: EnvUnowned<'local>,
    _this: JObject<'local>,
    input_bytes: JByteArray<'local>,
    max_output_length: jint,
) -> JByteArray<'local> {
    jni_util::run(env, "Compresso decompress", |env| {
        let input = jni_util::read_bytes(env, &input_bytes)?;
        let labels = decompress(&input, max_output_length)?;
        jni_util::new_byte_array(env, labels.as_le_bytes())
    })
}

#[cfg(test)]
mod tests;
