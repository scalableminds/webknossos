use super::*;

#[test]
fn decodes_overlapping_matches_and_long_lengths() {
    // 20 literals "a", then a run of 300 more "a" via offset 1.
    let mut block = vec![0xF0 | 0x0F, 5]; // literal len 15+5 = 20, match nibble 15
    block.extend(std::iter::repeat_n(b'a', 20));
    block.extend([1, 0]); // offset 1
    block.extend([255, 26]); // match len 15 + 255 + 26 + 4 = 300
    block.push(0x10); // final token: 1 literal
    block.push(b'b');
    let out = decompress(&block, 1000).unwrap();
    assert_eq!(out.len(), 321);
    assert!(out[..320].iter().all(|&b| b == b'a'));
    assert_eq!(out[320], b'b');
    assert_eq!(decompress(&block, 320), Err(Lz4Error::TooLarge));
}

#[test]
fn rejects_bad_offsets_and_truncation() {
    for block in [
        &[0x10, b'a', 2, 0][..], // offset before the start of the output
        &[0x10, b'a', 0, 0],     // offset 0
        &[0x10, b'a', 1],        // truncated offset
        &[0x50, b'a'],           // literals exceed the input
        &[0xF0],                 // truncated length
    ] {
        assert!(
            matches!(decompress(block, 100), Err(Lz4Error::Malformed(_))),
            "{block:?}"
        );
    }
}

#[test]
fn round_trips_with_lz4_flex() {
    let data: Vec<u8> = (0..10_000u32).map(|i| (i / 7 % 13) as u8).collect();
    let compressed = compress_block(&data);
    assert!(compressed.len() < data.len());
    assert_eq!(decompress_exact(&compressed, data.len()).unwrap(), data);
    assert_eq!(decompress(&compressed, usize::MAX).unwrap(), data);
    assert!(decompress_exact(&compressed, data.len() - 1).is_err());
    assert!(decompress_exact(&compressed, data.len() + 1).is_err());
    assert_eq!(decompress_exact(&compress_block(&[]), 0), Ok(Vec::new()));
}
