//! Scala `dataformats/wkw/WKWHeader` (+ `ChunkType`, `WKWDataFormatHelper` paths).
//!
//! Layout (little endian): `"WKW"`, version (1), side lengths (`log2(file side in blocks) << 4 |
//! log2(block side in voxels)`), block type (1 raw, 2 LZ4, 3 LZ4HC), voxel type (WKW id), bytes
//! per voxel, then the jump table: one `i64` (data offset) for raw files and `header.wkw`,
//! `numChunksPerShard + 1` absolute block offsets for compressed data files. Blocks are stored in
//! Morton order within a file; voxels within a block are `c, x, y, z` (Fortran order).

use super::super::data_type::{
    ArrayDataType, ArrayOrder, DimensionSeparator, FillValue, JavaNumber,
};
use super::super::header::DatasetHeader;
use crate::compression::Compressor;
use crate::error::{DsError, DsResult};
use crate::models::{BUCKET_LENGTH, Vec3Int};

/// Scala `WKWDataFormatHelper.FILENAME_HEADER_WKW`.
pub const FILENAME_HEADER_WKW: &str = "header.wkw";
const DATA_FILE_EXTENSION: &str = "wkw";
const MAGIC_BYTES: &[u8; 3] = b"WKW";
/// Scala `WKWHeader.currentVersion`.
pub const CURRENT_VERSION: u8 = 1;
/// Size of the fixed header part before the jump table.
pub const HEADER_FIXED_BYTES: usize = 8;

/// Scala `ChunkType` (`Enumeration(1)`: Raw = 1, LZ4 = 2, LZ4HC = 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChunkType {
    Raw,
    Lz4,
    Lz4Hc,
}

impl ChunkType {
    pub fn id(self) -> u8 {
        match self {
            Self::Raw => 1,
            Self::Lz4 => 2,
            Self::Lz4Hc => 3,
        }
    }

    /// Scala `ChunkType(id)` (throws `NoSuchElementException` for unknown ids).
    pub fn from_id(id: u8) -> DsResult<Self> {
        match id {
            1 => Ok(Self::Raw),
            2 => Ok(Self::Lz4),
            3 => Ok(Self::Lz4Hc),
            _ => Err(java_exception(
                "java.util.NoSuchElementException",
                format!("key not found: {id}"),
            )),
        }
    }

    pub fn is_compressed(self) -> bool {
        matches!(self, Self::Lz4 | Self::Lz4Hc)
    }
}

/// `tryo` failure of a Java exception: message = `getMessage`, exception text = `toString`.
pub(crate) fn java_exception(class: &str, message: impl Into<String>) -> DsError {
    let message = message.into();
    DsError {
        exception: Some(format!("{class}: {message}")),
        ..DsError::failure(message)
    }
}

/// An exception without a message (`toString` is the class name), e.g. `EOFException`.
pub(crate) fn java_exception_without_message(class: &str) -> DsError {
    DsError::from_exception(class)
}

fn header_error(
    msg: &str,
    expected: impl std::fmt::Display,
    actual: impl std::fmt::Display,
) -> String {
    format!("Error reading WKW header: {msg} [expected: {expected}, actual: {actual}].")
}

fn header_error_plain(msg: &str) -> String {
    format!("Error reading WKW header: {msg}.")
}

/// Renders a byte array for the magic-bytes message. Scala prints the JVM identity string
/// (`[B@1b2c3d`), which is not reproducible; the Rust port prints the byte values instead.
fn render_bytes(bytes: &[u8]) -> String {
    let parts: Vec<String> = bytes.iter().map(|b| (*b as i8).to_string()).collect();
    format!("[{}]", parts.join(", "))
}

/// Minimal Guava `LittleEndianDataInputStream` over a byte slice.
struct LeReader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> LeReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    /// Commons-IO `IOUtils.toByteArray(input, size)`.
    fn read_exact_commons(&mut self, size: usize) -> DsResult<&'a [u8]> {
        let available = self.bytes.len() - self.position;
        if available < size {
            return Err(java_exception(
                "java.io.IOException",
                format!("Unexpected read size, current: {available}, expected: {size}"),
            ));
        }
        let slice = &self.bytes[self.position..self.position + size];
        self.position += size;
        Ok(slice)
    }

    fn read_unsigned_byte(&mut self) -> DsResult<u8> {
        let byte = *self
            .bytes
            .get(self.position)
            .ok_or_else(|| java_exception_without_message("java.io.EOFException"))?;
        self.position += 1;
        Ok(byte)
    }

    fn read_long(&mut self) -> DsResult<i64> {
        let end = self.position + 8;
        let slice = self
            .bytes
            .get(self.position..end)
            .ok_or_else(|| java_exception_without_message("java.io.EOFException"))?;
        self.position = end;
        Ok(i64::from_le_bytes(slice.try_into().expect("8 bytes")))
    }
}

/// Scala `WKWHeader`.
#[derive(Debug, Clone, PartialEq)]
pub struct WkwHeader {
    pub version: u8,
    /// Number of blocks per file and dimension (Scala `numChunksPerShardDimension`).
    pub num_chunks_per_shard_dimension: i32,
    /// Number of voxels per block and dimension (Scala `numVoxelsPerChunkDimension`).
    pub num_voxels_per_chunk_dimension: i32,
    pub block_type: ChunkType,
    pub data_type: ArrayDataType,
    pub num_channels: i32,
    /// Absolute block offsets (compressed data files) or `[dataOffset]`.
    pub jump_table: Vec<i64>,
    chunk_shape: Vec<i32>,
    fill_value: FillValue,
    compressor: Compressor,
}

const VOXEL_OFFSET: [i32; 4] = [0, 0, 0, 0];

impl WkwHeader {
    /// The full Scala case-class constructor.
    #[allow(clippy::too_many_arguments)]
    pub fn from_parts(
        version: u8,
        num_chunks_per_shard_dimension: i32,
        num_voxels_per_chunk_dimension: i32,
        block_type: ChunkType,
        data_type: ArrayDataType,
        num_channels: i32,
        jump_table: Vec<i64>,
    ) -> Self {
        let b = num_voxels_per_chunk_dimension;
        Self {
            version,
            num_chunks_per_shard_dimension,
            num_voxels_per_chunk_dimension,
            block_type,
            data_type,
            num_channels,
            jump_table,
            chunk_shape: vec![num_channels, b, b, b],
            // Scala `fill_value = Right(0)`
            fill_value: FillValue::Number(JavaNumber::Long(0)),
            compressor: if block_type.is_compressed() {
                Compressor::Lz4
            } else {
                Compressor::Null
            },
        }
    }

    /// Scala `WKWHeader(numChunksPerShardDimension, numVoxelsPerChunkDimension, blockType,
    /// dataType, numChannels)` (current version, jump table `[0]`).
    pub fn new(
        num_chunks_per_shard_dimension: i32,
        num_voxels_per_chunk_dimension: i32,
        block_type: ChunkType,
        data_type: ArrayDataType,
        num_channels: i32,
    ) -> Self {
        Self::from_parts(
            CURRENT_VERSION,
            num_chunks_per_shard_dimension,
            num_voxels_per_chunk_dimension,
            block_type,
            data_type,
            num_channels,
            vec![0],
        )
    }

    /// Scala `WKWHeader(dataStream, readJumpTable)`. Returns the header and the number of bytes
    /// consumed. Truncated input fails with the Java exception text (`java.io.EOFException`).
    pub fn parse_with_length(bytes: &[u8], read_jump_table: bool) -> DsResult<(Self, usize)> {
        let mut reader = LeReader::new(bytes);
        let magic = reader.read_exact_commons(MAGIC_BYTES.len())?;
        let version = reader.read_unsigned_byte()?;
        let side_lengths = reader.read_unsigned_byte()?;
        let num_chunks_per_shard_dimension = 1i32 << (side_lengths >> 4);
        let num_voxels_per_chunk_dimension = 1i32 << (side_lengths & 0x0f);
        let block_type_id = reader.read_unsigned_byte()?;
        let voxel_type_id = reader.read_unsigned_byte()?;
        let num_bytes_per_voxel = i32::from(reader.read_unsigned_byte()?);

        if magic != MAGIC_BYTES {
            return Err(DsError::failure(header_error(
                "Invalid magic bytes",
                render_bytes(MAGIC_BYTES),
                render_bytes(magic),
            )));
        }
        if version != CURRENT_VERSION {
            return Err(DsError::failure(header_error(
                "Unknown version",
                CURRENT_VERSION,
                version,
            )));
        }
        // Scala: "We only support fileSideLengths < 1024". Expected/actual are swapped in Scala.
        if num_chunks_per_shard_dimension >= 1024 {
            return Err(DsError::failure(header_error(
                "Specified fileSideLength not supported",
                num_chunks_per_shard_dimension,
                "[0, 1024)",
            )));
        }
        // Scala checks numChunksPerShardDimension again here (copy-paste), so the blockSideLength
        // check can never fail; kept for parity.
        if num_chunks_per_shard_dimension >= 1024 {
            return Err(DsError::failure(header_error(
                "Specified blockSideLength not supported",
                num_voxels_per_chunk_dimension,
                "[0, 1024)",
            )));
        }
        let block_type = ChunkType::from_id(block_type_id)
            .map_err(|e| e.wrap(header_error_plain("Specified blockType is not supported")))?;
        let data_type = ArrayDataType::from_wkw_type_id(voxel_type_id).ok_or_else(|| {
            java_exception(
                "scala.MatchError",
                format!("{voxel_type_id} (of class java.lang.Integer)"),
            )
            .wrap(header_error_plain("Specified voxelType is not supported"))
        })?;
        let num_channels = num_bytes_per_voxel / data_type.bytes_per_element() as i32;

        let jump_table = if block_type.is_compressed() && read_jump_table {
            let n = num_chunks_per_shard(num_chunks_per_shard_dimension);
            (0..=n)
                .map(|_| reader.read_long())
                .collect::<DsResult<Vec<_>>>()?
        } else {
            vec![reader.read_long()?]
        };
        Ok((
            Self::from_parts(
                version,
                num_chunks_per_shard_dimension,
                num_voxels_per_chunk_dimension,
                block_type,
                data_type,
                num_channels,
                jump_table,
            ),
            reader.position,
        ))
    }

    /// See [`WkwHeader::parse_with_length`].
    pub fn parse(bytes: &[u8], read_jump_table: bool) -> DsResult<Self> {
        Self::parse_with_length(bytes, read_jump_table).map(|(header, _)| header)
    }

    /// Scala `dataOffset` (`jumpTable.head`).
    pub fn data_offset(&self) -> i64 {
        self.jump_table.first().copied().unwrap_or(0)
    }

    pub fn is_compressed(&self) -> bool {
        self.block_type.is_compressed()
    }

    /// Scala `numChunksPerShard` (blocks per file).
    pub fn num_chunks_per_shard(&self) -> i32 {
        num_chunks_per_shard(self.num_chunks_per_shard_dimension)
    }

    /// Scala `numBytesPerVoxel`.
    pub fn num_bytes_per_voxel(&self) -> i32 {
        self.num_channels * self.data_type.bytes_per_element() as i32
    }

    /// Scala `numBytesPerChunk` (64 bit here; Scala's `Int` wraps for blocks of 2^31 bytes).
    pub fn num_bytes_per_chunk(&self) -> i64 {
        let b = i64::from(self.num_voxels_per_chunk_dimension);
        b * b * b * i64::from(self.num_bytes_per_voxel())
    }

    /// Scala `blockLengths`: compressed sizes from the jump table, or `numBytesPerChunk` each.
    pub fn block_lengths(&self) -> Vec<i64> {
        if self.is_compressed() {
            self.jump_table.windows(2).map(|w| w[1] - w[0]).collect()
        } else {
            vec![self.num_bytes_per_chunk(); self.num_chunks_per_shard().max(0) as usize]
        }
    }

    /// Scala `shardShape`: `[c, file side in voxels (x, y, z)]`.
    pub fn shard_shape(&self) -> Vec<i32> {
        let side = self
            .num_chunks_per_shard_dimension
            .wrapping_mul(self.num_voxels_per_chunk_dimension);
        vec![self.num_channels, side, side, side]
    }

    /// Scala `writeTo(output, isHeaderFile)`. Jump table entries are relocated so the data starts
    /// right after the table (`8 + 8 * len`); a header file gets a single zero long instead.
    pub fn write_to(&self, is_header_file: bool) -> Vec<u8> {
        let log2 = |v: i32| ((f64::from(v)).ln() / 2f64.ln()) as i32;
        let side_lengths = (log2(self.num_chunks_per_shard_dimension) << 4)
            + log2(self.num_voxels_per_chunk_dimension);
        let mut out = Vec::with_capacity(HEADER_FIXED_BYTES + 8 * self.jump_table.len().max(1));
        out.extend_from_slice(MAGIC_BYTES);
        out.push(CURRENT_VERSION);
        out.push(side_lengths as u8);
        out.push(self.block_type.id());
        out.push(self.data_type.to_wkw_id().unwrap_or(0));
        out.push(self.num_bytes_per_voxel() as u8);
        if is_header_file {
            out.extend_from_slice(&0i64.to_be_bytes());
        } else {
            let real_data_offset = 8 + self.jump_table.len() as i64 * 8;
            let data_offset = self.data_offset();
            for entry in &self.jump_table {
                out.extend_from_slice(&(entry - data_offset + real_data_offset).to_le_bytes());
            }
        }
        out
    }
}

fn num_chunks_per_shard(per_dimension: i32) -> i32 {
    per_dimension
        .wrapping_mul(per_dimension)
        .wrapping_mul(per_dimension)
}

impl DatasetHeader for WkwHeader {
    /// Scala `datasetShape = None` (WKW has no stored extent).
    fn dataset_shape(&self) -> Option<&[i64]> {
        None
    }

    fn chunk_shape(&self) -> &[i32] {
        &self.chunk_shape
    }

    fn dimension_separator(&self) -> DimensionSeparator {
        DimensionSeparator::Slash
    }

    fn fill_value(&self) -> &FillValue {
        &self.fill_value
    }

    fn order(&self) -> ArrayOrder {
        ArrayOrder::F
    }

    fn resolved_data_type(&self) -> ArrayDataType {
        self.data_type
    }

    /// Scala `compressorImpl`: `NullCompressor` for raw blocks, `Lz4Compressor` (raw LZ4 block
    /// decoded until the input ends) for LZ4 and LZ4HC.
    fn compressor(&self) -> DsResult<&Compressor> {
        Ok(&self.compressor)
    }

    fn voxel_offset(&self) -> &[i32] {
        &VOXEL_OFFSET
    }

    // `byte_order` is NOT overridden: Scala's WKWHeader keeps the DatasetHeader default
    // (BIG_ENDIAN) although WKW files are little endian. This only matters for non-shortcut
    // (unaligned) typed reads of multi-byte types; kept for parity.

    fn is_sharded(&self) -> bool {
        true
    }
}

/// Scala `WKWDataFormatHelper.wkwFilePath(x, y, z)`: `z{z}/y{y}/x{x}.wkw`.
pub fn wkw_file_path(x: i32, y: i32, z: i32) -> String {
    format!("z{z}/y{y}/x{x}.{DATA_FILE_EXTENSION}")
}

/// Scala `wkwFilePath(bucket)` (single-bucket files, as for volume tracings):
/// `<mag literal>/z{bz}/y{by}/x{bx}.wkw` with bucket coordinates in the bucket's mag.
pub fn wkw_bucket_file_path(mag: Vec3Int, bucket: Vec3Int) -> String {
    format!(
        "{}/{}",
        mag.to_mag_literal(true),
        wkw_file_path(bucket.x, bucket.y, bucket.z)
    )
}

/// Scala `parseWKWFilePath` (single-bucket files): the mag and the bucket's top-left voxel in mag
/// 1 (Scala `BucketPosition(x * mag.x * 32, ...)`), for paths ending in
/// `<mag>/z<d>/y<d>/x<d>.wkw` (mag `2` or `2-2-1`).
pub fn parse_wkw_file_path(path: &str) -> Option<(Vec3Int, Vec3Int)> {
    let rest = path.strip_suffix(".wkw")?;
    let mut parts = rest.rsplit('/');
    let x = parts.next()?.strip_prefix('x')?;
    let y = parts.next()?.strip_prefix('y')?;
    let z = parts.next()?.strip_prefix('z')?;
    let mag_str = parts.next()?;
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if !digits(x) || !digits(y) || !digits(z) {
        return None;
    }
    let mag_ok = digits(mag_str) || {
        let groups: Vec<&str> = mag_str.split('-').collect();
        groups.len() == 3 && groups.iter().all(|g| digits(g))
    };
    if !mag_ok {
        return None;
    }
    // Scala `toInt` throws for out-of-range numbers (the regex matched); treat as no match.
    let (x, y, z): (i32, i32, i32) = (x.parse().ok()?, y.parse().ok()?, z.parse().ok()?);
    let mag = Vec3Int::from_mag_literal(mag_str, true)?;
    Some((
        mag,
        Vec3Int::new(
            x.wrapping_mul(mag.x).wrapping_mul(BUCKET_LENGTH),
            y.wrapping_mul(mag.y).wrapping_mul(BUCKET_LENGTH),
            z.wrapping_mul(mag.z).wrapping_mul(BUCKET_LENGTH),
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header_bytes(side: u8, block_type: u8, voxel_type: u8, bytes_per_voxel: u8) -> Vec<u8> {
        let mut b = b"WKW".to_vec();
        b.extend_from_slice(&[1, side, block_type, voxel_type, bytes_per_voxel]);
        b
    }

    #[test]
    fn parses_header_file() {
        let mut bytes = header_bytes(0x55, 2, 2, 6);
        bytes.extend_from_slice(&0i64.to_le_bytes());
        let header = WkwHeader::parse(&bytes, false).unwrap();
        assert_eq!(header.num_chunks_per_shard_dimension, 32);
        assert_eq!(header.num_voxels_per_chunk_dimension, 32);
        assert_eq!(header.block_type, ChunkType::Lz4);
        assert_eq!(header.data_type, ArrayDataType::U2);
        assert_eq!(header.num_channels, 3);
        assert_eq!(header.jump_table, vec![0]);
        assert_eq!(header.chunk_shape(), &[3, 32, 32, 32]);
        assert_eq!(header.shard_shape(), vec![3, 1024, 1024, 1024]);
        assert_eq!(header.num_bytes_per_chunk(), 32 * 32 * 32 * 6);
        assert_eq!(header.bytes_per_chunk(), 32 * 32 * 32 * 6);
        assert_eq!(header.num_chunks_per_shard(), 32768);
        assert_eq!(header.order(), ArrayOrder::F);
        assert!(header.is_sharded());
        assert_eq!(header.compressor().unwrap(), &Compressor::Lz4);
        assert!(header.dataset_shape().is_none());
        assert_eq!(header.fill_value_number(), JavaNumber::Long(0));
        // header-file round trip (Scala writeTo(isHeaderFile = true))
        assert_eq!(header.write_to(true), bytes);
    }

    #[test]
    fn reads_jump_table_only_for_compressed_data_files() {
        let mut bytes = header_bytes(0x15, 2, 1, 1);
        let table: Vec<i64> = (0..=8).map(|i| 80 + i * 10).collect();
        for t in &table {
            bytes.extend_from_slice(&t.to_le_bytes());
        }
        let (header, consumed) = WkwHeader::parse_with_length(&bytes, true).unwrap();
        assert_eq!(consumed, 80);
        assert_eq!(header.jump_table, table);
        assert_eq!(header.block_lengths(), vec![10; 8]);
        assert_eq!(header.data_offset(), 80);
        assert_eq!(
            WkwHeader::parse(&bytes, false).unwrap().jump_table,
            vec![80]
        );
        // write_to relocates to 8 + 8 * len
        assert_eq!(header.write_to(false), bytes);

        let mut raw = header_bytes(0x15, 1, 1, 1);
        raw.extend_from_slice(&16i64.to_le_bytes());
        let raw_header = WkwHeader::parse(&raw, true).unwrap();
        assert_eq!(raw_header.jump_table, vec![16]);
        assert_eq!(raw_header.compressor().unwrap(), &Compressor::Null);
        assert_eq!(raw_header.block_lengths(), vec![32768; 8]);

        // truncated jump table
        let err = WkwHeader::parse(&bytes[..40], true).unwrap_err();
        assert_eq!(err.message, "java.io.EOFException");
    }

    #[test]
    fn validation_messages_match_scala() {
        let mut bad_magic = b"WKX".to_vec();
        bad_magic.extend_from_slice(&[1, 0x55, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(
            WkwHeader::parse(&bad_magic, false).unwrap_err().message,
            "Error reading WKW header: Invalid magic bytes [expected: [87, 75, 87], actual: [87, 75, 88]]."
        );
        let mut v2 = header_bytes(0x55, 1, 1, 1);
        v2[3] = 2;
        assert_eq!(
            WkwHeader::parse(&v2, false).unwrap_err().message,
            "Error reading WKW header: Unknown version [expected: 1, actual: 2]."
        );
        assert_eq!(
            WkwHeader::parse(&header_bytes(0xa5, 1, 1, 1), false)
                .unwrap_err()
                .message,
            "Error reading WKW header: Specified fileSideLength not supported [expected: 1024, actual: [0, 1024)]."
        );
        let err = WkwHeader::parse(&header_bytes(0x55, 4, 1, 1), false).unwrap_err();
        assert_eq!(
            err.message,
            "Error reading WKW header: Specified blockType is not supported."
        );
        assert_eq!(
            err.chain,
            vec!["key not found: 4 java.util.NoSuchElementException: key not found: 4"]
        );
        let err = WkwHeader::parse(&header_bytes(0x55, 1, 11, 1), false).unwrap_err();
        assert_eq!(
            err.message,
            "Error reading WKW header: Specified voxelType is not supported."
        );
        // validation happens before the jump table is read
        assert_eq!(
            WkwHeader::parse(&header_bytes(0x55, 1, 1, 1), false)
                .unwrap_err()
                .message,
            "java.io.EOFException"
        );
        assert_eq!(
            WkwHeader::parse(b"WK", false).unwrap_err().message,
            "Unexpected read size, current: 2, expected: 3"
        );
    }

    #[test]
    fn file_paths() {
        assert_eq!(wkw_file_path(1, 2, 3), "z3/y2/x1.wkw");
        assert_eq!(
            wkw_bucket_file_path(Vec3Int::new(2, 2, 1), Vec3Int::new(4, 5, 6)),
            "2-2-1/z6/y5/x4.wkw"
        );
        assert_eq!(
            wkw_bucket_file_path(Vec3Int::new(4, 4, 4), Vec3Int::new(0, 0, 1)),
            "4/z1/y0/x0.wkw"
        );
        assert_eq!(
            parse_wkw_file_path("layer/2-2-1/z6/y5/x4.wkw"),
            Some((Vec3Int::new(2, 2, 1), Vec3Int::new(256, 320, 192)))
        );
        assert_eq!(
            parse_wkw_file_path("4/z1/y0/x0.wkw"),
            Some((Vec3Int::new(4, 4, 4), Vec3Int::new(0, 0, 128)))
        );
        assert_eq!(parse_wkw_file_path("z1/y0/x0.wkw"), None);
        assert_eq!(parse_wkw_file_path("a/z1/y0/x0.wkw"), None);
        assert_eq!(parse_wkw_file_path("1/z1/y0/x0.wkx"), None);
    }
}
