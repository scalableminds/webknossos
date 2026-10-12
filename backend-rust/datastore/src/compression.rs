//! Chunk compressors used by WKW/Zarr/Zarr3/N5/Precomputed (Scala `datareaders/Compressor.scala`
//! and the format-specific factories `ZarrCompressorFactory`, `N5CompressorFactory`,
//! zarr3 `BloscCodec`/`GzipCodec`/`ZstdCodec`, `PrecomputedCompressorFactory` sharding encodings,
//! plus the WKW LZ4 block helpers of `WKWCompressionHelper`).
//!
//! Everything is pure Rust: Blosc1 is implemented here (see `compression/blosc.rs`), LZ4 blocks
//! are decoded by `compression/lz4.rs` and encoded with `lz4_flex`, zlib/gzip use `flate2`
//! (miniz_oxide backend) and zstd uses `ruzstd`.
//!
//! Decompression never trusts sizes announced by the input: output is bounded by the caller's
//! expected length or [`DEFAULT_MAX_DECOMPRESSED_BYTES`], and buffers grow incrementally.
//!
//! Not here: `JpegCompressor` (Precomputed `jpeg`, DS2d), `CompressoCompressor` (DS5b) and
//! `CompressedSegmentationCompressor` (DS2d).

mod blosc;
mod blosclz;
mod lz4;

use std::{
    collections::BTreeMap,
    fmt,
    io::{Read, Write},
};

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

pub use blosc::{BloscCname, BloscConfig, BloscShuffle};

use crate::error::{DsError, DsResult};

/// Upper bound for decompressed chunks when the caller does not know the expected size.
pub const DEFAULT_MAX_DECOMPRESSED_BYTES: usize = 1 << 30;

/// Scala `CompressionSetting`: a compressor property from JSON metadata. Play reads a string
/// first, then an `Int` (any JSON number with an exact 32-bit integer value), then a boolean.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompressionSetting {
    String(String),
    Int(i32),
    Bool(bool),
}

/// Scala `Map[String, CompressionSetting]`.
pub type CompressionSettings = BTreeMap<String, CompressionSetting>;

impl CompressionSetting {
    /// `None` where Play's `CompressionSettingFormat.reads` fails (null, arrays, objects,
    /// non-integral or out-of-range numbers).
    pub fn from_json(value: &Value) -> Option<Self> {
        match value {
            Value::String(s) => Some(Self::String(s.clone())),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    i32::try_from(i).ok().map(Self::Int)
                } else if let Some(f) = n.as_f64() {
                    // BigDecimal.isValidInt accepts e.g. `5.0`.
                    (f.fract() == 0.0 && f >= f64::from(i32::MIN) && f <= f64::from(i32::MAX))
                        .then_some(Self::Int(f as i32))
                } else {
                    None
                }
            }
            Value::Bool(b) => Some(Self::Bool(*b)),
            _ => None,
        }
    }

    pub fn to_json(&self) -> Value {
        match self {
            Self::String(s) => Value::String(s.clone()),
            Self::Int(i) => Value::from(*i),
            Self::Bool(b) => Value::Bool(*b),
        }
    }
}

impl Serialize for CompressionSetting {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for CompressionSetting {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        Self::from_json(&value).ok_or_else(|| {
            serde::de::Error::custom("compression setting must be a string, int or boolean")
        })
    }
}

/// Scala `Compressor` subclasses that are pure byte transformations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Compressor {
    /// `NullCompressor`.
    Null,
    /// `Lz4Compressor`: raw LZ4 block, decoded until the input ends (commons-compress
    /// `BlockLZ4CompressorInputStream`). Used for WKW chunks on the read path.
    Lz4,
    /// `ZlibCompressor` (zlib-wrapped deflate).
    Zlib { level: i32 },
    /// `GzipCompressor`. `level == -1` means the deflate default.
    Gzip { level: i32 },
    /// `BloscCompressor` (Blosc1 container, c-blosc 1.21 compatible).
    Blosc(BloscConfig),
    /// `ZstdCompressor`.
    Zstd { level: i32, checksum: bool },
    /// `ChainedCompressor`: compresses left to right, decompresses right to left.
    Chained(Vec<Compressor>),
}

fn fail(message: impl Into<String>) -> DsError {
    DsError::failure(message)
}

/// Java `Integer.parseInt` (`String.toInt`) with its `NumberFormatException` message.
fn parse_java_int(s: &str) -> DsResult<i32> {
    s.parse::<i32>()
        .map_err(|_| fail(format!("For input string: \"{s}\"")))
}

impl Compressor {
    /// Scala `new ZlibCompressor(properties)`.
    pub fn zlib(properties: &CompressionSettings) -> DsResult<Self> {
        let validate = |level: i32| {
            if (0..=9).contains(&level) {
                Ok(level)
            } else {
                Err(fail(format!("Invalid compression level: {level}")))
            }
        };
        let level = match properties.get("level") {
            None => 1,
            Some(CompressionSetting::Int(l)) => validate(*l)?,
            Some(CompressionSetting::String(s)) => validate(parse_java_int(s)?)?,
            // Scala reads the not-yet-initialized `level` field (0) in this message.
            Some(CompressionSetting::Bool(_)) => {
                return Err(fail("Invalid compression level: 0"));
            }
        };
        Ok(Self::Zlib { level })
    }

    /// Scala `new GzipCompressor(properties)`.
    pub fn gzip(properties: &CompressionSettings) -> DsResult<Self> {
        let validate = |level: i32| {
            if level == -1 || (0..=9).contains(&level) {
                Ok(level)
            } else {
                Err(fail(format!("Invalid compression level: {level}")))
            }
        };
        let level = match properties.get("level") {
            None => 1,
            Some(CompressionSetting::Int(l)) => validate(*l)?,
            Some(CompressionSetting::String(s)) => validate(parse_java_int(s)?)?,
            Some(CompressionSetting::Bool(_)) => {
                return Err(fail("Invalid compression level: 0"));
            }
        };
        Ok(Self::Gzip { level })
    }

    /// Scala `new BloscCompressor(properties)` (fields are validated in declaration order:
    /// cname, clevel, typesize, shuffle, blocksize).
    pub fn blosc(properties: &CompressionSettings) -> DsResult<Self> {
        let defaults = BloscConfig::default();
        let cname = match properties.get("cname") {
            None => defaults.cname,
            Some(CompressionSetting::String(name)) => {
                BloscCname::from_name(name).ok_or_else(|| {
                    let supported: Vec<&str> = BloscCname::ALL.iter().map(|c| c.value()).collect();
                    fail(format!(
                        "blosc: compressor not supported: '{name}'; expected one of {}",
                        supported.join(",")
                    ))
                })?
            }
            Some(_) => return Err(fail("Blosc cname must be string")),
        };
        let validate_clevel = |clevel: i32| {
            if (0..=9).contains(&clevel) {
                Ok(clevel)
            } else {
                Err(fail(format!(
                    "blosc: clevel parameter must be between 0 and 9 but was: {clevel}"
                )))
            }
        };
        let clevel = match properties.get("clevel") {
            None => defaults.clevel,
            Some(CompressionSetting::String(s)) => validate_clevel(parse_java_int(s)?)?,
            Some(CompressionSetting::Int(c)) => validate_clevel(*c)?,
            Some(_) => return Err(fail("Blosc clevel must be int or string")),
        };
        let typesize = match properties.get("typesize") {
            None => defaults.typesize,
            Some(CompressionSetting::String(s)) => parse_java_int(s)?,
            Some(CompressionSetting::Int(t)) => *t,
            Some(_) => return Err(fail("Blosc typesize must be int or string")),
        };
        let shuffle = match properties.get("shuffle") {
            None => defaults.shuffle,
            Some(CompressionSetting::String(s)) => BloscShuffle::from_name(s).ok_or_else(|| {
                fail(format!(
                    "blosc: shuffle type '{s}' not supported. Expected one of noshuffle,shuffle,bitshuffle"
                ))
            })?,
            Some(CompressionSetting::Int(shuffle)) => {
                let resolved = match *shuffle {
                    -1 if typesize == 1 => 2,
                    -1 => 1,
                    other => other,
                };
                BloscShuffle::from_int(resolved).ok_or_else(|| {
                    fail(format!(
                        "blosc: shuffle type '{shuffle}' not supported. Expected one of -1 (AUTOSHUFFLE), 0 (NOSHUFFLE),1 (BYTESHUFFLE),2 (BITSHUFFLE)"
                    ))
                })?
            }
            Some(_) => return Err(fail("Blosc shuffle must be int or string")),
        };
        let blocksize = match properties.get("blocksize") {
            None => defaults.blocksize,
            Some(CompressionSetting::String(s)) => parse_java_int(s)?,
            Some(CompressionSetting::Int(b)) => *b,
            Some(_) => return Err(fail("Blosc blocksize must be int or string")),
        };
        Ok(Self::Blosc(BloscConfig {
            cname,
            clevel,
            shuffle,
            blocksize,
            typesize,
        }))
    }

    /// Scala `new ZstdCompressor(level, checksum)` (no validation).
    pub fn zstd(level: i32, checksum: bool) -> Self {
        Self::Zstd { level, checksum }
    }

    fn zstd_from_level_setting(properties: &CompressionSettings) -> DsResult<Self> {
        match properties.get("level") {
            Some(CompressionSetting::Int(level)) => Ok(Self::zstd(*level, false)),
            _ => Err(fail("Zstd level must be int")),
        }
    }

    /// Scala `ZarrCompressorFactory.create(properties)`: the zarr v2 `.zarray` `compressor`
    /// object. (`compressor: null` maps to [`Compressor::Null`] in the header reader.)
    pub fn from_zarr_settings(properties: &CompressionSettings) -> DsResult<Self> {
        match properties.get("id") {
            Some(CompressionSetting::String(id)) => Self::from_zarr_id(id, properties),
            Some(_) => Err(fail("Compressor id must be string")),
            None => Err(fail("key not found: id")),
        }
    }

    /// Scala `ZarrCompressorFactory.create(id, properties)`.
    pub fn from_zarr_id(id: &str, properties: &CompressionSettings) -> DsResult<Self> {
        match id {
            "null" => Ok(Self::Null),
            "zlib" => Self::zlib(properties),
            "blosc" => Self::blosc(properties),
            "gzip" => Self::gzip(properties),
            "zstd" => Self::zstd_from_level_setting(properties),
            _ => Err(fail(format!("Compressor id:'{id}' not supported."))),
        }
    }

    /// Scala `N5CompressorFactory.create(properties)`: the N5 `attributes.json` `compression`
    /// object.
    pub fn from_n5_settings(properties: &CompressionSettings) -> DsResult<Self> {
        match properties.get("type") {
            Some(CompressionSetting::String(id)) => Self::from_n5_type(id, properties),
            Some(_) => Err(fail("N5 compressor id must be string")),
            None => Err(fail("key not found: type")),
        }
    }

    /// Scala `N5CompressorFactory.create(id, properties)`.
    pub fn from_n5_type(id: &str, properties: &CompressionSettings) -> DsResult<Self> {
        match id {
            "raw" | "null" => Ok(Self::Null),
            "zlib" => Self::zlib(properties),
            "gzip" if properties.get("useZlib") == Some(&CompressionSetting::Bool(true)) => {
                Self::zlib(properties)
            }
            "gzip" => Self::gzip(properties),
            "blosc" => Self::blosc(properties),
            "zstd" => Self::zstd_from_level_setting(properties),
            _ => Err(fail(format!(
                "N5 compressor with id: \u{201c}{id}\u{201d} not supported."
            ))),
        }
    }

    /// Scala zarr3 `BloscCodec.fromConfiguration`. Shuffle strings are matched exactly
    /// (`noshuffle|shuffle|bitshuffle`) before blosc-java's own validation; an omitted `typesize`
    /// becomes 0. Scala fails lazily on first use; this fails at construction.
    pub fn from_zarr3_blosc(
        cname: &str,
        clevel: i32,
        shuffle: &CompressionSetting,
        typesize: Option<i32>,
        blocksize: i32,
    ) -> DsResult<Self> {
        let shuffle_int = match shuffle {
            CompressionSetting::String(s) => match s.as_str() {
                "noshuffle" => 0,
                "shuffle" => 1,
                "bitshuffle" => 2,
                other => {
                    return Err(fail(format!("{other} (of class java.lang.String)")));
                }
            },
            CompressionSetting::Int(x) => *x,
            CompressionSetting::Bool(_) => return Err(fail("an implementation is missing")),
        };
        let properties: CompressionSettings = [
            ("cname", CompressionSetting::String(cname.to_owned())),
            ("clevel", CompressionSetting::Int(clevel)),
            ("shuffle", CompressionSetting::Int(shuffle_int)),
            ("blocksize", CompressionSetting::Int(blocksize)),
            ("typesize", CompressionSetting::Int(typesize.unwrap_or(0))),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v))
        .collect();
        Self::blosc(&properties)
    }

    /// Scala zarr3 `GzipCodec(level)`.
    pub fn from_zarr3_gzip(level: i32) -> DsResult<Self> {
        Self::gzip(&[("level".to_owned(), CompressionSetting::Int(level))].into())
    }

    /// Scala zarr3 `ZstdCodec(level, checksum)`.
    pub fn from_zarr3_zstd(level: i32, checksum: bool) -> Self {
        Self::zstd(level, checksum)
    }

    /// Scala `PrecomputedCompressorFactory.getCompressorForShardingChunks`
    /// (sharding `data_encoding`).
    pub fn from_precomputed_sharding_encoding(encoding: &str) -> DsResult<Self> {
        match encoding {
            "raw" => Ok(Self::Null),
            "gzip" => Self::gzip(&CompressionSettings::new()),
            _ => Err(fail(format!("Chunk encoding '{encoding}' not supported."))),
        }
    }

    /// Scala `getId`.
    pub fn id(&self) -> &'static str {
        match self {
            Self::Null => "NullCompressor",
            Self::Lz4 => "LZ4Compressor",
            Self::Zlib { .. } => "zlib",
            Self::Gzip { .. } => "gzip",
            Self::Blosc(_) => "blosc",
            Self::Zstd { .. } => "zstd",
            Self::Chained(_) => "chainedcompressor",
        }
    }

    /// Decompresses one chunk. `expected_len` (the decompressed size the caller expects, if known)
    /// bounds the output; without it, [`DEFAULT_MAX_DECOMPRESSED_BYTES`] does. Shorter output is
    /// returned as is (Scala does not check the length here either).
    pub fn decompress(&self, input: &[u8], expected_len: Option<usize>) -> DsResult<Vec<u8>> {
        self.decompress_with_limit(
            input,
            expected_len.unwrap_or(DEFAULT_MAX_DECOMPRESSED_BYTES),
        )
    }

    /// Like [`Compressor::decompress`] with an explicit output bound.
    pub fn decompress_with_limit(&self, input: &[u8], limit: usize) -> DsResult<Vec<u8>> {
        match self {
            Self::Null => Ok(input.to_vec()),
            Self::Lz4 => lz4::decode_block(input, limit, lz4::Lz4End::InputExhausted)
                .map(|(out, _)| out)
                .map_err(|e| fail(e.to_string())),
            Self::Zlib { .. } => {
                let mut out = Vec::new();
                zlib_decompress_into(input, limit, &mut out).map_err(fail)?;
                Ok(out)
            }
            Self::Gzip { .. } => gzip_decompress(input, limit).map_err(fail),
            Self::Blosc(_) => blosc::decompress(input, limit).map_err(fail),
            Self::Zstd { .. } => zstd_decompress(input, limit).map_err(fail),
            Self::Chained(compressors) => {
                let mut bytes = input.to_vec();
                for (i, compressor) in compressors.iter().enumerate().rev() {
                    let step_limit = if i == 0 {
                        limit
                    } else {
                        DEFAULT_MAX_DECOMPRESSED_BYTES
                    };
                    bytes = compressor.decompress_with_limit(&bytes, step_limit)?;
                }
                Ok(bytes)
            }
        }
    }

    /// Compresses one chunk. Output is decodable by the Scala/Java readers; it is not
    /// byte-identical to the Java libraries' output (see the DS2-codecs checkpoint).
    pub fn compress(&self, input: &[u8]) -> DsResult<Vec<u8>> {
        match self {
            Self::Null => Ok(input.to_vec()),
            Self::Lz4 => Ok(lz4::compress_block(input)),
            Self::Zlib { level } => {
                let mut encoder = flate2::write::ZlibEncoder::new(
                    Vec::new(),
                    flate2::Compression::new(level.clamp(&0, &9).unsigned_abs()),
                );
                encoder
                    .write_all(input)
                    .and_then(|()| encoder.finish())
                    .map_err(|e| fail(format!("zlib compression failed: {e}")))
            }
            Self::Gzip { level } => {
                let compression = if *level < 0 {
                    flate2::Compression::default()
                } else {
                    flate2::Compression::new(level.unsigned_abs().min(9))
                };
                // Like java.util.zip.GZIPOutputStream: no file name, mtime 0, OS 255 (unknown).
                let mut encoder = flate2::GzBuilder::new()
                    .operating_system(255)
                    .write(Vec::new(), compression);
                encoder
                    .write_all(input)
                    .and_then(|()| encoder.finish())
                    .map_err(|e| fail(format!("gzip compression failed: {e}")))
            }
            Self::Blosc(config) => blosc::compress(input, config).map_err(fail),
            Self::Zstd { .. } => Ok(zstd_compress(input)),
            Self::Chained(compressors) => {
                let mut bytes = input.to_vec();
                for compressor in compressors {
                    bytes = compressor.compress(&bytes)?;
                }
                Ok(bytes)
            }
        }
    }
}

/// Scala `toString` (used in log and error messages).
impl fmt::Display for Compressor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Null | Self::Lz4 => f.write_str(self.id()),
            Self::Zlib { level } | Self::Gzip { level } => {
                write!(f, "compressor={}/level={level}", self.id())
            }
            Self::Blosc(c) => write!(
                f,
                "compressor=blosc/cname={}/clevel={}/blocksize={}/shuffle={}/typesize={}",
                c.cname.java_name(),
                c.clevel,
                c.blocksize,
                c.shuffle.java_name(),
                c.typesize
            ),
            Self::Zstd { level, checksum } => {
                write!(f, "compressor=zstd/level={level}/checksum={checksum}")
            }
            Self::Chained(compressors) => {
                let parts: Vec<String> = compressors.iter().map(ToString::to_string).collect();
                write!(
                    f,
                    "compressor=chainedcompressor{}",
                    parts.join("/nextCompressor->")
                )
            }
        }
    }
}

/// Inflates a complete zlib stream (java `InflaterInputStream`; bytes after the end of the stream
/// are ignored) into `out`, producing at most `limit` bytes.
pub(crate) fn zlib_decompress_into(
    input: &[u8],
    limit: usize,
    out: &mut Vec<u8>,
) -> Result<(), String> {
    let mut inflater = flate2::Decompress::new(true);
    let start = out.len();
    loop {
        let produced = out.len() - start;
        if out.len() == out.capacity() {
            let room = (limit - produced)
                .saturating_add(1)
                .min(input.len().saturating_mul(4).max(32 * 1024));
            out.reserve_exact(room);
        }
        let consumed = usize::try_from(inflater.total_in()).unwrap_or(usize::MAX);
        let (in_before, out_before) = (inflater.total_in(), inflater.total_out());
        let status = inflater
            .decompress_vec(
                input.get(consumed..).unwrap_or_default(),
                out,
                flate2::FlushDecompress::None,
            )
            .map_err(|e| format!("zlib: {e}"))?;
        if out.len() - start > limit {
            return Err(format!(
                "zlib: decompressed data exceeds the allowed {limit} bytes"
            ));
        }
        match status {
            flate2::Status::StreamEnd => return Ok(()),
            _ if inflater.total_in() == in_before
                && inflater.total_out() == out_before
                && out.len() < out.capacity() =>
            {
                return Err("Unexpected end of ZLIB input stream".to_owned());
            }
            _ => {}
        }
    }
}

/// java `GZIPInputStream`: decodes concatenated members; trailing bytes that do not start a new
/// member are ignored.
fn gzip_decompress(input: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut rest = input;
    loop {
        let mut decoder = flate2::bufread::GzDecoder::new(rest);
        let budget = (limit - out.len()) as u64 + 1;
        (&mut decoder)
            .take(budget)
            .read_to_end(&mut out)
            .map_err(|e| format!("gzip: {e}"))?;
        if out.len() > limit {
            return Err(format!(
                "gzip: decompressed data exceeds the allowed {limit} bytes"
            ));
        }
        rest = decoder.into_inner();
        if !rest.starts_with(&[0x1f, 0x8b]) {
            return Ok(out);
        }
    }
}

/// Decodes concatenated zstd frames (skippable frames are skipped), verifying content checksums.
pub(crate) fn zstd_decompress(input: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    use ruzstd::decoding::{
        StreamingDecoder,
        errors::{FrameDecoderError, ReadFrameHeaderError},
    };
    let mut out = Vec::new();
    let mut src = input;
    while !src.is_empty() {
        let mut decoder = match StreamingDecoder::new(&mut src) {
            Ok(decoder) => decoder,
            Err(FrameDecoderError::ReadFrameHeaderError(ReadFrameHeaderError::SkipFrame {
                length,
                ..
            })) => {
                let length = length as usize;
                src = src
                    .get(length..)
                    .ok_or_else(|| "zstd: truncated skippable frame".to_owned())?;
                continue;
            }
            Err(e) => return Err(format!("zstd: {e}")),
        };
        let budget = (limit - out.len()) as u64 + 1;
        (&mut decoder)
            .take(budget)
            .read_to_end(&mut out)
            .map_err(|e| format!("zstd: {e}"))?;
        if out.len() > limit {
            return Err(format!(
                "zstd: decompressed data exceeds the allowed {limit} bytes"
            ));
        }
        let frame = &decoder.decoder;
        if !frame.is_finished() {
            return Err("zstd: truncated frame".to_owned());
        }
        if let (Some(stored), Some(computed)) = (
            frame.get_checksum_from_data(),
            frame.get_calculated_checksum(),
        ) && stored != computed
        {
            return Err("zstd: content checksum mismatch".to_owned());
        }
    }
    Ok(out)
}

/// One zstd frame (ruzstd's "fastest" level; content checksum always written).
pub(crate) fn zstd_compress(input: &[u8]) -> Vec<u8> {
    ruzstd::encoding::compress_to_vec(input, ruzstd::encoding::CompressionLevel::Fastest)
}

/// Scala `WKWCompressionHelper.decompressChunk` for LZ4/LZ4HC blocks (lz4-java
/// `fastDecompressor`): exactly `num_bytes_per_chunk` bytes must be produced and the whole input
/// must be consumed.
pub fn wkw_decompress_block(compressed: &[u8], num_bytes_per_chunk: usize) -> DsResult<Vec<u8>> {
    let (out, consumed) =
        lz4::decode_block(compressed, num_bytes_per_chunk, lz4::Lz4End::OutputFull)
            .map_err(|e| fail(format!("Error processing WKW file: {e}.")))?;
    if consumed != compressed.len() {
        return Err(fail(format!(
            "Error processing WKW file: Decompressed unexpected number of bytes [expected: {}, actual: {consumed}].",
            compressed.len()
        )));
    }
    Ok(out)
}

/// Scala `WKWCompressionHelper.compressChunk` for LZ4 and LZ4HC blocks. Both produce a standard
/// LZ4 block (lz4_flex has no high-compression mode; any LZ4 decoder reads either).
pub fn wkw_compress_block(raw: &[u8]) -> Vec<u8> {
    lz4::compress_block(raw)
}
