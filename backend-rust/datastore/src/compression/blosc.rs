//! Blosc1 (container format version 2) through c-blosc 1.21.6, the version blosc-java
//! (`com.scalableminds:blosc-java:0.3-1.21.6`, numthreads = 1) bundles. The codec itself is in the
//! `webknossos-blosc` crate; this module holds the Scala `BloscCompressor` settings and checks.

use super::{DEFAULT_MAX_DECOMPRESSED_BYTES, size_limit_message};

const HEADER_LEN: usize = 16;
/// blosc-java is called with one thread (Scala `BloscCompressor`).
const NUM_THREADS: i32 = 1;

/// blosc-java `Blosc.Compressor` (declaration order = Scala `supportedCnames` order).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BloscCname {
    Lz4,
    Lz4hc,
    Blosclz,
    Zstd,
    Zlib,
}

impl BloscCname {
    pub const ALL: [Self; 5] = [
        Self::Lz4,
        Self::Lz4hc,
        Self::Blosclz,
        Self::Zstd,
        Self::Zlib,
    ];

    /// `getValue`, the c-blosc compressor name.
    pub fn value(self) -> &'static str {
        match self {
            Self::Lz4 => "lz4",
            Self::Lz4hc => "lz4hc",
            Self::Blosclz => "blosclz",
            Self::Zstd => "zstd",
            Self::Zlib => "zlib",
        }
    }

    /// Java enum constant name (what Scala's `toString` prints).
    pub fn java_name(self) -> &'static str {
        match self {
            Self::Lz4 => "LZ4",
            Self::Lz4hc => "LZ4HC",
            Self::Blosclz => "BLOSCLZ",
            Self::Zstd => "ZSTD",
            Self::Zlib => "ZLIB",
        }
    }

    /// blosc-java `Compressor.fromString` (case-insensitive).
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|c| c.value().eq_ignore_ascii_case(name))
    }
}

/// blosc-java `Blosc.Shuffle`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BloscShuffle {
    NoShuffle,
    ByteShuffle,
    BitShuffle,
}

impl BloscShuffle {
    pub fn value(self) -> i32 {
        match self {
            Self::NoShuffle => 0,
            Self::ByteShuffle => 1,
            Self::BitShuffle => 2,
        }
    }

    /// The zarr/blosc-java string form (`noshuffle`, `shuffle`, `bitshuffle`).
    pub fn name(self) -> &'static str {
        match self {
            Self::NoShuffle => "noshuffle",
            Self::ByteShuffle => "shuffle",
            Self::BitShuffle => "bitshuffle",
        }
    }

    pub fn java_name(self) -> &'static str {
        match self {
            Self::NoShuffle => "NO_SHUFFLE",
            Self::ByteShuffle => "BYTE_SHUFFLE",
            Self::BitShuffle => "BIT_SHUFFLE",
        }
    }

    /// blosc-java `Shuffle.fromInt`.
    pub fn from_int(value: i32) -> Option<Self> {
        [Self::NoShuffle, Self::ByteShuffle, Self::BitShuffle]
            .into_iter()
            .find(|s| s.value() == value)
    }

    /// blosc-java `Shuffle.fromString` (case-insensitive).
    pub fn from_name(name: &str) -> Option<Self> {
        [Self::NoShuffle, Self::ByteShuffle, Self::BitShuffle]
            .into_iter()
            .find(|s| s.name().eq_ignore_ascii_case(name))
    }
}

/// Settings of a Scala `BloscCompressor`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BloscConfig {
    pub cname: BloscCname,
    pub clevel: i32,
    pub shuffle: BloscShuffle,
    pub blocksize: i32,
    pub typesize: i32,
}

impl Default for BloscConfig {
    /// Scala `BloscCompressor` defaults.
    fn default() -> Self {
        Self {
            cname: BloscCname::Lz4,
            clevel: 5,
            shuffle: BloscShuffle::ByteShuffle,
            blocksize: 0,
            typesize: 1,
        }
    }
}

/// Scala `BloscCompressor.decompress` (header checks, then blosc-java's JNI decompression),
/// bounded by `limit` output bytes.
pub(crate) fn decompress(input: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    if input.len() < HEADER_LEN {
        return Err(format!(
            "blosc: input of {} bytes is too short for the header",
            input.len()
        ));
    }
    // nbytes and cbytes are read as unsigned 32-bit integers.
    let header_u32 = |pos: usize| {
        u32::from_le_bytes([input[pos], input[pos + 1], input[pos + 2], input[pos + 3]])
    };
    let (nbytes, cbytes) = (u64::from(header_u32(4)), u64::from(header_u32(12)));
    if nbytes > DEFAULT_MAX_DECOMPRESSED_BYTES as u64 {
        return Err(size_limit_message(
            "blosc",
            Some(nbytes),
            DEFAULT_MAX_DECOMPRESSED_BYTES,
        ));
    }
    // c-blosc trusts cbytes, so a larger value than the actual input would read past the buffer.
    if cbytes > input.len() as u64 {
        return Err(format!(
            "blosc: header claims {cbytes} compressed bytes, but input has {}",
            input.len()
        ));
    }
    if nbytes > limit as u64 {
        return Err(format!(
            "blosc: header announces {nbytes} decompressed bytes, more than the allowed {limit}"
        ));
    }
    webknossos_blosc::decompress(input, NUM_THREADS)
}

/// Scala `BloscCompressor.compress` (blosc-java's JNI compression).
pub(crate) fn compress(input: &[u8], config: &BloscConfig) -> Result<Vec<u8>, String> {
    if input.len() > i32::MAX as usize - HEADER_LEN {
        return Err("blosc: input larger than 2 GiB cannot be compressed".to_owned());
    }
    // blosc-java rejects non-positive typesizes; WEBKNOSSOS only produces them for zarr3 without
    // `typesize` (0), which is compressed with typesize 1 instead. c-blosc itself treats
    // typesizes above 255 as 1.
    let typesize = usize::try_from(config.typesize)
        .ok()
        .filter(|&t| t > 0)
        .unwrap_or(1);
    webknossos_blosc::compress(
        input,
        config.clevel,
        config.shuffle.value(),
        typesize,
        config.cname.value(),
        usize::try_from(config.blocksize).unwrap_or(0),
        NUM_THREADS,
    )
}
