
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
