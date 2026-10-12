//! Pure-Rust Blosc1 (container format version 2) as produced/consumed by c-blosc 1.21 through
//! blosc-java (`com.scalableminds:blosc-java:0.3-1.21.6`, numthreads = 1).
//!
//! Layout: 16-byte header (`version`, `versionlz`, `flags`, `typesize`, `nbytes`, `blocksize`,
//! `cbytes`; integers little-endian i32), then (unless `flags & MEMCPYED`) one i32 start offset
//! per block, then per block one or `typesize` split streams, each prefixed by its i32 compressed
//! size (`== neblock` means stored uncompressed). `flags`: 0x01 byte shuffle, 0x02 memcpyed,
//! 0x04 bit shuffle, 0x10 no split, bits 5..7 the internal codec format
//! (0 blosclz, 1 lz4/lz4hc, 2 snappy, 3 zlib, 4 zstd).

use std::io::Write;

use super::{blosclz, lz4, zlib_decompress_into, zstd_decompress};

const HEADER_LEN: usize = 16;
const VERSION_FORMAT: u8 = 2;
const VERSION_LZ: u8 = 1;
const MIN_BUFFERSIZE: usize = 128;
const MAX_SPLITS: usize = 16;
const MAX_TYPESIZE: usize = 255;
const L1: usize = 32 * 1024;

const FLAG_SHUFFLE: u8 = 0x01;
const FLAG_MEMCPYED: u8 = 0x02;
const FLAG_BITSHUFFLE: u8 = 0x04;
const FLAG_NOSPLIT: u8 = 0x10;

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

    fn format(self) -> u8 {
        match self {
            Self::Blosclz => 0,
            Self::Lz4 | Self::Lz4hc => 1,
            Self::Zlib => 3,
            Self::Zstd => 4,
        }
    }

    /// High compression ratio codecs get larger blocks in c-blosc.
    fn is_hcr(self) -> bool {
        matches!(self, Self::Lz4hc | Self::Zlib | Self::Zstd)
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

fn read_i32(bytes: &[u8], pos: usize) -> Option<i32> {
    let slice = bytes.get(pos..pos.checked_add(4)?)?;
    Some(i32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn read_len(bytes: &[u8], pos: usize) -> Option<usize> {
    usize::try_from(read_i32(bytes, pos)?).ok()
}

/// Blosc1 decompression bounded by `limit` output bytes.
pub(crate) fn decompress(input: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    if input.len() < HEADER_LEN {
        return Err(format!(
            "blosc: input of {} bytes is shorter than the 16-byte header",
            input.len()
        ));
    }
    let version = input[0];
    let flags = input[2];
    let typesize = usize::from(input[3]);
    let header_int = |pos: usize, name: &str| {
        read_len(input, pos).ok_or_else(|| format!("blosc: invalid {name} in header"))
    };
    let nbytes = header_int(4, "nbytes")?;
    let blocksize = header_int(8, "blocksize")?;
    let cbytes = header_int(12, "cbytes")?;
    if version == 0 || version > VERSION_FORMAT {
        return Err(format!("blosc: unsupported format version {version}"));
    }
    if cbytes < HEADER_LEN || cbytes > input.len() {
        return Err(format!(
            "blosc: header announces {cbytes} compressed bytes but {} are available",
            input.len()
        ));
    }
    if nbytes > limit {
        return Err(format!(
            "blosc: header announces {nbytes} decompressed bytes, more than the allowed {limit}"
        ));
    }
    let src = &input[..cbytes];
    if nbytes == 0 {
        return Ok(Vec::new());
    }
    if flags & FLAG_MEMCPYED != 0 {
        return src
            .get(HEADER_LEN..HEADER_LEN + nbytes)
            .map(<[u8]>::to_vec)
            .ok_or_else(|| "blosc: memcpyed buffer is truncated".to_owned());
    }
    if typesize == 0 {
        return Err("blosc: typesize 0 in header".to_owned());
    }
    if blocksize == 0 {
        return Err("blosc: blocksize 0 in header".to_owned());
    }
    let format = flags >> 5;
    let leftover = nbytes % blocksize;
    let nblocks = nbytes / blocksize + usize::from(leftover > 0);
    let bstarts_end = nblocks
        .checked_mul(4)
        .and_then(|n| n.checked_add(HEADER_LEN))
        .filter(|&end| end <= cbytes)
        .ok_or_else(|| "blosc: block offsets exceed the buffer".to_owned())?;

    let max_block = blocksize.min(nbytes);
    let mut out = Vec::with_capacity(nbytes.min(64 << 20));
    let mut tmp = Vec::with_capacity(max_block);
    for j in 0..nblocks {
        let is_leftover = leftover > 0 && j == nblocks - 1;
        let bsize = if is_leftover { leftover } else { blocksize };
        let start = read_len(src, HEADER_LEN + 4 * j)
            .filter(|&s| s >= bstarts_end && s < cbytes)
            .ok_or_else(|| format!("blosc: invalid start offset of block {j}"))?;
        tmp.clear();
        decode_block(
            src,
            start,
            bsize,
            is_leftover,
            typesize,
            flags,
            format,
            &mut tmp,
        )?;
        unshuffle_block(&tmp, typesize, flags, &mut out);
    }
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
fn decode_block(
    src: &[u8],
    start: usize,
    bsize: usize,
    is_leftover: bool,
    typesize: usize,
    flags: u8,
    format: u8,
    tmp: &mut Vec<u8>,
) -> Result<(), String> {
    let split = flags & FLAG_NOSPLIT == 0
        && !is_leftover
        && typesize <= MAX_SPLITS
        && bsize / typesize >= MIN_BUFFERSIZE;
    let nsplits = if split { typesize } else { 1 };
    if !bsize.is_multiple_of(nsplits) {
        return Err("blosc: block size is not a multiple of the split count".to_owned());
    }
    let neblock = bsize / nsplits;
    let mut pos = start;
    for _ in 0..nsplits {
        let csize =
            read_len(src, pos).ok_or_else(|| "blosc: invalid compressed split size".to_owned())?;
        pos += 4;
        let stream = pos
            .checked_add(csize)
            .and_then(|end| src.get(pos..end))
            .ok_or_else(|| "blosc: compressed split exceeds the buffer".to_owned())?;
        pos += csize;
        let before = tmp.len();
        if csize == neblock {
            tmp.extend_from_slice(stream);
            continue;
        }
        match format {
            0 => {
                let decoded = blosclz::decompress(stream, neblock)
                    .ok_or_else(|| "blosc: blosclz stream is corrupt".to_owned())?;
                tmp.extend_from_slice(&decoded);
            }
            1 => {
                let (decoded, _) = lz4::decode_block(stream, neblock, lz4::Lz4End::InputExhausted)
                    .map_err(|e| format!("blosc: {e}"))?;
                tmp.extend_from_slice(&decoded);
            }
            2 => return Err("blosc: snappy is not supported (as in blosc-java)".to_owned()),
            3 => {
                zlib_decompress_into(stream, neblock, tmp).map_err(|e| format!("blosc: {e}"))?;
            }
            4 => {
                let decoded =
                    zstd_decompress(stream, neblock).map_err(|e| format!("blosc: {e}"))?;
                tmp.extend_from_slice(&decoded);
            }
            other => return Err(format!("blosc: unknown codec format {other}")),
        }
        if tmp.len() - before != neblock {
            return Err(format!(
                "blosc: split decompressed to {} bytes instead of {neblock}",
                tmp.len() - before
            ));
        }
    }
    Ok(())
}

fn unshuffle_block(block: &[u8], typesize: usize, flags: u8, out: &mut Vec<u8>) {
    let bsize = block.len();
    let start = out.len();
    if flags & FLAG_SHUFFLE != 0 && typesize > 1 {
        out.resize(start + bsize, 0);
        let dest = &mut out[start..];
        let n = bsize / typesize;
        for j in 0..typesize {
            for i in 0..n {
                dest[i * typesize + j] = block[j * n + i];
            }
        }
        dest[n * typesize..].copy_from_slice(&block[n * typesize..]);
    } else if flags & FLAG_BITSHUFFLE != 0
        && bsize >= typesize
        && (bsize / typesize).is_multiple_of(8)
    {
        // c-blosc 1.21 `bitunshuffle` for format version 2: only blocks whose element count is a
        // multiple of 8 are bit-transposed; the rest is copied as is.
        out.resize(start + bsize, 0);
        let dest = &mut out[start..];
        let size = bsize / typesize;
        let row = size / 8;
        for e in 0..size {
            let (group, bit) = (e / 8, e % 8);
            for b in 0..typesize {
                let mut value = 0u8;
                for k in 0..8 {
                    value |= ((block[(b * 8 + k) * row + group] >> bit) & 1) << k;
                }
                dest[e * typesize + b] = value;
            }
        }
        dest[size * typesize..].copy_from_slice(&block[size * typesize..]);
    } else {
        out.extend_from_slice(block);
    }
}

fn shuffle_block(block: &[u8], typesize: usize, shuffle: BloscShuffle) -> Vec<u8> {
    let bsize = block.len();
    match shuffle {
        BloscShuffle::ByteShuffle if typesize > 1 => {
            let mut dest = vec![0u8; bsize];
            let n = bsize / typesize;
            for j in 0..typesize {
                for i in 0..n {
                    dest[j * n + i] = block[i * typesize + j];
                }
            }
            dest[n * typesize..].copy_from_slice(&block[n * typesize..]);
            dest
        }
        BloscShuffle::BitShuffle if bsize >= typesize && (bsize / typesize).is_multiple_of(8) => {
            let mut dest = vec![0u8; bsize];
            let size = bsize / typesize;
            let row = size / 8;
            for b in 0..typesize {
                for k in 0..8 {
                    for group in 0..row {
                        let mut value = 0u8;
                        for bit in 0..8 {
                            let e = group * 8 + bit;
                            value |= ((block[e * typesize + b] >> k) & 1) << bit;
                        }
                        dest[(b * 8 + k) * row + group] = value;
                    }
                }
            }
            dest[size * typesize..].copy_from_slice(&block[size * typesize..]);
            dest
        }
        _ => block.to_vec(),
    }
}

/// c-blosc 1.21 `split_block` in the default `BLOSC_FORWARD_COMPAT_SPLIT` mode.
fn split_block(cname: BloscCname, typesize: usize, blocksize: usize) -> bool {
    cname != BloscCname::Zstd && typesize <= MAX_SPLITS && blocksize / typesize >= MIN_BUFFERSIZE
}

/// c-blosc 1.21 `compute_blocksize`.
fn compute_blocksize(
    cname: BloscCname,
    clevel: i32,
    typesize: usize,
    nbytes: usize,
    forced: usize,
) -> usize {
    if nbytes < typesize {
        return 1;
    }
    let mut blocksize = nbytes;
    if forced > 0 {
        blocksize = forced.max(MIN_BUFFERSIZE);
    } else if nbytes >= L1 {
        blocksize = L1;
        if cname.is_hcr() {
            blocksize *= 2;
        }
        blocksize = match clevel {
            0 => blocksize / 4,
            1 => blocksize / 2,
            2 => blocksize,
            3 => blocksize * 2,
            4 | 5 => blocksize * 4,
            6..=8 => blocksize * 8,
            _ => blocksize * 8 * if cname.is_hcr() { 2 } else { 1 },
        };
    }
    if clevel > 0 && split_block(cname, typesize, blocksize) {
        blocksize = blocksize.min(1 << 18) * typesize;
        blocksize = blocksize.clamp(1 << 16, 1 << 20);
    }
    blocksize = blocksize.min(nbytes);
    if blocksize > typesize {
        blocksize = blocksize / typesize * typesize;
    }
    blocksize
}

/// Blosc1 compression with blosc-java's parameters. Output is decodable by c-blosc; the internal
/// codec streams are not byte-identical to c-blosc's.
pub(crate) fn compress(input: &[u8], config: &BloscConfig) -> Result<Vec<u8>, String> {
    let nbytes = input.len();
    if nbytes > i32::MAX as usize - HEADER_LEN {
        return Err("blosc: input larger than 2 GiB cannot be compressed".to_owned());
    }
    // c-blosc falls back to typesize 1 for typesizes above 255; blosc-java is never called with
    // non-positive typesizes by WEBKNOSSOS except zarr3 `typesize` omitted (0), handled the same.
    let typesize = usize::try_from(config.typesize)
        .ok()
        .filter(|t| (1..=MAX_TYPESIZE).contains(t))
        .unwrap_or(1);
    let clevel = config.clevel;
    let forced = usize::try_from(config.blocksize).unwrap_or(0);
    let blocksize = compute_blocksize(config.cname, clevel, typesize, nbytes, forced);
    let mut flags = config.cname.format() << 5;
    match config.shuffle {
        BloscShuffle::NoShuffle => {}
        BloscShuffle::ByteShuffle => flags |= FLAG_SHUFFLE,
        BloscShuffle::BitShuffle => flags |= FLAG_BITSHUFFLE,
    }
    if !split_block(config.cname, typesize, blocksize) {
        flags |= FLAG_NOSPLIT;
    }
    let header = |flags: u8, cbytes: usize| {
        let mut h = Vec::with_capacity(HEADER_LEN);
        h.extend([VERSION_FORMAT, VERSION_LZ, flags, typesize as u8]);
        for v in [nbytes, blocksize, cbytes] {
            h.extend((v as i32).to_le_bytes());
        }
        h
    };
    let memcpyed = || {
        let mut out = header(flags | FLAG_MEMCPYED, nbytes + HEADER_LEN);
        out.extend_from_slice(input);
        out
    };
    if clevel == 0 || nbytes < MIN_BUFFERSIZE {
        return Ok(memcpyed());
    }
    let leftover = nbytes % blocksize;
    let nblocks = nbytes / blocksize + usize::from(leftover > 0);
    let max_bytes = nbytes + HEADER_LEN;
    let mut out = header(flags, 0);
    out.resize(HEADER_LEN + 4 * nblocks, 0);
    for (j, block) in input.chunks(blocksize).enumerate() {
        let is_leftover = leftover > 0 && j == nblocks - 1;
        let start = out.len() as i32;
        out[HEADER_LEN + 4 * j..HEADER_LEN + 4 * j + 4].copy_from_slice(&start.to_le_bytes());
        let shuffled = if config.shuffle == BloscShuffle::BitShuffle || typesize > 1 {
            shuffle_block(block, typesize, config.shuffle)
        } else {
            block.to_vec()
        };
        let split = flags & FLAG_NOSPLIT == 0 && !is_leftover;
        let nsplits = if split { typesize } else { 1 };
        for stream in shuffled.chunks(block.len() / nsplits) {
            let encoded = encode_stream(stream, config.cname, clevel)?
                .filter(|e| !e.is_empty() && e.len() < stream.len());
            let payload = encoded.as_deref().unwrap_or(stream);
            out.extend((payload.len() as i32).to_le_bytes());
            out.extend_from_slice(payload);
            if out.len() > max_bytes {
                return Ok(memcpyed());
            }
        }
    }
    let cbytes = out.len() as i32;
    out[12..16].copy_from_slice(&cbytes.to_le_bytes());
    Ok(out)
}

fn encode_stream(stream: &[u8], cname: BloscCname, clevel: i32) -> Result<Option<Vec<u8>>, String> {
    Ok(match cname {
        BloscCname::Blosclz => blosclz::compress(stream),
        BloscCname::Lz4 | BloscCname::Lz4hc => Some(lz4::compress_block(stream)),
        BloscCname::Zlib => {
            let level = flate2::Compression::new(clevel.clamp(0, 9) as u32);
            let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), level);
            encoder
                .write_all(stream)
                .and_then(|()| encoder.finish())
                .map(Some)
                .map_err(|e| format!("blosc: zlib compression failed: {e}"))?
        }
        BloscCname::Zstd => Some(super::zstd_compress(stream)),
    })
}
