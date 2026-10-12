//! Scala `dataformats/wkw/WKWFile` (+ `WKWCompressionHelper`): whole-file reading and writing
//! of WKW data files, used by the tracingstore for volume data zips.

use super::header::{ChunkType, WkwHeader};
use crate::compression::{wkw_compress_block, wkw_decompress_block};
use crate::error::{DsError, DsResult};

fn error(msg: &str) -> String {
    format!("Error processing WKW file: {msg}.")
}

fn error_expected(
    msg: &str,
    expected: impl std::fmt::Display,
    actual: impl std::fmt::Display,
) -> String {
    format!("Error processing WKW file: {msg} [expected: {expected}, actual: {actual}].")
}

/// Scala `WKWCompressionHelper.compressChunk` (LZ4 and LZ4HC both produce a standard LZ4 block).
pub fn compress_chunk(target_chunk_type: ChunkType, raw_chunk: &[u8]) -> DsResult<Vec<u8>> {
    Ok(match target_chunk_type {
        ChunkType::Lz4 | ChunkType::Lz4Hc => wkw_compress_block(raw_chunk),
        ChunkType::Raw => raw_chunk.to_vec(),
    })
}

/// Scala `WKWCompressionHelper.decompressChunk` (lz4-java fast decompressor: exactly
/// `num_bytes_per_chunk` output bytes, the whole input consumed).
pub fn decompress_chunk(
    source_chunk_type: ChunkType,
    num_bytes_per_chunk: usize,
    compressed_chunk: &[u8],
) -> DsResult<Vec<u8>> {
    match source_chunk_type {
        ChunkType::Lz4 | ChunkType::Lz4Hc => {
            wkw_decompress_block(compressed_chunk, num_bytes_per_chunk)
        }
        ChunkType::Raw => Ok(compressed_chunk.to_vec()),
    }
}

/// Scala `WKWFile.read`: parses the header including the jump table and returns the decoded
/// blocks in file (Morton) order. The data is expected right after the header. Like Scala
/// (`Iterator.flatMap` over `Box`), blocks whose decompression fails are silently skipped; a
/// truncated file fails with the commons-io `IOUtils.toByteArray` message.
pub fn read_wkw_file(bytes: &[u8]) -> DsResult<(WkwHeader, Vec<Vec<u8>>)> {
    let (header, mut position) = WkwHeader::parse_with_length(bytes, true)?;
    let num_bytes_per_chunk = usize::try_from(header.num_bytes_per_chunk())
        .map_err(|_| DsError::failure(error("Invalid block size")))?;
    let mut blocks = Vec::new();
    for length in header.block_lengths() {
        // Scala `blockLength.toInt`; commons-io rejects negative sizes.
        let length = length as i32;
        let size = usize::try_from(length).map_err(|_| {
            super::header::java_exception(
                "java.lang.IllegalArgumentException",
                format!("Size must be equal or greater than zero: {length}"),
            )
        })?;
        let available = bytes.len() - position;
        if available < size {
            return Err(super::header::java_exception(
                "java.io.IOException",
                format!("Unexpected read size, current: {available}, expected: {size}"),
            ));
        }
        let data = &bytes[position..position + size];
        position += size;
        let block = if header.is_compressed() {
            decompress_chunk(header.block_type, num_bytes_per_chunk, data).ok()
        } else {
            Some(data.to_vec())
        };
        blocks.extend(block);
    }
    Ok((header, blocks))
}

/// Scala `WKWFile.write`: writes `header` with a jump table computed from the (compressed) block
/// lengths, followed by the blocks. Exactly `numChunksPerShard` blocks of `numBytesPerChunk`
/// bytes are required.
pub fn write_wkw_file<I>(header: &WkwHeader, blocks: I) -> DsResult<Vec<u8>>
where
    I: IntoIterator,
    I::Item: AsRef<[u8]>,
{
    let mut blocks = blocks.into_iter();
    let mut data_buffer = Vec::new();
    let mut chunk_lengths = Vec::new();
    for _ in 0..header.num_chunks_per_shard().max(0) {
        let Some(data) = blocks.next() else {
            return Err(DsError::failure("No more chunks in iterator."));
        };
        let data = data.as_ref();
        if data.len() as i64 != header.num_bytes_per_chunk() {
            return Err(DsError::failure(error_expected(
                "Unexpected chunk size",
                header.num_bytes_per_chunk(),
                data.len(),
            )));
        }
        let compressed = if header.is_compressed() {
            compress_chunk(header.block_type, data)?
        } else {
            data.to_vec()
        };
        chunk_lengths.push(compressed.len() as i64);
        data_buffer.extend_from_slice(&compressed);
    }
    let jump_table = if header.is_compressed() {
        let mut table = Vec::with_capacity(chunk_lengths.len() + 1);
        let mut offset = header.data_offset();
        table.push(offset);
        for length in chunk_lengths {
            offset += length;
            table.push(offset);
        }
        table
    } else {
        vec![header.data_offset()]
    };
    let mut header = header.clone();
    header.jump_table = jump_table;
    let mut out = header.write_to(false);
    out.extend_from_slice(&data_buffer);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::datareaders::data_type::ArrayDataType;

    #[test]
    fn write_read_round_trip() {
        for block_type in [ChunkType::Raw, ChunkType::Lz4, ChunkType::Lz4Hc] {
            let header = WkwHeader::new(2, 4, block_type, ArrayDataType::U2, 1);
            let blocks: Vec<Vec<u8>> = (0..8u8)
                .map(|i| {
                    (0..128u8)
                        .map(|j| if i % 2 == 0 { i } else { j ^ i })
                        .collect()
                })
                .collect();
            let bytes = write_wkw_file(&header, &blocks).unwrap();
            let (parsed, read) = read_wkw_file(&bytes).unwrap();
            assert_eq!(parsed.block_type, block_type);
            assert_eq!(read, blocks);
            if block_type.is_compressed() {
                assert_eq!(parsed.jump_table.len(), 9);
                assert_eq!(parsed.jump_table[0], 8 + 9 * 8);
                assert_eq!(*parsed.jump_table.last().unwrap(), bytes.len() as i64);
            } else {
                assert_eq!(parsed.jump_table, vec![16]);
                assert_eq!(bytes.len(), 16 + 8 * 128);
            }
        }
    }

    #[test]
    fn write_errors() {
        let header = WkwHeader::new(1, 2, ChunkType::Lz4, ArrayDataType::U1, 1);
        assert_eq!(
            write_wkw_file(&header, [vec![0u8; 7]]).unwrap_err().message,
            "Error processing WKW file: Unexpected chunk size [expected: 8, actual: 7]."
        );
        assert_eq!(
            write_wkw_file(&header, Vec::<Vec<u8>>::new())
                .unwrap_err()
                .message,
            "No more chunks in iterator."
        );
    }

    #[test]
    fn corrupt_blocks_are_skipped_like_scala() {
        let header = WkwHeader::new(1, 2, ChunkType::Lz4, ArrayDataType::U1, 1);
        let mut bytes = write_wkw_file(&header, [vec![5u8; 8]]).unwrap();
        // claim a longer block than the encoded one: the decompressor leaves input unconsumed
        bytes.push(0);
        let last = bytes.len() as i64;
        bytes[16..24].copy_from_slice(&last.to_le_bytes());
        let (_, blocks) = read_wkw_file(&bytes).unwrap();
        assert!(blocks.is_empty());
        // truncated data
        let err = read_wkw_file(&bytes[..bytes.len() - 2]).unwrap_err();
        assert!(
            err.message.starts_with("Unexpected read size"),
            "{}",
            err.message
        );
    }
}
