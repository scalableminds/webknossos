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
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    const MAX_OUTPUT_LENGTH: i32 = 1024 * 1024 * 1024;

    /// The Compresso streams of the golden test corpus (generated by the Python `compresso` package).
    fn corpus() -> Vec<(String, Vec<u8>)> {
        let directory =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test/native-golden/compresso");
        let mut files: Vec<_> = std::fs::read_dir(&directory)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", directory.display()))
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|extension| extension == "cpso")
            })
            .collect();
        files.sort();
        assert!(
            !files.is_empty(),
            "no .cpso files in {}",
            directory.display()
        );
        files
            .into_iter()
            .map(|path| {
                (
                    path.file_name().unwrap().to_string_lossy().into_owned(),
                    std::fs::read(&path).unwrap(),
                )
            })
            .collect()
    }

    /// A deterministic pseudo random number generator (SplitMix64), to avoid a dependency.
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            z ^ (z >> 31)
        }
        fn below(&mut self, n: usize) -> usize {
            (self.next() % n as u64) as usize
        }
    }

    #[test]
    fn decodes_the_corpus_to_the_declared_size() {
        for (name, input) in corpus() {
            let output = decompress(&input, MAX_OUTPUT_LENGTH)
                .unwrap_or_else(|error| panic!("{name}: {error}"));
            assert_eq!(
                output.as_le_bytes().len() as u64,
                output_length_from_header(&input),
                "{name}"
            );
        }
    }

    #[test]
    fn checks_the_header_before_decoding() {
        let (_, input) = &corpus()[0];
        let length = output_length_from_header(input) as i32;
        assert!(decompress(&input[..HEADER_SIZE - 1], MAX_OUTPUT_LENGTH).is_err());
        assert!(decompress(&[], MAX_OUTPUT_LENGTH).is_err());
        assert!(decompress(input, -1).is_err());
        assert!(decompress(input, length - 1).is_err());
        assert!(decompress(input, length).is_ok());
        assert!(decompress(&input[..HEADER_SIZE], MAX_OUTPUT_LENGTH).is_err());

        // A header declaring a huge volume (65535^3 voxels of 8 bytes) is rejected without decoding.
        let mut huge = input.clone();
        huge[5] = 8;
        huge[6..12].fill(0xff);
        assert!(decompress(&huge, i32::MAX).is_err());

        // A zero-sized volume is rejected as well.
        let mut empty = input.clone();
        empty[10..12].fill(0);
        assert!(decompress(&empty, MAX_OUTPUT_LENGTH).is_err());
    }

    /// Runs one corrupted input. It must return (Ok or Err) without panicking. The time it takes is only reported,
    /// not asserted, as it depends on the machine and on debug vs. release builds.
    fn check_corruption(description: &str, input: &[u8], slowest: &mut (Duration, String)) {
        let start = Instant::now();
        let result = std::panic::catch_unwind(|| decompress(input, MAX_OUTPUT_LENGTH));
        let elapsed = start.elapsed();
        match result {
            Ok(Ok(output)) => assert_eq!(
                output.as_le_bytes().len() as u64,
                output_length_from_header(input),
                "{description}"
            ),
            Ok(Err(_)) => {}
            Err(_) => panic!("decompress panicked on {description}"),
        }
        if elapsed > slowest.0 {
            *slowest = (elapsed, description.to_string());
        }
    }

    #[test]
    fn survives_corrupted_input() {
        let mut rng = Rng(42);
        let mut slowest = (Duration::ZERO, String::new());
        let mut cases = 0;
        for (name, input) in corpus() {
            // Truncations at every length up to the end of the section tables, then spread over the rest.
            let step = (input.len() / 200).max(1);
            for length in (0..input.len()).filter(|&length| length < 256 || length % step == 0) {
                check_corruption(
                    &format!("{name} truncated to {length}"),
                    &input[..length],
                    &mut slowest,
                );
                cases += 1;
            }
            // Single byte flips at random positions (half of them in the header).
            for i in 0..400 {
                let mut corrupted = input.clone();
                let position = if i % 2 == 0 {
                    rng.below(HEADER_SIZE)
                } else {
                    rng.below(input.len())
                };
                let mask = (rng.below(255) + 1) as u8;
                corrupted[position] ^= mask;
                check_corruption(
                    &format!("{name} byte {position} ^= {mask:#04x}"),
                    &corrupted,
                    &mut slowest,
                );
                cases += 1;
            }
            // Several random bytes overwritten in the body.
            for _ in 0..100 {
                let mut corrupted = input.clone();
                let count = rng.below(8) + 1;
                for _ in 0..count {
                    let position = HEADER_SIZE + rng.below(input.len() - HEADER_SIZE);
                    corrupted[position] = rng.next() as u8;
                }
                check_corruption(
                    &format!("{name} {count} random body bytes (seeded)"),
                    &corrupted,
                    &mut slowest,
                );
                cases += 1;
            }
            // Random headers with small sizes and plausible fields in front of the original body.
            for _ in 0..200 {
                let mut corrupted = input.clone();
                corrupted[4] = rng.below(3) as u8; // format version 0, 1 or invalid 2
                corrupted[5] = [1, 2, 4, 8, 3][rng.below(5)];
                for axis in 0..3 {
                    let size = rng.below(70) as u16;
                    corrupted[6 + 2 * axis..8 + 2 * axis].copy_from_slice(&size.to_le_bytes());
                }
                for step in &mut corrupted[12..15] {
                    *step = rng.below(10) as u8;
                }
                corrupted[15..23].copy_from_slice(&(rng.below(5000) as u64).to_le_bytes());
                corrupted[23..27].copy_from_slice(&(rng.below(300) as u32).to_le_bytes());
                corrupted[27..35].copy_from_slice(&(rng.below(5000) as u64).to_le_bytes());
                corrupted[35] = [4, 6, 5][rng.below(3)];
                let header = corrupted[..HEADER_SIZE]
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect::<String>();
                check_corruption(
                    &format!("{name} with header {header}"),
                    &corrupted,
                    &mut slowest,
                );
                cases += 1;
            }
        }
        assert!(cases > 3000, "only {cases} cases");
        eprintln!(
            "{cases} corrupted inputs, slowest {:?}: {}",
            slowest.0, slowest.1
        );
    }
}
