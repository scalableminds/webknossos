
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
    let (out, consumed) = decode_block(&block, 1000, Lz4End::InputExhausted).unwrap();
    assert_eq!(consumed, block.len());
    assert_eq!(out.len(), 321);
    assert!(out[..320].iter().all(|&b| b == b'a'));
    assert_eq!(out[320], b'b');
    assert_eq!(
        decode_block(&block, 320, Lz4End::InputExhausted),
        Err(Lz4Error::TooLarge)
    );
}

#[test]
fn rejects_bad_offsets_and_truncation() {
    assert!(matches!(
        decode_block(&[0x10, b'a', 2, 0], 100, Lz4End::InputExhausted),
        Err(Lz4Error::Malformed(_))
    ));
    assert!(matches!(
        decode_block(&[0x10, b'a', 0, 0], 100, Lz4End::InputExhausted),
        Err(Lz4Error::Malformed(_))
    ));
    assert!(matches!(
        decode_block(&[0x10, b'a', 1], 100, Lz4End::InputExhausted),
        Err(Lz4Error::Malformed(_))
    ));
    assert!(matches!(
        decode_block(&[0x50, b'a'], 100, Lz4End::InputExhausted),
        Err(Lz4Error::Malformed(_))
    ));
    assert!(matches!(
        decode_block(&[0xF0], 100, Lz4End::InputExhausted),
        Err(Lz4Error::Malformed(_))
    ));
}

#[test]
fn round_trips_with_lz4_flex() {
    let data: Vec<u8> = (0..10_000u32).map(|i| (i / 7 % 13) as u8).collect();
    let compressed = compress_block(&data);
    assert!(compressed.len() < data.len());
    let (out, consumed) = decode_block(&compressed, data.len(), Lz4End::OutputFull).unwrap();
    assert_eq!(out, data);
    assert_eq!(consumed, compressed.len());
    let (out, _) = decode_block(&compressed, usize::MAX, Lz4End::InputExhausted).unwrap();
    assert_eq!(out, data);
    assert_eq!(
        decode_block(&compress_block(&[]), 0, Lz4End::OutputFull),
        Ok((Vec::new(), 1))
    );
}
