//! Compresso v0/v1 decoding through the pure-Rust `compresso-rs` crate.
//! This wrapper keeps the Scala/JNI behavior (webknossos-jni/src/include/compresso.hpp): the
//! output-length bound, the accepted header variants and the native error messages.

use crate::{
    compression::DEFAULT_MAX_DECOMPRESSED_BYTES,
    error::{DsError, DsResult},
};
use ::compresso::{Error, Header};

/// Scala `CompressoCompressor` passes `Compressor.maxDecompressedBytes` to the native decoder.
pub const MAX_OUTPUT_BYTES: usize = DEFAULT_MAX_DECOMPRESSED_BYTES;
/// Native `compresso::decompress` return codes.
const ERROR_NO_LOCATIONS: u8 = 1;
/// Location codes 0..=5 (-x, +x, -y, +y, -z, +z) map to native codes 2..=7.
const ERROR_INVALID_LOCATION_BASE: u8 = 2;
const ERROR_INVALID_HEADER: u8 = 12;
const ERROR_ZERO_STEP: u8 = 14;
const ERROR_WINDOW_TOO_LARGE: u8 = 15;
const ERROR_SECTION_SIZES: u8 = 16;

fn error(message: impl std::fmt::Display) -> DsError {
    DsError::failure(format!(
        "An error occurred in native code: Error while decoding with compresso: {message}"
    ))
}

fn native_error(e: Error) -> DsError {
    match e {
        Error::NoLocations => error(ERROR_NO_LOCATIONS),
        Error::InvalidLocation { offset } => error(ERROR_INVALID_LOCATION_BASE + offset),
        Error::InvalidMagic
        | Error::UnsupportedVersion(_)
        | Error::InvalidDataWidth(_)
        | Error::InvalidConnectivity(_) => error(ERROR_INVALID_HEADER),
        Error::Truncated => error(ERROR_SECTION_SIZES),
        other => error(other),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompressoHeader {
    pub version: u8,
    pub label_width: usize,
    pub shape: [usize; 3],
    pub steps: [usize; 3],
    pub connectivity: u8,
}

impl CompressoHeader {
    pub fn parse(input: &[u8]) -> DsResult<Self> {
        if input.len() < Header::SIZE {
            return Err(error(format!(
                "Expected at least 36 bytes of input for the compresso header, got {}",
                input.len()
            )));
        }
        // JNI checks the raw output length (at most 255 * 65535³, no overflow) before validating
        // magic/type/version.
        let output_length = input[6..12]
            .as_chunks::<2>()
            .0
            .iter()
            .fold(u64::from(input[5]), |n, v| {
                n * u64::from(u16::from_le_bytes(*v))
            });
        if output_length == 0 || output_length > MAX_OUTPUT_BYTES as u64 {
            return Err(error(format!(
                "output length as read from header must be >0 and at most {MAX_OUTPUT_BYTES}, \
                 got {output_length}"
            )));
        }
        let header = Header::parse(input).map_err(native_error)?;
        // Native only accepts 6-connectivity for format version 0.
        if header.connectivity == 6 && header.format_version != 0 {
            return Err(error(ERROR_INVALID_HEADER));
        }
        // Zero steps would divide by zero, windows above 64 bits overflow the bit shifts.
        if header.steps.contains(&0) {
            return Err(error(ERROR_ZERO_STEP));
        }
        if header.window_voxels() > 64 {
            return Err(error(ERROR_WINDOW_TOO_LARGE));
        }
        Ok(Self {
            version: header.format_version,
            label_width: usize::from(header.data_width),
            shape: header.shape_usize(),
            steps: header.steps.map(usize::from),
            connectivity: header.connectivity,
        })
    }
}

pub fn decode(input: &[u8], output_limit: usize) -> DsResult<Vec<u8>> {
    let header = CompressoHeader::parse(input)?;
    let limit = output_limit.min(MAX_OUTPUT_BYTES);
    let length = header.shape.iter().product::<usize>() * header.label_width;
    if length > limit {
        return Err(error(format!("output exceeds {limit} bytes")));
    }
    ::compresso::decompress_bytes(input).map_err(native_error)
}
